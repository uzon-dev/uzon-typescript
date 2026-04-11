// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Deep access utilities for navigating nested UzonValue structures.
 *
 * Supports dot-separated paths with bracket notation for list/tuple indexing:
 *   "database.host"       → struct field access
 *   "items[0]"            → list/tuple element access
 *   "servers[0].host"     → combined access
 */

import {
  UzonUnion, UzonTaggedUnion, UzonTuple, UzonEnum, UzonFunction,
  type UzonValue,
} from "./value.js";

/** Unwrap unions/tagged unions transparently. */
function unwrap(value: UzonValue): UzonValue {
  if (value instanceof UzonUnion) return unwrap(value.value);
  if (value instanceof UzonTaggedUnion) return unwrap(value.value);
  return value;
}

/** Check if a value is a struct. */
function isStructValue(v: UzonValue): v is Record<string, UzonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    && !(v instanceof UzonEnum) && !(v instanceof UzonUnion)
    && !(v instanceof UzonTaggedUnion) && !(v instanceof UzonTuple)
    && !(v instanceof UzonFunction);
}

/** Parse a dot-path into segments: "a.b[0].c" → ["a", "b", 0, "c"] */
function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === "[") {
      const end = path.indexOf("]", i);
      if (end === -1) throw new Error(`Unterminated bracket in path: ${path}`);
      segments.push(Number(path.slice(i + 1, end)));
      i = end + 1;
      if (i < path.length && path[i] === ".") i++;
    } else {
      let end = i;
      while (end < path.length && path[end] !== "." && path[end] !== "[") end++;
      segments.push(path.slice(i, end));
      i = end;
      if (i < path.length && path[i] === ".") i++;
    }
  }
  return segments;
}

/**
 * Access a nested value by dot-path. Returns undefined if any segment is missing.
 * Transparently unwraps unions and tagged unions at each level.
 *
 * ```ts
 * get(config, "database.host")     // struct field access
 * get(config, "items[0].name")     // list element + field
 * get(config, "matrix[0][1]")      // nested list indexing
 * ```
 */
export function get(value: UzonValue, path: string): UzonValue | undefined {
  const segments = parsePath(path);
  let current: UzonValue = value;

  for (const seg of segments) {
    current = unwrap(current);
    if (current === null) return undefined;

    if (typeof seg === "number") {
      if (Array.isArray(current)) {
        if (seg < 0 || seg >= current.length) return undefined;
        current = current[seg];
      } else if (current instanceof UzonTuple) {
        if (seg < 0 || seg >= current.length) return undefined;
        current = current.elements[seg];
      } else {
        return undefined;
      }
    } else {
      if (isStructValue(current)) {
        if (!(seg in current)) return undefined;
        current = current[seg];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * Like `get`, but throws if the path doesn't resolve.
 */
export function getOrThrow(value: UzonValue, path: string): UzonValue {
  const result = get(value, path);
  if (result === undefined) {
    throw new TypeError(`Path '${path}' not found`);
  }
  return result;
}
