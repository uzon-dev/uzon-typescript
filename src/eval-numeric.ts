// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Numeric type validation and resolution.
 *
 * Handles §5 adoptable numeric defaults (~i64/~f64), overflow validation,
 * and type compatibility checks for arithmetic and comparison operations.
 */

import type { NodeBase } from "./ast.js";
import { UzonRuntimeError, UzonTypeError } from "./error.js";
import type { UzonValue } from "./value.js";

// ── Range limits ──

const FLOAT_MAX: Record<string, number> = {
  f16: 65504,
  f32: 3.4028235e+38,
  f64: Number.MAX_VALUE,
};

// ── Validation ──

export function validateIntegerType(val: bigint, typeName: string, node: NodeBase): void {
  const match = typeName.match(/^([iu])(\d+)$/);
  if (!match) return;
  const signed = match[1] === "i";
  const bits = Number(match[2]);
  if (bits === 0) {
    if (val !== 0n) throw new UzonRuntimeError(`${typeName} can only hold 0`, node.line, node.col);
    return;
  }
  let min: bigint, max: bigint;
  if (signed) {
    min = -(1n << BigInt(bits - 1));
    max = (1n << BigInt(bits - 1)) - 1n;
  } else {
    min = 0n;
    max = (1n << BigInt(bits)) - 1n;
  }
  if (val < min || val > max) {
    throw new UzonRuntimeError(
      `Value ${val} does not fit in ${typeName} (range: ${min} to ${max})`,
      node.line, node.col,
    );
  }
}

export function validateFloatType(val: number, typeName: string, node: NodeBase): void {
  if (!Number.isFinite(val)) return;
  const maxVal = FLOAT_MAX[typeName];
  if (maxVal !== undefined && Math.abs(val) > maxVal) {
    throw new UzonRuntimeError(
      `Value ${val} does not fit in ${typeName} (max finite: ±${maxVal})`,
      node.line, node.col,
    );
  }
}

// ── Adoptable type helpers ──

/** Strip the "~" prefix to get the concrete type name. */
export function actualType(t: string | null): string | null {
  return t?.startsWith("~") ? t.slice(1) : t;
}

/** Whether a numeric type is adoptable (unresolved default). */
export function isAdoptable(t: string | null): boolean {
  return t !== null && t.startsWith("~");
}

/** Map a type name to its broad category. */
export function typeNameCategory(typeName: string): string | null {
  if (/^[iu]\d+$/.test(typeName)) return "integer";
  if (/^f\d+$/.test(typeName)) return "float";
  if (typeName === "bool") return "bool";
  if (typeName === "string") return "string";
  return null;
}

// ── Type resolution for binary operations ──

/** Whether a type name is a float type. */
function isFloatType(t: string): boolean {
  return /^f\d+$/.test(t);
}

/** Whether a type name is an integer type. */
function isIntType(t: string): boolean {
  return /^[iu]\d+$/.test(t);
}

/**
 * Resolve the numeric type when two operands meet in a binary operation.
 *
 * Rules (§5):
 * - Adoptable + concrete → adopt the concrete type
 * - Concrete + concrete → must match exactly
 * - Both adoptable → resolve to the shared default
 * - §5: Integer literal may adopt a float type (cross-category promotion,
 *   int→float only, never reverse)
 */
export function resolveNumericTypes(
  leftType: string | null, rightType: string | null,
  left: UzonValue, right: UzonValue, node: NodeBase,
): string | null {
  const la = actualType(leftType);
  const ra = actualType(rightType);
  if (!la && !ra) return null;

  const lAdopt = isAdoptable(leftType);
  const rAdopt = isAdoptable(rightType);

  if (lAdopt && !rAdopt && ra) {
    // §5: adoptable integer can adopt a float type (cross-category promotion)
    if (typeof left === "bigint" && isFloatType(ra)) {
      validateFloatType(Number(left), ra, node);
      return ra;
    }
    if (typeof left === "bigint") validateIntegerType(left, ra, node);
    else if (typeof left === "number") validateFloatType(left, ra, node);
    return ra;
  }
  if (rAdopt && !lAdopt && la) {
    // §5: adoptable integer can adopt a float type (cross-category promotion)
    if (typeof right === "bigint" && isFloatType(la)) {
      validateFloatType(Number(right), la, node);
      return la;
    }
    if (typeof right === "bigint") validateIntegerType(right, la, node);
    else if (typeof right === "number") validateFloatType(right, la, node);
    return la;
  }
  if (la && ra && la !== ra) {
    // §5: Both adoptable — integer literal adopts float type (int→float only)
    if (lAdopt && rAdopt) {
      if (isIntType(la) && isFloatType(ra)) return ra;
      if (isFloatType(la) && isIntType(ra)) return la;
    }
    throw new UzonTypeError(
      `Cannot mix ${la} and ${ra} in this operation — operands must be the same type`,
      node.line, node.col,
    );
  }
  const resolved = la ?? ra;
  if (resolved) {
    if (lAdopt && typeof left === "bigint") validateIntegerType(left, resolved, node);
    if (lAdopt && typeof left === "number") validateFloatType(left, resolved, node);
    if (rAdopt && typeof right === "bigint") validateIntegerType(right, resolved, node);
    if (rAdopt && typeof right === "number") validateFloatType(right, resolved, node);
  }
  return resolved;
}
