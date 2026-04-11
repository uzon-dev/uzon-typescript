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
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion,
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

function evalIs(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  let left: UzonValue, right: UzonValue;
  if (node.right.kind === "Identifier") {
    left = ctx.evalNode(node.left, scope, exclude);
    if (left instanceof UzonUnion) left = left.value;
    right = ctx.resolveEnumVariantOrEval(node.right, left, scope, exclude);
  } else if (node.left.kind === "Identifier") {
    right = ctx.evalNode(node.right, scope, exclude);
    if (right instanceof UzonUnion) right = right.value;
    left = ctx.resolveEnumVariantOrEval(node.left, right, scope, exclude);
  } else {
    left = ctx.evalNode(node.left, scope, exclude);
    right = ctx.evalNode(node.right, scope, exclude);
  }
  if (left instanceof UzonUnion) left = left.value;
  if (right instanceof UzonUnion) right = right.value;
  assertSameType(left, right, node as AstNode);
  return valuesEqual(left, right);
}

function evalIsNot(
  ctx: EvalContext,
  node: { left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): boolean {
  let left: UzonValue, right: UzonValue;
  if (node.right.kind === "Identifier") {
    left = ctx.evalNode(node.left, scope, exclude);
    if (left instanceof UzonUnion) left = left.value;
    right = ctx.resolveEnumVariantOrEval(node.right, left, scope, exclude);
  } else if (node.left.kind === "Identifier") {
    right = ctx.evalNode(node.right, scope, exclude);
    if (right instanceof UzonUnion) right = right.value;
    left = ctx.resolveEnumVariantOrEval(node.left, right, scope, exclude);
  } else {
    left = ctx.evalNode(node.left, scope, exclude);
    right = ctx.evalNode(node.right, scope, exclude);
  }
  if (left instanceof UzonUnion) left = left.value;
  if (right instanceof UzonUnion) right = right.value;
  assertSameType(left, right, node as AstNode);
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
  if (!Array.isArray(right)) {
    throw new UzonTypeError("'in' requires a list on the right", node.line, node.col);
  }
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

// ── Arithmetic ──

function evalArithmetic(
  ctx: EvalContext,
  op: string, rawLeft: UzonValue, rawRight: UzonValue, node: AstNode,
  leftNumType: string | null, rightNumType: string | null,
): UzonValue {
  const left = unwrapValue(rawLeft);
  const right = unwrapValue(rawRight);
  const resultType = resolveNumericTypes(leftNumType, rightNumType, left, right, node);

  let result: UzonValue | undefined;
  if (typeof left === "bigint" && typeof right === "bigint") {
    switch (op) {
      case "+": result = left + right; break;
      case "-": result = left - right; break;
      case "*": result = left * right; break;
      case "/":
        if (right === 0n) throw new UzonRuntimeError("Division by zero", node.line, node.col);
        result = left / right; break;
      case "%":
        if (right === 0n) throw new UzonRuntimeError("Modulo by zero", node.line, node.col);
        result = left % right; break;
      case "^":
        if (right < 0n) throw new UzonRuntimeError("Integer exponent must be non-negative", node.line, node.col);
        result = left ** right; break;
    }
  } else if (typeof left === "number" && typeof right === "number") {
    switch (op) {
      case "+": result = left + right; break;
      case "-": result = left - right; break;
      case "*": result = left * right; break;
      case "/": result = left / right; break;
      case "%": result = left % right; break;
      case "^": result = Math.pow(left, right); break;
    }
  } else if (typeof left === "bigint" && typeof right === "number") {
    throw new UzonTypeError("Cannot mix integer and float in arithmetic — use 'to' to convert", node.line, node.col);
  } else if (typeof left === "number" && typeof right === "bigint") {
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
  const left = unwrapValue(rawLeft);
  const right = unwrapValue(rawRight);
  resolveNumericTypes(leftNumType, rightNumType, left, right, node);

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
    const result = [...left, ...right];
    const elemType = ctx.listElementTypes.get(left) ?? ctx.listElementTypes.get(right);
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
