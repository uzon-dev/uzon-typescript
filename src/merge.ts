// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Deep merge for UzonValue structs.
 *
 * Designed for config layering: merge defaults with user overrides.
 * Structs are merged recursively; all other types are overwritten.
 */

import {
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";

function isStructValue(v: UzonValue): v is Record<string, UzonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    && !(v instanceof UzonEnum) && !(v instanceof UzonUnion)
    && !(v instanceof UzonTaggedUnion) && !(v instanceof UzonTuple)
    && !(v instanceof UzonFunction);
}

/**
 * Deep merge two UzonValue structs.
 *
 * - Struct + struct → recursively merged (override's fields take precedence)
 * - Any other combination → override replaces base entirely
 * - Returns a new object; neither input is mutated
 *
 * ```ts
 * const defaults = parse('host is "localhost"\nport is 8080\ndb is { name is "dev" }');
 * const user = parse('port is 3000\ndb is { name is "prod" }');
 * const config = merge(defaults, user);
 * // { host: "localhost", port: 3000n, db: { name: "prod" } }
 * ```
 */
export function merge(
  base: Record<string, UzonValue>,
  override: Record<string, UzonValue>,
): Record<string, UzonValue> {
  return mergeValues(base, override) as Record<string, UzonValue>;
}

/**
 * Deep merge two UzonValue values.
 * If both are structs, fields are recursively merged.
 * Otherwise, the override replaces the base.
 */
export function mergeValues(base: UzonValue, override: UzonValue): UzonValue {
  if (isStructValue(base) && isStructValue(override)) {
    const result: Record<string, UzonValue> = {};
    for (const key of Object.keys(base)) {
      if (key in override) {
        result[key] = mergeValues(base[key], override[key]);
      } else {
        result[key] = base[key];
      }
    }
    for (const key of Object.keys(override)) {
      if (!(key in base)) {
        result[key] = override[key];
      }
    }
    return result;
  }
  return override;
}
