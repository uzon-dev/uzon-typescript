// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Standard library — 24 built-in functions (§5.16).
 *
 * All std.* functions are dispatched through evalStdCall, which evaluates
 * arguments up-front and propagates `undefined` per §5.16.
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

/** §5.16: undefined propagated from std.* retains the declared return type
 *  for speculative type-checking. Only fixed primitive numeric return types
 *  are listed — polymorphic returns (same type as input, [T], etc.) don't
 *  carry a numeric type.
 */
const STD_RETURN_NUMERIC_TYPE: Record<string, string> = {
  len: "i64",
};

const KNOWN_STD_FUNCS = new Set([
  "len", "hasKey", "get", "keys", "values",
  "map", "filter", "reduce", "sort",
  "isNan", "isInf", "isFinite",
  "join", "replace", "split", "trim", "lower", "upper",
  "reverse", "all", "any", "contains", "startsWith", "endsWith",
]);

export function evalStdCall(
  ctx: EvalContext, fnName: string, argNodes: AstNode[],
  scope: Scope, exclude: string | undefined, node: AstNode,
): UzonValue {
  if (!KNOWN_STD_FUNCS.has(fnName)) {
    throw new UzonRuntimeError(`'std.${fnName}' is not a standard library function`, node.line, node.col);
  }
  // §5.16: evaluate args up-front; propagate undefined if any arg is undefined
  const args: UzonValue[] = [];
  for (const argNode of argNodes) {
    args.push(ctx.evalNode(argNode, scope, exclude));
  }
  for (const a of args) {
    if (a === UZON_UNDEFINED) {
      const retType = STD_RETURN_NUMERIC_TYPE[fnName];
      if (retType) ctx.numericType = retType;
      return UZON_UNDEFINED;
    }
  }
  switch (fnName) {
    case "len": return stdLen(ctx, args, node);
    case "hasKey": return stdHasKey(args, node);
    case "get": return stdGet(args, node);
    case "keys": return stdKeys(args, node);
    case "values": return stdValues(args, node);
    case "map": return stdMap(ctx, args, scope, node);
    case "filter": return stdFilter(ctx, args, scope, node);
    case "reduce": return stdReduce(ctx, args, scope, node);
    case "sort": return stdSort(ctx, args, scope, node);
    case "isNan": return stdIsNan(args, node);
    case "isInf": return stdIsInf(args, node);
    case "isFinite": return stdIsFinite_(args, node);
    case "join": return stdJoin(args, node);
    case "replace": return stdReplace(args, node);
    case "split": return stdSplit(args, node);
    case "trim": return stdTrim(args, node);
    case "lower": return stdLower(args, node);
    case "upper": return stdUpper(args, node);
    case "reverse": return stdReverse(ctx, args, node);
    case "all": return stdAll(ctx, args, scope, node);
    case "any": return stdAny(ctx, args, scope, node);
    case "contains": return stdContains(args, node);
    case "startsWith": return stdStartsWith(args, node);
    case "endsWith": return stdEndsWith(args, node);
    default:
      throw new UzonRuntimeError(`'std.${fnName}' is not a standard library function`, node.line, node.col);
  }
}

// ── Helpers ──

function expectArgs(args: UzonValue[], count: number, fnName: string, node: AstNode): void {
  if (args.length !== count) {
    throw new UzonTypeError(`std.${fnName} expects ${count} argument(s) but got ${args.length}`, node.line, node.col);
  }
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

function stdLen(ctx: EvalContext, args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "len", node);
  const val = unwrapUnion(args[0]);
  if (typeof val === "string") { ctx.numericType = "i64"; return BigInt([...val].length); }
  if (Array.isArray(val)) { ctx.numericType = "i64"; return BigInt(val.length); }
  if (val instanceof UzonTuple) { ctx.numericType = "i64"; return BigInt(val.length); }
  if (isStruct(val)) { ctx.numericType = "i64"; return BigInt(Object.keys(val).length); }
  throw new UzonTypeError("std.len requires a string, list, tuple, or struct", node.line, node.col);
}

function stdHasKey(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "hasKey", node);
  const collection = unwrapUnion(args[0]);
  const key = args[1];
  if (!isStruct(collection)) throw new UzonTypeError("std.hasKey requires a struct as the first argument", node.line, node.col);
  if (typeof key !== "string") throw new UzonTypeError("std.hasKey requires a string key", node.line, node.col);
  return key in collection;
}

function stdGet(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "get", node);
  const collection = unwrapUnion(args[0]);
  const key = args[1];
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

function stdKeys(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "keys", node);
  const val = unwrapUnion(args[0]);
  if (isStruct(val)) return Object.keys(val);
  throw new UzonTypeError("std.keys requires a struct", node.line, node.col);
}

function stdValues(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "values", node);
  const val = unwrapUnion(args[0]);
  if (isStruct(val)) return new UzonTuple(Object.values(val));
  throw new UzonTypeError("std.values requires a struct", node.line, node.col);
}

// ── Higher-order functions ──

function stdMap(ctx: EvalContext, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
  expectArgs(args, 2, "map", node);
  const list = unwrapUnion(args[0]);
  if (!Array.isArray(list)) throw new UzonTypeError("std.map requires a list as the first argument", node.line, node.col);
  const fn = args[1];
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.map requires a function as the second argument", node.line, node.col);
  if (fn.paramNames.length < 1) throw new UzonTypeError("std.map function must take at least one parameter", node.line, node.col);
  const result: UzonValue[] = [];
  for (const elem of list) result.push(ctx.callFunctionDirect(fn, [elem], scope, node));
  return result;
}

function stdFilter(ctx: EvalContext, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
  expectArgs(args, 2, "filter", node);
  const list = unwrapUnion(args[0]);
  if (!Array.isArray(list)) throw new UzonTypeError("std.filter requires a list as the first argument", node.line, node.col);
  const fn = args[1];
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
  const typeName = ctx.listTypeNames.get(list);
  if (typeName) ctx.listTypeNames.set(result, typeName);
  return result;
}

function stdSort(ctx: EvalContext, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
  expectArgs(args, 2, "sort", node);
  const list = unwrapUnion(args[0]);
  if (!Array.isArray(list)) throw new UzonTypeError("std.sort requires a list as the first argument", node.line, node.col);
  const fn = args[1];
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
  const typeName = ctx.listTypeNames.get(list);
  if (typeName) ctx.listTypeNames.set(result, typeName);
  return result;
}

function stdReduce(ctx: EvalContext, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
  expectArgs(args, 3, "reduce", node);
  const list = unwrapUnion(args[0]);
  if (!Array.isArray(list)) throw new UzonTypeError("std.reduce requires a list as the first argument", node.line, node.col);
  let acc = args[1];
  const fn = args[2];
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

function stdIsNan(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "isNan", node);
  const val = args[0];
  if (typeof val !== "number") throw new UzonTypeError("std.isNan requires a float value", node.line, node.col);
  return Number.isNaN(val);
}

function stdIsInf(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "isInf", node);
  const val = args[0];
  if (typeof val !== "number") throw new UzonTypeError("std.isInf requires a float value", node.line, node.col);
  return val === Infinity || val === -Infinity;
}

function stdIsFinite_(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "isFinite", node);
  const val = args[0];
  if (typeof val !== "number") throw new UzonTypeError("std.isFinite requires a float value", node.line, node.col);
  return Number.isFinite(val);
}

// ── String utilities ──

function stdJoin(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "join", node);
  const list = unwrapUnion(args[0]);
  const sep = args[1];
  if (!Array.isArray(list)) throw new UzonTypeError("std.join requires a [string] list as first argument", node.line, node.col);
  if (typeof sep !== "string") throw new UzonTypeError("std.join requires a string separator", node.line, node.col);
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string") throw new UzonTypeError("std.join requires a [string] list — element is not a string", node.line, node.col);
  }
  return (list as string[]).join(sep);
}

function stdReplace(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 3, "replace", node);
  const str = args[0];
  const target = args[1];
  const replacement = args[2];
  if (typeof str !== "string" || typeof target !== "string" || typeof replacement !== "string") {
    throw new UzonTypeError("std.replace requires three string arguments", node.line, node.col);
  }
  if (target === "") return str;
  return str.split(target).join(replacement);
}

function stdSplit(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "split", node);
  const str = args[0];
  const delim = args[1];
  if (typeof str !== "string" || typeof delim !== "string") {
    throw new UzonTypeError("std.split requires two string arguments", node.line, node.col);
  }
  if (str === "") return [""];
  if (delim === "") return [...str];
  return str.split(delim);
}

function stdTrim(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "trim", node);
  const val = args[0];
  if (typeof val !== "string") throw new UzonTypeError("std.trim requires a string argument", node.line, node.col);
  return val.trim();
}

// §5.16.6: Unicode simple (default) case folding — locale-independent,
// codepoint-by-codepoint one-to-one mapping only. Characters whose full
// folding produces multiple codepoints (e.g., `ß` → `SS`) are returned
// unchanged. Iterates by codepoint so surrogate pairs map as a unit.
function simpleCaseFold(s: string, to: "lower" | "upper"): string {
  let out = "";
  for (const ch of s) {
    const mapped = to === "lower" ? ch.toLowerCase() : ch.toUpperCase();
    let n = 0;
    for (const _ of mapped) { n++; if (n > 1) break; }
    out += n === 1 ? mapped : ch;
  }
  return out;
}

function stdLower(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "lower", node);
  const val = args[0];
  if (typeof val !== "string") throw new UzonTypeError("std.lower requires a string argument", node.line, node.col);
  return simpleCaseFold(val, "lower");
}

function stdUpper(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "upper", node);
  const val = args[0];
  if (typeof val !== "string") throw new UzonTypeError("std.upper requires a string argument", node.line, node.col);
  return simpleCaseFold(val, "upper");
}

// ── Reverse ──

function stdReverse(ctx: EvalContext, args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 1, "reverse", node);
  const val = unwrapUnion(args[0]);
  if (typeof val === "string") return [...val].reverse().join("");
  if (Array.isArray(val)) {
    const result = [...val].reverse();
    const elemType = ctx.listElementTypes.get(val);
    if (elemType) ctx.listElementTypes.set(result, elemType);
    const typeName = ctx.listTypeNames.get(val);
    if (typeName) ctx.listTypeNames.set(result, typeName);
    return result;
  }
  throw new UzonTypeError("std.reverse requires a list or string", node.line, node.col);
}

// ── Collection predicates ──

function stdAll(ctx: EvalContext, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
  expectArgs(args, 2, "all", node);
  const list = unwrapUnion(args[0]);
  if (!Array.isArray(list)) throw new UzonTypeError("std.all requires a list as the first argument", node.line, node.col);
  const fn = args[1];
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.all requires a function as the second argument", node.line, node.col);
  for (const elem of list) {
    const result = ctx.callFunctionDirect(fn, [elem], scope, node);
    if (typeof result !== "boolean") throw new UzonTypeError("std.all predicate must return bool", node.line, node.col);
    if (!result) return false;
  }
  return true;
}

function stdAny(ctx: EvalContext, args: UzonValue[], scope: Scope, node: AstNode): UzonValue {
  expectArgs(args, 2, "any", node);
  const list = unwrapUnion(args[0]);
  if (!Array.isArray(list)) throw new UzonTypeError("std.any requires a list as the first argument", node.line, node.col);
  const fn = args[1];
  if (!(fn instanceof UzonFunction)) throw new UzonTypeError("std.any requires a function as the second argument", node.line, node.col);
  for (const elem of list) {
    const result = ctx.callFunctionDirect(fn, [elem], scope, node);
    if (typeof result !== "boolean") throw new UzonTypeError("std.any predicate must return bool", node.line, node.col);
    if (result) return true;
  }
  return false;
}

// ── String predicates ──

function stdContains(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "contains", node);
  const str = args[0];
  const sub = args[1];
  if (typeof str !== "string" || typeof sub !== "string") throw new UzonTypeError("std.contains requires two string arguments", node.line, node.col);
  return str.includes(sub);
}

function stdStartsWith(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "startsWith", node);
  const str = args[0];
  const prefix = args[1];
  if (typeof str !== "string" || typeof prefix !== "string") throw new UzonTypeError("std.startsWith requires two string arguments", node.line, node.col);
  return str.startsWith(prefix);
}

function stdEndsWith(args: UzonValue[], node: AstNode): UzonValue {
  expectArgs(args, 2, "endsWith", node);
  const str = args[0];
  const suffix = args[1];
  if (typeof str !== "string" || typeof suffix !== "string") throw new UzonTypeError("std.endsWith requires two string arguments", node.line, node.col);
  return str.endsWith(suffix);
}
