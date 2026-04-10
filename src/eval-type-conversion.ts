// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Type conversion (to) evaluation.
 *
 * Handles explicit type conversions between UZON types:
 * numeric ↔ numeric, string → numeric, value → string, string → enum.
 * See §4.5 for the permitted conversions table.
 */

import type { AstNode, TypeExprNode } from "./ast.js";
import type { Scope } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum,
  type UzonValue,
} from "./value.js";
import { UzonRuntimeError, UzonTypeError } from "./error.js";
import { validateIntegerType, validateFloatType } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { typeTag, valueToString } from "./eval-helpers.js";

// ── Type conversion (to) ──

export function evalConversion(
  ctx: EvalContext,
  node: { kind: "Conversion"; expr: AstNode; type: TypeExprNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const val = ctx.evalNode(node.expr, scope, exclude);
  const typePath = node.type.path;
  const typeName = node.type.isNull ? "null" : typePath.join(".");

  if (val === UZON_UNDEFINED) {
    return convertUndefined(ctx, node, typeName);
  }

  // §4.5: null to null is identity
  if (typeName === "null") {
    if (val === null) return null;
    throw new UzonTypeError(
      `Cannot convert ${typeTag(val)} to null — only null to null is permitted`,
      node.line, node.col,
    );
  }

  // §4.5: null conversions
  if (val === null) {
    if (typeName === "string") return "null";
    throw new UzonTypeError(
      `Cannot convert null to '${typeName}' — only null to string or null is permitted`,
      node.line, node.col,
    );
  }

  // to string (checked before type-specific branches)
  if (typeName === "string") return valueToString(val, node as AstNode);

  // §5.11.0: bool → bool identity
  if (typeof val === "boolean") {
    return convertBool(val, typeName, node);
  }

  // String to numeric / enum
  if (typeof val === "string") {
    return convertString(ctx, val, typePath, typeName, scope, node);
  }

  // Numeric conversions
  if (typeof val === "bigint") {
    return convertInteger(ctx, val, typeName, node);
  }
  if (typeof val === "number") {
    return convertFloat(ctx, val, typeName, node);
  }

  throw new UzonTypeError(`Cannot convert ${typeTag(val)} to '${typeName}' — conversion not permitted`, node.line, node.col);
}

// ── Undefined ──

function convertUndefined(
  ctx: EvalContext,
  node: { expr: AstNode; line: number; col: number },
  typeName: string,
): UzonValue {
  // §5.11: env.X to bool is always invalid even when undefined
  if (node.expr.kind === "MemberAccess"
      && (node.expr as any).object?.kind === "EnvRef"
      && typeName === "bool") {
    throw new UzonTypeError(
      `Cannot convert string to bool — not in the permitted conversions table`,
      node.line, node.col,
    );
  }
  if (/^[iuf]\d+$/.test(typeName)) ctx.numericType = typeName;
  return UZON_UNDEFINED;
}

// ── Bool ──

function convertBool(
  val: boolean, typeName: string, node: { line: number; col: number },
): boolean {
  if (typeName === "bool") return val;
  throw new UzonTypeError(
    `Cannot convert bool to '${typeName}' — only bool to string or bool is permitted`,
    node.line, node.col,
  );
}

// ── String ──

function convertString(
  ctx: EvalContext, val: string, typePath: string[], typeName: string,
  scope: Scope, node: { line: number; col: number },
): UzonValue {
  const enumType = scope.getType(typePath);
  if (enumType && enumType.kind === "enum") {
    if (enumType.variants?.includes(val)) {
      return new UzonEnum(val, enumType.variants, enumType.name);
    }
    throw new UzonRuntimeError(`'${val}' is not a variant of '${enumType.name}'`, node.line, node.col);
  }
  if (typeName === "bool") {
    throw new UzonTypeError(
      `Cannot convert string to bool — not in the permitted conversions table`,
      node.line, node.col,
    );
  }
  const converted = convertStringToNumeric(val, typeName, node);
  if (/^[iuf]\d+$/.test(typeName)) ctx.numericType = typeName;
  return converted;
}

function convertStringToNumeric(
  val: string, typeName: string, node: { line: number; col: number },
): UzonValue {
  if (val.length === 0 || val !== val.trim()) {
    throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
  }
  const cleaned = val.replace(/_/g, "");
  if (typeName.startsWith("f")) {
    if (cleaned === "inf") return Infinity;
    if (cleaned === "-inf") return -Infinity;
    if (cleaned === "nan" || cleaned === "-nan") return NaN;
    const n = Number(cleaned);
    if (isNaN(n)) throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
    if (!Number.isFinite(n)) throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
    return n;
  }
  if (typeName.startsWith("i") || typeName.startsWith("u")) {
    let n: bigint;
    try { n = BigInt(cleaned); }
    catch { throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col); }
    validateIntegerType(n, typeName, node as AstNode);
    return n;
  }
  if (typeName === "string") return val;
  throw new UzonTypeError(`Cannot convert string to '${typeName}' — conversion not permitted`, node.line, node.col);
}

// ── Integer ──

function convertInteger(
  ctx: EvalContext, val: bigint, typeName: string, node: { line: number; col: number },
): UzonValue {
  if (!/^[iuf]\d+$/.test(typeName)) {
    throw new UzonTypeError(`Cannot convert integer to '${typeName}' — only numeric and string targets are permitted`, node.line, node.col);
  }
  if (typeName.startsWith("f")) {
    const result = Number(val);
    validateFloatType(result, typeName, node as AstNode);
    ctx.numericType = typeName;
    return result;
  }
  validateIntegerType(val, typeName, node as AstNode);
  ctx.numericType = typeName;
  return val;
}

// ── Float ──

function convertFloat(
  ctx: EvalContext, val: number, typeName: string, node: { line: number; col: number },
): UzonValue {
  if (!/^[iuf]\d+$/.test(typeName)) {
    throw new UzonTypeError(`Cannot convert float to '${typeName}' — only numeric and string targets are permitted`, node.line, node.col);
  }
  if (typeName.startsWith("i") || typeName.startsWith("u")) {
    if (!Number.isFinite(val)) {
      throw new UzonRuntimeError(
        `Cannot convert ${Number.isNaN(val) ? "nan" : val > 0 ? "inf" : "-inf"} to ${typeName}`,
        node.line, node.col,
      );
    }
    const truncated = BigInt(Math.trunc(val));
    validateIntegerType(truncated, typeName, node as AstNode);
    ctx.numericType = typeName;
    return truncated;
  }
  validateFloatType(val, typeName, node as AstNode);
  ctx.numericType = typeName;
  return val;
}
