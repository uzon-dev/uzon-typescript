// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Runtime value types used throughout the UZON evaluator and stringify.
 *
 * UZON values are immutable once constructed. The type hierarchy mirrors
 * the specification's type system (§3):
 *   - Primitives: boolean, number (f64), bigint (integer), string, null
 *   - Compound: struct (plain object), list (array), tuple, enum, union,
 *               tagged union, function
 *   - Special: UZON_UNDEFINED — a sentinel for unresolved lookups (§3.1)
 */

// ── Undefined sentinel (§3.1) ──────────────────────────────────────

/**
 * `undefined` in UZON is a *state*, not a value. It arises from unresolved
 * lookups (`self.missing`, `env.UNSET`) and propagates through `.`, `to`,
 * and `as`, but causes runtime errors in arithmetic and most other operators.
 */
export const UZON_UNDEFINED: unique symbol = Symbol("UzonUndefined");
export type UzonUndefined = typeof UZON_UNDEFINED;

// ── Enum (§3.5) ────────────────────────────────────────────────────

/** A selected variant from a finite set of named alternatives. */
export class UzonEnum {
  constructor(
    public readonly value: string,
    public readonly variants: readonly string[],
    public readonly typeName: string | null = null,
  ) {}

  toString(): string {
    return this.value;
  }
}

// ── Untagged union (§3.6) ──────────────────────────────────────────

/** A value whose type is one of several possible member types. */
export class UzonUnion {
  constructor(
    public readonly value: UzonValue,
    public readonly types: readonly string[],
    public readonly typeName: string | null = null,
  ) {}
}

// ── Tagged union (§3.7) ────────────────────────────────────────────

/**
 * A value paired with an explicit variant tag.
 *
 * Tagged unions are *transparent* to most operators — arithmetic, concatenation,
 * and interpolation see the inner value. Exceptions: `is`/`is not` compare
 * tag+value, `is named` checks the tag, and `to` sees the wrapper (§3.7.1).
 */
export class UzonTaggedUnion {
  constructor(
    public readonly value: UzonValue,
    public readonly tag: string,
    public readonly variants: ReadonlyMap<string, string | null>,
    public readonly typeName: string | null = null,
  ) {}

  toString(): string {
    return String(this.value);
  }
}

// ── Tuple (§3.3) ──────────────────────────────────────────────────

/** A fixed-length heterogeneous sequence. */
export class UzonTuple {
  readonly elements: readonly UzonValue[];

  constructor(elements: readonly UzonValue[]) {
    this.elements = elements;
  }

  get length(): number {
    return this.elements.length;
  }

  [Symbol.iterator](): Iterator<UzonValue> {
    return this.elements[Symbol.iterator]();
  }
}

// ── Function (§3.8) ───────────────────────────────────────────────

/** A function value — pure, non-recursive, first-class. */
export class UzonFunction {
  constructor(
    public readonly paramNames: readonly string[],
    public readonly paramTypes: readonly string[],
    public readonly defaultValues: readonly (UzonValue | null)[],
    public readonly returnType: string,
    public readonly body: unknown,
    public readonly finalExpr: unknown,
    public readonly closureScope: unknown,
    public readonly typeName: string | null = null,
  ) {}
}

// ── UzonValue ─────────────────────────────────────────────────────

/**
 * The union of all possible UZON values.
 *
 * Structs are represented as `Record<string, UzonValue>` — plain objects
 * with string keys. This provides natural JS interop while keeping the
 * evaluator simple.
 */
export type UzonValue =
  | null
  | boolean
  | bigint
  | number
  | string
  | UzonEnum
  | UzonUnion
  | UzonTaggedUnion
  | UzonTuple
  | UzonFunction
  | UzonList
  | UzonStruct
  | UzonUndefined;

/** List value — variable-length homogeneous array. */
export type UzonList = UzonValue[];

/** Struct value — plain object with string keys. */
export interface UzonStruct {
  [key: string]: UzonValue;
}

// ── Float formatting (§5.11.2) ────────────────────────────────────

/**
 * Format a float for UZON `to string` output per §5.11.2.
 *
 * Rules:
 *  - Shortest round-trip decimal representation
 *  - Always contains a decimal point
 *  - Plain notation when 0 < n ≤ 21 or -6 < n ≤ 0
 *  - Scientific notation otherwise, with one digit before the point
 */
export function formatUzonFloat(value: number): string {
  if (!isFinite(value)) {
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    return "nan";
  }

  // Use JavaScript's toPrecision to get shortest round-trip form.
  // We rely on V8/SpiderMonkey producing correct round-trip strings.
  let s = String(value);

  // If the result has no dot and no exponent, add ".0" to distinguish from integer
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
    s += ".0";
  }

  // Normalize exponent format: JavaScript uses e+NN, UZON uses eNN (no +)
  s = s.replace(/e\+/, "e");

  // Ensure at least one digit after the decimal point in scientific notation
  s = s.replace(/^(-?\d)e/, "$1.0e");

  return s;
}
