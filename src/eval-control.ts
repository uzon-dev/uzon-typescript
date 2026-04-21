// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Control flow expression evaluation.
 *
 * Extracted from Evaluator class — evalOrElse, evalIf, evalCase as free
 * functions receiving an EvalContext for callbacks.
 */

import type { AstNode, WhenClause } from "./ast.js";
import { Scope } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple,
  type UzonValue,
} from "./value.js";
import { UzonRuntimeError, UzonTypeError } from "./error.js";
import { isAdoptable } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { assertSameType, valuesEqual, unwrapValue, assertBool, typeTag } from "./eval-helpers.js";

// ── Cross-category adoption helper ──

/** §5: assertSameType with int→float cross-category adoption awareness.
 *  An adoptable integer literal may unify with a float value in branch contexts. */
function assertBranchTypeCompat(
  ctx: EvalContext,
  a: UzonValue, aNumType: string | null,
  b: UzonValue, bNumType: string | null,
  node: AstNode,
): void {
  if (typeof a === "bigint" && typeof b === "number" && isAdoptable(aNumType)) return;
  if (typeof b === "bigint" && typeof a === "number" && isAdoptable(bNumType)) return;
  assertSameType(a, b, node, ctx.structTypeNames);
}

// ── Or else ──

export function evalOrElse(
  ctx: EvalContext,
  node: { kind: "OrElse"; left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  // §4.5: literal `undefined` is not a value — reject in operand positions.
  if (node.left.kind === "UndefinedLiteral") {
    throw new UzonTypeError(
      "literal 'undefined' is not a value — cannot be an 'or else' operand",
      node.left.line, node.left.col,
    );
  }
  if (node.right.kind === "UndefinedLiteral") {
    throw new UzonTypeError(
      "literal 'undefined' is not a value — cannot be an 'or else' operand",
      node.right.line, node.right.col,
    );
  }
  const left = ctx.evalNode(node.left, scope, exclude);
  const leftNumType = ctx.numericType;
  if (left === UZON_UNDEFINED) {
    const right = ctx.evalNode(node.right, scope, exclude);
    if (leftNumType && !isAdoptable(leftNumType)) {
      ctx.numericType = leftNumType;
    }
    return right;
  }
  // §5.7: both operands must be the same type regardless of runtime values
  try {
    const right = ctx.resolveEnumVariantOrEval(node.right, left, scope, exclude);
    if (right !== UZON_UNDEFINED && right !== null && left !== null) {
      assertBranchTypeCompat(ctx, left, leftNumType, right, ctx.numericType, node as AstNode);
    }
  } catch (e) {
    if (e instanceof UzonTypeError) throw e;
  }
  ctx.numericType = leftNumType;
  return left;
}

// ── If expression ──

export function evalIf(
  ctx: EvalContext,
  node: { kind: "IfExpr"; condition: AstNode; thenBranch: AstNode; elseBranch: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  // §4.5: literal `undefined` is not a value — reject in branch positions.
  if (node.thenBranch.kind === "UndefinedLiteral") {
    throw new UzonTypeError(
      "literal 'undefined' is not a value — cannot be a 'then' branch result",
      node.thenBranch.line, node.thenBranch.col,
    );
  }
  if (node.elseBranch.kind === "UndefinedLiteral") {
    throw new UzonTypeError(
      "literal 'undefined' is not a value — cannot be an 'else' branch result",
      node.elseBranch.line, node.elseBranch.col,
    );
  }
  const cond = unwrapValue(ctx.evalNode(node.condition, scope, exclude));
  assertBool(cond, node.condition);
  const taken = cond === true
    ? ctx.evalNode(node.thenBranch, scope, exclude)
    : ctx.evalNode(node.elseBranch, scope, exclude);
  const takenNumType = ctx.numericType;
  // §5.9 R8: narrow the scope for the non-taken (speculative) branch so that
  // type-dependent references to the scrutinee don't produce spurious errors.
  const thenScope = narrowScopeForIfCondition(node.condition, scope, true);
  const elseScope = narrowScopeForIfCondition(node.condition, scope, false);
  // §5.9: both branches must evaluate to the same type
  try {
    const other = cond === true
      ? ctx.evalNode(node.elseBranch, elseScope, exclude)
      : ctx.evalNode(node.thenBranch, thenScope, exclude);
    if (taken !== null && other !== null
        && taken !== UZON_UNDEFINED && other !== UZON_UNDEFINED) {
      assertBranchTypeCompat(ctx, taken, takenNumType, other, ctx.numericType, node as AstNode);
    }
    // §3.4: empty list type inference from other branch
    if (Array.isArray(taken) && taken.length === 0 && Array.isArray(other) && other.length > 0) {
      const otherElemType = ctx.listElementTypes.get(other)
        ?? (other[0] !== null && other[0] !== undefined ? typeTag(other[0]) : null);
      if (otherElemType) ctx.listElementTypes.set(taken, otherElemType);
    }
  } catch (e) {
    if (e instanceof UzonTypeError) throw e;
  }
  ctx.numericType = takenNumType;
  return taken;
}

// §5.9 R8: narrow the scope for an if branch based on the condition.
// Supports `x is type T`, `x is not type T`, `x is named V`, `x is not named V`.
function narrowScopeForIfCondition(
  cond: AstNode, scope: Scope, thenBranch: boolean,
): Scope {
  if (cond.kind !== "BinaryOp") return scope;
  const bin = cond as { op: string; left: AstNode; right: AstNode };
  if (bin.left.kind !== "Identifier") return scope;
  const scrutineeName = (bin.left as { name: string }).name;

  // Determine effective narrowing direction (positive = narrow TO the target type/variant)
  let positive: boolean;
  if (bin.op === "is type" || bin.op === "is named") positive = thenBranch;
  else if (bin.op === "is not type" || bin.op === "is not named") positive = !thenBranch;
  else return scope;

  if (bin.op === "is type" || bin.op === "is not type") {
    const typeNode = bin.right as { path?: string[]; isNull?: boolean };
    const typeName = typeNode.isNull ? "null" : (typeNode.path?.join(".") ?? "");
    if (!typeName) return scope;
    if (positive) {
      return createNarrowedScope(scope, scrutineeName, typeName);
    }
    // Negative narrowing for union/tagged-union with exactly one remaining member
    const val = scope.has(scrutineeName) ? scope.get(scrutineeName) : undefined;
    if (val instanceof UzonUnion && val.types.length > 0) {
      const remaining = val.types.filter((t: string) => t !== typeName);
      if (remaining.length === 1) {
        return createNarrowedScope(scope, scrutineeName, remaining[0]);
      }
    }
    return scope;
  }

  // is named / is not named
  const variantName = (bin.right as { name: string }).name;
  const val = scope.has(scrutineeName) ? scope.get(scrutineeName) : undefined;
  if (!(val instanceof UzonTaggedUnion)) return scope;
  let variants: ReadonlyMap<string, string | null> | undefined;
  if (val.variants.size > 0) {
    variants = val.variants;
  } else if (val.typeName) {
    const typeDef = scope.getType([val.typeName]);
    if (typeDef && typeDef.variants) {
      const m = new Map<string, string | null>();
      for (const v of typeDef.variants) {
        m.set(v, typeDef.variantTypes?.get(v) ?? null);
      }
      variants = m;
    }
  }
  if (!variants) return scope;
  if (positive) {
    const innerType = variants.get(variantName);
    if (innerType) return createNarrowedScope(scope, scrutineeName, innerType);
    return scope;
  }
  // Negative: narrow only if exactly one remaining variant with a non-null inner type.
  // Multiple remaining variants (or a remaining nullary variant) leave the value as
  // a tagged union, so no primitive narrowing is possible.
  const remainingEntries: [string, string | null][] = [];
  for (const [tag, t] of variants) {
    if (tag !== variantName) remainingEntries.push([tag, t]);
  }
  if (remainingEntries.length === 1) {
    const innerType = remainingEntries[0][1];
    if (innerType) return createNarrowedScope(scope, scrutineeName, innerType);
  }
  return scope;
}

// ── Case expression ──

export function evalCase(
  ctx: EvalContext,
  node: {
    kind: "CaseExpr"; mode: "value" | "type" | "named"; scrutinee: AstNode;
    whenClauses: WhenClause[]; elseBranch: AstNode; line: number; col: number
  },
  scope: Scope, exclude?: string,
): UzonValue {
  const scrutinee = ctx.evalNode(node.scrutinee, scope, exclude);
  if (scrutinee === UZON_UNDEFINED) {
    throw new UzonRuntimeError(
      "Cannot use 'case' with undefined — use 'is undefined' check before 'case'",
      node.line, node.col,
    );
  }

  if (node.mode === "type") {
    return evalCaseType(ctx, node, scrutinee, scope, exclude);
  }

  if (node.mode === "named") {
    // §5.10: case named — only valid for tagged unions
    if (!(scrutinee instanceof UzonTaggedUnion)) {
      throw new UzonTypeError(
        "'case named' is only valid for tagged unions",
        node.line, node.col,
      );
    }
    return evalCaseNamed(ctx, node, scrutinee, scope, exclude);
  }

  // mode === "value": standard value matching
  const scrutineeNumType = ctx.numericType;
  if (scrutinee instanceof UzonUnion) {
    throw new UzonTypeError(
      "Cannot use 'case' with an untagged union — use 'case type' for type dispatch",
      node.line, node.col,
    );
  }

  let takenResult: UzonValue | undefined;
  let takenNumType: string | null = null;

  for (const wc of node.whenClauses) {
    const wcNode = wc.value as AstNode;
    if (wcNode.kind === "UndefinedLiteral") {
      throw new UzonTypeError(
        "'when undefined' is not allowed — use 'is undefined' check before 'case'",
        wc.line, wc.col,
      );
    }
    let whenVal: UzonValue;
    if (scrutinee instanceof UzonEnum && wcNode.kind === "Identifier") {
      const variantName = (wcNode as { name: string }).name;
      if (scrutinee.variants.includes(variantName)) {
        whenVal = new UzonEnum(variantName, scrutinee.variants, scrutinee.typeName);
      } else {
        whenVal = ctx.evalNode(wcNode, scope, exclude);
      }
    } else {
      whenVal = ctx.evalNode(wcNode, scope, exclude);
    }
    if (whenVal === UZON_UNDEFINED) {
      throw new UzonRuntimeError(
        "'when' clause evaluated to undefined — use 'is undefined' check before 'case'",
        wcNode.line, wcNode.col,
      );
    }
    assertBranchTypeCompat(ctx, scrutinee, scrutineeNumType, whenVal, ctx.numericType, wcNode);
    if (takenResult === undefined && valuesEqual(scrutinee, whenVal)) {
      takenResult = ctx.evalNode(wc.result, scope, exclude);
      takenNumType = ctx.numericType;
    }
  }

  const result = takenResult ?? ctx.evalNode(node.elseBranch, scope, exclude);
  const resultNumType = takenResult !== undefined ? takenNumType : ctx.numericType;
  assertBranchTypes(ctx, node, result, resultNumType, takenResult !== undefined, scope, exclude);
  ctx.numericType = resultNumType;
  return result;
}

function evalCaseNamed(
  ctx: EvalContext,
  node: { scrutinee: AstNode; whenClauses: WhenClause[]; elseBranch: AstNode; line: number; col: number },
  scrutinee: UzonTaggedUnion,
  scope: Scope, exclude?: string,
): UzonValue {
  let takenResult: UzonValue | undefined;
  let takenNumType: string | null = null;

  for (const wc of node.whenClauses) {
    const variantName = wc.value as string;
    let knownVariants: string[] | undefined;
    if (scrutinee.variants.size > 0) {
      knownVariants = [...scrutinee.variants.keys()];
    } else if (scrutinee.typeName) {
      const typeDef = scope.getType([scrutinee.typeName]);
      if (typeDef && typeDef.variants) knownVariants = typeDef.variants;
    }
    if (knownVariants && !knownVariants.includes(variantName)) {
      throw new UzonTypeError(
        `'${variantName}' is not a valid variant of this tagged union (variants: ${knownVariants.join(", ")})`,
        wc.line, wc.col,
      );
    }
    if (takenResult === undefined && scrutinee.tag === variantName) {
      takenResult = ctx.evalNode(wc.result, scope, exclude);
      takenNumType = ctx.numericType;
    }
  }

  const result = takenResult ?? ctx.evalNode(node.elseBranch, scope, exclude);
  const resultNumType = takenResult !== undefined ? takenNumType : ctx.numericType;
  // §5.10: case named — branch narrowing + type enforcement
  const narrowTypes = node.whenClauses.map(wc =>
    scrutinee.variants.get(wc.value as string) ?? null);
  const coveredTags = new Set(node.whenClauses.map(wc => wc.value as string));
  const remainingTypes: string[] = [];
  for (const [tag, innerType] of scrutinee.variants) {
    if (!coveredTags.has(tag) && innerType) remainingTypes.push(innerType);
  }
  const elseNarrowType = remainingTypes.length === 1 ? remainingTypes[0] : null;
  assertBranchTypesNarrowed(ctx, node, result, resultNumType, takenResult !== undefined,
    node.scrutinee, narrowTypes, elseNarrowType, scope, exclude);
  ctx.numericType = resultNumType;
  return result;
}

function evalCaseType(
  ctx: EvalContext,
  node: { scrutinee: AstNode; whenClauses: WhenClause[]; elseBranch: AstNode; line: number; col: number },
  scrutinee: UzonValue,
  scope: Scope, exclude?: string,
): UzonValue {
  let takenResult: UzonValue | undefined;
  let takenNumType: string | null = null;

  // Unwrap union/tagged union to get inner value for type matching
  const isUnion = scrutinee instanceof UzonUnion;
  const innerValue = isUnion ? scrutinee.value
    : scrutinee instanceof UzonTaggedUnion ? scrutinee.value
    : scrutinee;
  // §5.10: when scrutinee is a union (tagged or untagged), validate when-types
  const isTaggedUnion = scrutinee instanceof UzonTaggedUnion;
  let memberTypes: readonly string[] | null = null;
  if (isUnion) {
    memberTypes = (scrutinee as UzonUnion).types;
  } else if (isTaggedUnion) {
    // For tagged unions, the valid types are the distinct inner types across all variants
    const tu = scrutinee as UzonTaggedUnion;
    const innerTypes = new Set<string>();
    for (const vType of tu.variants.values()) {
      if (vType) innerTypes.add(vType);
    }
    if (innerTypes.size > 0) memberTypes = [...innerTypes];
  }
  for (const wc of node.whenClauses) {
    const typeName = wc.value as string;
    if (memberTypes && !memberTypes.includes(typeName)) {
      throw new UzonTypeError(
        `'${typeName}' is not a member type of this ${isUnion ? "union" : "tagged union"} (members: ${memberTypes.join(", ")})`,
        wc.line, wc.col,
      );
    }
    // §3.6: validate that when-clause type name is valid even for non-union scrutinees
    if (!memberTypes && !isValidTypeName(typeName, scope)) {
      throw new UzonTypeError(
        `'${typeName}' is not a valid type name`,
        wc.line, wc.col,
      );
    }
    if (takenResult === undefined && valueMatchesTypeName(innerValue, typeName)) {
      takenResult = ctx.evalNode(wc.result, scope, exclude);
      takenNumType = ctx.numericType;
    }
  }

  const result = takenResult ?? ctx.evalNode(node.elseBranch, scope, exclude);
  const resultNumType = takenResult !== undefined ? takenNumType : ctx.numericType;
  // §5.10: branch narrowing — non-matching branches are narrowed to the when-type
  const narrowTypes: (string | null)[] = node.whenClauses.map(wc => wc.value as string);
  const coveredTypes = new Set(narrowTypes.filter(Boolean) as string[]);
  const elseNarrowType = memberTypes
    ? (memberTypes.filter(t => !coveredTypes.has(t)).length === 1
      ? memberTypes.find(t => !coveredTypes.has(t))!
      : null)
    : null;
  assertBranchTypesNarrowed(ctx, node, result, resultNumType, takenResult !== undefined,
    node.scrutinee, narrowTypes, elseNarrowType, scope, exclude);
  ctx.numericType = resultNumType;
  return result;
}

/** §5.10: Branch type checking with narrowing.
 *  Speculatively evaluates non-matching branches in narrowed scopes.
 *  Evaluation errors are suppressed (the branch may reference the scrutinee
 *  in a type-dependent way). Successfully-evaluated results are always
 *  checked for type compatibility — regardless of scrutinee type. */
function assertBranchTypesNarrowed(
  ctx: EvalContext,
  node: { whenClauses: WhenClause[]; elseBranch: AstNode; line: number; col: number },
  result: UzonValue, resultNumType: string | null, hasTaken: boolean,
  scrutineeNode: AstNode,
  narrowTypes: (string | null)[],
  elseNarrowType: string | null,
  scope: Scope, exclude?: string,
): void {
  const scrutineeName = scrutineeNode.kind === "Identifier"
    ? (scrutineeNode as { name: string }).name : null;

  for (let i = 0; i < node.whenClauses.length; i++) {
    const wc = node.whenClauses[i];
    const nt = narrowTypes[i];
    const evalScope = (scrutineeName && nt)
      ? createNarrowedScope(scope, scrutineeName, nt)
      : scope;
    let branchResult: UzonValue;
    try {
      branchResult = ctx.evalNode(wc.result, evalScope, exclude);
    } catch (e) {
      // §D.5: type errors are always reported; only runtime errors are suppressed
      if (e instanceof UzonTypeError) throw e;
      continue;
    }
    if (result !== null && branchResult !== null
        && result !== UZON_UNDEFINED && branchResult !== UZON_UNDEFINED) {
      assertBranchTypeCompat(ctx, result, resultNumType, branchResult, ctx.numericType, node as unknown as AstNode);
    }
  }
  if (hasTaken) {
    const evalScope = (scrutineeName && elseNarrowType)
      ? createNarrowedScope(scope, scrutineeName, elseNarrowType)
      : scope;
    let elseResult: UzonValue;
    try {
      elseResult = ctx.evalNode(node.elseBranch, evalScope, exclude);
    } catch (e) {
      // §D.5: type errors are always reported; only runtime errors are suppressed
      if (e instanceof UzonTypeError) throw e;
      return;
    }
    if (result !== null && elseResult !== null
        && result !== UZON_UNDEFINED && elseResult !== UZON_UNDEFINED) {
      assertBranchTypeCompat(ctx, result, resultNumType, elseResult, ctx.numericType, node as unknown as AstNode);
    }
  }
}

// ── Narrowing helpers ──

function createNarrowedScope(scope: Scope, name: string, typeName: string): Scope {
  const child = new Scope(scope);
  const val = defaultForType(typeName);
  if (val === undefined) return scope; // Unknown type — can't narrow
  child.set(name, val);
  child.setNumericType(name, typeName);
  return child;
}

function defaultForType(typeName: string): UzonValue | undefined {
  if (/^[iu]\d+$/.test(typeName)) return 0n;
  if (/^f\d+$/.test(typeName)) return 0.0;
  if (typeName === "string") return "";
  if (typeName === "bool") return false;
  if (typeName === "null") return null;
  return undefined;
}

const BUILTIN_TYPE_NAMES = new Set([
  "null", "bool", "string",
  "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64",
  "f16", "f32", "f64", "f80", "f128",
]);

function isValidTypeName(typeName: string, scope: Scope): boolean {
  if (BUILTIN_TYPE_NAMES.has(typeName)) return true;
  if (typeName.startsWith("[") || typeName.startsWith("(")) return true;
  return !!scope.getType(typeName.split("."));
}

function valueMatchesTypeName(value: UzonValue, typeName: string): boolean {
  if (value === null) return typeName === "null";
  if (typeof value === "boolean") return typeName === "bool";
  if (typeof value === "string") return typeName === "string";
  if (typeof value === "bigint") return /^[iu]\d+$/.test(typeName);
  if (typeof value === "number") return /^f\d+$/.test(typeName);
  // §5.10: compound types in when clauses
  if (Array.isArray(value) && typeName.startsWith("[") && typeName.endsWith("]")) {
    const elemType = typeName.slice(1, -1);
    if (value.length === 0) return true;
    return value.some(el => el !== null && valueMatchesTypeName(el, elemType));
  }
  if (value instanceof UzonTuple && typeName.startsWith("(") && typeName.endsWith(")")) {
    return true;
  }
  return false;
}

function assertBranchTypes(
  ctx: EvalContext,
  node: { whenClauses: WhenClause[]; elseBranch: AstNode; line: number; col: number },
  result: UzonValue, resultNumType: string | null, hasTaken: boolean,
  scope: Scope, exclude?: string,
): void {
  for (const wc of node.whenClauses) {
    try {
      const branchResult = ctx.evalNode(wc.result, scope, exclude);
      if (result !== null && branchResult !== null
          && result !== UZON_UNDEFINED && branchResult !== UZON_UNDEFINED) {
        assertBranchTypeCompat(ctx, result, resultNumType, branchResult, ctx.numericType, node as unknown as AstNode);
      }
      if (Array.isArray(result) && result.length === 0 && Array.isArray(branchResult) && branchResult.length > 0) {
        const otherElemType = ctx.listElementTypes.get(branchResult)
          ?? (branchResult[0] !== null && branchResult[0] !== undefined ? typeTag(branchResult[0]) : null);
        if (otherElemType) ctx.listElementTypes.set(result, otherElemType);
      }
    } catch (e) {
      if (e instanceof UzonTypeError) throw e;
    }
  }
  if (hasTaken) {
    try {
      const elseResult = ctx.evalNode(node.elseBranch, scope, exclude);
      if (result !== null && elseResult !== null
          && result !== UZON_UNDEFINED && elseResult !== UZON_UNDEFINED) {
        assertBranchTypeCompat(ctx, result, resultNumType, elseResult, ctx.numericType, node as unknown as AstNode);
      }
      if (Array.isArray(result) && result.length === 0 && Array.isArray(elseResult) && elseResult.length > 0) {
        const otherElemType = ctx.listElementTypes.get(elseResult)
          ?? (elseResult[0] !== null && elseResult[0] !== undefined ? typeTag(elseResult[0]) : null);
        if (otherElemType) ctx.listElementTypes.set(result, otherElemType);
      }
    } catch (e) {
      if (e instanceof UzonTypeError) throw e;
    }
  }
}
