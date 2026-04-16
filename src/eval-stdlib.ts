// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Standard library — 24 built-in functions (§5.16).
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
    case "hasKey": return stdHasKey(ctx, argNodes, scope, exclude, node);
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
    case "reverse": return stdReverse(ctx, argNodes, scope, exclude, node);
    case "all": return stdAll(ctx, argNodes, scope, exclude, node);
    case "any": return stdAny(ctx, argNodes, scope, exclude, node);
    case "contains": return stdContains(ctx, argNodes, scope, exclude, node);
    case "startsWith": return stdStartsWith(ctx, argNodes, scope, exclude, node);
    case "endsWith": return stdEndsWith(ctx, argNodes, scope, exclude, node);
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

/** §D.2: undefined as argument to a std function is a runtime error. */
function evalArg(
  ctx: EvalContext, argNode: AstNode, scope: Scope,
  exclude: string | undefined, fnName: string, _node: AstNode,
): UzonValue {
  const val = ctx.evalNode(argNode, scope, exclude);
  if (val === UZON_UNDEFINED) {
    throw new UzonRuntimeError(
      `Argument of std.${fnName} is undefined`, argNode.line, argNode.col,
    );
  }
  return val;
}

function isStruct(val: UzonValue): val is Record<string, UzonValue> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
    && !(val instanceof UzonEnum) && !(val instanceof UzonUnion)
    && !(val instanceof UzonTaggedUnion) && !(val instanceof UzonTuple)
    && !(val instanceof UzonFunction);
}

/** §3.6/§3.7.1: unwrap union/tagged union to access inner value. */
function unwrapUnion(val: UzonValue): UzonValue {
  if (val instanceof UzonTaggedUnion) return val.value;
  if (val instanceof UzonUnion) return val.value;
  return val;
}

// ── Collection queries ──

function stdLen(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "len", node);
  const val = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "len", node));
  if (typeof val === "string") { ctx.numericType = "i64"; return BigInt([...val].length); }
  if (Array.isArray(val)) { ctx.numericType = "i64"; return BigInt(val.length); }
  if (val instanceof UzonTuple) { ctx.numericType = "i64"; return BigInt(val.length); }
  if (isStruct(val)) { ctx.numericType = "i64"; return BigInt(Object.keys(val).length); }
  throw new UzonTypeError("std.len requires a string, list, tuple, or struct", node.line, node.col);
}

function stdHasKey(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "hasKey", node);
  const collection = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "hasKey", node));
  const key = evalArg(ctx, argNodes[1], scope, exclude, "hasKey", node);
  if (!isStruct(collection)) throw new UzonTypeError("std.hasKey requires a struct as the first argument", node.line, node.col);
  if (typeof key !== "string") throw new UzonTypeError("std.hasKey requires a string key", node.line, node.col);
  return key in collection;
}

function stdGet(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "get", node);
  const collection = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "get", node));
  const key = evalArg(ctx, argNodes[1], scope, exclude, "get", node);
  if (Array.isArray(collection)) {
    if (typeof key !== "bigint") throw new UzonTypeError("std.get on a list requires an integer index", node.line, node.col);
    const idx = Number(key);
    if (idx < 0 || idx >= collection.length) return UZON_UNDEFINED as UzonValue;
    return collection[idx];
  }
  if (collection instanceof UzonTuple) {
    if (typeof key !== "bigint") throw new UzonTypeError("std.get on a tuple requires an integer index", node.line, node.col);
    const idx = Number(key);
    if (idx < 0 || idx >= collection.length) return UZON_UNDEFINED as UzonValue;
    return collection.elements[idx];
  }
  if (isStruct(collection)) {
    if (typeof key !== "string") throw new UzonTypeError("std.get on a struct requires a string key", node.line, node.col);
    return key in collection ? collection[key] : UZON_UNDEFINED as UzonValue;
  }
  throw new UzonTypeError("std.get requires a list, tuple, or struct", node.line, node.col);
}

function stdKeys(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "keys", node);
  const val = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "keys", node));
  if (isStruct(val)) return Object.keys(val);
  throw new UzonTypeError("std.keys requires a struct", node.line, node.col);
}

function stdValues(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "values", node);
  const val = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "values", node));
  if (isStruct(val)) return new UzonTuple(Object.values(val));
  throw new UzonTypeError("std.values requires a struct", node.line, node.col);
}

// ── Higher-order functions ──

function stdMap(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "map", node);
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "map", node));
  if (!Array.isArray(list)) throw new UzonTypeError("std.map requires a list as the first argument", node.line, node.col);
  const fn = evalArg(ctx, argNodes[1], scope, exclude, "map", node);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.map requires a function as the second argument", node.line, node.col);
  if (fn.paramNames.length < 1) throw new UzonTypeError("std.map function must take at least one parameter", node.line, node.col);
  const result: UzonValue[] = [];
  for (const elem of list) result.push(ctx.callFunctionDirect(fn, [elem], scope, node));
  return result;
}

function stdFilter(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "filter", node);
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "filter", node));
  if (!Array.isArray(list)) throw new UzonTypeError("std.filter requires a list as the first argument", node.line, node.col);
  const fn = evalArg(ctx, argNodes[1], scope, exclude, "filter", node);
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
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "sort", node));
  if (!Array.isArray(list)) throw new UzonTypeError("std.sort requires a list as the first argument", node.line, node.col);
  const fn = evalArg(ctx, argNodes[1], scope, exclude, "sort", node);
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
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "reduce", node));
  if (!Array.isArray(list)) throw new UzonTypeError("std.reduce requires a list as the first argument", node.line, node.col);
  let acc = evalArg(ctx, argNodes[1], scope, exclude, "reduce", node);
  const fn = evalArg(ctx, argNodes[2], scope, exclude, "reduce", node);
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
  const val = evalArg(ctx, argNodes[0], scope, exclude, "isNan", node);
  if (typeof val !== "number") throw new UzonTypeError("std.isNan requires a float value", node.line, node.col);
  return Number.isNaN(val);
}

function stdIsInf(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "isInf", node);
  const val = evalArg(ctx, argNodes[0], scope, exclude, "isInf", node);
  if (typeof val !== "number") throw new UzonTypeError("std.isInf requires a float value", node.line, node.col);
  return val === Infinity || val === -Infinity;
}

function stdIsFinite_(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "isFinite", node);
  const val = evalArg(ctx, argNodes[0], scope, exclude, "isFinite", node);
  if (typeof val !== "number") throw new UzonTypeError("std.isFinite requires a float value", node.line, node.col);
  return Number.isFinite(val);
}

// ── String utilities ──

function stdJoin(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "join", node);
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "join", node));
  const sep = evalArg(ctx, argNodes[1], scope, exclude, "join", node);
  if (!Array.isArray(list)) throw new UzonTypeError("std.join requires a [string] list as first argument", node.line, node.col);
  if (typeof sep !== "string") throw new UzonTypeError("std.join requires a string separator", node.line, node.col);
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string") throw new UzonTypeError("std.join requires a [string] list — element is not a string", node.line, node.col);
  }
  return (list as string[]).join(sep);
}

function stdReplace(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 3, "replace", node);
  const str = evalArg(ctx, argNodes[0], scope, exclude, "replace", node);
  const target = evalArg(ctx, argNodes[1], scope, exclude, "replace", node);
  const replacement = evalArg(ctx, argNodes[2], scope, exclude, "replace", node);
  if (typeof str !== "string" || typeof target !== "string" || typeof replacement !== "string") {
    throw new UzonTypeError("std.replace requires three string arguments", node.line, node.col);
  }
  if (target === "") return str;
  return str.split(target).join(replacement);
}

function stdSplit(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "split", node);
  const str = evalArg(ctx, argNodes[0], scope, exclude, "split", node);
  const delim = evalArg(ctx, argNodes[1], scope, exclude, "split", node);
  if (typeof str !== "string" || typeof delim !== "string") {
    throw new UzonTypeError("std.split requires two string arguments", node.line, node.col);
  }
  if (str === "") return [""];
  if (delim === "") return [...str];
  return str.split(delim);
}

function stdTrim(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "trim", node);
  const val = evalArg(ctx, argNodes[0], scope, exclude, "trim", node);
  if (typeof val !== "string") throw new UzonTypeError("std.trim requires a string argument", node.line, node.col);
  return val.trim();
}

function stdLower(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "lower", node);
  const val = evalArg(ctx, argNodes[0], scope, exclude, "lower", node);
  if (typeof val !== "string") throw new UzonTypeError("std.lower requires a string argument", node.line, node.col);
  return val.toLowerCase();
}

function stdUpper(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "upper", node);
  const val = evalArg(ctx, argNodes[0], scope, exclude, "upper", node);
  if (typeof val !== "string") throw new UzonTypeError("std.upper requires a string argument", node.line, node.col);
  return val.toUpperCase();
}

// ── Reverse ──

function stdReverse(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 1, "reverse", node);
  const val = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "reverse", node));
  if (typeof val === "string") return [...val].reverse().join("");
  if (Array.isArray(val)) {
    const result = [...val].reverse();
    const elemType = ctx.listElementTypes.get(val);
    if (elemType) ctx.listElementTypes.set(result, elemType);
    return result;
  }
  throw new UzonTypeError("std.reverse requires a list or string", node.line, node.col);
}

// ── Collection predicates ──

function stdAll(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "all", node);
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "all", node));
  if (!Array.isArray(list)) throw new UzonTypeError("std.all requires a list as the first argument", node.line, node.col);
  const fn = evalArg(ctx, argNodes[1], scope, exclude, "all", node);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.all requires a function as the second argument", node.line, node.col);
  for (const elem of list) {
    const result = ctx.callFunctionDirect(fn, [elem], scope, node);
    if (typeof result !== "boolean") throw new UzonTypeError("std.all predicate must return bool", node.line, node.col);
    if (!result) return false;
  }
  return true;
}

function stdAny(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "any", node);
  const list = unwrapUnion(evalArg(ctx, argNodes[0], scope, exclude, "any", node));
  if (!Array.isArray(list)) throw new UzonTypeError("std.any requires a list as the first argument", node.line, node.col);
  const fn = evalArg(ctx, argNodes[1], scope, exclude, "any", node);
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.any requires a function as the second argument", node.line, node.col);
  for (const elem of list) {
    const result = ctx.callFunctionDirect(fn, [elem], scope, node);
    if (typeof result !== "boolean") throw new UzonTypeError("std.any predicate must return bool", node.line, node.col);
    if (result) return true;
  }
  return false;
}

// ── String predicates ──

function stdContains(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "contains", node);
  const str = evalArg(ctx, argNodes[0], scope, exclude, "contains", node);
  const sub = evalArg(ctx, argNodes[1], scope, exclude, "contains", node);
  if (typeof str !== "string" || typeof sub !== "string") throw new UzonTypeError("std.contains requires two string arguments", node.line, node.col);
  return str.includes(sub);
}

function stdStartsWith(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "startsWith", node);
  const str = evalArg(ctx, argNodes[0], scope, exclude, "startsWith", node);
  const prefix = evalArg(ctx, argNodes[1], scope, exclude, "startsWith", node);
  if (typeof str !== "string" || typeof prefix !== "string") throw new UzonTypeError("std.startsWith requires two string arguments", node.line, node.col);
  return str.startsWith(prefix);
}

function stdEndsWith(ctx: EvalContext, argNodes: AstNode[], scope: Scope, exclude: string | undefined, node: AstNode): UzonValue {
  expectArgs(argNodes, 2, "endsWith", node);
  const str = evalArg(ctx, argNodes[0], scope, exclude, "endsWith", node);
  const suffix = evalArg(ctx, argNodes[1], scope, exclude, "endsWith", node);
  if (typeof str !== "string" || typeof suffix !== "string") throw new UzonTypeError("std.endsWith requires two string arguments", node.line, node.col);
  return str.endsWith(suffix);
}
