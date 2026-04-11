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
  /** Map from list arrays to their element type names (from Evaluator) */
  listElementTypes?: WeakMap<UzonValue[], string>;
}

export interface ToJSOptions {
  /** How to convert bigint values (default: "number") */
  bigint?: "number" | "bigint" | "string";
}

// ── Internal context ─────────────────────────────────────────────

interface StringifyCtx {
  indent: string;
  mt: number;
  emittedTypes: Set<string>;
  listElementTypes: WeakMap<UzonValue[], string>;
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
    .replace(/\0/g, "\\0")
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
 * Passes through UzonValue types unchanged. Plain JS numbers stay as
 * floats (use BigInt for integers). Preserves array/object identity
 * when no elements change, so WeakMap lookups remain valid.
 */
function normalizeValue(value: any): UzonValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (value instanceof UzonEnum) return value;
  if (value instanceof UzonUnion) return value;
  if (value instanceof UzonTaggedUnion) return value;
  if (value instanceof UzonTuple) return value;
  if (value instanceof UzonFunction) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((e: any) => {
      const n = normalizeValue(e);
      if (n !== e) changed = true;
      return n;
    });
    return changed ? result : value;
  }
  if (typeof value === "object") {
    let changed = false;
    const result: Record<string, UzonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalizeValue(v);
      if (n !== v) changed = true;
      result[k] = n;
    }
    return changed ? result : value;
  }
  throw new Error(`Cannot convert ${typeof value} to UZON`);
}

// ── Type collection ──────────────────────────────────────────────

function getTypeName(value: UzonValue): string | null {
  if (value instanceof UzonEnum) return value.typeName;
  if (value instanceof UzonUnion) return value.typeName;
  if (value instanceof UzonTaggedUnion) return value.typeName;
  return null;
}

/** Recursively collect all named types from a value tree. */
function collectTypes(
  value: UzonValue,
  types: Map<string, UzonEnum | UzonUnion | UzonTaggedUnion>,
): void {
  if (value instanceof UzonEnum) {
    if (value.typeName && !types.has(value.typeName)) types.set(value.typeName, value);
  } else if (value instanceof UzonUnion) {
    if (value.typeName && !types.has(value.typeName)) types.set(value.typeName, value);
    collectTypes(value.value, types);
  } else if (value instanceof UzonTaggedUnion) {
    if (value.typeName && !types.has(value.typeName)) types.set(value.typeName, value);
    collectTypes(value.value, types);
  } else if (value instanceof UzonTuple) {
    for (const e of value.elements) collectTypes(e, types);
  } else if (Array.isArray(value)) {
    for (const e of value) collectTypes(e, types);
  } else if (typeof value === "object" && value !== null
      && !(value instanceof UzonFunction)) {
    for (const v of Object.values(value as Record<string, UzonValue>)) {
      collectTypes(v, types);
    }
  }
}

/** Generate a synthetic type definition binding. */
function emitTypeDefinition(
  typeName: string, typeValue: UzonEnum | UzonUnion | UzonTaggedUnion,
  ctx: StringifyCtx,
): string {
  const bName = escapeIdentifier(`_${typeName}`);
  if (typeValue instanceof UzonEnum) {
    const escapedVariants = typeValue.variants.map((v: string) =>
      ALL_KEYWORDS.has(v) ? `@${v}` : v,
    );
    return `${bName} is ${escapeIdentifier(typeValue.variants[0])} from ${escapedVariants.join(", ")} called ${typeName}`;
  }
  if (typeValue instanceof UzonTaggedUnion) {
    const firstEntry = [...typeValue.variants.entries()][0];
    const [firstTag, firstType] = firstEntry;
    let defaultValue: string;
    if (firstType === null || firstType === "null") defaultValue = "null";
    else if (firstType === "string") defaultValue = '""';
    else if (firstType === "bool") defaultValue = "false";
    else if (/^[iu]\d+$/.test(firstType)) defaultValue = "0";
    else if (/^f\d+$/.test(firstType)) defaultValue = "0.0";
    else defaultValue = "null";
    const variants = [...typeValue.variants.entries()]
      .map(([k, v]) => `${k} as ${v ?? "null"}`)
      .join(", ");
    return `${bName} is ${defaultValue} named ${firstTag} from ${variants} called ${typeName}`;
  }
  // UzonUnion
  const inner = stringifyValueImpl(typeValue.value, ctx, 0);
  return `${bName} is ${inner} from union ${typeValue.types.join(", ")} called ${typeName}`;
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
  const ctx: StringifyCtx = {
    indent: options.indent ?? "    ",
    mt: options.multilineThreshold ?? 1,
    emittedTypes: new Set(),
    listElementTypes: options.listElementTypes ?? new WeakMap(),
  };

  // Normalize all values (preserving array/object identity)
  const entries: [string, UzonValue][] = [];
  for (const [k, v] of Object.entries(bindings)) {
    entries.push([k, normalizeValue(v)]);
  }

  // Collect all types used anywhere in the value tree
  const allTypes = new Map<string, UzonEnum | UzonUnion | UzonTaggedUnion>();
  for (const [, value] of entries) collectTypes(value, allTypes);

  // Find which types are direct top-level binding values
  const topLevelTypes = new Set<string>();
  for (const [, value] of entries) {
    const tn = getTypeName(value);
    if (tn) topLevelTypes.add(tn);
  }

  const lines: string[] = [];

  // Emit synthetic definitions for types only found in nested positions
  for (const [typeName, typeValue] of allTypes) {
    if (!topLevelTypes.has(typeName)) {
      lines.push(emitTypeDefinition(typeName, typeValue, ctx));
      ctx.emittedTypes.add(typeName);
    }
  }

  // Emit actual bindings
  for (const [name, value] of entries) {
    const eName = escapeIdentifier(name);
    lines.push(`${eName} is ${stringifyValueImpl(value, ctx, 0)}`);
    const tn = getTypeName(value);
    if (tn) ctx.emittedTypes.add(tn);
  }

  return lines.join("\n");
}

// ── stringifyValue (public API) ─────────────────────────────────

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
  const ctx: StringifyCtx = {
    indent, mt: multilineThreshold,
    emittedTypes: new Set(),
    listElementTypes: new WeakMap(),
  };
  return stringifyValueImpl(normalizeValue(value), ctx, depth);
}

// ── stringifyValueImpl (internal) ───────────────────────────────

function stringifyValueImpl(value: UzonValue, ctx: StringifyCtx, depth: number): string {
  if (value === UZON_UNDEFINED) throw new Error("Cannot stringify undefined UZON value");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return stringifyNumber(value);
  if (typeof value === "string") return stringifyString(value);
  if (value instanceof UzonEnum) return stringifyEnumImpl(value, ctx);
  if (value instanceof UzonUnion) return stringifyUnionImpl(value, ctx, depth);
  if (value instanceof UzonTaggedUnion) return stringifyTaggedUnionImpl(value, ctx, depth);
  if (value instanceof UzonFunction) throw new Error("Cannot stringify function values — functions are not serializable");
  if (value instanceof UzonTuple) return stringifyTupleImpl(value, ctx, depth);
  if (Array.isArray(value)) return stringifyListImpl(value, ctx, depth);
  if (typeof value === "object") return stringifyStructImpl(value, ctx, depth);
  throw new Error(`Cannot stringify value: ${value}`);
}

function stringifyNumber(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  return formatUzonFloat(value);
}

// §3.5: Enum
function stringifyEnumImpl(value: UzonEnum, ctx: StringifyCtx): string {
  if (value.typeName && ctx.emittedTypes.has(value.typeName)) {
    return `${escapeIdentifier(value.value)} as ${value.typeName}`;
  }
  const escapedVariants = value.variants.map((v: string) =>
    ALL_KEYWORDS.has(v) ? `@${v}` : v,
  );
  let result = `${escapeIdentifier(value.value)} from ${escapedVariants.join(", ")}`;
  if (value.typeName) {
    result += ` called ${value.typeName}`;
    ctx.emittedTypes.add(value.typeName);
  }
  return result;
}

// §3.6: Untagged union
function stringifyUnionImpl(value: UzonUnion, ctx: StringifyCtx, depth: number): string {
  const inner = stringifyValueImpl(value.value, ctx, depth);
  if (value.typeName && ctx.emittedTypes.has(value.typeName)) {
    return `${inner} as ${value.typeName}`;
  }
  let result = `${inner} from union ${value.types.join(", ")}`;
  if (value.typeName) {
    result += ` called ${value.typeName}`;
    ctx.emittedTypes.add(value.typeName);
  }
  return result;
}

// §3.7: Tagged union
function stringifyTaggedUnionImpl(value: UzonTaggedUnion, ctx: StringifyCtx, depth: number): string {
  const inner = stringifyValueImpl(value.value, ctx, depth);
  if (value.typeName && ctx.emittedTypes.has(value.typeName)) {
    return `${inner} as ${value.typeName} named ${value.tag}`;
  }
  // Full definition — always emit variant types
  const variants = [...value.variants.entries()]
    .map(([k, v]) => `${k} as ${v ?? "null"}`)
    .join(", ");
  let result: string;
  if (value.variants.size > 0) {
    result = `${inner} named ${value.tag} from ${variants}`;
  } else {
    result = `${inner} named ${value.tag}`;
  }
  if (value.typeName) {
    result += ` called ${value.typeName}`;
    ctx.emittedTypes.add(value.typeName);
  }
  return result;
}

// §3.3: Tuple
function stringifyTupleImpl(value: UzonTuple, ctx: StringifyCtx, depth: number): string {
  if (value.elements.length === 0) return "()";
  if (value.elements.length === 1) {
    return `(${stringifyValueImpl(value.elements[0], ctx, depth)},)`;
  }
  const elems = value.elements.map((e: UzonValue) => stringifyValueImpl(e, ctx, depth));
  return `(${elems.join(", ")})`;
}

// §3.4: List
function stringifyListImpl(value: UzonValue[], ctx: StringifyCtx, depth: number): string {
  const elemType = ctx.listElementTypes.get(value);
  if (value.length === 0) {
    if (elemType) return `[] as [${elemType}]`;
    return "[]";
  }
  const elems = value.map((e: UzonValue) => stringifyValueImpl(e, ctx, depth + 1));
  const result = `[ ${elems.join(", ")} ]`;
  if (elemType && value.every(e => e === null)) {
    return `${result} as [${elemType}]`;
  }
  return result;
}

// §3.2: Struct
function stringifyStructImpl(value: Record<string, any>, ctx: StringifyCtx, depth: number): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  if (entries.length <= ctx.mt) {
    const fields = entries.map(([k, v]) =>
      `${escapeIdentifier(k)} is ${stringifyValueImpl(v, ctx, depth + 1)}`,
    );
    return `{ ${fields.join(", ")} }`;
  }
  const pad = ctx.indent.repeat(depth + 1);
  const closePad = ctx.indent.repeat(depth);
  const fields = entries.map(([k, v]) =>
    `${pad}${escapeIdentifier(k)} is ${stringifyValueImpl(v, ctx, depth + 1)}`,
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
