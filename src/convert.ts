// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Type-narrowing helpers for extracting JS values from UzonValue.
 *
 * Each function unwraps UzonUnion and UzonTaggedUnion transparently
 * (matching UZON's transparent semantics), then checks the inner type.
 * Throws a TypeError with a clear message on mismatch.
 */

import {
  UZON_UNDEFINED,
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";

// ── Unwrap ──────────────────────────────────────────────────────

/** Unwrap UzonUnion and UzonTaggedUnion to reach the inner value. */
function unwrap(value: UzonValue): UzonValue {
  if (value instanceof UzonUnion) return unwrap(value.value);
  if (value instanceof UzonTaggedUnion) return unwrap(value.value);
  return value;
}

// ── Type description ────────────────────────────────────────────

function describeType(value: UzonValue): string {
  if (value === null) return "null";
  if (value === UZON_UNDEFINED) return "undefined";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return "float";
  if (typeof value === "string") return "string";
  if (value instanceof UzonEnum) return `enum(${value.typeName ?? "anonymous"})`;
  if (value instanceof UzonUnion) return `union(${value.typeName ?? "anonymous"})`;
  if (value instanceof UzonTaggedUnion) return `tagged_union(${value.typeName ?? "anonymous"})`;
  if (value instanceof UzonTuple) return "tuple";
  if (value instanceof UzonFunction) return "function";
  if (Array.isArray(value)) return "list";
  return "struct";
}

// ── Narrowing helpers ───────────────────────────────────────────

/**
 * Extract a number from a UzonValue.
 * Accepts float (number) and integer (bigint, converted to number).
 * Transparently unwraps unions and tagged unions.
 */
export function asNumber(value: UzonValue): number {
  const v = unwrap(value);
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  throw new TypeError(`Expected a number, got ${describeType(value)}`);
}

/**
 * Extract a bigint (integer) from a UzonValue.
 * Transparently unwraps unions and tagged unions.
 */
export function asInteger(value: UzonValue): bigint {
  const v = unwrap(value);
  if (typeof v === "bigint") return v;
  throw new TypeError(`Expected an integer, got ${describeType(value)}`);
}

/**
 * Extract a string from a UzonValue.
 * Also accepts UzonEnum (returns variant name).
 * Transparently unwraps unions and tagged unions.
 */
export function asString(value: UzonValue): string {
  const v = unwrap(value);
  if (typeof v === "string") return v;
  if (v instanceof UzonEnum) return v.value;
  throw new TypeError(`Expected a string, got ${describeType(value)}`);
}

/**
 * Extract a boolean from a UzonValue.
 * Transparently unwraps unions and tagged unions.
 */
export function asBool(value: UzonValue): boolean {
  const v = unwrap(value);
  if (typeof v === "boolean") return v;
  throw new TypeError(`Expected a bool, got ${describeType(value)}`);
}

/**
 * Extract a list (array) from a UzonValue.
 * Transparently unwraps unions and tagged unions.
 */
export function asList(value: UzonValue): UzonValue[] {
  const v = unwrap(value);
  if (Array.isArray(v)) return v;
  throw new TypeError(`Expected a list, got ${describeType(value)}`);
}

/**
 * Extract a UzonTuple from a UzonValue.
 * Transparently unwraps unions and tagged unions.
 */
export function asTuple(value: UzonValue): UzonTuple {
  const v = unwrap(value);
  if (v instanceof UzonTuple) return v;
  throw new TypeError(`Expected a tuple, got ${describeType(value)}`);
}

/**
 * Extract a struct (plain object) from a UzonValue.
 * Transparently unwraps unions and tagged unions.
 */
export function asStruct(value: UzonValue): Record<string, UzonValue> {
  const v = unwrap(value);
  if (typeof v === "object" && v !== null && !Array.isArray(v)
      && !(v instanceof UzonEnum) && !(v instanceof UzonUnion)
      && !(v instanceof UzonTaggedUnion) && !(v instanceof UzonTuple)
      && !(v instanceof UzonFunction)) {
    return v as Record<string, UzonValue>;
  }
  throw new TypeError(`Expected a struct, got ${describeType(value)}`);
}

/**
 * Extract a UzonEnum from a UzonValue.
 * Transparently unwraps unions and tagged unions.
 */
export function asEnum(value: UzonValue): UzonEnum {
  const v = unwrap(value);
  if (v instanceof UzonEnum) return v;
  throw new TypeError(`Expected an enum, got ${describeType(value)}`);
}
