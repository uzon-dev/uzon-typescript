// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * JSON interop for UzonValue — safe serialization and deserialization.
 *
 * Handles edge cases that toJS() doesn't address for JSON:
 *   - bigint → number (with overflow check) or string
 *   - NaN/Infinity → null or string representation
 *   - UzonEnum → string
 *   - UzonTaggedUnion → { _tag, _value }
 *   - UzonTuple → array
 */

import {
  UZON_UNDEFINED,
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";

export interface ToJSONOptions {
  /** How to handle bigint values (default: "number") */
  bigint?: "number" | "string";
  /** How to handle non-finite floats — NaN, Infinity (default: "null") */
  nonFinite?: "null" | "string";
}

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

/**
 * Convert a UzonValue to a JSON-safe value.
 *
 * Unlike `toJS()`, this ensures the result is safe for `JSON.stringify()`:
 * - bigint is converted to number or string (no BigInt in JSON)
 * - NaN/Infinity become null or string representations
 * - Functions and UZON_UNDEFINED become null
 *
 * ```ts
 * const json = toJSON(parse('x is 42\ny is inf'));
 * JSON.stringify(json)  // '{"x":42,"y":null}'
 * ```
 */
export function toJSON(value: UzonValue, options: ToJSONOptions = {}): JSONValue {
  const bigintMode = options.bigint ?? "number";
  const nonFiniteMode = options.nonFinite ?? "null";

  return convertToJSON(value, bigintMode, nonFiniteMode);
}

function convertToJSON(
  value: UzonValue, bigintMode: string, nonFiniteMode: string,
): JSONValue {
  if (value === null || value === UZON_UNDEFINED) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") {
    if (bigintMode === "string") return value.toString();
    const n = Number(value);
    if (!Number.isSafeInteger(n) && value !== 0n) {
      return value.toString();
    }
    return n;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      if (nonFiniteMode === "string") {
        if (Number.isNaN(value)) return "NaN";
        return value > 0 ? "Infinity" : "-Infinity";
      }
      return null;
    }
    return value;
  }
  if (typeof value === "string") return value;
  if (value instanceof UzonEnum) return value.value;
  if (value instanceof UzonUnion) return convertToJSON(value.value, bigintMode, nonFiniteMode);
  if (value instanceof UzonTaggedUnion) {
    return {
      _tag: value.tag,
      _value: convertToJSON(value.value, bigintMode, nonFiniteMode),
    };
  }
  if (value instanceof UzonFunction) return null;
  if (value instanceof UzonTuple) {
    return value.elements.map(e => convertToJSON(e, bigintMode, nonFiniteMode));
  }
  if (Array.isArray(value)) {
    return value.map(e => convertToJSON(e, bigintMode, nonFiniteMode));
  }
  if (typeof value === "object") {
    const result: Record<string, JSONValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, UzonValue>)) {
      result[k] = convertToJSON(v, bigintMode, nonFiniteMode);
    }
    return result;
  }
  return null;
}

/**
 * Convert a JSON-compatible value to UzonValue.
 *
 * Mapping:
 *   - null → null
 *   - boolean → boolean
 *   - number (integer) → bigint
 *   - number (float) → number
 *   - string → string
 *   - array → UzonValue[]
 *   - object with _tag/_value → UzonTaggedUnion (roundtrip support)
 *   - object → struct
 *
 * ```ts
 * const value = fromJSON({ host: "localhost", port: 8080 });
 * stringify({ config: value })  // 'config is { host is "localhost", port is 8080 }'
 * ```
 */
export function fromJSON(value: JSONValue): UzonValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return BigInt(value);
    return value;
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(fromJSON);
  }
  if (typeof value === "object") {
    // Roundtrip support: { _tag, _value } → UzonTaggedUnion
    if ("_tag" in value && "_value" in value
        && typeof value._tag === "string") {
      return new UzonTaggedUnion(
        fromJSON(value._value),
        value._tag,
        new Map(),
      );
    }
    const result: Record<string, UzonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = fromJSON(v);
    }
    return result;
  }
  return null;
}
