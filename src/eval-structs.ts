// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Struct override (with) and struct extend (extends) evaluation.
 *
 * Extracted from Evaluator class — struct operations as free functions
 * receiving an EvalContext for callbacks.
 */

import type { AstNode, BindingNode } from "./ast.js";
import { Scope } from "./scope.js";
import {
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  UZON_UNDEFINED,
  type UzonValue,
} from "./value.js";
import { UzonRuntimeError, UzonTypeError } from "./error.js";
import { actualType, isAdoptable, validateIntegerType, validateFloatType } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { typeCategory } from "./eval-helpers.js";

// ── Struct override (with) ──

export function evalStructOverride(
  ctx: EvalContext,
  node: { kind: "StructOverride"; base: AstNode; overrides: { fields: BindingNode[] }; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const base = ctx.evalNode(node.base, scope, exclude);
  if (base === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Base expression for 'with' evaluated to undefined", node.line, node.col);
  }
  // §3.7.1: with is a transparency exception — tagged unions NOT unwrapped
  if (base === null || typeof base !== "object" || Array.isArray(base)
      || base instanceof UzonEnum || base instanceof UzonUnion
      || base instanceof UzonTaggedUnion || base instanceof UzonTuple
      || base instanceof UzonFunction) {
    throw new UzonTypeError("'with' requires a struct", node.line, node.col);
  }

  const result = { ...base as Record<string, UzonValue> };
  for (const field of node.overrides.fields) {
    if (!(field.name in result)) {
      throw new UzonTypeError(
        `'${field.name}' does not exist in the base struct — 'with' cannot add new fields`,
        field.line, field.col,
      );
    }
    const val = ctx.evalNode(field.value, scope, exclude);
    const overrideNumType = ctx.numericType;
    if (val === UZON_UNDEFINED) {
      throw new UzonRuntimeError(
        `Override field '${field.name}' resolved to undefined — 'with' preserves struct shape`,
        field.line, field.col,
      );
    }
    const original = result[field.name];
    if (original !== null && val !== null) {
      const origCat = typeCategory(original);
      const newCat = typeCategory(val);
      if (origCat !== newCat) {
        throw new UzonTypeError(
          `Cannot override field '${field.name}' (${origCat}) with ${newCat} — types must be compatible`,
          field.line, field.col,
        );
      }
      // §3.2.1: Typed numeric fields must match exact type
      const baseScope = ctx.structScopes.get(base as Record<string, UzonValue>);
      const origNumType = baseScope?.getNumericType(field.name);
      if (origNumType) {
        const actualOverride = actualType(overrideNumType);
        const overrideAdoptable = isAdoptable(overrideNumType);
        if (actualOverride && !overrideAdoptable && actualOverride !== origNumType) {
          throw new UzonTypeError(
            `Cannot override field '${field.name}' (${origNumType}) with ${actualOverride} — types must match exactly`,
            field.line, field.col,
          );
        }
        if (!actualOverride || overrideAdoptable) {
          if (typeof val === "bigint") validateIntegerType(val, origNumType, field);
          if (typeof val === "number") validateFloatType(val, origNumType, field);
        }
      }
      // §3.2.1: Nested struct override must match shape
      if (origCat === "struct") {
        const origObj = original as Record<string, UzonValue>;
        const newObj = val as Record<string, UzonValue>;
        const origKeys = Object.keys(origObj).sort();
        const newKeys = Object.keys(newObj).sort();
        if (origKeys.length !== newKeys.length || origKeys.some((k, i) => k !== newKeys[i])) {
          throw new UzonTypeError(
            `Override struct for '${field.name}' has different shape — expected fields: {${origKeys.join(", ")}}`,
            field.line, field.col,
          );
        }
        const origNestedScope = ctx.structScopes.get(origObj);
        const newNestedScope = ctx.structScopes.get(newObj);
        for (const k of origKeys) {
          if (origObj[k] !== null && newObj[k] !== null) {
            const origFieldCat = typeCategory(origObj[k]);
            const newFieldCat = typeCategory(newObj[k]);
            if (origFieldCat !== newFieldCat) {
              throw new UzonTypeError(
                `Override struct field '${field.name}.${k}' has type ${newFieldCat} but expected ${origFieldCat}`,
                field.line, field.col,
              );
            }
            const origNestedNumType = origNestedScope?.getNumericType(k);
            if (origNestedNumType) {
              const newNestedNumType = newNestedScope?.getNumericType(k);
              const actualNew = newNestedNumType ? actualType(newNestedNumType) : null;
              const newAdoptable = newNestedNumType ? isAdoptable(newNestedNumType) : !newNestedNumType;
              if (actualNew && !newAdoptable && actualNew !== origNestedNumType) {
                throw new UzonTypeError(
                  `Override struct field '${field.name}.${k}' has type ${actualNew} but expected ${origNestedNumType}`,
                  field.line, field.col,
                );
              }
            }
          }
        }
      }
    }
    // §3.2.1: When struct has a named type, null fields enforce the named type's field type
    if (original === null && val !== null) {
      const baseTypeName = ctx.structTypeNames.get(base as Record<string, UzonValue>);
      if (baseTypeName) {
        const typeDef = scope.getType([baseTypeName]);
        if (typeDef?.fieldAnnotations) {
          const expectedType = typeDef.fieldAnnotations.get(field.name);
          if (expectedType) {
            const valCat = typeCategory(val);
            const expectedCat = /^[iu]\d+$/.test(expectedType) ? "integer"
              : /^f\d+$/.test(expectedType) ? "float"
              : expectedType === "bool" ? "bool"
              : expectedType === "string" ? "string"
              : null;
            if (expectedCat && valCat !== expectedCat) {
              throw new UzonTypeError(
                `Cannot override null field '${field.name}' with ${valCat} — named type '${baseTypeName}' defines it as ${expectedType}`,
                field.line, field.col,
              );
            }
          }
        }
      }
    }
    result[field.name] = val;
  }

  // Build child scope for new struct, copying numericTypes from base
  const baseScope = ctx.structScopes.get(base as Record<string, UzonValue>);
  const newScope = new Scope(scope);
  for (const [k, v] of Object.entries(result)) newScope.set(k, v);
  if (baseScope) {
    for (const k of Object.keys(result)) {
      const nt = baseScope.getNumericType(k);
      if (nt) newScope.setNumericType(k, nt);
    }
  }
  for (const field of node.overrides.fields) {
    const baseNt = baseScope?.getNumericType(field.name);
    if (baseNt && (typeof result[field.name] === "bigint" || typeof result[field.name] === "number")) {
      newScope.setNumericType(field.name, baseNt);
    }
  }
  ctx.structScopes.set(result, newScope);
  // §3.2.1: with preserves the base struct's named type
  const baseTypeName = ctx.structTypeNames.get(base as Record<string, UzonValue>);
  if (baseTypeName) ctx.structTypeNames.set(result, baseTypeName);
  return result;
}

// ── Struct plus (plus) ──

export function evalStructPlus(
  ctx: EvalContext,
  node: { kind: "StructPlus"; base: AstNode; extensions: { fields: BindingNode[] }; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const base = ctx.evalNode(node.base, scope, exclude);
  if (base === UZON_UNDEFINED) {
    throw new UzonRuntimeError("Base expression for 'plus' evaluated to undefined", node.line, node.col);
  }
  if (base === null || typeof base !== "object" || Array.isArray(base)
      || base instanceof UzonEnum || base instanceof UzonUnion
      || base instanceof UzonTaggedUnion || base instanceof UzonTuple
      || base instanceof UzonFunction) {
    throw new UzonTypeError("'plus' requires a struct", node.line, node.col);
  }

  const baseObj = base as Record<string, UzonValue>;
  const result = { ...baseObj };

  // §3.2.2: extends must add at least one new field
  let hasNewField = false;
  for (const field of node.extensions.fields) {
    if (!(field.name in baseObj)) hasNewField = true;
  }
  if (!hasNewField) {
    throw new UzonTypeError(
      "'plus' must add at least one new field — use 'with' for override-only operations",
      node.line, node.col,
    );
  }

  const baseScope = ctx.structScopes.get(baseObj);
  for (const field of node.extensions.fields) {
    const val = ctx.evalNode(field.value, scope, exclude);
    const overrideNumType = ctx.numericType;
    if (val === UZON_UNDEFINED) {
      throw new UzonRuntimeError(`Field '${field.name}' in 'plus' resolved to undefined`, field.line, field.col);
    }
    // Existing field override — same type compatibility rules as 'with'
    if (field.name in baseObj) {
      const original = baseObj[field.name];
      if (original !== null && val !== null) {
        const origCat = typeCategory(original);
        const newCat = typeCategory(val);
        if (origCat !== newCat) {
          throw new UzonTypeError(
            `Cannot override field '${field.name}' (${origCat}) with ${newCat} — types must be compatible`,
            field.line, field.col,
          );
        }
        const origNumType = baseScope?.getNumericType(field.name);
        if (origNumType) {
          const actualOverride = actualType(overrideNumType);
          const overrideAdoptable = isAdoptable(overrideNumType);
          if (actualOverride && !overrideAdoptable && actualOverride !== origNumType) {
            throw new UzonTypeError(
              `Cannot override field '${field.name}' (${origNumType}) with ${actualOverride} — types must match exactly`,
              field.line, field.col,
            );
          }
          if (!actualOverride || overrideAdoptable) {
            if (typeof val === "bigint") validateIntegerType(val, origNumType, field);
            if (typeof val === "number") validateFloatType(val, origNumType, field);
          }
        }
      }
    }
    result[field.name] = val;
  }

  const newScope = new Scope(scope);
  for (const [k, v] of Object.entries(result)) newScope.set(k, v);
  if (baseScope) {
    for (const k of Object.keys(baseObj)) {
      const nt = baseScope.getNumericType(k);
      if (nt) newScope.setNumericType(k, nt);
    }
  }
  ctx.structScopes.set(result, newScope);
  return result;
}
