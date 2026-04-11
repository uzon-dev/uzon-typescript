// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Builder utilities for creating UzonValue from plain JS.
 *
 * Three ways to create UZON values:
 *   1. uzon({...})     — auto-convert plain JS objects
 *   2. uzon.int(42)    — factory helpers for explicit types
 *   3. uzon`...`       — tagged template literal with UZON syntax
 */

import {
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { Evaluator } from "./evaluator.js";

// ── Explicit float marker ────────────────────────────────────────

/** Marker class so autoConvert preserves floats created via uzon.float(). */
class ExplicitFloat {
  constructor(public readonly value: number) {}
}

// ── Auto-conversion ─────────────────────────────────────────────

type JSInput =
  | null | boolean | bigint | number | string
  | ExplicitFloat
  | UzonEnum | UzonUnion | UzonTaggedUnion | UzonTuple | UzonFunction
  | JSInput[]
  | { [key: string]: JSInput };

/**
 * Auto-convert a plain JS value to UzonValue.
 *
 * - `null`, `boolean`, `bigint`, `string` → pass through
 * - `number`: integer → bigint, non-integer → float
 * - `UzonEnum`, `UzonTuple`, etc. → pass through
 * - `Array` → recursively converted list
 * - `Object` → recursively converted struct
 *
 * ```ts
 * uzon({ host: "localhost", port: 8080, rate: 3.14 })
 * // { host: "localhost", port: 8080n, rate: 3.14 }
 * ```
 */
function autoConvert(value: JSInput): UzonValue {
  if (value === null) return null;
  if (value instanceof ExplicitFloat) return value.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return BigInt(value);
    return value;
  }
  if (value instanceof UzonEnum) return value;
  if (value instanceof UzonUnion) return value;
  if (value instanceof UzonTaggedUnion) return value;
  if (value instanceof UzonTuple) return value;
  if (value instanceof UzonFunction) return value;
  if (Array.isArray(value)) {
    return value.map(autoConvert);
  }
  if (typeof value === "object") {
    const result: Record<string, UzonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = autoConvert(v);
    }
    return result;
  }
  throw new Error(`Cannot convert ${typeof value} to UzonValue`);
}

// ── Factory helpers ─────────────────────────────────────────────

/** Create an integer (bigint) value. */
function int(value: number | bigint): bigint {
  return BigInt(value);
}

/** Create a float (number) value. Forces float even for integer-valued numbers. */
function float(value: number): ExplicitFloat {
  return new ExplicitFloat(value);
}

/** Create a UzonEnum. */
function enumValue(
  variant: string,
  variants: string[],
  typeName?: string,
): UzonEnum {
  return new UzonEnum(variant, variants, typeName ?? null);
}

/** Create a UzonTuple from elements. */
function tuple(...elements: JSInput[]): UzonTuple {
  return new UzonTuple(elements.map(autoConvert));
}

/** Create a UzonTaggedUnion. */
function tagged(
  tag: string,
  value: JSInput,
  variants: Record<string, string | null>,
  typeName?: string,
): UzonTaggedUnion {
  return new UzonTaggedUnion(
    autoConvert(value),
    tag,
    new Map(Object.entries(variants)),
    typeName ?? null,
  );
}

/** Create a UzonUnion. */
function union(
  value: JSInput,
  types: string[],
  typeName?: string,
): UzonUnion {
  return new UzonUnion(autoConvert(value), types, typeName ?? null);
}

/** Create a list with explicit element conversion. */
function list(...elements: JSInput[]): UzonValue[] {
  return elements.map(autoConvert);
}

/** Create a struct from a plain object. */
function struct(obj: Record<string, JSInput>): Record<string, UzonValue> {
  const result: Record<string, UzonValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = autoConvert(v);
  }
  return result;
}

// ── Tagged template literal ─────────────────────────────────────

/**
 * Tagged template literal for creating UZON bindings.
 *
 * Interpolated JS values are auto-converted to UZON literals and spliced
 * into the source before parsing.
 *
 * ```ts
 * const host = "localhost";
 * const port = 8080;
 * const config = uzon`
 *   host is ${host}
 *   port is ${port}
 *   enabled is true
 * `;
 * // { host: "localhost", port: 8080n, enabled: true }
 * ```
 */
function templateLiteral(
  strings: TemplateStringsArray,
  ...values: any[]
): Record<string, UzonValue> {
  let source = strings[0];
  for (let i = 0; i < values.length; i++) {
    source += jsValueToUzonLiteral(values[i]);
    source += strings[i + 1];
  }
  const tokens = new Lexer(source).tokenize();
  const doc = new Parser(tokens).parse();
  return new Evaluator({}).evaluate(doc);
}

/** Convert a JS value to its UZON literal representation for splicing. */
function jsValueToUzonLiteral(value: any): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    if (Number.isInteger(value)) return value.toString();
    return value.toString();
  }
  if (typeof value === "string") {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\{/g, "\\{")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/\r/g, "\\r")
      .replace(/\0/g, "\\0");
    return `"${escaped}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[ ${value.map(jsValueToUzonLiteral).join(", ")} ]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const fields = entries.map(([k, v]) => `${k} is ${jsValueToUzonLiteral(v)}`);
    return `{ ${fields.join(", ")} }`;
  }
  throw new Error(`Cannot interpolate ${typeof value} into UZON template`);
}

// ── Combined export ─────────────────────────────────────────────

type UzonBuilder = {
  (value: Record<string, JSInput>): Record<string, UzonValue>;
  (strings: TemplateStringsArray, ...values: any[]): Record<string, UzonValue>;
  int: typeof int;
  float: typeof float;
  enum: typeof enumValue;
  tuple: typeof tuple;
  tagged: typeof tagged;
  union: typeof union;
  list: typeof list;
  struct: typeof struct;
  value: typeof autoConvert;
};

/**
 * Create UZON values from plain JS.
 *
 * Can be called as:
 * - `uzon({ ... })` — auto-convert a plain object
 * - `` uzon`...` `` — tagged template literal
 * - `uzon.int(42)`, `uzon.enum(...)`, etc. — factory helpers
 */
export const uzon: UzonBuilder = Object.assign(
  function uzon(
    stringsOrObj: TemplateStringsArray | Record<string, JSInput>,
    ...values: any[]
  ): Record<string, UzonValue> {
    if (Array.isArray(stringsOrObj) && "raw" in stringsOrObj) {
      return templateLiteral(stringsOrObj as TemplateStringsArray, ...values);
    }
    return struct(stringsOrObj as Record<string, JSInput>);
  },
  {
    int,
    float,
    enum: enumValue,
    tuple,
    tagged,
    union,
    list,
    struct,
    value: autoConvert,
  },
);
