// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Evaluator — evaluates a UZON AST into runtime values.
 *
 * Pipeline: source → Lexer → Parser → Evaluator → Record<string, UzonValue>
 *
 * Key design decisions (all bug fixes from the reference absorbed):
 * - Dependency graph + topological sort for binding evaluation order (§3.1)
 * - Binding self-exclusion: lookups skip the binding currently being evaluated
 * - Adoptable numeric defaults: untyped literals are ~i64/~f64 until resolved
 * - Tagged union transparency: unwrap for operations, NOT for `with` (§3.7.1)
 * - Speculative branch evaluation: non-taken branches propagate type errors (§5.9)
 * - std namespace: built-in functions (§5.16)
 *
 * See SPECIFICATION.md §3–§7 for the full evaluation rules.
 */

import type {
  AstNode, BindingNode, DocumentNode, StructLiteralNode,
  TypeExprNode, StringPart,
} from "./ast.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";
import { Scope } from "./scope.js";
import {
  UzonError, UzonRuntimeError, UzonTypeError, UzonCircularError, UzonSyntaxError,
} from "./error.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";

// ── Extracted modules ──
import type { EvalContext } from "./eval-context.js";
import { collectDeps, topoSort, checkFunctionCallDag } from "./eval-deps.js";
import {
  validateIntegerType, validateFloatType,
  actualType, isAdoptable,
} from "./eval-numeric.js";
import { evalBinaryOp, evalUnaryOp, evalIn as evalInImpl } from "./eval-operators.js";
import { evalTypeAnnotation } from "./eval-type-annotation.js";
import { evalConversion } from "./eval-type-conversion.js";
import {
  evalFunctionExpr, evalFunctionCall, callFunctionDirect as callFunctionDirectImpl,
} from "./eval-functions.js";
import { evalOrElse, evalIf, evalCase } from "./eval-control.js";
import { evalStructOverride, evalStructPlus } from "./eval-structs.js";
import {
  typeCategory, typeTag, listElementCategory,
  valueToString, typeExprToString,
} from "./eval-helpers.js";

// §5.12: Ordinal member access on lists/tuples
const ORDINALS: Record<string, number> = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4,
  sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9,
};

// ── Options ──────────────────────────────────────────────────────

export interface EvalOptions {
  env?: Record<string, string>;
  filename?: string;
  fileReader?: (path: string) => string;
  /** Resolve a path to its canonical form (e.g. resolving symlinks). */
  realpath?: (path: string) => string;
  importCache?: Map<string, Record<string, UzonValue>>;
  scopeCache?: Map<string, Scope>;
  importStack?: string[];
  /** Shared across imports: struct → type name */
  structTypeNames?: WeakMap<Record<string, UzonValue>, string>;
  /** Shared across imports: struct → scope */
  structScopes?: WeakMap<Record<string, UzonValue>, Scope>;
  /** Shared across imports: list → element type */
  listElementTypes?: WeakMap<UzonValue[], string>;
  /** Shared across imports: list → named list type */
  listTypeNames?: WeakMap<UzonValue[], string>;
}

// ── Evaluator ────────────────────────────────────────────────────

export class Evaluator implements EvalContext {
  private env: Record<string, string>;
  private filename: string | null;
  private fileReader: ((path: string) => string) | null;
  private realpathFn: ((path: string) => string) | null;
  private importCache: Map<string, Record<string, UzonValue>>;
  private scopeCache: Map<string, Scope>;
  private importStack: string[];
  /** Collected errors for multi-error reporting (circular deps, import cycles). */
  collectedErrors: UzonError[] = [];
  structScopes!: WeakMap<Record<string, UzonValue>, Scope>;
  structTypeNames!: WeakMap<Record<string, UzonValue>, string>;
  listElementTypes!: WeakMap<UzonValue[], string>;
  listTypeNames!: WeakMap<UzonValue[], string>;
  private tupleElementTypes = new WeakMap<UzonTuple, (string | null)[]>();
  /** Active function-local bindings for bare identifier resolution (§3.8) */
  functionLocals: Map<string, UzonValue> | null = null;
  /** Runtime call stack for recursion detection (§3.8) */
  callStack = new Set<UzonFunction>();

  /**
   * §5: Tracks the numeric type of the most recently evaluated expression.
   * "~i64" = adoptable default integer, "i32" = concrete.
   * null = untyped / non-numeric context.
   */
  numericType: string | null = null;

  constructor(private options: EvalOptions = {}) {
    this.env = options.env ?? ((globalThis as any).process?.env as Record<string, string> ?? {});
    this.filename = options.filename ?? null;
    this.fileReader = options.fileReader ?? null;
    this.realpathFn = options.realpath ?? null;
    this.importCache = options.importCache ?? new Map();
    this.scopeCache = options.scopeCache ?? new Map();
    this.importStack = options.importStack ?? [];
    this.structTypeNames = options.structTypeNames ?? new WeakMap();
    this.structScopes = options.structScopes ?? new WeakMap();
    this.listElementTypes = options.listElementTypes ?? new WeakMap();
    this.listTypeNames = options.listTypeNames ?? new WeakMap();
  }

  // ── Public API ──

  evaluate(doc: DocumentNode): Record<string, UzonValue> {
    try {
      const scope = new Scope();
      // §5.16: Inject std namespace sentinel
      scope.set("std", Object.freeze(Object.create(null)) as UzonValue);
      this.evaluateBindings(doc.bindings, scope, true);
      const result: Record<string, UzonValue> = {};
      for (const b of doc.bindings) {
        const val = scope.get(b.name)!;
        if (val !== UZON_UNDEFINED) {
          result[b.name] = val;
        }
      }
      if (this.filename) {
        this.scopeCache.set(this.filename, scope);
      }
      return result;
    } catch (e) {
      if (e instanceof UzonError && this.filename) {
        e.withFilename(this.filename);
      }
      throw e;
    }
  }

  // ── Binding evaluation with dependency graph ──

  evaluateBindings(
    bindings: BindingNode[], scope: Scope, allowOverloads = false,
    locals?: Map<string, UzonValue>,
  ): void {
    const deps = new Map<string, Set<string>>();
    const bindingMap = new Map<string, BindingNode>();
    const names = new Set<string>();
    const hasPriorBinding = new Set<string>();
    const fnCycleNames = new Set<string>();

    // Step 1: Build name set and detect duplicates
    for (const b of bindings) {
      if (names.has(b.name)) {
        if (!allowOverloads
            || (b.value.kind !== "FunctionExpr" && b.value.kind !== "FieldExtraction")) {
          throw new UzonSyntaxError(`Duplicate binding '${b.name}'`, b.line, b.col);
        }
        hasPriorBinding.add(b.name);
      }
      names.add(b.name);
      bindingMap.set(b.name, b);
    }

    // Step 2: Collect dependencies
    for (const b of bindings) {
      const d = collectDeps(b.value, names);
      d.delete(b.name);
      deps.set(b.name, d);
    }

    // Step 2b: Check function call DAG — detect direct & mutual recursion with call site locations
    const fnCycles = checkFunctionCallDag(bindings);
    for (const entry of fnCycles) {
      this.collectedErrors.push(new UzonCircularError(
        `Recursion detected: '${entry.name}' participates in a call cycle — the call graph must be a DAG`,
        entry.line, entry.col,
      ));
      fnCycleNames.add(entry.name);
    }

    // Step 3: Topological sort — collect ALL cycle participants
    const { order, cycleNames } = topoSort(deps, bindings);
    for (const name of cycleNames) {
      if (!fnCycleNames.has(name)) {
        const b = bindings.find(b => b.name === name)!;
        this.collectedErrors.push(new UzonCircularError(
          `Circular dependency detected involving '${name}'`,
          b.line, b.col,
        ));
      }
    }

    // Step 4: Evaluate non-cycle bindings via partial topological order.
    // All errors are collected so that multiple problems are reported at once.
    const preCount = this.collectedErrors.length;
    let hadErrors = cycleNames.length > 0 || fnCycleNames.size > 0;
    for (const name of order) {
      if (fnCycleNames.has(name)) continue;
      const b = bindingMap.get(name)!;

      // Inline validation — collect and continue
      if (b.value.kind === "UndefinedLiteral") {
        this.collectedErrors.push(new UzonTypeError(
          `Cannot assign literal 'undefined' to '${b.name}' — undefined is a state, not a value`,
          b.value.line, b.value.col,
        ));
        hadErrors = true;
        continue;
      }
      if (b.value.kind === "EnvRef") {
        this.collectedErrors.push(new UzonTypeError(
          "standalone env is not a value; use env.VARIABLE_NAME",
          b.value.line, b.value.col,
        ));
        hadErrors = true;
        continue;
      }

      try {
        let val = this.evalNode(b.value, scope, name);

        // Post-eval validation
        if (b.value.kind === "ListLiteral" && Array.isArray(val) && val.length === 0) {
          this.collectedErrors.push(new UzonTypeError(
            "Empty list requires a type annotation — use 'as [Type]' (e.g., [] as [i32])",
            b.value.line, b.value.col,
          ));
          hadErrors = true;
          continue;
        }
        if (b.value.kind === "ListLiteral" && Array.isArray(val)
            && val.length > 0 && val.every(e => e === null)) {
          this.collectedErrors.push(new UzonTypeError(
            "All-null list requires a type annotation — use 'as [Type]' (e.g., [null] as [i32])",
            b.value.line, b.value.col,
          ));
          hadErrors = true;
          continue;
        }

        if (b.calledName) val = this.applyCalledName(val, b.calledName);
        scope.set(name, val);
        if (locals && val !== UZON_UNDEFINED) locals.set(name, val);
        this.storeNumericType(val, b, scope);
        if (b.calledName) this.registerType(b.calledName, b.value, val, scope);
        this.registerStructScope(val, name, scope);
      } catch (e) {
        if (e instanceof UzonCircularError) {
          if (this.collectedErrors.length === preCount) {
            this.collectedErrors.push(e);
          }
        } else if (e instanceof UzonError) {
          this.collectedErrors.push(e);
        } else {
          throw e; // non-Uzon errors (e.g. OOM) propagate
        }
        hadErrors = true;
      }
    }

    // If any errors were found, throw to signal failure
    if (hadErrors) {
      throw this.collectedErrors[this.collectedErrors.length - 1];
    }
  }

  /** Attach a `called` type name to a value. */
  private applyCalledName(val: UzonValue, calledName: string): UzonValue {
    if (val instanceof UzonEnum && val.typeName === null) {
      return new UzonEnum(val.value, val.variants, calledName);
    }
    if (val instanceof UzonUnion && val.typeName === null) {
      return new UzonUnion(val.value, val.types, calledName);
    }
    if (val instanceof UzonTaggedUnion && val.typeName === null) {
      return new UzonTaggedUnion(val.value, val.tag, val.variants, calledName);
    }
    if (val instanceof UzonFunction && val.typeName === null) {
      return new UzonFunction(
        val.paramNames, val.paramTypes, val.defaultValues,
        val.returnType, val.body, val.finalExpr, val.closureScope, calledName,
        val.paramTypeExprs, val.returnTypeExpr,
      );
    }
    if (val !== null && typeof val === "object" && !Array.isArray(val)
        && !(val instanceof UzonTuple)) {
      this.structTypeNames.set(val as Record<string, UzonValue>, calledName);
    }
    if (Array.isArray(val)) {
      this.listTypeNames.set(val, calledName);
    }
    return val;
  }

  /** Store resolved numeric type for a binding. */
  private storeNumericType(val: UzonValue, b: BindingNode, scope: Scope): void {
    if (this.numericType && (typeof val === "bigint" || typeof val === "number")) {
      const concreteType = actualType(this.numericType)!;
      if (isAdoptable(this.numericType)) {
        if (typeof val === "bigint") validateIntegerType(val, concreteType, b.value);
        else if (typeof val === "number") validateFloatType(val, concreteType, b.value);
      }
      scope.setNumericType(b.name, concreteType);
    }
  }

  /** Register child scope for struct bindings (type path resolution). */
  private registerStructScope(val: UzonValue, name: string, scope: Scope): void {
    if (val !== null && typeof val === "object" && !Array.isArray(val)
        && !(val instanceof UzonEnum) && !(val instanceof UzonUnion)
        && !(val instanceof UzonTaggedUnion) && !(val instanceof UzonTuple)
        && !(val instanceof UzonFunction)) {
      const existing = this.structScopes.get(val as Record<string, UzonValue>)
        ?? this.getImportScope(val as Record<string, UzonValue>);
      if (existing) {
        scope.setChildScope(name, existing);
      } else {
        const childScope = new Scope(scope);
        for (const [k, v] of Object.entries(val)) {
          childScope.set(k, v);
        }
        scope.setChildScope(name, childScope);
      }
    }
  }

  // ── Node evaluation dispatcher ──

  evalNode(node: AstNode, scope: Scope, exclude?: string): UzonValue {
    this.numericType = null;
    switch (node.kind) {
      case "IntegerLiteral": {
        const v = this.evalInteger(node.value);
        this.numericType = "~i64"; // adoptable default
        return v;
      }
      case "FloatLiteral": {
        const v = this.evalFloat(node.value);
        this.numericType = "~f64";
        return v;
      }
      case "BoolLiteral": return node.value;
      case "NullLiteral": return null;
      case "UndefinedLiteral": return UZON_UNDEFINED;
      case "InfLiteral": this.numericType = "~f64"; return node.negative ? -Infinity : Infinity;
      case "NanLiteral": this.numericType = "~f64"; return NaN;

      case "StringLiteral": return this.evalString(node.parts, scope, exclude, node);
      case "Identifier": return this.resolveIdentifier(node.name, node, scope, exclude);

      case "EnvRef":
        throw new UzonTypeError("'env' must be followed by .NAME", node.line, node.col);

      case "MemberAccess": return this.evalMemberAccess(node, scope, exclude);
      case "BinaryOp": return evalBinaryOp(this, node, scope, exclude);
      case "UnaryOp": return evalUnaryOp(this, node, scope, exclude);
      case "OrElse": return evalOrElse(this, node, scope, exclude);
      case "IfExpr": return evalIf(this, node, scope, exclude);
      case "CaseExpr": return evalCase(this, node, scope, exclude);

      case "TypeAnnotation": return evalTypeAnnotation(this, node, scope, exclude);
      case "Conversion": return evalConversion(this, node, scope, exclude);
      case "StructOverride": return evalStructOverride(this, node, scope, exclude);
      case "StructPlus": return evalStructPlus(this, node, scope, exclude);
      case "FromEnum": return this.evalFromEnum(node, scope, exclude);
      case "FromUnion": return this.evalFromUnion(node, scope, exclude);
      case "NamedVariant": return this.evalNamedVariant(node, scope, exclude);
      case "StandaloneUnion": return this.evalStandaloneUnion(node, scope);
      case "StandaloneTaggedUnion": return this.evalStandaloneTaggedUnion(node, scope);
      case "VariantShorthand":
        // §3.7 v0.10: variant shorthand requires type context. It should be
        // intercepted by evalTypeAnnotation, struct field eval, or function
        // argument eval. Reaching here means no context is available.
        throw new UzonTypeError(
          `Variant shorthand '${node.variantName} ...' requires type context — use 'as TypeName' or place in a typed position`,
          node.line, node.col,
        );
      case "FieldExtraction": return this.evalFieldExtraction(node, scope, exclude);

      case "FunctionExpr": return evalFunctionExpr(this, node, scope, exclude);
      case "FunctionCall": return evalFunctionCall(this, node, scope, exclude);

      case "StructLiteral": return this.evalStructLiteral(node, scope);
      case "ListLiteral": return this.evalList(node, scope, exclude);
      case "TupleLiteral": return this.evalTuple(node, scope, exclude);
      case "Grouping": return this.evalNode(node.expr, scope, exclude);

      case "StructImport": return this.evalStructImport(node, scope);

      default:
        throw new UzonRuntimeError(`Unexpected node: ${(node as AstNode).kind}`, node.line, node.col);
    }
  }

  // ── Literals ──

  private evalInteger(raw: string): bigint {
    const cleaned = raw.replace(/_/g, "");
    if (cleaned.startsWith("0x") || cleaned.startsWith("0X")
        || cleaned.startsWith("-0x") || cleaned.startsWith("-0X")) {
      const neg = cleaned.startsWith("-");
      const val = BigInt("0x" + cleaned.slice(neg ? 3 : 2));
      return neg ? -val : val;
    }
    if (cleaned.startsWith("0o") || cleaned.startsWith("0O")
        || cleaned.startsWith("-0o") || cleaned.startsWith("-0O")) {
      const neg = cleaned.startsWith("-");
      const val = BigInt("0o" + cleaned.slice(neg ? 3 : 2));
      return neg ? -val : val;
    }
    if (cleaned.startsWith("0b") || cleaned.startsWith("0B")
        || cleaned.startsWith("-0b") || cleaned.startsWith("-0B")) {
      const neg = cleaned.startsWith("-");
      const val = BigInt("0b" + cleaned.slice(neg ? 3 : 2));
      return neg ? -val : val;
    }
    return BigInt(cleaned);
  }

  private evalFloat(raw: string): number {
    return Number(raw.replace(/_/g, ""));
  }

  private evalString(parts: StringPart[], scope: Scope, exclude: string | undefined, _node: AstNode): string {
    let result = "";
    for (const part of parts) {
      if (typeof part === "string") {
        result += part;
      } else {
        const val = this.evalNode(part, scope, exclude);
        if (val === UZON_UNDEFINED) {
          throw new UzonRuntimeError(
            "undefined cannot be used in string interpolation — use 'or else' to provide a fallback",
            part.line, part.col,
          );
        }
        result += valueToString(val, part);
      }
    }
    return result;
  }

  // ── Identifier resolution ──

  private resolveIdentifier(name: string, node: AstNode, scope?: Scope, exclude?: string): UzonValue {
    // §3.8: Inside function bodies, parameters and body bindings are bare identifiers
    if (this.functionLocals?.has(name)) {
      return this.functionLocals.get(name)!;
    }
    if (scope) {
      const val = scope.get(name, exclude);
      if (val !== UZON_UNDEFINED) {
        const nt = scope.getNumericType(name);
        if (nt) this.numericType = nt;
      }
      return val;
    }
    return UZON_UNDEFINED;
  }

  /**
   * §3.5 point 4: Type-context inference for enum variants.
   * If contextVal is a named enum and node is a bare Identifier matching a variant,
   * resolve it as that variant. Otherwise, evaluate normally.
   */
  resolveEnumVariantOrEval(
    node: AstNode, contextVal: UzonValue, scope: Scope, exclude?: string,
  ): UzonValue {
    if (node.kind === "Identifier" && contextVal instanceof UzonEnum && contextVal.typeName) {
      const name = (node as { name: string }).name;
      if (contextVal.variants.includes(name)) {
        return new UzonEnum(name, contextVal.variants, contextVal.typeName);
      }
    }
    return this.evalNode(node, scope, exclude);
  }

  /**
   * §3.5 + §3.7 v0.10: Context-aware evaluation.
   *
   * Evaluate `node` with the expected type `typeExpr` as context. Enables:
   *   - VariantShorthand resolution against a tagged union type
   *   - Bare Identifier as enum variant or nullary tagged-union variant
   *   - StructLiteral with a named struct type — applies field defaults and
   *     recurses with each field's declared type
   *   - ListLiteral with a typed element — recurses per element
   *
   * Returns the annotated value. Callers are responsible for any outer
   * validation (e.g., list homogeneity, struct nominal identity).
   */
  evalInContext(
    node: AstNode, typeExpr: TypeExprNode, scope: Scope, exclude?: string,
  ): UzonValue {
    // List with element type context
    if (typeExpr.isList && typeExpr.inner && node.kind === "ListLiteral") {
      const elements: UzonValue[] = [];
      for (const elem of node.elements) {
        const v = this.evalInContext(elem, typeExpr.inner, scope, exclude);
        if (v === UZON_UNDEFINED) {
          throw new UzonRuntimeError(`List element resolved to undefined`, elem.line, elem.col);
        }
        elements.push(v);
      }
      this.listElementTypes.set(elements, typeExpr.inner.path.join("."));
      return elements;
    }

    const typeDef = scope.getType(typeExpr.path);

    // VariantShorthand requires tagged union context
    if (node.kind === "VariantShorthand") {
      if (typeDef && typeDef.kind === "tagged_union") {
        return this.expandVariantShorthand(node, typeDef, scope, exclude);
      }
      throw new UzonTypeError(
        `Variant shorthand '${node.variantName} ...' requires a tagged union type context, got '${typeExpr.path.join(".")}'`,
        node.line, node.col,
      );
    }

    // Bare Identifier in inference position — try variant resolution if not a binding
    if (node.kind === "Identifier" && typeDef) {
      const name = node.name;
      const bindingPresent = scope.has(name) && name !== exclude;
      if (!bindingPresent) {
        if (typeDef.kind === "enum" && typeDef.variants?.includes(name)) {
          return new UzonEnum(name, typeDef.variants, typeDef.name);
        }
        if (typeDef.kind === "tagged_union" && typeDef.variants?.includes(name)) {
          // Must be a nullary variant (inner type is null/absent)
          const innerType = typeDef.variantTypes?.get(name);
          if (innerType === undefined || innerType === null) {
            const variantsMap = new Map<string, string | null>();
            for (const v of typeDef.variants) {
              variantsMap.set(v, typeDef.variantTypes?.get(v) ?? null);
            }
            return new UzonTaggedUnion(null, name, variantsMap, typeDef.name);
          }
          throw new UzonTypeError(
            `Variant '${name}' of tagged union '${typeDef.name}' is not nullary — provide an inner value`,
            node.line, node.col,
          );
        }
      }
    }

    // StructLiteral with named struct context — fill defaults and recurse
    if (node.kind === "StructLiteral" && typeDef && typeDef.kind === "struct") {
      return this.evalStructLiteralInContext(node, typeDef, scope, exclude);
    }

    // §3.7 v0.10: `variant(args)` / `variant (args)` — parsed as FunctionCall
    // but in a tagged union context with no matching binding, treated as variant
    // shorthand. Single arg becomes the inner value; multiple args become a tuple.
    if (
      node.kind === "FunctionCall" && node.callee.kind === "Identifier"
      && typeDef && typeDef.kind === "tagged_union"
    ) {
      const variantName = node.callee.name;
      const bindingPresent = scope.has(variantName) && variantName !== exclude;
      if (!bindingPresent && typeDef.variants?.includes(variantName)) {
        const innerNode: AstNode = node.args.length === 1
          ? node.args[0]
          : {
              kind: "TupleLiteral",
              elements: node.args,
              line: node.line, col: node.col,
            };
        return this.expandVariantShorthand(
          { variantName, inner: innerNode, line: node.line, col: node.col },
          typeDef, scope, exclude,
        );
      }
    }

    // Fallthrough — evaluate normally then apply standard type annotation checks
    // (e.g., primitive/numeric, struct conformance for an already-built value).
    return this.evalNode(node, scope, exclude);
  }

  /**
   * §3.7 v0.10: Expand a variant shorthand into a UzonTaggedUnion using the
   * tagged union's variant metadata. The inner expression is evaluated with
   * the variant's inner type as context (enabling nested shorthands).
   */
  private expandVariantShorthand(
    node: { variantName: string; inner: AstNode; line: number; col: number },
    typeDef: { name: string; variants?: string[]; variantTypes?: Map<string, string> },
    scope: Scope, exclude?: string,
  ): UzonTaggedUnion {
    const { variantName, inner } = node;
    if (!typeDef.variants?.includes(variantName)) {
      throw new UzonTypeError(
        `'${variantName}' is not a variant of tagged union '${typeDef.name}'`,
        node.line, node.col,
      );
    }
    const innerTypeName = typeDef.variantTypes?.get(variantName) ?? null;
    let innerVal: UzonValue;
    if (innerTypeName === null) {
      // Nullary variant — inner must be null literal or a bare identifier that resolves to null.
      innerVal = this.evalNode(inner, scope, exclude);
      if (innerVal !== null) {
        throw new UzonTypeError(
          `Variant '${variantName}' of tagged union '${typeDef.name}' is nullary — inner value must be null`,
          node.line, node.col,
        );
      }
    } else {
      // Build a synthetic TypeExpr for the inner and eval with context
      const innerTypeExpr: TypeExprNode = {
        kind: "TypeExpr",
        path: innerTypeName.split("."),
        isList: false, inner: null, isNull: false,
        isTuple: false, tupleElements: null,
        line: node.line, col: node.col,
      };
      innerVal = this.evalInContext(inner, innerTypeExpr, scope, exclude);
    }
    const variantsMap = new Map<string, string | null>();
    for (const v of typeDef.variants) {
      variantsMap.set(v, typeDef.variantTypes?.get(v) ?? null);
    }
    return new UzonTaggedUnion(innerVal, variantName, variantsMap, typeDef.name);
  }

  /**
   * §3.2 v0.10: Evaluate a struct literal with a declared struct type, applying
   * field defaults for missing fields and evaluating explicit fields with each
   * field's declared type as context. Returns the constructed struct object.
   */
  private evalStructLiteralInContext(
    node: { kind: "StructLiteral"; fields: BindingNode[]; line: number; col: number },
    typeDef: {
      name: string;
      templateValue?: Record<string, UzonValue>;
      fieldTypeExprs?: Map<string, TypeExprNode>;
    },
    scope: Scope, _exclude?: string,
  ): Record<string, UzonValue> {
    const template = typeDef.templateValue ?? {};
    const templateKeys = Object.keys(template);
    const templateKeySet = new Set(templateKeys);

    // Reject unknown fields upfront.
    for (const f of node.fields) {
      if (!templateKeySet.has(f.name)) {
        throw new UzonTypeError(
          `Extra field '${f.name}' not defined in type '${typeDef.name}'`,
          f.line, f.col,
        );
      }
    }

    const childScope = new Scope(scope);
    const result: Record<string, UzonValue> = {};
    const seen = new Set<string>();

    for (const f of node.fields) {
      if (seen.has(f.name)) {
        throw new UzonSyntaxError(
          `Duplicate field '${f.name}' in struct literal`,
          f.line, f.col,
        );
      }
      seen.add(f.name);
      const fieldTypeExpr = typeDef.fieldTypeExprs?.get(f.name);
      let val: UzonValue;
      if (fieldTypeExpr) {
        val = this.evalInContext(f.value, fieldTypeExpr, childScope, f.name);
      } else {
        val = this.evalNode(f.value, childScope, f.name);
      }
      if (val !== UZON_UNDEFINED) {
        childScope.set(f.name, val);
        result[f.name] = val;
      }
    }

    // Fill missing fields from template defaults (§3.2 v0.10).
    for (const key of templateKeys) {
      if (!(key in result)) {
        result[key] = template[key];
      }
    }

    this.structScopes.set(result, childScope);
    this.structTypeNames.set(result, typeDef.name);
    return result;
  }

  // ── Member access ──

  private evalMemberAccess(
    node: { kind: "MemberAccess"; object: AstNode; member: string; line: number; col: number },
    scope: Scope, exclude?: string,
  ): UzonValue {
    if (node.object.kind === "EnvRef") {
      const val = this.env[node.member];
      return val !== undefined ? val : UZON_UNDEFINED;
    }
    const obj = this.evalNode(node.object, scope, exclude);
    return this.accessMember(obj, node.member, node);
  }

  private accessMember(obj: UzonValue, member: string, node: AstNode): UzonValue {
    if (obj === UZON_UNDEFINED) return UZON_UNDEFINED;
    // §5.12: null is a value, not a missing state
    if (obj === null) {
      throw new UzonTypeError(
        "Cannot access member on null — null is a value, not a struct. Use 'is null' to check first.",
        node.line, node.col,
      );
    }
    // §3.7.1: tagged unions are transparent
    if (obj instanceof UzonTaggedUnion) {
      return this.accessMember(obj.value, member, node);
    }
    // §3.6: untagged unions are transparent for member access
    if (obj instanceof UzonUnion) {
      return this.accessMember(obj.value, member, node);
    }
    // §5.12 (R4): functions have no fields.
    if (obj instanceof UzonFunction) {
      throw new UzonTypeError(
        `Cannot access member '${member}' on a function value — functions have no fields`,
        node.line, node.col,
      );
    }
    // Struct field
    if (typeof obj === "object" && !Array.isArray(obj)
        && !(obj instanceof UzonEnum) && !(obj instanceof UzonUnion)
        && !(obj instanceof UzonTaggedUnion) && !(obj instanceof UzonTuple)
        && !(obj instanceof UzonFunction)) {
      if (!(member in obj)) return UZON_UNDEFINED;
      const val = (obj as Record<string, UzonValue>)[member];
      const childScope = this.structScopes.get(obj as Record<string, UzonValue>);
      if (childScope) {
        const nt = childScope.getNumericType(member);
        if (nt) this.numericType = nt;
      }
      return val;
    }
    // List/tuple index (numeric or ordinal)
    if (Array.isArray(obj) || obj instanceof UzonTuple) {
      const elements = obj instanceof UzonTuple ? obj.elements : obj;
      let idx = -1;
      if (/^\d+$/.test(member)) idx = Number(member);
      if (member in ORDINALS) idx = ORDINALS[member];
      if (idx >= 0 && idx < elements.length) {
        const val = elements[idx];
        if (Array.isArray(obj)) {
          const nt = this.listElementTypes.get(obj);
          if (nt && /^[iuf]\d+$/.test(nt)) this.numericType = nt;
        }
        if (obj instanceof UzonTuple) {
          const types = this.tupleElementTypes.get(obj);
          if (types && types[idx]) this.numericType = types[idx];
        }
        return val;
      }
      return UZON_UNDEFINED;
    }
    return UZON_UNDEFINED;
  }

  // ── Membership (in) — delegates to eval-operators ──

  evalIn(
    left: UzonValue, right: UzonValue, node: AstNode,
    leftNumType?: string | null, rightNumType?: string | null,
  ): boolean {
    return evalInImpl(this, left, right, node, leftNumType, rightNumType);
  }

  // ── Enum / Union / Tagged union ──

  private evalFromEnum(
    node: { kind: "FromEnum"; value: AstNode; variants: string[]; line: number; col: number },
    scope: Scope, exclude?: string,
  ): UzonValue {
    if (node.variants.length < 2) {
      throw new UzonTypeError("An enum must have at least two variants", node.line, node.col);
    }
    // §3.5/§9: duplicate variant names are a type error.
    const seen = new Set<string>();
    for (const v of node.variants) {
      if (seen.has(v)) {
        throw new UzonTypeError(`duplicate variant "${v}" in enum`, node.line, node.col);
      }
      seen.add(v);
    }
    let variantName: string;
    if (node.value.kind === "Identifier") {
      variantName = node.value.name;
    } else {
      const val = this.evalNode(node.value, scope, exclude);
      if (val instanceof UzonEnum) {
        variantName = val.value;
      } else {
        throw new UzonTypeError("Enum value must be a variant name", node.line, node.col);
      }
    }
    if (!node.variants.includes(variantName)) {
      throw new UzonTypeError(
        `'${variantName}' is not one of the variants: ${node.variants.join(", ")}`,
        node.line, node.col,
      );
    }
    return new UzonEnum(variantName, node.variants);
  }

  /**
   * §3.6: Default value of a type for standalone union declarations.
   * Returns null if the type has no default (function, nested anon union).
   */
  private defaultValueForType(type: TypeExprNode, scope: Scope): UzonValue | null {
    if (type.isNull) return null;
    if (type.isList) return [] as UzonValue[];
    if (type.isTuple) {
      // Non-empty tuple: default each element; empty tuple: ()
      if (!type.tupleElements || type.tupleElements.length === 0) return new UzonTuple([]);
      const elems: UzonValue[] = [];
      for (const t of type.tupleElements) {
        const d = this.defaultValueForType(t, scope);
        if (d === null && !t.isNull) {
          // A tuple element with no default — propagate failure.
          return null;
        }
        elems.push(d);
      }
      return new UzonTuple(elems);
    }
    const typeName = type.path.join(".");
    if (/^[iu]\d+$/.test(typeName)) return 0n;
    if (/^f\d+$/.test(typeName)) return 0.0;
    if (typeName === "string") return "";
    if (typeName === "bool") return false;
    if (typeName === "null") return null;
    if (typeName === "function") return null; // error marker: no default
    // Named type — look up
    const typeDef = scope.getType(type.path);
    if (typeDef) {
      if (typeDef.kind === "enum" && typeDef.variants && typeDef.variants.length > 0) {
        return new UzonEnum(typeDef.variants[0], typeDef.variants, typeDef.name);
      }
      if (typeDef.kind === "struct" && typeDef.templateValue) {
        return { ...typeDef.templateValue } as UzonValue;
      }
      if (typeDef.kind === "tagged_union" && typeDef.variants && typeDef.variants.length > 0) {
        const firstTag = typeDef.variants[0];
        const firstTypeName = typeDef.variantTypes?.get(firstTag);
        let inner: UzonValue = null;
        if (firstTypeName) {
          inner = this.defaultValueForNamedType(firstTypeName, scope);
        }
        const variantsMap = new Map<string, string | null>();
        for (const v of typeDef.variants) {
          variantsMap.set(v, typeDef.variantTypes?.get(v) ?? null);
        }
        return new UzonTaggedUnion(inner, firstTag, variantsMap, typeDef.name);
      }
      if (typeDef.kind === "union") {
        // Nested named union is allowed — not an anonymous nested union
        if (typeDef.memberTypes && typeDef.memberTypes.length > 0) {
          const inner = this.defaultValueForNamedType(typeDef.memberTypes[0], scope);
          return new UzonUnion(inner, typeDef.memberTypes, typeDef.name);
        }
      }
      if (typeDef.kind === "function") return null; // no default
    }
    return null;
  }

  /** Lookup + default by string type name (for named-type chains). */
  private defaultValueForNamedType(typeName: string, scope: Scope): UzonValue {
    if (/^[iu]\d+$/.test(typeName)) return 0n;
    if (/^f\d+$/.test(typeName)) return 0.0;
    if (typeName === "string") return "";
    if (typeName === "bool") return false;
    if (typeName === "null") return null;
    const typeDef = scope.getType(typeName.split("."));
    if (!typeDef) return null;
    if (typeDef.kind === "enum" && typeDef.variants?.length) {
      return new UzonEnum(typeDef.variants[0], typeDef.variants, typeDef.name);
    }
    if (typeDef.kind === "struct" && typeDef.templateValue) {
      return { ...typeDef.templateValue } as UzonValue;
    }
    return null;
  }

  private evalStandaloneUnion(
    node: { kind: "StandaloneUnion"; types: TypeExprNode[]; line: number; col: number },
    scope: Scope,
  ): UzonValue {
    if (node.types.length < 2) {
      throw new UzonTypeError("A union must have at least two member types", node.line, node.col);
    }
    // §3.6: duplicate member types in union are a type error.
    const seen = new Set<string>();
    for (const t of node.types) {
      const name = typeExprToString(t);
      if (seen.has(name)) {
        throw new UzonTypeError(`duplicate type "${name}" in union`, node.line, node.col);
      }
      seen.add(name);
    }
    const first = node.types[0];
    const firstName = typeExprToString(first);
    // §3.6: function or nested anonymous union as first member → type error
    if (firstName === "function") {
      throw new UzonTypeError(
        "Standalone union declaration cannot use 'function' as first member — use inline 'from union' with an explicit value",
        node.line, node.col,
      );
    }
    // Detect nested anonymous union — a TypeExpr whose path is a single
    // unknown name that happens to be a union is fine (it's *named*);
    // but anonymous nested unions can only appear through unusual constructs
    // and are not syntactically expressible in a TypeExpr. So we accept
    // all path-based types here and just compute the default.
    const defaultVal = this.defaultValueForType(first, scope);
    if (defaultVal === null && !first.isNull && firstName !== "null") {
      throw new UzonTypeError(
        `Standalone union declaration cannot use '${firstName}' as first member — type has no default value`,
        node.line, node.col,
      );
    }
    const typeNames = node.types.map(t => typeExprToString(t));
    return new UzonUnion(defaultVal, typeNames);
  }

  private evalStandaloneTaggedUnion(
    node: { kind: "StandaloneTaggedUnion"; variants: [string, TypeExprNode][]; line: number; col: number },
    scope: Scope,
  ): UzonValue {
    if (node.variants.length < 2) {
      throw new UzonTypeError("A tagged union must have at least two variants", node.line, node.col);
    }
    // §3.7: duplicate variant names are a type error.
    const seen = new Set<string>();
    for (const [name] of node.variants) {
      if (seen.has(name)) {
        throw new UzonTypeError(`duplicate variant "${name}" in tagged union`, node.line, node.col);
      }
      seen.add(name);
    }
    const [firstTag, firstType] = node.variants[0];
    const firstName = typeExprToString(firstType);
    if (firstName === "function") {
      throw new UzonTypeError(
        "Standalone tagged union declaration cannot use 'function' as first variant's type — use inline 'named' + 'from' with an explicit value",
        node.line, node.col,
      );
    }
    const defaultVal = this.defaultValueForType(firstType, scope);
    if (defaultVal === null && !firstType.isNull && firstName !== "null") {
      throw new UzonTypeError(
        `Standalone tagged union declaration cannot use '${firstName}' as first variant's type — type has no default value`,
        node.line, node.col,
      );
    }
    const variantsMap = new Map<string, string | null>();
    for (const [name, type] of node.variants) {
      variantsMap.set(name, type.isNull ? null : typeExprToString(type));
    }
    return new UzonTaggedUnion(defaultVal, firstTag, variantsMap);
  }

  private evalFromUnion(
    node: { kind: "FromUnion"; value: AstNode; types: TypeExprNode[]; line: number; col: number },
    scope: Scope, exclude?: string,
  ): UzonValue {
    if (node.types.length < 2) {
      throw new UzonTypeError("A union must have at least two member types", node.line, node.col);
    }
    // §3.6: duplicate member types in union are a type error.
    const seenTypes = new Set<string>();
    for (const t of node.types) {
      const name = t.path.join(".");
      if (name && seenTypes.has(name)) {
        throw new UzonTypeError(`duplicate type "${name}" in union`, node.line, node.col);
      }
      seenTypes.add(name);
    }
    const val = this.evalNode(node.value, scope, exclude);
    if (val === UZON_UNDEFINED) {
      throw new UzonRuntimeError("Union value resolved to undefined", node.line, node.col);
    }
    const typeNames = node.types.map(t => typeExprToString(t));
    return new UzonUnion(val, typeNames);
  }

  private evalNamedVariant(
    node: {
      kind: "NamedVariant"; value: AstNode; tag: string;
      variants: [string, TypeExprNode][] | null; line: number; col: number
    },
    scope: Scope, exclude?: string,
  ): UzonValue {
    // §6.3: when inner is `as TaggedUnionType`, evaluate inner expression directly
    let val: UzonValue;
    if (node.value.kind === "TypeAnnotation") {
      const innerNode = (node.value as { expr: AstNode }).expr;
      val = this.evalNode(innerNode, scope, exclude);
    } else {
      val = this.evalNode(node.value, scope, exclude);
    }
    if (val === UZON_UNDEFINED) {
      throw new UzonRuntimeError("Tagged union value resolved to undefined", node.line, node.col);
    }
    const variants = new Map<string, string | null>();
    let typeName: string | null = null;
    if (node.variants) {
      if (node.variants.length < 2) {
        throw new UzonTypeError("A tagged union must have at least two variants", node.line, node.col);
      }
      // §3.5/§9: duplicate variant names are a type error.
      const seenNames = new Set<string>();
      for (const [name, type] of node.variants) {
        if (seenNames.has(name)) {
          throw new UzonTypeError(`duplicate variant "${name}" in tagged union`, node.line, node.col);
        }
        seenNames.add(name);
        variants.set(name, type.isNull ? null : typeExprToString(type));
      }
    } else if (node.value.kind === "TypeAnnotation") {
      // §6.3: Type reuse via as annotation
      const typePath = (node.value as { type: TypeExprNode }).type.path;
      typeName = typePath.join(".");
      const typeDef = scope.getType(typePath);
      if (typeDef && typeDef.kind === "tagged_union" && typeDef.variants) {
        for (const v of typeDef.variants) {
          variants.set(v, typeDef.variantTypes?.get(v) ?? null);
        }
        if (!variants.has(node.tag)) {
          throw new UzonTypeError(
            `'${node.tag}' is not a valid variant of '${typeName}' (variants: ${typeDef.variants.join(", ")})`,
            node.line, node.col,
          );
        }
      }
    }
    return new UzonTaggedUnion(val, node.tag, variants, typeName);
  }

  // ── Field extraction ──

  private evalFieldExtraction(
    node: { kind: "FieldExtraction"; bindingName: string; source: AstNode; line: number; col: number },
    scope: Scope, exclude?: string,
  ): UzonValue {
    let source = this.evalNode(node.source, scope, exclude);
    if (source === UZON_UNDEFINED) return UZON_UNDEFINED;
    // §3.7.1/§3.6: unions are transparent for member access
    if (source instanceof UzonTaggedUnion) source = source.value;
    if (source instanceof UzonUnion) source = source.value;
    if (source === null || typeof source !== "object" || Array.isArray(source)
        || source instanceof UzonEnum || source instanceof UzonUnion
        || source instanceof UzonTuple || source instanceof UzonFunction) {
      throw new UzonTypeError("'of' requires a struct", node.line, node.col);
    }
    return (node.bindingName in source)
      ? (source as Record<string, UzonValue>)[node.bindingName]
      : UZON_UNDEFINED;
  }

  // ── Compound literals ──

  private evalStructLiteral(
    node: { kind: "StructLiteral"; fields: BindingNode[]; line: number; col: number },
    scope: Scope,
  ): UzonValue {
    const childScope = new Scope(scope);
    this.evaluateBindings(node.fields, childScope);
    const result: Record<string, UzonValue> = {};
    for (const f of node.fields) {
      const val = childScope.get(f.name)!;
      if (val !== UZON_UNDEFINED) result[f.name] = val;
    }
    this.structScopes.set(result, childScope);
    return result;
  }

  private evalList(
    node: { kind: "ListLiteral"; elements: AstNode[]; line: number; col: number },
    scope: Scope, exclude?: string,
  ): UzonValue {
    const result = node.elements.map((e, i) => {
      const val = this.evalNode(e, scope, exclude);
      if (val === UZON_UNDEFINED) {
        throw new UzonRuntimeError(`List element ${i} resolved to undefined`, e.line, e.col);
      }
      return val;
    });
    // §3.4: All elements must be the same type; null is compatible with any type
    if (result.length > 1) {
      const inferredCat = listElementCategory(result);
      if (inferredCat !== null) {
        for (let i = 0; i < result.length; i++) {
          if (result[i] === null) continue;
          const cat = typeCategory(result[i]);
          if (cat !== inferredCat) {
            throw new UzonTypeError(
              `List element ${i} is ${cat} but expected ${inferredCat} — all list elements must be the same type`,
              node.elements[i].line, node.elements[i].col,
            );
          }
        }
        // §3.4 + §3.2.1: Struct elements must have same shape and named type
        if (inferredCat === "struct") {
          this.validateListStructHomogeneity(result, node);
        }
      }
    }
    return result;
  }

  private validateListStructHomogeneity(
    result: UzonValue[],
    node: { elements: AstNode[]; line: number; col: number },
  ): void {
    // Find first non-null struct element as reference
    let refIdx = -1;
    let refStruct: Record<string, UzonValue> | null = null;
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== null && typeof result[i] === "object" && !Array.isArray(result[i])) {
        refIdx = i;
        refStruct = result[i] as Record<string, UzonValue>;
        break;
      }
    }
    if (refStruct === null) return;

    const refKeys = Object.keys(refStruct);
    const refTypeName = this.structTypeNames.get(refStruct) ?? null;

    for (let i = refIdx + 1; i < result.length; i++) {
      if (result[i] === null) continue;
      const elem = result[i] as Record<string, UzonValue>;
      const elemKeys = Object.keys(elem);

      // Check named type compatibility (§3.2.1 rule 5)
      const elemTypeName = this.structTypeNames.get(elem) ?? null;
      if (refTypeName !== elemTypeName) {
        const refDesc = refTypeName ?? "anonymous struct";
        const elemDesc = elemTypeName ?? "anonymous struct";
        throw new UzonTypeError(
          `List element ${i} is ${elemDesc} but expected ${refDesc} — all struct elements must have the same type`,
          node.elements[i].line, node.elements[i].col,
        );
      }

      // Check same field names (§3.2.1 rule 4)
      if (elemKeys.length !== refKeys.length) {
        throw new UzonTypeError(
          `List element ${i} has ${elemKeys.length} fields but expected ${refKeys.length} — all struct elements must have the same shape`,
          node.elements[i].line, node.elements[i].col,
        );
      }
      for (const key of refKeys) {
        if (!(key in elem)) {
          throw new UzonTypeError(
            `List element ${i} is missing field '${key}' — all struct elements must have the same shape`,
            node.elements[i].line, node.elements[i].col,
          );
        }
      }

      // Check same field value types
      for (const key of refKeys) {
        const refValCat = typeCategory(refStruct[key]);
        const elemValCat = typeCategory(elem[key]);
        if (refValCat === "null" || elemValCat === "null") continue;
        if (refValCat !== elemValCat) {
          throw new UzonTypeError(
            `List element ${i} field '${key}' is ${elemValCat} but expected ${refValCat} — all struct elements must have the same field types`,
            node.elements[i].line, node.elements[i].col,
          );
        }
      }
    }
  }

  private evalTuple(
    node: { kind: "TupleLiteral"; elements: AstNode[]; line: number; col: number },
    scope: Scope, exclude?: string,
  ): UzonValue {
    const elemTypes: (string | null)[] = [];
    const elements = node.elements.map((e, i) => {
      const val = this.evalNode(e, scope, exclude);
      if (val === UZON_UNDEFINED) {
        throw new UzonRuntimeError(`Tuple element ${i} resolved to undefined`, e.line, e.col);
      }
      elemTypes.push(actualType(this.numericType));
      return val;
    });
    const tuple = new UzonTuple(elements);
    if (elemTypes.some(t => t !== null)) {
      this.tupleElementTypes.set(tuple, elemTypes);
    }
    return tuple;
  }

  // ── Struct import ──

  private evalStructImport(
    node: { kind: "StructImport"; path: string; line: number; col: number },
    _scope: Scope,
  ): UzonValue {
    if (!this.fileReader) {
      throw new UzonRuntimeError("File imports are not supported in this context", node.line, node.col);
    }
    let resolvedPath = node.path;
    if (this.filename) {
      const dir = this.filename.replace(/[/\\][^/\\]*$/, "");
      resolvedPath = dir + "/" + resolvedPath;
    }
    const lastSeg = resolvedPath.split("/").pop()!;
    if (!lastSeg.includes(".")) resolvedPath += ".uzon";

    // Normalize: logical normalization first, then realpath for symlink resolution
    resolvedPath = this.normalizePath(resolvedPath);
    if (this.realpathFn) {
      try { resolvedPath = this.realpathFn(resolvedPath); } catch { /* keep normalized */ }
    }

    if (this.importCache.has(resolvedPath)) {
      // Restore cached scope for type information
      if (this.scopeCache.has(resolvedPath)) {
        // Type info already available via scopeCache
      }
      return this.importCache.get(resolvedPath)! as unknown as UzonValue;
    }
    if (this.importStack.includes(resolvedPath)) {
      throw new UzonCircularError(`Circular file import: ${resolvedPath}`, node.line, node.col);
    }

    let source: string;
    try {
      source = this.fileReader(resolvedPath);
    } catch {
      throw new UzonRuntimeError(`Cannot read file: ${resolvedPath}`, node.line, node.col);
    }
    const tokens = new Lexer(source).tokenize();
    const doc = new Parser(tokens).parse();

    const childEval = new Evaluator({
      ...this.options,
      filename: resolvedPath,
      importCache: this.importCache,
      scopeCache: this.scopeCache,
      importStack: [...this.importStack, resolvedPath],
      structTypeNames: this.structTypeNames,
      structScopes: this.structScopes,
      listElementTypes: this.listElementTypes,
    });

    try {
      const result = childEval.evaluate(doc);
      this.importCache.set(resolvedPath, result);
      return result as unknown as UzonValue;
    } catch (e) {
      // Don't propagate the imported file's internal collected errors —
      // they belong to that file, not the importer.
      // Only propagate a single import-level error.
      if (e instanceof UzonError) {
        if (!e.filename) e.withFilename(resolvedPath);
        e.addImportFrame(this.filename ?? "<string>", node.line, node.col);
      }
      throw e;
    }
  }

  private normalizePath(p: string): string {
    const parts = p.split("/");
    const result: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") {
        if (result.length > 0 && result[result.length - 1] !== "..") result.pop();
        else result.push(part);
      } else {
        result.push(part);
      }
    }
    return (p.startsWith("/") ? "/" : "") + result.join("/");
  }

  // ── Function call — delegates to eval-functions ──

  callFunctionDirect(fn: UzonFunction, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
    return callFunctionDirectImpl(this, fn, args, scope, node);
  }

  // ── Type registration ──

  private registerType(name: string, valueNode: AstNode, val: UzonValue, scope: Scope): void {
    if (scope.hasOwnType(name)) {
      throw new UzonTypeError(
        `Duplicate type name '${name}' — type names must be unique within the same scope`,
        valueNode.line, valueNode.col,
      );
    }
    if (val instanceof UzonEnum) {
      scope.setType(name, { kind: "enum", name, variants: [...val.variants] });
    } else if (val instanceof UzonUnion) {
      scope.setType(name, { kind: "union", name, memberTypes: [...val.types] });
    } else if (val instanceof UzonTaggedUnion) {
      const variantTypes = new Map<string, string>();
      for (const [k, v] of val.variants) { if (v !== null) variantTypes.set(k, v); }
      scope.setType(name, {
        kind: "tagged_union", name,
        variants: [...val.variants.keys()],
        ...(variantTypes.size > 0 ? { variantTypes } : {}),
      });
    } else if (val instanceof UzonFunction) {
      scope.setType(name, {
        kind: "function", name,
        paramTypes: [...val.paramTypes],
        returnType: val.returnType,
      });
    } else if (Array.isArray(val)) {
      const elemType = this.listElementTypes.get(val) ?? (val.length > 0 ? typeTag(val[0]) : null);
      scope.setType(name, {
        kind: "list", name,
        ...(elemType ? { elementType: elemType } : {}),
      });
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)
        && !(val instanceof UzonTuple)) {
      const fields = new Map<string, string>();
      for (const [k, v] of Object.entries(val as Record<string, UzonValue>)) {
        fields.set(k, typeTag(v));
      }
      const fieldAnnotations = new Map<string, string>();
      const fieldTypeExprs = new Map<string, TypeExprNode>();
      if (valueNode.kind === "StructLiteral") {
        for (const field of (valueNode as StructLiteralNode).fields) {
          if (field.value.kind === "TypeAnnotation") {
            const typeNode = field.value.type;
            const typePath = typeNode.path.join(".");
            fieldAnnotations.set(field.name, typePath);
            fieldTypeExprs.set(field.name, typeNode);
          }
        }
      }
      scope.setType(name, {
        kind: "struct", name, fields,
        ...(fieldAnnotations.size > 0 ? { fieldAnnotations } : {}),
        ...(fieldTypeExprs.size > 0 ? { fieldTypeExprs } : {}),
        templateValue: val as Record<string, UzonValue>,
      });
    } else {
      // Primitives and null — register as a primitive type
      const baseType = val === null ? "null"
        : typeof val === "boolean" ? "bool"
        : typeof val === "bigint" ? "i64"
        : typeof val === "number" ? "f64"
        : typeof val === "string" ? "string"
        : "unknown";
      scope.setType(name, { kind: "primitive", name, elementType: baseType });
    }
  }

  private getImportScope(val: Record<string, UzonValue>): Scope | undefined {
    const ss = this.structScopes.get(val);
    if (ss) return ss;
    for (const [, scope] of this.scopeCache) {
      const names = scope.ownBindingNames().filter(n => n !== "std");
      if (names.length === 0) continue;
      const keys = Object.keys(val);
      if (keys.length !== names.length) continue;
      if (keys.every(k => names.includes(k) && Object.is(scope.get(k), val[k]))) {
        return scope;
      }
    }
    return undefined;
  }
}
