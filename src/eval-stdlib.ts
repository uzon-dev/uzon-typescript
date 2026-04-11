// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Standard library — 18 built-in functions (§5.16).
 *
 * All std.* functions are dispatched through evalStdCall, which delegates
 * to individual implementations. Each function receives a EvalContext
 * to access the evaluator's node evaluation and function call machinery.
 */

import type { AstNode } from "./ast.js";
import type { Scope } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";
import { UzonTypeError, UzonRuntimeError } from "./error.js";
import { typeNameCategory } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { typeCategory } from "./eval-helpers.js";

// ── Dispatcher ──

export function evalStdCall(
  ctx: EvalContext, fnName: string, argNodes: AstNode[],
  scope: Scope, exclude: string | undefined, node: AstNode,
): UzonValue {
  switch (fnName) {
    case "len": return stdLen(ctx, argNodes, scope, exclude, node);
    case "has": return stdHas(ctx, argNodes, scope, exclude, node);
    case "get": return stdGet(ctx, argNodes, scope, exclude, node);
    case "keys": return stdKeys(ctx, argNodes, scope, exclude, node);
    case "values": return stdValues(ctx, argNodes, scope, exclude, node);
    case "map": return stdMap(ctx, argNodes, scope, exclude, node);
    case "filter": return stdFilter(ctx, argNodes, scope, exclude, node);
    case "reduce": return stdReduce(ctx, argNodes, scope, exclude, node);
    case "sort": return stdSort(ctx, argNodes, scope, exclude, node);
    case "isNan": return stdIsNan(ctx, argNodes, scope, exclude, node);
    case "isInf": return stdIsInf(ctx, argNodes, scope, exclude, node);
    case "isFinite": return stdIsFinite_(ctx, argNodes, scope, exclude, node);
    case "join": return stdJoin(ctx, argNodes, scope, exclude, node);
    case "replace": return stdReplace(ctx, argNodes, scope, exclude, node);
    case "split": return stdSplit(ctx, argNodes, scope, exclude, node);
    case "trim": return stdTrim(ctx, argNodes, scope, exclude, node);
    case "lower": return stdLower(ctx, argNodes, scope, exclude, node);
    case "upper": return stdUpper(ctx, argNodes, scope, exclude, node);
    default:
      throw new UzonRuntimeError(`'std.${fnName}' is not a standard library function`, node.line, node.col);
  }
}

// ── Helpers ──

function expectArgs(argNodes: AstNode[], count: number, fnName: string, node: AstNode): void {
  if (argNodes.length !== count) {
    throw new UzonTypeError(`std.${fnName} expects ${count} argument(s) but got ${argNodes.length}`, node.line, node.col);
  }
}

function isStruct(val: UzonValue): val is Record<string, UzonValue> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
    && !(val instanceof UzonEnum) && !(val instanceof UzonUnion)
    && !(val instanceof UzonTaggedUnion) && !(val instanceof UzonTuple)
    && !(val instanceof UzonFunction);
}

// ── Collection queries ──

function stdLen(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "len", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val === "string") { ctx.numericType = "i64"; return BigInt([...val].length); }
  if (Array.isArray(val)) { ctx.numericType = "i64"; return BigInt(val.length); }
  if (val instanceof UzonTuple) { ctx.numericType = "i64"; return BigInt(val.length); }
  if (isStruct(val)) { ctx.numericType = "i64"; return BigInt(Object.keys(val).length); }
  throw new UzonTypeError("std.len requires a string, list, tuple, or struct", node.line, node.col);
}

function stdHas(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "has", node);
  const collection = ctx.evalNode(argNodes[0], scope, exclude);
  const key = ctx.evalNode(argNodes[1], scope, exclude);
  if (Array.isArray(collection)) return ctx.evalIn(key, collection, node);
  if (isStruct(collection)) {
    if (typeof key !== "string") throw new UzonTypeError("std.has on a struct requires a string key", node.line, node.col);
    return key in collection;
  }
  throw new UzonTypeError("std.has requires a list or struct", node.line, node.col);
}

function stdGet(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "get", node);
  const collection = ctx.evalNode(argNodes[0], scope, exclude);
  const key = ctx.evalNode(argNodes[1], scope, exclude);
  if (Array.isArray(collection)) {
    if (typeof key !== "bigint") throw new UzonTypeError("std.get on a list requires an integer index", node.line, node.col);
    const idx = Number(key);
    if (idx < 0 || idx >= collection.length) return UZON_UNDEFINED as UzonValue;
    return collection[idx];
  }
  if (isStruct(collection)) {
    if (typeof key !== "string") throw new UzonTypeError("std.get on a struct requires a string key", node.line, node.col);
    return key in collection ? collection[key] : UZON_UNDEFINED as UzonValue;
  }
  throw new UzonTypeError("std.get requires a list or struct", node.line, node.col);
}

function stdKeys(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "keys", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (isStruct(val)) return Object.keys(val);
  throw new UzonTypeError("std.keys requires a struct", node.line, node.col);
}

function stdValues(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "values", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (isStruct(val)) return new UzonTuple(Object.values(val));
  throw new UzonTypeError("std.values requires a struct", node.line, node.col);
}

// ── Higher-order functions ──

function stdMap(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "map", node);
  const list = ctx.evalNode(argNodes[0], scope, exclude);
  if (!Array.isArray(list)) throw new UzonTypeError("std.map requires a list as the first argument", node.line, node.col);
  const fn = ctx.evalNode(argNodes[1], scope, exclude);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.map requires a function as the second argument", node.line, node.col);
  if (fn.paramNames.length < 1) throw new UzonTypeError("std.map function must take at least one parameter", node.line, node.col);
  const result: UzonValue[] = [];
  for (const elem of list) result.push(ctx.callFunctionDirect(fn, [elem], scope, node));
  return result;
}

function stdFilter(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "filter", node);
  const list = ctx.evalNode(argNodes[0], scope, exclude);
  if (!Array.isArray(list)) throw new UzonTypeError("std.filter requires a list as the first argument", node.line, node.col);
  const fn = ctx.evalNode(argNodes[1], scope, exclude);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.filter requires a function as the second argument", node.line, node.col);
  if (fn.returnType !== "bool") throw new UzonTypeError("std.filter function must return bool", node.line, node.col);
  const result: UzonValue[] = [];
  for (const elem of list) {
    const keep = ctx.callFunctionDirect(fn, [elem], scope, node);
    if (typeof keep !== "boolean") throw new UzonTypeError("std.filter function must return bool", node.line, node.col);
    if (keep) result.push(elem);
  }
  const elemType = ctx.listElementTypes.get(list);
  if (elemType) ctx.listElementTypes.set(result, elemType);
  return result;
}

function stdSort(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "sort", node);
  const list = ctx.evalNode(argNodes[0], scope, exclude);
  if (!Array.isArray(list)) throw new UzonTypeError("std.sort requires a list as the first argument", node.line, node.col);
  const fn = ctx.evalNode(argNodes[1], scope, exclude);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.sort requires a comparator function as the second argument", node.line, node.col);
  if (fn.paramNames.length < 2) throw new UzonTypeError("std.sort comparator must take two parameters", node.line, node.col);
  if (fn.returnType !== "bool") throw new UzonTypeError("std.sort comparator must return bool", node.line, node.col);
  // §5.16.2: Stable sort
  const indexed: { el: UzonValue; i: number }[] = list.map((el, i) => ({ el, i }));
  indexed.sort((a, b) => {
    const aBeforeB = ctx.callFunctionDirect(fn, [a.el, b.el] as UzonValue[], scope, node);
    if (typeof aBeforeB !== "boolean") throw new UzonTypeError("std.sort comparator must return bool", node.line, node.col);
    if (aBeforeB) return -1;
    const bBeforeA = ctx.callFunctionDirect(fn, [b.el, a.el] as UzonValue[], scope, node);
    if (typeof bBeforeA !== "boolean") throw new UzonTypeError("std.sort comparator must return bool", node.line, node.col);
    if (bBeforeA) return 1;
    return a.i - b.i;
  });
  const result = indexed.map(x => x.el);
  const elemType = ctx.listElementTypes.get(list);
  if (elemType) ctx.listElementTypes.set(result, elemType);
  return result;
}

function stdReduce(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 3, "reduce", node);
  const list = ctx.evalNode(argNodes[0], scope, exclude);
  if (!Array.isArray(list)) throw new UzonTypeError("std.reduce requires a list as the first argument", node.line, node.col);
  let acc = ctx.evalNode(argNodes[1], scope, exclude);
  const fn = ctx.evalNode(argNodes[2], scope, exclude);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.reduce requires a function as the third argument", node.line, node.col);
  if (fn.paramNames.length < 2) throw new UzonTypeError("std.reduce function must take at least two parameters", node.line, node.col);
  if (fn.returnType) {
    const accType = fn.paramTypes[0];
    if (accType && accType !== fn.returnType) {
      throw new UzonTypeError(
        `std.reduce: accumulator type '${accType}' does not match return type '${fn.returnType}'`,
        node.line, node.col,
      );
    }
    const initCat = typeCategory(acc);
    const retCat = typeNameCategory(fn.returnType);
    if (retCat && initCat !== retCat) {
      throw new UzonTypeError(
        `std.reduce: initial value type (${initCat}) does not match function return type (${fn.returnType})`,
        node.line, node.col,
      );
    }
  }
  for (const elem of list) acc = ctx.callFunctionDirect(fn, [acc, elem], scope, node);
  return acc;
}

// ── Numeric utilities ──

function stdIsNan(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "isNan", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val !== "number") throw new UzonTypeError("std.isNan requires a float value", node.line, node.col);
  return Number.isNaN(val);
}

function stdIsInf(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "isInf", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val !== "number") throw new UzonTypeError("std.isInf requires a float value", node.line, node.col);
  return val === Infinity || val === -Infinity;
}

function stdIsFinite_(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "isFinite", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val !== "number") throw new UzonTypeError("std.isFinite requires a float value", node.line, node.col);
  return Number.isFinite(val);
}

// ── String utilities ──

function stdJoin(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "join", node);
  const list = ctx.evalNode(argNodes[0], scope, exclude);
  const sep = ctx.evalNode(argNodes[1], scope, exclude);
  if (!Array.isArray(list)) throw new UzonTypeError("std.join requires a [string] list as first argument", node.line, node.col);
  if (typeof sep !== "string") throw new UzonTypeError("std.join requires a string separator", node.line, node.col);
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string") throw new UzonTypeError("std.join requires a [string] list — element is not a string", node.line, node.col);
  }
  return (list as string[]).join(sep);
}

function stdReplace(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 3, "replace", node);
  const str = ctx.evalNode(argNodes[0], scope, exclude);
  const target = ctx.evalNode(argNodes[1], scope, exclude);
  const replacement = ctx.evalNode(argNodes[2], scope, exclude);
  if (typeof str !== "string" || typeof target !== "string" || typeof replacement !== "string") {
    throw new UzonTypeError("std.replace requires three string arguments", node.line, node.col);
  }
  if (target === "") return str;
  return str.split(target).join(replacement);
}

function stdSplit(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "split", node);
  const str = ctx.evalNode(argNodes[0], scope, exclude);
  const delim = ctx.evalNode(argNodes[1], scope, exclude);
  if (typeof str !== "string" || typeof delim !== "string") {
    throw new UzonTypeError("std.split requires two string arguments", node.line, node.col);
  }
  if (str === "") return [""];
  if (delim === "") return [...str];
  return str.split(delim);
}

function stdTrim(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "trim", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val !== "string") throw new UzonTypeError("std.trim requires a string argument", node.line, node.col);
  return val.trim();
}

function stdLower(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "lower", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val !== "string") throw new UzonTypeError("std.lower requires a string argument", node.line, node.col);
  return val.toLowerCase();
}

function stdUpper(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "upper", node);
  const val = ctx.evalNode(argNodes[0], scope, exclude);
  if (typeof val !== "string") throw new UzonTypeError("std.upper requires a string argument", node.line, node.col);
  return val.toUpperCase();
}
