// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Stringify — convert UZON values back to source text.
 *
 * Supports both UzonValue types and plain JS values (auto-converted).
 * See SPECIFICATION.md §E.2 for serialisation format rules.
 */

import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  formatUzonFloat,
  type UzonValue,
} from "./value.js";
import { KEYWORDS, RESERVED_KEYWORDS, TOKEN_BOUNDARY_CHARS } from "./token.js";

// ── Options ──────────────────────────────────────────────────────

export interface StringifyOptions {
  /** Indentation string per nesting level (default: "    " per spec §E.2) */
  indent?: string;
  /** Use multiline format for structs with more than this many fields (default: 1) */
  multilineThreshold?: number;
}

export interface ToJSOptions {
  /** How to convert bigint values (default: "number") */
  bigint?: "number" | "bigint" | "string";
}

// ── Keyword set for identifier escaping ──────────────────────────

const ALL_KEYWORDS = new Set([...Object.keys(KEYWORDS), ...RESERVED_KEYWORDS]);

// ── Identifier escaping (§2.3) ──────────────────────────────────

/**
 * Escape/quote an identifier (binding name, struct field) for valid UZON output.
 * - Keywords and reserved keywords → @-escaped (e.g. `@is`)
 * - Names with whitespace or token boundary chars → quoted with '...'
 * - Otherwise → as-is
 */
function escapeIdentifier(name: string): string {
  if (ALL_KEYWORDS.has(name)) return `@${name}`;
  for (const ch of name) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || TOKEN_BOUNDARY_CHARS.has(ch)) {
      return `'${name}'`;
    }
  }
  return name;
}

// ── String escaping ─────────────────────────────────────────────

function stringifyString(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\{/g, "\\{")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

// ── Value normalisation (plain JS → UzonValue) ──────────────────

/**
 * Normalise a value for stringification.
 * Passes through UzonValue types unchanged; converts plain JS numbers
 * (integer → bigint) so stringifyValue formats them correctly.
 */
function normalizeValue(value: any): UzonValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) return value;
    if (Number.isInteger(value)) return BigInt(value);
    return value;
  }
  if (typeof value === "string") return value;
  if (value instanceof UzonEnum) return value;
  if (value instanceof UzonUnion) return value;
  if (value instanceof UzonTaggedUnion) return value;
  if (value instanceof UzonTuple) return value;
  if (value instanceof UzonFunction) return value;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") {
    const result: Record<string, UzonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = normalizeValue(v);
    }
    return result;
  }
  throw new Error(`Cannot convert ${typeof value} to UZON`);
}

// ── stringify ───────────────────────────────────────────────────

/**
 * Convert a record of bindings to UZON source text.
 * Accepts both UzonValue and plain JS values (auto-converted).
 */
export function stringify(
  bindings: Record<string, any>,
  options: StringifyOptions = {},
): string {
  const indent = options.indent ?? "    ";
  const threshold = options.multilineThreshold ?? 1;

  const lines: string[] = [];
  for (const [name, value] of Object.entries(bindings)) {
    const eName = escapeIdentifier(name);
    const uVal = normalizeValue(value);
    lines.push(`${eName} is ${stringifyValue(uVal, indent, threshold, 0)}`);
  }
  return lines.join("\n");
}

// ── stringifyValue ──────────────────────────────────────────────

/**
 * Convert a single value to its UZON text representation.
 * Accepts both UzonValue and plain JS values.
 */
export function stringifyValue(
  value: any,
  indent: string = "    ",
  multilineThreshold: number = 1,
  depth: number = 0,
): string {
  if (value === UZON_UNDEFINED) throw new Error("Cannot stringify undefined UZON value");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return stringifyNumber(value);
  if (typeof value === "string") return stringifyString(value);
  if (value instanceof UzonEnum) return stringifyEnum(value);
  if (value instanceof UzonUnion) return stringifyUnion(value, indent, multilineThreshold, depth);
  if (value instanceof UzonTaggedUnion) return stringifyTaggedUnion(value, indent, multilineThreshold, depth);
  if (value instanceof UzonFunction) throw new Error("Cannot stringify function values — functions are not serializable");
  if (value instanceof UzonTuple) return stringifyTuple(value, indent, multilineThreshold, depth);
  if (Array.isArray(value)) return stringifyList(value, indent, multilineThreshold, depth);
  if (typeof value === "object") return stringifyStruct(value, indent, multilineThreshold, depth);
  throw new Error(`Cannot stringify value: ${value}`);
}

function stringifyNumber(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  return formatUzonFloat(value);
}

// §3.5: Enum — `variant from var1, var2, ... [called TypeName]`
function stringifyEnum(value: UzonEnum): string {
  const escapedVariants = value.variants.map((v: string) =>
    ALL_KEYWORDS.has(v) ? `@${v}` : v,
  );
  let result = `${escapeIdentifier(value.value)} from ${escapedVariants.join(", ")}`;
  if (value.typeName) result += ` called ${value.typeName}`;
  return result;
}

// §3.6: Untagged union — `value from union Type1, Type2, ...`
function stringifyUnion(value: UzonUnion, indent: string, mt: number, depth: number): string {
  const inner = stringifyValue(value.value, indent, mt, depth);
  let result = `${inner} from union ${value.types.join(", ")}`;
  if (value.typeName) result += ` called ${value.typeName}`;
  return result;
}

// §3.7: Tagged union — `value named tag from var1 as T1, ... [called TypeName]`
function stringifyTaggedUnion(value: UzonTaggedUnion, indent: string, mt: number, depth: number): string {
  const inner = stringifyValue(value.value, indent, mt, depth);
  const allHaveTypes = value.variants.size > 0
    && [...value.variants.values()].every(v => v !== null);
  let result: string;
  if (allHaveTypes) {
    const variants = [...value.variants.entries()]
      .map(([k, v]) => `${k} as ${v}`)
      .join(", ");
    result = `${inner} named ${value.tag} from ${variants}`;
  } else {
    result = `${inner} named ${value.tag}`;
  }
  if (value.typeName) result += ` called ${value.typeName}`;
  return result;
}

// §3.3: Tuple — `(elem1, elem2)` with trailing comma for single-element
function stringifyTuple(value: UzonTuple, indent: string, mt: number, depth: number): string {
  if (value.elements.length === 0) return "()";
  if (value.elements.length === 1) {
    return `(${stringifyValue(value.elements[0], indent, mt, depth)},)`;
  }
  const elems = value.elements.map((e: UzonValue) => stringifyValue(e, indent, mt, depth));
  return `(${elems.join(", ")})`;
}

// §3.4: List — `[ elem1, elem2, ... ]`
function stringifyList(value: UzonValue[], indent: string, mt: number, depth: number): string {
  if (value.length === 0) return "[]";
  const elems = value.map((e: UzonValue) => stringifyValue(e, indent, mt, depth + 1));
  return `[ ${elems.join(", ")} ]`;
}

// §3.2: Struct — inline or multiline based on field count
function stringifyStruct(value: Record<string, any>, indent: string, mt: number, depth: number): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  if (entries.length <= mt) {
    const fields = entries.map(([k, v]) =>
      `${escapeIdentifier(k)} is ${stringifyValue(v, indent, mt, depth + 1)}`,
    );
    return `{ ${fields.join(", ")} }`;
  }
  const pad = indent.repeat(depth + 1);
  const closePad = indent.repeat(depth);
  const fields = entries.map(([k, v]) =>
    `${pad}${escapeIdentifier(k)} is ${stringifyValue(v, indent, mt, depth + 1)}`,
  );
  return `{\n${fields.join("\n")}\n${closePad}}`;
}

// ── toJS ────────────────────────────────────────────────────────

type JsValue = string | number | boolean | null | JsValue[] | { [key: string]: JsValue };

/**
 * Convert a UzonValue to a plain JS value.
 *
 * Mapping:
 *   null       → null
 *   boolean    → boolean
 *   bigint     → number (default), bigint, or string (via options.bigint)
 *   number     → number (floats, NaN, Infinity)
 *   string     → string
 *   UzonEnum   → string (variant name)
 *   UzonUnion  → recursively converts inner value
 *   UzonTaggedUnion → { tag, value }
 *   UzonTuple  → array
 *   list       → array
 *   struct     → plain object
 *   UzonFunction → throws
 *   UZON_UNDEFINED → undefined
 */
export function toJS(value: UzonValue, options: ToJSOptions = {}): JsValue | undefined {
  if (value === UZON_UNDEFINED) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") {
    const mode = options.bigint ?? "number";
    if (mode === "bigint") return value as unknown as JsValue;
    if (mode === "string") return value.toString();
    return Number(value);
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;

  if (value instanceof UzonEnum) return value.value;
  if (value instanceof UzonUnion) return toJS(value.value, options);
  if (value instanceof UzonTaggedUnion) {
    return { tag: value.tag, value: toJS(value.value, options) ?? null };
  }
  if (value instanceof UzonFunction) {
    throw new Error("Cannot convert function values to JS");
  }
  if (value instanceof UzonTuple) {
    return value.elements.map(e => toJS(e, options) ?? null);
  }
  if (Array.isArray(value)) {
    return value.map(e => toJS(e, options) ?? null);
  }
  if (typeof value === "object") {
    const result: Record<string, JsValue> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = toJS(v, options) ?? null;
    }
    return result;
  }
  throw new Error(`Cannot convert to JS: ${value}`);
}
