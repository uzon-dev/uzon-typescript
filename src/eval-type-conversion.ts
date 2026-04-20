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
import { validateIntegerType, saturateFloat } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { typeTag, typeExprToString, valueToString } from "./eval-helpers.js";

// ── Type conversion (to) ──

export function evalConversion(
  ctx: EvalContext,
  node: { kind: "Conversion"; expr: AstNode; type: TypeExprNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  // §5.11.0: list/tuple target types are never valid `to` targets — static type error
  if (node.type.isList || node.type.isTuple) {
    throw new UzonTypeError(
      `Cannot convert to '${typeExprToString(node.type)}' — list and tuple are not valid 'to' targets`,
      node.line, node.col,
    );
  }

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
  // §5.13: env values are typed as string even when undefined
  // §5.11: string → bool / string → null are not in the conversion table
  if (node.expr.kind === "MemberAccess"
      && (node.expr as any).object?.kind === "EnvRef"
      && (typeName === "bool" || typeName === "null")) {
    throw new UzonTypeError(
      `Cannot convert string to ${typeName} — not in the permitted conversions table`,
      node.line, node.col,
    );
  }
  // §5.11: undefined propagates through `to` regardless of target type
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

// §9 grammar: underscores may appear BETWEEN digits (single underscore, digit on both sides)
// dec_int = DIGIT , { ( "_" , DIGIT ) | DIGIT }
const INT_DEC_RE = /^\d(?:_?\d)*$/;
const INT_HEX_RE = /^0[xX][\da-fA-F](?:_?[\da-fA-F])*$/;
const INT_OCT_RE = /^0[oO][0-7](?:_?[0-7])*$/;
const INT_BIN_RE = /^0[bB][01](?:_?[01])*$/;
// float_num = dec_int "." dec_int [ exp ] | dec_int exp
const FLOAT_NUM_RE = /^\d(?:_?\d)*(?:\.\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?|[eE][+-]?\d(?:_?\d)*)$/;

function isValidIntegerLiteral(s: string): boolean {
  const body = s.startsWith("-") ? s.slice(1) : s;
  return INT_DEC_RE.test(body) || INT_HEX_RE.test(body) || INT_OCT_RE.test(body) || INT_BIN_RE.test(body);
}

function isValidFloatLiteral(s: string): boolean {
  if (s === "inf" || s === "-inf" || s === "nan" || s === "-nan") return true;
  const body = s.startsWith("-") ? s.slice(1) : s;
  if (body === "inf" || body === "nan") return true;
  return FLOAT_NUM_RE.test(body);
}

function convertStringToNumeric(
  val: string, typeName: string, node: { line: number; col: number },
): UzonValue {
  if (val.length === 0 || val !== val.trim()) {
    throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
  }
  if (typeName.startsWith("f")) {
    // §5.11.1: float literal may also be parsed from a dec_int (e.g., "42" to f64)
    if (!isValidFloatLiteral(val) && !isValidIntegerLiteral(val)) {
      throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
    }
    const cleaned = val.replace(/_/g, "");
    if (cleaned === "inf") return Infinity;
    if (cleaned === "-inf") return -Infinity;
    if (cleaned === "nan" || cleaned === "-nan") return NaN;
    // Handle base-prefixed integers converted to float
    let n: number;
    if (/^-?0[xXoObB]/.test(cleaned)) {
      const neg = cleaned.startsWith("-");
      const abs = neg ? cleaned.slice(1) : cleaned;
      const asInt = BigInt(abs);
      n = Number(neg ? -asInt : asInt);
    } else {
      n = Number(cleaned);
    }
    if (isNaN(n)) throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
    if (!Number.isFinite(n)) throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
    return saturateFloat(n, typeName);
  }
  if (typeName.startsWith("i") || typeName.startsWith("u")) {
    if (!isValidIntegerLiteral(val)) {
      throw new UzonRuntimeError(`Cannot convert '${val}' to ${typeName}`, node.line, node.col);
    }
    const cleaned = val.replace(/_/g, "");
    let n: bigint;
    try {
      // JS BigInt() doesn't accept negative base-prefixed strings like "-0xff"
      const neg = cleaned.startsWith("-");
      const abs = neg ? cleaned.slice(1) : cleaned;
      n = BigInt(abs);
      if (neg) n = -n;
    }
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
    const result = saturateFloat(Number(val), typeName);
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
  const result = saturateFloat(val, typeName);
  ctx.numericType = typeName;
  return result;
}
