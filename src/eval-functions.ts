// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Function expression and function call evaluation.
 *
 * Extracted from Evaluator class — function handling logic as free functions
 * receiving an EvalContext for callbacks.
 */

import type { AstNode, BindingNode, TypeExprNode } from "./ast.js";
import { Scope } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";
import { UzonRuntimeError, UzonSyntaxError, UzonTypeError } from "./error.js";
import { validateIntegerType, validateFloatType } from "./eval-numeric.js";
import { evalStdCall } from "./eval-stdlib.js";
import type { EvalContext } from "./eval-context.js";
import { typeTag, typeExprToString } from "./eval-helpers.js";
import { validateTypeExists } from "./eval-type-annotation.js";

// ── Function expression ──

export function evalFunctionExpr(
  ctx: EvalContext,
  node: {
    kind: "FunctionExpr"; params: { name: string; type: TypeExprNode; defaultValue: AstNode | null }[];
    returnType: TypeExprNode; body: BindingNode[]; finalExpr: AstNode; line: number; col: number
  },
  scope: Scope, exclude?: string,
): UzonValue {
  // §3.8: Required params must come before defaulted params
  let seenDefault = false;
  for (const p of node.params) {
    if (p.defaultValue) seenDefault = true;
    else if (seenDefault) {
      throw new UzonSyntaxError(
        `Required parameter '${p.name}' cannot follow a parameter with a default value`,
        p.type.line, p.type.col,
      );
    }
  }

  // §6.2: Validate parameter and return types exist in scope at definition time
  for (const p of node.params) {
    validateTypeExists(p.type, scope, node as AstNode);
  }
  validateTypeExists(node.returnType, scope, node as AstNode);

  const paramNames = node.params.map(p => p.name);
  const paramTypes = node.params.map(p => typeExprToString(p.type));
  const paramTypeExprs = node.params.map(p => p.type);
  const defaultValues: (UzonValue | null)[] = node.params.map(p =>
    p.defaultValue ? ctx.evalNode(p.defaultValue, scope, exclude) : null,
  );
  const returnType = typeExprToString(node.returnType);

  return new UzonFunction(
    paramNames, paramTypes, defaultValues, returnType,
    node.body, node.finalExpr, scope, null,
    paramTypeExprs, node.returnType,
  );
}

// ── Function call ──

export function evalFunctionCall(
  ctx: EvalContext,
  node: { kind: "FunctionCall"; callee: AstNode; args: AstNode[]; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const stdFn = extractStdFunctionName(node.callee);
  if (stdFn) return evalStdCall(ctx, stdFn, node.args, scope, exclude, node as AstNode);

  const callee = ctx.evalNode(node.callee, scope, exclude);
  if (callee === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Cannot call undefined — callee resolved to undefined", node.line, node.col);
  }
  if (!(callee instanceof UzonFunction)) {
    throw new UzonTypeError("Cannot call a non-function value", node.line, node.col);
  }
  return callFunction(ctx, callee, node.args, scope, exclude, node as AstNode);
}

// ── Internal function call ──

function callFunction(
  ctx: EvalContext,
  fn: UzonFunction, argNodes: AstNode[],
  callerScope: Scope, exclude: string | undefined, node: AstNode,
): UzonValue {
  if (ctx.callStack.has(fn)) {
    throw new UzonTypeError(
      "Recursive function call detected — the call graph must be a DAG",
      node.line, node.col,
    );
  }

  const requiredCount = fn.defaultValues.filter(d => d === null).length;
  const totalParams = fn.paramNames.length;
  if (argNodes.length < requiredCount || argNodes.length > totalParams) {
    const expected = requiredCount === totalParams
      ? `${totalParams}` : `${requiredCount}-${totalParams}`;
    throw new UzonTypeError(
      `Expected ${expected} argument(s) but got ${argNodes.length}`,
      node.line, node.col,
    );
  }

  const locals = new Map<string, UzonValue>();
  for (let i = 0; i < totalParams; i++) {
    let argVal: UzonValue;
    if (i < argNodes.length) {
      const paramTypeExpr = fn.paramTypeExprs[i] as TypeExprNode | undefined;
      argVal = paramTypeExpr
        ? ctx.evalInContext(argNodes[i], paramTypeExpr, callerScope, exclude)
        : ctx.evalNode(argNodes[i], callerScope, exclude);
      const argNumType = ctx.numericType;
      checkArgType(ctx, argVal, fn.paramTypes[i], fn.paramNames[i], argNodes[i], callerScope, argNumType);
    } else {
      argVal = fn.defaultValues[i]!;
    }
    locals.set(fn.paramNames[i], argVal);
  }

  const closureScope = fn.closureScope as Scope;
  const bodyScope = new Scope(closureScope);
  // Add parameters to bodyScope so nested functions can close over them
  for (const [k, v] of locals) bodyScope.set(k, v);
  const prevLocals = ctx.functionLocals;
  ctx.functionLocals = locals;
  ctx.callStack.add(fn);

  try {
    const body = fn.body as BindingNode[];
    if (body.length > 0) {
      ctx.evaluateBindings(body, bodyScope, true, locals);
    }
    const returnTypeExpr = fn.returnTypeExpr as TypeExprNode | null;
    const result = returnTypeExpr
      ? ctx.evalInContext(fn.finalExpr as AstNode, returnTypeExpr, bodyScope)
      : ctx.evalNode(fn.finalExpr as AstNode, bodyScope);
    checkReturnType(ctx, result, fn.returnType, node);
    return result;
  } finally {
    ctx.callStack.delete(fn);
    ctx.functionLocals = prevLocals;
  }
}

/** Call a function with pre-evaluated argument values (used by std.map/filter/reduce/sort) */
export function callFunctionDirect(
  ctx: EvalContext,
  fn: UzonFunction, args: UzonValue[], _scope: Scope, node: AstNode,
): UzonValue {
  if (ctx.callStack.has(fn)) {
    throw new UzonTypeError(
      "Recursive function call detected — the call graph must be a DAG",
      node.line, node.col,
    );
  }
  const requiredCount = fn.defaultValues.filter(d => d === null).length;
  const totalParams = fn.paramNames.length;
  if (args.length < requiredCount || args.length > totalParams) {
    throw new UzonTypeError(
      `Function expects ${requiredCount === totalParams ? totalParams : `${requiredCount}-${totalParams}`} argument(s) but got ${args.length}`,
      node.line, node.col,
    );
  }

  const locals = new Map<string, UzonValue>();
  for (let i = 0; i < totalParams; i++) {
    const argVal = i < args.length ? args[i] : fn.defaultValues[i]!;
    checkArgTypeDirect(argVal, fn.paramTypes[i], fn.paramNames[i], node);
    locals.set(fn.paramNames[i], argVal);
  }

  const closureScope = fn.closureScope as Scope;
  const bodyScope = new Scope(closureScope);
  // Add parameters to bodyScope so nested functions can close over them
  for (const [k, v] of locals) bodyScope.set(k, v);
  const prevLocals = ctx.functionLocals;
  ctx.functionLocals = locals;
  ctx.callStack.add(fn);

  try {
    const body = fn.body as BindingNode[];
    if (body.length > 0) ctx.evaluateBindings(body, bodyScope, true, locals);
    const returnTypeExpr = fn.returnTypeExpr as TypeExprNode | null;
    const result = returnTypeExpr
      ? ctx.evalInContext(fn.finalExpr as AstNode, returnTypeExpr, bodyScope)
      : ctx.evalNode(fn.finalExpr as AstNode, bodyScope);
    checkReturnType(ctx, result, fn.returnType, node);
    return result;
  } finally {
    ctx.callStack.delete(fn);
    ctx.functionLocals = prevLocals;
  }
}

// ── Argument type checking ──

function checkArgType(
  ctx: EvalContext,
  val: UzonValue, expectedType: string, paramName: string,
  node: AstNode, scope: Scope, _argNumType: string | null,
): void {
  if (val === null) return;
  if (val === UZON_UNDEFINED) {
    throw new UzonRuntimeError(`Argument '${paramName}' is undefined`, node.line, node.col);
  }
  if (/^[iu]\d+$/.test(expectedType)) {
    if (typeof val !== "bigint") {
      throw new UzonTypeError(`Argument '${paramName}' expected ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
    }
    validateIntegerType(val, expectedType, node);
    return;
  }
  if (/^f\d+$/.test(expectedType)) {
    if (typeof val !== "number") {
      throw new UzonTypeError(`Argument '${paramName}' expected ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
    }
    validateFloatType(val, expectedType, node);
    return;
  }
  if (expectedType === "bool") {
    if (typeof val !== "boolean") {
      throw new UzonTypeError(`Argument '${paramName}' expected bool but got ${typeTag(val)}`, node.line, node.col);
    }
    return;
  }
  if (expectedType === "string") {
    if (typeof val !== "string") {
      throw new UzonTypeError(`Argument '${paramName}' expected string but got ${typeTag(val)}`, node.line, node.col);
    }
    return;
  }
  if (expectedType.startsWith("(") && expectedType.endsWith(")")) {
    if (!(val instanceof UzonTuple)) {
      throw new UzonTypeError(`Argument '${paramName}' expected tuple ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
    }
    const inner = expectedType.slice(1, -1);
    const elemTypes = inner.split(",").map(s => s.trim());
    if (val.elements.length !== elemTypes.length) {
      throw new UzonTypeError(
        `Argument '${paramName}' expected tuple of ${elemTypes.length} elements but got ${val.elements.length}`,
        node.line, node.col,
      );
    }
    return;
  }
  // User-defined type
  const typeDef = scope.getType(expectedType.split("."));
  if (typeDef) {
    if (typeDef.kind === "enum") {
      if (!(val instanceof UzonEnum) || (val.typeName && val.typeName !== typeDef.name)) {
        throw new UzonTypeError(`Argument '${paramName}' expected ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
      }
    } else if (typeDef.kind === "struct") {
      if (typeof val !== "object" || val === null || Array.isArray(val)
          || val instanceof UzonTuple || val instanceof UzonEnum
          || val instanceof UzonUnion || val instanceof UzonTaggedUnion
          || val instanceof UzonFunction) {
        throw new UzonTypeError(`Argument '${paramName}' expected ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
      }
      const valTypeName = ctx.structTypeNames.get(val as Record<string, UzonValue>);
      if (valTypeName !== typeDef.name) {
        throw new UzonTypeError(
          `Argument '${paramName}' expected struct '${expectedType}' but got struct '${valTypeName ?? "(anonymous)"}'`,
          node.line, node.col,
        );
      }
    }
  }
}

/** Type check for pre-evaluated arguments (used by callFunctionDirect / HOF callbacks). */
function checkArgTypeDirect(
  val: UzonValue, expectedType: string, paramName: string, node: AstNode,
): void {
  if (!expectedType || val === null) return;
  if (val === UZON_UNDEFINED) {
    throw new UzonRuntimeError(`Argument '${paramName}' is undefined`, node.line, node.col);
  }
  if (/^[iu]\d+$/.test(expectedType)) {
    if (typeof val !== "bigint") {
      throw new UzonTypeError(`Argument '${paramName}' expected ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
    }
    validateIntegerType(val, expectedType, node);
    return;
  }
  if (/^f\d+$/.test(expectedType)) {
    if (typeof val !== "number") {
      throw new UzonTypeError(`Argument '${paramName}' expected ${expectedType} but got ${typeTag(val)}`, node.line, node.col);
    }
    validateFloatType(val, expectedType, node);
    return;
  }
  if (expectedType === "bool") {
    if (typeof val !== "boolean") {
      throw new UzonTypeError(`Argument '${paramName}' expected bool but got ${typeTag(val)}`, node.line, node.col);
    }
    return;
  }
  if (expectedType === "string") {
    if (typeof val !== "string") {
      throw new UzonTypeError(`Argument '${paramName}' expected string but got ${typeTag(val)}`, node.line, node.col);
    }
    return;
  }
}

// ── Return type checking ──

function checkReturnType(ctx: EvalContext, result: UzonValue, returnType: string, node: AstNode): void {
  if (result === null || result === UZON_UNDEFINED) return;
  if (/^[iu]\d+$/.test(returnType)) {
    if (typeof result !== "bigint") {
      throw new UzonTypeError(`Function return type is ${returnType} but body evaluated to ${typeTag(result)}`, node.line, node.col);
    }
    validateIntegerType(result, returnType, node);
    return;
  }
  if (/^f\d+$/.test(returnType)) {
    if (typeof result !== "number") {
      throw new UzonTypeError(`Function return type is ${returnType} but body evaluated to ${typeTag(result)}`, node.line, node.col);
    }
    validateFloatType(result, returnType, node);
    return;
  }
  if (returnType === "bool" && typeof result !== "boolean") {
    throw new UzonTypeError(`Function return type is bool but body evaluated to ${typeTag(result)}`, node.line, node.col);
  }
  if (returnType === "string" && typeof result !== "string") {
    throw new UzonTypeError(`Function return type is string but body evaluated to ${typeTag(result)}`, node.line, node.col);
  }
  // List return type
  if (returnType.startsWith("[") && returnType.endsWith("]")) {
    if (!Array.isArray(result)) {
      throw new UzonTypeError(`Function return type is ${returnType} but body evaluated to ${typeTag(result)}`, node.line, node.col);
    }
    return;
  }
  // Tuple return type
  if (returnType.startsWith("(") && returnType.endsWith(")")) {
    if (!(result instanceof UzonTuple)) {
      throw new UzonTypeError(`Function return type is ${returnType} but body evaluated to ${typeTag(result)}`, node.line, node.col);
    }
    return;
  }
  // Named struct type: verify the result's struct type name matches
  if (typeof result === "object" && !Array.isArray(result)
      && !(result instanceof UzonEnum) && !(result instanceof UzonUnion)
      && !(result instanceof UzonTaggedUnion) && !(result instanceof UzonTuple)
      && !(result instanceof UzonFunction)) {
    const resultTypeName = ctx.structTypeNames.get(result as Record<string, UzonValue>);
    if (resultTypeName && resultTypeName !== returnType) {
      throw new UzonTypeError(
        `Function return type is '${returnType}' but body evaluated to struct '${resultTypeName}'`,
        node.line, node.col,
      );
    }
    return;
  }
  // Enum return type
  if (result instanceof UzonEnum) {
    if (result.typeName && result.typeName !== returnType) {
      throw new UzonTypeError(
        `Function return type is '${returnType}' but body evaluated to enum '${result.typeName}'`,
        node.line, node.col,
      );
    }
    return;
  }
}

// ── Std library detection ──

function extractStdFunctionName(callee: AstNode): string | null {
  if (callee.kind !== "MemberAccess") return null;
  const ma = callee as { object: AstNode; member: string };
  if (ma.object.kind === "Identifier" && (ma.object as { name: string }).name === "std") {
    return ma.member;
  }
  return null;
}
