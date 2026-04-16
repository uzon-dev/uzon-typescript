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
import { collectDeps, topoSort } from "./eval-deps.js";
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
  importCache?: Map<string, Record<string, UzonValue>>;
  scopeCache?: Map<string, Scope>;
  importStack?: string[];
  /** Shared across imports: struct → type name */
  structTypeNames?: WeakMap<Record<string, UzonValue>, string>;
  /** Shared across imports: struct → scope */
  structScopes?: WeakMap<Record<string, UzonValue>, Scope>;
  /** Shared across imports: list → element type */
  listElementTypes?: WeakMap<UzonValue[], string>;
}

// ── Evaluator ────────────────────────────────────────────────────

export class Evaluator implements EvalContext {
  private env: Record<string, string>;
  private filename: string | null;
  private fileReader: ((path: string) => string) | null;
  private importCache: Map<string, Record<string, UzonValue>>;
  private scopeCache: Map<string, Scope>;
  private importStack: string[];
  structScopes!: WeakMap<Record<string, UzonValue>, Scope>;
  structTypeNames!: WeakMap<Record<string, UzonValue>, string>;
  listElementTypes!: WeakMap<UzonValue[], string>;
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
    this.importCache = options.importCache ?? new Map();
    this.scopeCache = options.scopeCache ?? new Map();
    this.importStack = options.importStack ?? [];
    this.structTypeNames = options.structTypeNames ?? new WeakMap();
    this.structScopes = options.structScopes ?? new WeakMap();
    this.listElementTypes = options.listElementTypes ?? new WeakMap();
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
    const { bindingMap, order } = this.resolveBindingOrder(bindings, allowOverloads);
    this.validateBindings(bindings);
    this.evaluateInOrder(order, bindingMap, scope, locals);
  }

  /** Step 1+2: Build dependency graph + topological sort. */
  private resolveBindingOrder(
    bindings: BindingNode[], allowOverloads: boolean,
  ): { bindingMap: Map<string, BindingNode>; order: string[] } {
    const deps = new Map<string, Set<string>>();
    const bindingMap = new Map<string, BindingNode>();
    const names = new Set<string>();
    const hasPriorBinding = new Set<string>();

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

    for (const b of bindings) {
      const d = collectDeps(b.value, names);
      if (d.has(b.name) && b.value.kind === "FunctionExpr" && !hasPriorBinding.has(b.name)) {
        throw new UzonTypeError(
          `Direct recursion detected: '${b.name}' references itself — the call graph must be a DAG`,
          b.line, b.col,
        );
      }
      d.delete(b.name);
      deps.set(b.name, d);
    }

    return { bindingMap, order: topoSort(deps, bindings) };
  }

  /** Step 3: Pre-evaluation validation of bindings. */
  private validateBindings(bindings: BindingNode[]): void {
    for (const b of bindings) {
      // §3.1: literal `undefined` cannot appear on the RHS of `is` in a binding.
      if (b.value.kind === "UndefinedLiteral") {
        throw new UzonTypeError(
          `Cannot assign literal 'undefined' to '${b.name}' — undefined is a state, not a value`,
          b.value.line, b.value.col,
        );
      }
      if (b.value.kind === "ListLiteral"
          && (b.value as { elements: AstNode[] }).elements.length === 0) {
        throw new UzonTypeError(
          "Empty list requires a type annotation — use 'as [Type]' (e.g., [] as [i32])",
          b.value.line, b.value.col,
        );
      }
      if (b.value.kind === "ListLiteral") {
        const elems = (b.value as { elements: AstNode[] }).elements;
        if (elems.length > 0 && elems.every(e => e.kind === "NullLiteral")) {
          throw new UzonTypeError(
            "All-null list requires a type annotation — use 'as [Type]' (e.g., [null] as [i32])",
            b.value.line, b.value.col,
          );
        }
      }
    }
  }

  /** Step 4: Evaluate bindings in dependency order. */
  private evaluateInOrder(
    order: string[], bindingMap: Map<string, BindingNode>,
    scope: Scope, locals?: Map<string, UzonValue>,
  ): void {
    for (const name of order) {
      const b = bindingMap.get(name)!;
      let val = this.evalNode(b.value, scope, name);

      if (b.calledName) {
        val = this.applyCalledName(val, b.calledName);
      }

      scope.set(name, val);
      if (locals && val !== UZON_UNDEFINED) locals.set(name, val);

      this.storeNumericType(val, b, scope);

      if (b.calledName) {
        this.registerType(b.calledName, b.value, val, scope);
      }

      this.registerStructScope(val, name, scope);
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
      );
    }
    if (val !== null && typeof val === "object" && !Array.isArray(val)
        && !(val instanceof UzonTuple)) {
      this.structTypeNames.set(val as Record<string, UzonValue>, calledName);
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
    // §3.7.1: tagged unions are transparent
    if (source instanceof UzonTaggedUnion) source = source.value;
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
    resolvedPath = this.normalizePath(resolvedPath);

    if (this.importCache.has(resolvedPath)) {
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
      if (valueNode.kind === "StructLiteral") {
        for (const field of (valueNode as StructLiteralNode).fields) {
          if (field.value.kind === "TypeAnnotation") {
            const typePath = field.value.type.path.join(".");
            fieldAnnotations.set(field.name, typePath);
          }
        }
      }
      scope.setType(name, {
        kind: "struct", name, fields,
        ...(fieldAnnotations.size > 0 ? { fieldAnnotations } : {}),
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
