// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Value comparison and type classification helpers.
 *
 * Pure functions — they do not need EvalContext because
 * they only reference each other, not the evaluator's state.
 */

import type { AstNode, TypeExprNode } from "./ast.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  formatUzonFloat,
  type UzonValue,
} from "./value.js";
import { UzonTypeError } from "./error.js";

// ── Value comparison ──

export function valuesEqual(a: UzonValue, b: UzonValue): boolean {
  if (a === null && b === null) return true;
  if (a === UZON_UNDEFINED && b === UZON_UNDEFINED) return true;
  if (a === null || b === null) return false;
  if (a === UZON_UNDEFINED || b === UZON_UNDEFINED) return false;

  if (typeof a === "bigint" && typeof b === "bigint") return a === b;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return false; // IEEE 754
    return a === b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;

  if (a instanceof UzonEnum && b instanceof UzonEnum) {
    if (a.typeName && b.typeName) return a.typeName === b.typeName && a.value === b.value;
    if (!a.typeName && !b.typeName) return a.value === b.value;
    return false;
  }
  if (a instanceof UzonUnion && b instanceof UzonUnion) {
    if (a.typeName && b.typeName && a.typeName !== b.typeName) return false;
    if (!a.typeName !== !b.typeName) return false;
    return valuesEqual(a.value, b.value);
  }
  if (a instanceof UzonTaggedUnion && b instanceof UzonTaggedUnion) {
    return a.tag === b.tag && valuesEqual(a.value, b.value);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => valuesEqual(v, b[i]));
  }
  if (a instanceof UzonTuple && b instanceof UzonTuple) {
    if (a.length !== b.length) return false;
    return a.elements.every((v, i) => valuesEqual(v, b.elements[i]));
  }
  if (typeof a === "object" && typeof b === "object"
      && !Array.isArray(a) && !Array.isArray(b)
      && !(a instanceof UzonEnum) && !(b instanceof UzonEnum)
      && !(a instanceof UzonUnion) && !(b instanceof UzonUnion)
      && !(a instanceof UzonTaggedUnion) && !(b instanceof UzonTaggedUnion)
      && !(a instanceof UzonTuple) && !(b instanceof UzonTuple)
      && !(a instanceof UzonFunction) && !(b instanceof UzonFunction)) {
    const aObj = a as Record<string, UzonValue>;
    const bObj = b as Record<string, UzonValue>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(k => k in bObj && valuesEqual(aObj[k], bObj[k]));
  }
  return false;
}

// ── Type assertions ──

export function assertBool(val: UzonValue, node: AstNode): asserts val is boolean {
  if (typeof val !== "boolean") {
    throw new UzonTypeError(
      "Expected a boolean (true or false) — UZON has no truthy/falsy coercion",
      node.line, node.col,
    );
  }
}

export function assertSameType(a: UzonValue, b: UzonValue, node: AstNode): void {
  if (a === null || b === null) return;
  if (a === UZON_UNDEFINED || b === UZON_UNDEFINED) return;
  if (a instanceof UzonFunction || b instanceof UzonFunction) {
    throw new UzonTypeError(
      "Cannot compare function values — function equality is not defined",
      node.line, node.col,
    );
  }
  const ta = typeCategory(a);
  const tb = typeCategory(b);
  if (ta !== tb) {
    throw new UzonTypeError(
      `Cannot compare ${ta} with ${tb} — operands of 'is'/'is not' must be the same type`,
      node.line, node.col,
    );
  }
  if (ta === "struct") {
    const aKeys = Object.keys(a as Record<string, UzonValue>).sort();
    const bKeys = Object.keys(b as Record<string, UzonValue>).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) {
      throw new UzonTypeError(
        `Cannot compare structs with different fields — {${aKeys.join(", ")}} vs {${bKeys.join(", ")}}`,
        node.line, node.col,
      );
    }
    const aObj = a as Record<string, UzonValue>;
    const bObj = b as Record<string, UzonValue>;
    for (const k of aKeys) assertSameType(aObj[k], bObj[k], node);
  }
  if (ta === "list") {
    const aCat = listElementCategory(a as UzonValue[]);
    const bCat = listElementCategory(b as UzonValue[]);
    if (aCat !== null && bCat !== null && aCat !== bCat) {
      throw new UzonTypeError(
        `Cannot compare lists with different element types — ${aCat} vs ${bCat}`,
        node.line, node.col,
      );
    }
  }
  if (ta === "tuple") {
    const aTup = a as UzonTuple;
    const bTup = b as UzonTuple;
    if (aTup.length !== bTup.length) {
      throw new UzonTypeError(
        `Cannot compare tuples of different lengths — ${aTup.length} vs ${bTup.length}`,
        node.line, node.col,
      );
    }
    for (let i = 0; i < aTup.elements.length; i++) {
      assertSameType(aTup.elements[i], bTup.elements[i], node);
    }
  }
}

// ── Type classification ──

export function unwrapValue(val: UzonValue): UzonValue {
  if (val instanceof UzonTaggedUnion) return val.value;
  if (val instanceof UzonUnion) return val.value;
  return val;
}

export function listElementCategory(list: UzonValue[]): string | null {
  for (const elem of list) {
    if (elem !== null) return typeCategory(elem);
  }
  return null;
}

export function typeCategory(val: UzonValue): string {
  if (val === UZON_UNDEFINED) return "undefined";
  if (val === null) return "null";
  if (typeof val === "boolean") return "bool";
  if (typeof val === "bigint") return "integer";
  if (typeof val === "number") return "float";
  if (typeof val === "string") return "string";
  if (val instanceof UzonEnum) return "enum";
  if (val instanceof UzonTaggedUnion) return "tagged_union";
  if (val instanceof UzonUnion) return "union";
  if (val instanceof UzonFunction) return "function";
  if (val instanceof UzonTuple) return "tuple";
  if (Array.isArray(val)) return "list";
  return "struct";
}

export function typeTag(val: UzonValue): string {
  if (val === UZON_UNDEFINED) return "undefined";
  if (val === null) return "null";
  if (typeof val === "boolean") return "bool";
  if (typeof val === "bigint") return "integer";
  if (typeof val === "number") return "float";
  if (typeof val === "string") return "string";
  if (val instanceof UzonEnum) return `enum(${val.typeName ?? "anonymous"})`;
  if (val instanceof UzonTaggedUnion) return `tagged_union(${val.typeName ?? "anonymous"})`;
  if (val instanceof UzonUnion) return `union(${val.typeName ?? "anonymous"})`;
  if (val instanceof UzonFunction) return `function(${val.typeName ?? "anonymous"})`;
  if (val instanceof UzonTuple) return "tuple";
  if (Array.isArray(val)) return "list";
  return "struct";
}

export function typeExprToString(type: TypeExprNode): string {
  if (type.isNull) return "null";
  if (type.isList && type.inner) return `[${typeExprToString(type.inner)}]`;
  if (type.isTuple && type.tupleElements) {
    return `(${type.tupleElements.map(t => typeExprToString(t)).join(", ")})`;
  }
  return type.path.join(".");
}

// ── Value to string ──

export function valueToString(val: UzonValue, node: AstNode): string {
  if (val === null) return "null";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "number") {
    if (val === Infinity) return "inf";
    if (val === -Infinity) return "-inf";
    if (Number.isNaN(val)) return "nan";
    return formatUzonFloat(val);
  }
  if (typeof val === "string") return val;
  if (val instanceof UzonEnum) return val.value;
  if (val instanceof UzonTaggedUnion) return valueToString(val.value, node);
  if (val instanceof UzonUnion) return valueToString(val.value, node);
  if (Array.isArray(val)) {
    throw new UzonTypeError("Lists cannot be converted to string", node.line, node.col);
  }
  if (val instanceof UzonTuple) {
    throw new UzonTypeError("Tuples cannot be converted to string", node.line, node.col);
  }
  if (val instanceof UzonFunction) {
    throw new UzonTypeError("Functions cannot be converted to string", node.line, node.col);
  }
  throw new UzonTypeError("Structs cannot be converted to string", node.line, node.col);
}
