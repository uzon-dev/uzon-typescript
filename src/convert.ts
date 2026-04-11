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

// ── Type guards ─────────────────────────────────────────────────

export function isNull(value: UzonValue): value is null {
  return value === null;
}

export function isUndefined(value: UzonValue): value is typeof UZON_UNDEFINED {
  return value === UZON_UNDEFINED;
}

export function isBool(value: UzonValue): value is boolean {
  return typeof value === "boolean";
}

export function isInteger(value: UzonValue): value is bigint {
  return typeof value === "bigint";
}

export function isFloat(value: UzonValue): value is number {
  return typeof value === "number";
}

export function isNumber(value: UzonValue): value is number | bigint {
  return typeof value === "number" || typeof value === "bigint";
}

export function isString(value: UzonValue): value is string {
  return typeof value === "string";
}

export function isList(value: UzonValue): value is UzonValue[] {
  return Array.isArray(value);
}

export function isTuple(value: UzonValue): value is UzonTuple {
  return value instanceof UzonTuple;
}

export function isEnum(value: UzonValue): value is UzonEnum {
  return value instanceof UzonEnum;
}

export function isUnion(value: UzonValue): value is UzonUnion {
  return value instanceof UzonUnion;
}

export function isTaggedUnion(value: UzonValue): value is UzonTaggedUnion {
  return value instanceof UzonTaggedUnion;
}

export function isStruct(value: UzonValue): value is Record<string, UzonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && !(value instanceof UzonEnum) && !(value instanceof UzonUnion)
    && !(value instanceof UzonTaggedUnion) && !(value instanceof UzonTuple)
    && !(value instanceof UzonFunction);
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

// ── Optional helpers (return undefined instead of throwing) ─────

export function optionalNumber(value: UzonValue): number | undefined {
  try { return asNumber(value); } catch { return undefined; }
}

export function optionalInteger(value: UzonValue): bigint | undefined {
  try { return asInteger(value); } catch { return undefined; }
}

export function optionalString(value: UzonValue): string | undefined {
  try { return asString(value); } catch { return undefined; }
}

export function optionalBool(value: UzonValue): boolean | undefined {
  try { return asBool(value); } catch { return undefined; }
}

export function optionalList(value: UzonValue): UzonValue[] | undefined {
  try { return asList(value); } catch { return undefined; }
}

export function optionalTuple(value: UzonValue): UzonTuple | undefined {
  try { return asTuple(value); } catch { return undefined; }
}

export function optionalStruct(value: UzonValue): Record<string, UzonValue> | undefined {
  try { return asStruct(value); } catch { return undefined; }
}

export function optionalEnum(value: UzonValue): UzonEnum | undefined {
  try { return asEnum(value); } catch { return undefined; }
}
