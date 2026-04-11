// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Pattern matching for UzonValue — tagged unions and enums.
 *
 * Provides exhaustive and non-exhaustive matching with type-safe handlers.
 */

import {
  UzonEnum, UzonUnion, UzonTaggedUnion,
  type UzonValue,
} from "./value.js";

type MatchHandler<T> = (value: UzonValue) => T;

/**
 * Pattern match on a tagged union or enum value.
 *
 * For tagged unions: matches on `.tag`, passes `.value` to the handler.
 * For enums: matches on `.value` (variant name), passes the UzonEnum to the handler.
 * For unions: unwraps and recurses.
 *
 * ```ts
 * const result = match(status, {
 *   ok:  (v) => `Success: ${asString(v)}`,
 *   err: (v) => `Error: ${asString(v)}`,
 * });
 * ```
 *
 * Throws if no matching case is found and no `_` (default) handler is provided.
 */
export function match<T>(
  value: UzonValue,
  cases: Record<string, MatchHandler<T>> & { _?: MatchHandler<T> },
): T {
  if (value instanceof UzonUnion) {
    return match(value.value, cases);
  }

  if (value instanceof UzonTaggedUnion) {
    const handler = cases[value.tag];
    if (handler) return handler(value.value);
    if (cases._) return cases._(value.value);
    const tags = Object.keys(cases).filter(k => k !== "_");
    throw new TypeError(
      `No match for tag '${value.tag}'. Handled: ${tags.join(", ")}`,
    );
  }

  if (value instanceof UzonEnum) {
    const handler = cases[value.value];
    if (handler) return handler(value);
    if (cases._) return cases._(value);
    const variants = Object.keys(cases).filter(k => k !== "_");
    throw new TypeError(
      `No match for variant '${value.value}'. Handled: ${variants.join(", ")}`,
    );
  }

  if (cases._) return cases._(value);
  throw new TypeError(
    `match() requires a tagged union or enum, got ${describeForMatch(value)}`,
  );
}

function describeForMatch(value: UzonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return "float";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "list";
  return "struct";
}
