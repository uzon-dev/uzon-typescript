// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Immutable update helpers for UZON structs, lists, and tuples.
 *
 * All functions return new values — originals are never mutated.
 */

import { UzonTuple, type UzonValue } from "./value.js";

// ── Struct updates ──────────────────────────────────────────────

/** Return a new struct with the given field set (added or replaced). */
export function withField(
  struct: Record<string, UzonValue>,
  key: string,
  value: UzonValue,
): Record<string, UzonValue> {
  return { ...struct, [key]: value };
}

/** Return a new struct with the given field removed. */
export function withoutField(
  struct: Record<string, UzonValue>,
  key: string,
): Record<string, UzonValue> {
  const result = { ...struct };
  delete result[key];
  return result;
}

// ── List updates ────────────────────────────────────────────────

/** Return a new list with the value appended. */
export function append(
  list: UzonValue[],
  value: UzonValue,
): UzonValue[] {
  return [...list, value];
}

/** Return a new list with the value prepended. */
export function prepend(
  list: UzonValue[],
  value: UzonValue,
): UzonValue[] {
  return [value, ...list];
}

/** Return a new list with the element at `index` replaced. */
export function setAt(
  list: UzonValue[],
  index: number,
  value: UzonValue,
): UzonValue[] {
  if (index < 0 || index >= list.length) {
    throw new RangeError(`Index ${index} out of bounds for list of length ${list.length}`);
  }
  const result = [...list];
  result[index] = value;
  return result;
}

/** Return a new list with the element at `index` removed. */
export function removeAt(
  list: UzonValue[],
  index: number,
): UzonValue[] {
  if (index < 0 || index >= list.length) {
    throw new RangeError(`Index ${index} out of bounds for list of length ${list.length}`);
  }
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

// ── Tuple updates ───────────────────────────────────────────────

/** Return a new tuple with the element at `index` replaced. */
export function tupleSetAt(
  tuple: UzonTuple,
  index: number,
  value: UzonValue,
): UzonTuple {
  if (index < 0 || index >= tuple.length) {
    throw new RangeError(`Index ${index} out of bounds for tuple of length ${tuple.length}`);
  }
  const elements = [...tuple.elements];
  elements[index] = value;
  return new UzonTuple(elements);
}
