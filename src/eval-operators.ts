// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Binary and unary operator evaluation.
 *
 * Extracted from Evaluator class — all operator logic as free functions
 * receiving an EvalContext for callbacks.
 */

import type { AstNode, BinaryOp } from "./ast.js";
import type { Scope } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";
import { UzonRuntimeError, UzonTypeError } from "./error.js";
import {
  validateIntegerType, validateFloatType, resolveNumericTypes,
  actualType, isAdoptable,
} from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import {
  unwrapValue, assertBool, assertSameType, valuesEqual,
  typeCategory, listElementCategory,
} from "./eval-helpers.js";

// ── Binary operator dispatcher ──

export function evalBinaryOp(
  ctx: EvalContext,
  node: { kind: "BinaryOp"; op: BinaryOp; left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const { op } = node;

  // Short-circuit logical operators
  if (op === "and") return evalAnd(ctx, node, scope, exclude);
  if (op === "or") return evalOr(ctx, node, scope, exclude);

  // Equality with §3.5 type-context inference
  if (op === "is") return evalIs(ctx, node, scope, exclude);
  if (op === "is not") return evalIsNot(ctx, node, scope, exclude);

  // is named / is not named
  if (op === "is named" || op === "is not named") return evalIsNamed(ctx, node, scope, exclude);

  // is type / is not type
  if (op === "is type" || op === "is not type") return evalIsTypeOp(ctx, node, scope, exclude);

  // Membership
  if (op === "in") return evalInOp(ctx, node, scope, exclude);

  const left = ctx.evalNode(node.left, scope, exclude);
  const leftNumType = ctx.numericType;
  const right = ctx.evalNode(node.right, scope, exclude);
  const rightNumType = ctx.numericType;

  if (left === UZON_UNDEFINED || right === UZON_UNDEFINED) {
    throw new UzonRuntimeError(
      `Cannot use '${op}' with undefined — use 'or else' to provide a fallback`,
      node.line, node.col,
    );
  }

  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%" || op === "^") {
    return evalArithmetic(ctx, op, left, right, node as AstNode, leftNumType, rightNumType);
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    return evalComparison(ctx, op, left, right, node as AstNode, leftNumType, rightNumType);
  }
  if (op === "++") return evalConcat(ctx, left, right, node as AstNode);
  if (op === "**") return evalRepetition(ctx, left, right, node as AstNode);

  throw new UzonRuntimeError(`Unknown operator: ${op}`, node.line, node.col);
}

// ── Logical operators ──

function evalAnd(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const left = unwrapValue(ctx.evalNode(node.left, scope, exclude));
  if (left === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot use 'and' with undefined — use 'or else' to provide a fallback", node.left.line, node.left.col);
  }
  assertBool(left, node.left);
  if (left === false) {
    // §5.9: speculatively evaluate right — suppress runtime errors, propagate type errors
    try {
      const right = unwrapValue(ctx.evalNode(node.right, scope, exclude));
      if (right === UZON_UNDEFINED) {
        throw new UzonRuntimeError("Cannot use 'and' with undefined", node.right.line, node.right.col);
      }
      assertBool(right, node.right);
    } catch (e) { if (e instanceof UzonTypeError) throw e; }
    return false;
  }
  const right = unwrapValue(ctx.evalNode(node.right, scope, exclude));
  if (right === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot use 'and' with undefined — use 'or else' to provide a fallback", node.right.line, node.right.col);
  }
  assertBool(right, node.right);
  return right;
}

function evalOr(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const left = unwrapValue(ctx.evalNode(node.left, scope, exclude));
  if (left === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot use 'or' with undefined — use 'or else' to provide a fallback", node.left.line, node.left.col);
  }
  assertBool(left, node.left);
  if (left === true) {
    try {
      const right = unwrapValue(ctx.evalNode(node.right, scope, exclude));
      if (right === UZON_UNDEFINED) {
        throw new UzonRuntimeError("Cannot use 'or' with undefined", node.right.line, node.right.col);
      }
      assertBool(right, node.right);
    } catch (e) { if (e instanceof UzonTypeError) throw e; }
    return true;
  }
  const right = unwrapValue(ctx.evalNode(node.right, scope, exclude));
  if (right === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot use 'or' with undefined — use 'or else' to provide a fallback", node.right.line, node.right.col);
  }
  assertBool(right, node.right);
  return right;
}

// ── Equality ──

function evalIsOperands(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): [UzonValue, UzonValue] {
  let left: UzonValue, right: UzonValue;
  let leftNumType: string | null, rightNumType: string | null;
  if (node.right.kind === "Identifier") {
    left = ctx.evalNode(node.left, scope, exclude);
    leftNumType = ctx.numericType;
    const leftInner = left instanceof UzonUnion ? left.value : left;
    right = ctx.resolveEnumVariantOrEval(node.right, leftInner, scope, exclude);
    rightNumType = ctx.numericType;
  } else if (node.left.kind === "Identifier") {
    right = ctx.evalNode(node.right, scope, exclude);
    rightNumType = ctx.numericType;
    const rightInner = right instanceof UzonUnion ? right.value : right;
    left = ctx.resolveEnumVariantOrEval(node.left, rightInner, scope, exclude);
    leftNumType = ctx.numericType;
  } else {
    left = ctx.evalNode(node.left, scope, exclude);
    leftNumType = ctx.numericType;
    right = ctx.evalNode(node.right, scope, exclude);
    rightNumType = ctx.numericType;
  }
  // §3.6: Union type identity check before unwrapping
  if (left instanceof UzonUnion && right instanceof UzonUnion) {
    // Named unions: nominal identity
    if (left.typeName || right.typeName) {
      if (left.typeName !== right.typeName) {
        throw new UzonTypeError(
          `Cannot compare different union types: ${left.typeName ?? "anonymous"} vs ${right.typeName ?? "anonymous"}`,
          node.line, node.col,
        );
      }
    } else {
      // Anonymous unions: structural identity (same member type set, order irrelevant)
      const leftSet = new Set(left.types);
      const rightSet = new Set(right.types);
      if (leftSet.size !== rightSet.size || [...leftSet].some(t => !rightSet.has(t))) {
        throw new UzonTypeError(
          `Cannot compare unions with different member types: (${left.types.join(", ")}) vs (${right.types.join(", ")})`,
          node.line, node.col,
        );
      }
    }
    // Same union type — compare inner values; different runtime types → false (not error)
    left = left.value;
    right = right.value;
    try {
      assertSameType(left, right, node as AstNode);
    } catch (e) {
      // §3.8: function comparison is always a type error, even inside unions
      if (left instanceof UzonFunction || right instanceof UzonFunction) throw e;
      return [left, right];
    }
  } else {
    if (left instanceof UzonUnion) left = left.value;
    if (right instanceof UzonUnion) right = right.value;
  }

  // §5: cross-category promotion for is/is not — adoptable int can adopt float type
  if (typeof left === "bigint" && typeof right === "number"
      && isAdoptable(leftNumType)) {
    left = Number(left);
  } else if (typeof right === "bigint" && typeof left === "number"
      && isAdoptable(rightNumType)) {
    right = Number(right);
  }

  assertSameType(left, right, node as AstNode);
  return [left, right];
}

function evalIs(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  const [left, right] = evalIsOperands(ctx, node, scope, exclude);
  return valuesEqual(left, right);
}

function evalIsNot(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  const [left, right] = evalIsOperands(ctx, node, scope, exclude);
  return !valuesEqual(left, right);
}

function evalIsNamed(
  ctx: EvalContext,
  node: { op: BinaryOp; left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  const left = ctx.evalNode(node.left, scope, exclude);
  if (left === UZON_UNDEFINED) {
    throw new UzonRuntimeError("'is named' operand resolved to undefined", node.line, node.col);
  }
  if (!(left instanceof UzonTaggedUnion)) {
    throw new UzonTypeError("'is named' can only be used with tagged unions", node.line, node.col);
  }
  const variantName = (node.right as { name: string }).name;
  // §3.7.2: validate variant name
  let knownVariants: string[] | undefined;
  if (left.variants.size > 0) {
    knownVariants = [...left.variants.keys()];
  } else if (left.typeName) {
    const typeDef = scope.getType([left.typeName]);
    if (typeDef && typeDef.variants) knownVariants = typeDef.variants;
  }
  if (knownVariants && !knownVariants.includes(variantName)) {
    throw new UzonTypeError(
      `'${variantName}' is not a valid variant of this tagged union (variants: ${knownVariants.join(", ")})`,
      node.line, node.col,
    );
  }
  const matches = left.tag === variantName;
  return node.op === "is named" ? matches : !matches;
}

// ── Type check operator ──

/** Built-in type names recognised by `is type` / `is not type`. */
const BUILTIN_TYPES = new Set([
  "null", "bool", "string",
  "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64",
  "f32", "f64",
]);

function evalIsTypeOp(
  ctx: EvalContext,
  node: { op: BinaryOp; left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  const left = ctx.evalNode(node.left, scope, exclude);
  const leftNumType = ctx.numericType ? actualType(ctx.numericType) : null;
  if (left === UZON_UNDEFINED) {
    throw new UzonRuntimeError("'is type' operand resolved to undefined", node.line, node.col);
  }
  const typeNode = node.right as { path?: string[]; isNull?: boolean; isList?: boolean; isTuple?: boolean };
  const typeName = typeNode.isNull ? "null" : (typeNode.path?.join(".") ?? "");

  // §3.6: type name MUST be valid — check built-ins and user-defined types
  if (!typeNode.isNull && !typeNode.isList && !typeNode.isTuple
      && !BUILTIN_TYPES.has(typeName)
      && !scope.getType(typeNode.path ?? [])) {
    throw new UzonTypeError(
      `'${typeName}' is not a valid type name`,
      node.line, node.col,
    );
  }

  const matches = valueMatchesType(left, typeName, leftNumType);
  return node.op === "is type" ? matches : !matches;
}

function valueMatchesType(value: UzonValue, typeName: string, numType: string | null): boolean {
  // §3.6/§3.7: Unwrap unions — determine inner type from union member types
  if (value instanceof UzonUnion) {
    const memberNumType = resolveUnionMemberNumType(value);
    return valueMatchesType(value.value, typeName, memberNumType ?? numType);
  }
  if (value instanceof UzonTaggedUnion) {
    const memberNumType = resolveTaggedUnionMemberNumType(value);
    return valueMatchesType(value.value, typeName, memberNumType ?? numType);
  }

  if (value === null) return typeName === "null";
  if (typeof value === "boolean") return typeName === "bool";
  if (typeof value === "string") return typeName === "string";
  if (typeof value === "bigint") {
    if (!/^[iu]\d+$/.test(typeName)) return false;
    // Exact numeric type match — e.g. i64 value only matches i64, not i32
    return numType ? numType === typeName : typeName === "i64";
  }
  if (typeof value === "number") {
    if (!/^f\d+$/.test(typeName)) return false;
    return numType ? numType === typeName : typeName === "f64";
  }
  if (Array.isArray(value)) return typeName.startsWith("[");
  if (value instanceof UzonEnum) {
    if (value.typeName && value.typeName === typeName) return true;
    return false;
  }
  if (typeof value === "object") {
    // Struct — check named type
    return false;
  }
  return false;
}

/** Determine the numeric member type for an untagged union's inner value. */
function resolveUnionMemberNumType(union: UzonUnion): string | null {
  const val = union.value;
  if (typeof val === "bigint") {
    return union.types.find(t => /^[iu]\d+$/.test(t)) ?? null;
  }
  if (typeof val === "number") {
    return union.types.find(t => /^f\d+$/.test(t)) ?? null;
  }
  return null;
}

/** Determine the numeric member type for a tagged union's inner value. */
function resolveTaggedUnionMemberNumType(tu: UzonTaggedUnion): string | null {
  const val = tu.value;
  if (typeof val === "bigint" || typeof val === "number") {
    // Tagged union variants have explicit types — use the current variant's type
    const variantType = tu.variants.get(tu.tag);
    if (variantType && /^[iuf]\d+$/.test(variantType)) return variantType;
  }
  return null;
}

// ── Membership operator ──

function evalInOp(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  const right = ctx.evalNode(node.right, scope, exclude);
  const rightNumType = ctx.numericType;
  if (right === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot use 'in' with undefined — use 'or else' to provide a fallback", node.line, node.col);
  }
  let left: UzonValue;
  // §3.5 point 4: infer enum type from list element type
  if (node.left.kind === "Identifier" && Array.isArray(right) && right.length > 0 && right[0] instanceof UzonEnum) {
    left = ctx.resolveEnumVariantOrEval(node.left, right[0], scope, exclude);
  } else {
    left = ctx.evalNode(node.left, scope, exclude);
  }
  const leftNumType = ctx.numericType;
  if (left === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot use 'in' with undefined — use 'or else' to provide a fallback", node.line, node.col);
  }
  return ctx.evalIn(left, right, node as AstNode, leftNumType, rightNumType);
}

// ── Membership (in) implementation ──

export function evalIn(
  _ctx: EvalContext,
  left: UzonValue, right: UzonValue, node: AstNode,
  leftNumType?: string | null, rightNumType?: string | null,
): boolean {
  // §5.8.1: function left operand + function element → type error
  if (left instanceof UzonFunction) {
    const hasFunc = Array.isArray(right)
      ? right.some(el => el instanceof UzonFunction)
      : right instanceof UzonTuple
        ? right.elements.some(el => el instanceof UzonFunction)
        : (right !== null && typeof right === "object" && !(right instanceof UzonEnum)
           && !(right instanceof UzonUnion) && !(right instanceof UzonTaggedUnion)
           && !(right instanceof UzonFunction))
          ? Object.values(right as Record<string, UzonValue>).some(v => v instanceof UzonFunction)
          : false;
    if (hasFunc) {
      throw new UzonTypeError("Cannot compare function values", node.line, node.col);
    }
  }
  // §5.8.1: list membership (type-checked)
  if (Array.isArray(right)) {
    if (left !== null && right.length > 0) {
      const leftCat = typeCategory(left);
      const elemCat = listElementCategory(right);
      if (elemCat !== null && leftCat !== elemCat) {
        throw new UzonTypeError(
          `'in' requires the value (${leftCat}) and list elements (${elemCat}) to be the same type`,
          node.line, node.col,
        );
      }
      // §3.5: Nominal enum type must also match
      if (left instanceof UzonEnum && left.typeName) {
        const firstEnum = right.find(el => el instanceof UzonEnum && el.typeName);
        if (firstEnum instanceof UzonEnum && firstEnum.typeName && firstEnum.typeName !== left.typeName) {
          throw new UzonTypeError(
            `'in' type mismatch: value is ${left.typeName} but list elements are ${firstEnum.typeName}`,
            node.line, node.col,
          );
        }
      }
      // §5.8.1: Numeric subtype must also match
      if (leftNumType && rightNumType && (leftCat === "integer" || leftCat === "float")) {
        const la = actualType(leftNumType);
        const ra = actualType(rightNumType);
        const lAdopt = isAdoptable(leftNumType);
        const rAdopt = isAdoptable(rightNumType);
        if (la && ra && la !== ra && !(lAdopt && rAdopt)) {
          throw new UzonTypeError(
            `'in' type mismatch: value is ${la} but list elements are ${ra}`,
            node.line, node.col,
          );
        }
      }
    }
    return right.some(el => valuesEqual(left, el));
  }
  // §5.8.1: tuple membership — heterogeneous, type mismatches skip (no error)
  if (right instanceof UzonTuple) {
    return right.elements.some(el => {
      if (el === UZON_UNDEFINED) return false;
      try { return valuesEqual(left, el); } catch { return false; }
    });
  }
  // §5.8.1: struct membership — value membership (not key). Key check is std.hasKey
  if (right !== null && typeof right === "object"
      && !(right instanceof UzonEnum) && !(right instanceof UzonUnion)
      && !(right instanceof UzonTaggedUnion) && !(right instanceof UzonFunction)) {
    const struct = right as Record<string, UzonValue>;
    return Object.values(struct).some(v => {
      if (v === UZON_UNDEFINED) return false;
      try { return valuesEqual(left, v); } catch { return false; }
    });
  }
  throw new UzonTypeError("'in' requires a list, tuple, or struct on the right", node.line, node.col);
}

// ── Arithmetic ──

function evalArithmetic(
  ctx: EvalContext,
  op: string, rawLeft: UzonValue, rawRight: UzonValue, node: AstNode,
  leftNumType: string | null, rightNumType: string | null,
): UzonValue {
  const left = unwrapValue(rawLeft);
  const right = unwrapValue(rawRight);
  const resultType = resolveNumericTypes(leftNumType, rightNumType, left, right, node);

  // §5: cross-category promotion — convert bigint to number when resolved type is float
  let lVal = left;
  let rVal = right;
  if (resultType && /^f\d+$/.test(resultType)) {
    if (typeof lVal === "bigint") lVal = Number(lVal);
    if (typeof rVal === "bigint") rVal = Number(rVal);
  }

  let result: UzonValue | undefined;
  if (typeof lVal === "bigint" && typeof rVal === "bigint") {
    switch (op) {
      case "+": result = lVal + rVal; break;
      case "-": result = lVal - rVal; break;
      case "*": result = lVal * rVal; break;
      case "/":
        if (rVal === 0n) throw new UzonRuntimeError("Division by zero", node.line, node.col);
        result = lVal / rVal; break;
      case "%":
        if (rVal === 0n) throw new UzonRuntimeError("Modulo by zero", node.line, node.col);
        result = lVal % rVal; break;
      case "^":
        if (rVal < 0n) throw new UzonRuntimeError("Integer exponent must be non-negative", node.line, node.col);
        result = lVal ** rVal; break;
    }
  } else if (typeof lVal === "number" && typeof rVal === "number") {
    switch (op) {
      case "+": result = lVal + rVal; break;
      case "-": result = lVal - rVal; break;
      case "*": result = lVal * rVal; break;
      case "/": result = lVal / rVal; break;
      case "%": result = lVal % rVal; break;
      case "^": result = Math.pow(lVal, rVal); break;
    }
  } else if (typeof lVal === "bigint" && typeof rVal === "number") {
    throw new UzonTypeError("Cannot mix integer and float in arithmetic — use 'to' to convert", node.line, node.col);
  } else if (typeof lVal === "number" && typeof rVal === "bigint") {
    throw new UzonTypeError("Cannot mix float and integer in arithmetic — use 'to' to convert", node.line, node.col);
  }

  if (result === undefined) {
    throw new UzonTypeError(`Arithmetic operator '${op}' requires numeric operands`, node.line, node.col);
  }
  if (resultType && typeof result === "bigint") validateIntegerType(result, resultType, node);
  if (resultType && typeof result === "number") validateFloatType(result, resultType, node);
  ctx.numericType = resultType;
  return result;
}

// ── Comparison ──

function evalComparison(
  _ctx: EvalContext,
  op: string, rawLeft: UzonValue, rawRight: UzonValue, node: AstNode,
  leftNumType: string | null, rightNumType: string | null,
): boolean {
  // §5.4: Ordered comparison between two tagged union values is a type error
  if (rawLeft instanceof UzonTaggedUnion && rawRight instanceof UzonTaggedUnion) {
    throw new UzonTypeError(
      "Ordered comparison between two tagged union values is not supported — tags have no defined ordering",
      node.line, node.col,
    );
  }
  // §3.6 + §5.4: Ordered comparison on untagged union is a type error
  if (rawLeft instanceof UzonUnion || rawRight instanceof UzonUnion) {
    throw new UzonTypeError(
      "Ordered comparison on untagged union values is not supported",
      node.line, node.col,
    );
  }
  let left = unwrapValue(rawLeft);
  let right = unwrapValue(rawRight);
  const resolvedType = resolveNumericTypes(leftNumType, rightNumType, left, right, node);

  // §5: cross-category promotion — convert bigint to number when resolved type is float
  if (resolvedType && /^f\d+$/.test(resolvedType)) {
    if (typeof left === "bigint") left = Number(left);
    if (typeof right === "bigint") right = Number(right);
  }

  if (typeof left === "bigint" && typeof right === "bigint") {
    switch (op) {
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
    }
  }
  if (typeof left === "number" && typeof right === "number") {
    switch (op) {
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
    }
  }
  if (typeof left === "string" && typeof right === "string") {
    switch (op) {
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
    }
  }
  const leftCat = typeCategory(left);
  const rightCat = typeCategory(right);
  if (leftCat === rightCat) {
    throw new UzonTypeError(`Ordered comparison is not supported for ${leftCat} values`, node.line, node.col);
  }
  throw new UzonTypeError(`Cannot compare ${leftCat} with ${rightCat} using '${op}'`, node.line, node.col);
}

// ── Concatenation (++) ──

function evalConcat(ctx: EvalContext, rawLeft: UzonValue, rawRight: UzonValue, node: AstNode): UzonValue {
  const left = unwrapValue(rawLeft);
  const right = unwrapValue(rawRight);
  if (typeof left === "string" && typeof right === "string") return left + right;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length === 0 && right.length === 0) {
      throw new UzonTypeError(
        "Cannot concatenate two empty lists — neither side has type information",
        node.line, node.col,
      );
    }
    const leftCat = listElementCategory(left);
    const rightCat = listElementCategory(right);
    if (leftCat !== null && rightCat !== null && leftCat !== rightCat) {
      throw new UzonTypeError(
        `Cannot concatenate lists with different element types (${leftCat} vs ${rightCat})`,
        node.line, node.col,
      );
    }
    // §5.8.2: element types must match exactly — e.g. [i32] ++ [i16] is a type error
    const leftElemType = ctx.listElementTypes.get(left);
    const rightElemType = ctx.listElementTypes.get(right);
    if (leftElemType && rightElemType && leftElemType !== rightElemType) {
      throw new UzonTypeError(
        `Cannot concatenate lists with different element types (${leftElemType} vs ${rightElemType})`,
        node.line, node.col,
      );
    }
    const result = [...left, ...right];
    const elemType = leftElemType ?? rightElemType;
    if (elemType) ctx.listElementTypes.set(result, elemType);
    return result;
  }
  throw new UzonTypeError("'++' requires two strings or two lists", node.line, node.col);
}

// ── Repetition (**) ──

function evalRepetition(ctx: EvalContext, rawLeft: UzonValue, rawRight: UzonValue, node: AstNode): UzonValue {
  const left = unwrapValue(rawLeft);
  const right = unwrapValue(rawRight);
  if (typeof right !== "bigint") {
    throw new UzonTypeError("Repetition count must be an integer", node.line, node.col);
  }
  if (right < 0n) {
    throw new UzonRuntimeError("Repetition count must be a non-negative integer", node.line, node.col);
  }
  const count = Number(right);
  if (typeof left === "string") return left.repeat(count);
  if (Array.isArray(left)) {
    const result: UzonValue[] = [];
    for (let i = 0; i < count; i++) result.push(...left);
    const elemType = ctx.listElementTypes.get(left);
    if (elemType) ctx.listElementTypes.set(result, elemType);
    return result;
  }
  throw new UzonTypeError("'**' requires a string or list on the left", node.line, node.col);
}

// ── Unary operators ──

export function evalUnaryOp(
  ctx: EvalContext,
  node: { kind: "UnaryOp"; op: string; operand: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const val = unwrapValue(ctx.evalNode(node.operand, scope, exclude));
  if (node.op === "not") {
    if (val === UZON_UNDEFINED) {
      throw new UzonRuntimeError("Cannot use 'not' with undefined — use 'or else' to provide a fallback", node.operand.line, node.operand.col);
    }
    assertBool(val, node.operand);
    return !val;
  }
  if (node.op === "-") {
    const numType = ctx.numericType;
    const actualNt = actualType(numType);
    if (typeof val === "bigint") {
      const result = -val;
      if (actualNt) validateIntegerType(result, actualNt, node as AstNode);
      ctx.numericType = numType;
      return result;
    }
    if (typeof val === "number") {
      const result = -val;
      if (actualNt) validateFloatType(result, actualNt, node as AstNode);
      ctx.numericType = numType;
      return result;
    }
    throw new UzonTypeError("Unary '-' requires a number", node.line, node.col);
  }
  throw new UzonRuntimeError(`Unknown unary operator: ${node.op}`, node.line, node.col);
}
