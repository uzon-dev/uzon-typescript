// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Type annotation (as) evaluation.
 *
 * Validates that a value conforms to a declared type and applies
 * type metadata (numeric width, struct/enum/union/function type names).
 * See §6.1 for the full annotation rules.
 */

import type { AstNode, TypeExprNode } from "./ast.js";
import type { Scope, TypeDef } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  type UzonValue,
} from "./value.js";
import { UzonTypeError } from "./error.js";
import { validateIntegerType, validateFloatType, isAdoptable } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { typeTag, typeExprToString } from "./eval-helpers.js";

// ── Type annotation (as) ──

export function evalTypeAnnotation(
  ctx: EvalContext,
  node: { kind: "TypeAnnotation"; expr: AstNode; type: TypeExprNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  // §3.5/§3.7 v0.10: VariantShorthand and bare Identifier against a tagged
  // union type — delegate to context-aware evaluator which expands the shorthand.
  if (node.expr.kind === "VariantShorthand") {
    return ctx.evalInContext(node.expr, node.type, scope, exclude);
  }

  // §3.5 Rule 2: `as EnumType` — a bare identifier resolves as a variant
  // of that enum type. Explicit `as` forces variant resolution, overriding
  // Rule 4's binding-wins default.
  if (node.expr.kind === "Identifier") {
    const ctxType = scope.getType(node.type.path);
    if (ctxType && ctxType.kind === "enum") {
      const variantName = (node.expr as { name: string }).name;
      if (ctxType.variants?.includes(variantName)) {
        return new UzonEnum(variantName, ctxType.variants, ctxType.name);
      }
      const bindingPresent = scope.has(variantName) && variantName !== exclude;
      if (!bindingPresent) {
        throw new UzonTypeError(
          `'${variantName}' is not a variant of enum type '${ctxType.name}'`,
          node.line, node.col,
        );
      }
    }
    // §3.7 v0.10: bare identifier + tagged union type → nullary variant
    if (ctxType && ctxType.kind === "tagged_union") {
      return ctx.evalInContext(node.expr, node.type, scope, exclude);
    }
  }

  // List type with enum inner type — resolve bare identifiers as variants
  if (node.type.isList && node.type.inner && node.expr.kind === "ListLiteral") {
    const innerEnumType = scope.getType(node.type.inner.path);
    if (innerEnumType && innerEnumType.kind === "enum") {
      const elements: UzonValue[] = [];
      for (const elem of (node.expr as { elements: AstNode[] }).elements) {
        if (elem.kind === "Identifier") {
          const variantName = (elem as { name: string }).name;
          if (innerEnumType.variants?.includes(variantName)) {
            elements.push(new UzonEnum(variantName, innerEnumType.variants, innerEnumType.name));
            continue;
          }
        }
        elements.push(ctx.evalNode(elem, scope, exclude));
      }
      ctx.listElementTypes.set(elements, node.type.inner!.path.join("."));
      return elements;
    }
  }

  // §3.2 + §3.7 v0.10: StructLiteral/ListLiteral against a named type — use
  // context-aware evaluator which fills struct defaults and recursively
  // resolves variant shorthands in field values / list elements.
  const outerTypeDef = scope.getType(node.type.path);
  if (node.expr.kind === "StructLiteral" && outerTypeDef && outerTypeDef.kind === "struct") {
    const built = ctx.evalInContext(node.expr, node.type, scope, exclude);
    // Full conformance check still runs to validate types (incl. defaults).
    return annotateAsStruct(
      ctx, built, outerTypeDef,
      node.type.path.join("."), node,
    );
  }
  if (node.expr.kind === "ListLiteral" && node.type.isList && node.type.inner) {
    const listVal = ctx.evalInContext(node.expr, node.type, scope, exclude);
    if (Array.isArray(listVal)) {
      return annotateListType(ctx, listVal, node.type.inner, scope, node as AstNode);
    }
    return listVal;
  }

  const val = ctx.evalNode(node.expr, scope, exclude);

  // §6.1/D.2: undefined propagates through `as`, but type name must still be validated
  if (val === UZON_UNDEFINED) {
    validateTypeExists(node.type, scope, node as AstNode);
    return UZON_UNDEFINED;
  }

  // §6.1 (R6): `null as [T]` — null is not a list value; lists use `[] as [T]`.
  if (node.type.isList && val === null) {
    throw new UzonTypeError(
      `Cannot annotate null as list type — lists use '[] as [${node.type.inner ? typeExprToString(node.type.inner) : "T"}]'`,
      node.line, node.col,
    );
  }

  // §6.1 (R6): `null as (T1, T2)` — null is not a tuple value.
  if (node.type.isTuple && val === null) {
    throw new UzonTypeError(
      `Cannot annotate null as tuple type`,
      node.line, node.col,
    );
  }

  // §3.4/§6.1: List type annotation
  if (node.type.isList && node.type.inner && Array.isArray(val)) {
    return annotateListType(ctx, val, node.type.inner, scope, node as AstNode);
  }

  // §3.3: Tuple type annotation
  if (node.type.isTuple && node.type.tupleElements && val instanceof UzonTuple) {
    return annotateTupleType(val, node.type.tupleElements, scope, node as AstNode);
  }

  const typeName = node.type.path.join(".");
  const typeDef = scope.getType(node.type.path);

  // §6.3: as TaggedUnionType requires named
  if (typeDef && typeDef.kind === "tagged_union") {
    throw new UzonTypeError(
      `'as ${typeName}' requires 'named <variant>' — tagged union values must specify a variant`,
      node.line, node.col,
    );
  }

  // §6.3: as UnionType — value must match a member type
  if (typeDef && typeDef.kind === "union") {
    return annotateAsUnion(ctx, val, typeDef, typeName, node);
  }

  // §6.3: Struct conformance check
  if (typeDef && typeDef.kind === "struct") {
    return annotateAsStruct(ctx, val, typeDef, typeName, node);
  }

  // §3.5 + §6.1: Enum annotation — value must already be a variant of this enum.
  // Nominal types: cross-enum `as` is rejected even with identical variants.
  if (typeDef && typeDef.kind === "enum") {
    if (val instanceof UzonEnum) {
      if (val.typeName && val.typeName !== typeDef.name) {
        throw new UzonTypeError(
          `Cannot annotate value of enum type '${val.typeName}' as different enum type '${typeName}'`,
          node.line, node.col,
        );
      }
      if (typeDef.variants?.includes(val.value)) {
        return new UzonEnum(val.value, typeDef.variants, typeDef.name);
      }
      throw new UzonTypeError(
        `'${val.value}' is not a variant of enum type '${typeName}'`,
        node.line, node.col,
      );
    }
    throw new UzonTypeError(
      `Cannot annotate ${typeTag(val)} as enum type '${typeName}'`,
      node.line, node.col,
    );
  }

  // §3.8: Function type conformance
  if (typeDef && typeDef.kind === "function") {
    return annotateAsFunction(val, typeDef, typeName, node);
  }

  // §3.4: Named list type conformance
  if (typeDef && typeDef.kind === "list") {
    return annotateAsNamedList(ctx, val, typeDef, typeName, node);
  }

  // §6.2: If not a built-in type and not found in scope, it's an unknown type
  if (!typeDef) {
    validateTypeExists(node.type, scope, node as AstNode);
  }

  // Cross-category type validation (§6.1) — primitives and numeric widths
  return annotatePrimitive(ctx, val, typeName, node as AstNode);
}

// ── Union annotation ──

function annotateAsUnion(
  ctx: EvalContext, val: UzonValue, typeDef: { memberTypes?: string[]; name: string },
  typeName: string, node: { line: number; col: number },
): UzonUnion {
  if (!typeDef.memberTypes) {
    throw new UzonTypeError(
      `Value of type ${typeTag(val)} does not match any member of union type '${typeName}'`,
      node.line, node.col,
    );
  }
  // §6.3 (R7): exact-category match first
  if (typeDef.memberTypes.some(mt => valueMatchesMemberType(val, mt))) {
    return new UzonUnion(val, typeDef.memberTypes, typeDef.name);
  }
  // §6.3 (R7): untyped integer literal may promote to first float member
  if (typeof val === "bigint" && (!ctx.numericType || isAdoptable(ctx.numericType))) {
    const floatMember = typeDef.memberTypes.find(mt => /^f\d+$/.test(mt));
    if (floatMember) {
      const promoted = Number(val);
      validateFloatType(promoted, floatMember, node as AstNode);
      ctx.numericType = floatMember;
      return new UzonUnion(promoted, typeDef.memberTypes, typeDef.name);
    }
  }
  throw new UzonTypeError(
    `Value of type ${typeTag(val)} does not match any member of union type '${typeName}'`,
    node.line, node.col,
  );
}

// ── Struct annotation ──

function annotateAsStruct(
  ctx: EvalContext, val: UzonValue,
  typeDef: TypeDef,
  typeName: string, node: { line: number; col: number },
): UzonValue {
  if (typeof val !== "object" || val === null || Array.isArray(val)
      || val instanceof UzonTuple || val instanceof UzonEnum
      || val instanceof UzonUnion || val instanceof UzonTaggedUnion
      || val instanceof UzonFunction) {
    throw new UzonTypeError(
      `Cannot annotate ${typeTag(val)} as struct type '${typeName}'`,
      node.line, node.col,
    );
  }
  // §3.2.1/§6.1/§7.3: nominal struct types — a value already named as one
  // named struct type cannot be re-annotated as a different named type.
  // Identity is by TypeDef reference, not name (two files may declare
  // types with the same name but they are distinct per §7.3).
  const existingTypeDef = ctx.structTypeNames.get(val as Record<string, UzonValue>);
  if (existingTypeDef && existingTypeDef !== typeDef) {
    throw new UzonTypeError(
      `Cannot annotate value of named struct type '${existingTypeDef.name}' as different named struct type '${typeName}'`,
      node.line, node.col,
    );
  }
  if (typeDef.templateValue) {
    checkStructConformance(
      ctx,
      val as Record<string, UzonValue>,
      typeDef.templateValue as Record<string, UzonValue>,
      typeName, node as AstNode, typeDef.fieldAnnotations,
    );
  }
  if (!existingTypeDef) {
    ctx.structTypeNames.set(val as Record<string, UzonValue>, typeDef);
  }
  return val;
}

// ── Function annotation ──

function annotateAsFunction(
  val: UzonValue, typeDef: { name: string; paramTypes?: string[]; returnType?: string },
  typeName: string, node: { line: number; col: number },
): UzonValue {
  if (!(val instanceof UzonFunction)) {
    throw new UzonTypeError(
      `Cannot annotate ${typeTag(val)} as function type '${typeName}'`,
      node.line, node.col,
    );
  }
  if (val.typeName && val.typeName !== typeDef.name) {
    throw new UzonTypeError(
      `Function type '${val.typeName}' is not compatible with '${typeDef.name}' — nominal identity`,
      node.line, node.col,
    );
  }
  if (val.paramTypes.length !== (typeDef.paramTypes?.length ?? 0)) {
    throw new UzonTypeError(
      `Function has ${val.paramTypes.length} parameter(s) but '${typeName}' expects ${typeDef.paramTypes?.length ?? 0}`,
      node.line, node.col,
    );
  }
  for (let i = 0; i < val.paramTypes.length; i++) {
    if (val.paramTypes[i] !== typeDef.paramTypes![i]) {
      throw new UzonTypeError(
        `Parameter ${i + 1} type '${val.paramTypes[i]}' does not match '${typeDef.paramTypes![i]}' in type '${typeName}'`,
        node.line, node.col,
      );
    }
  }
  if (val.returnType !== typeDef.returnType) {
    throw new UzonTypeError(
      `Return type '${val.returnType}' does not match '${typeDef.returnType}' in type '${typeName}'`,
      node.line, node.col,
    );
  }
  if (!val.typeName) {
    return new UzonFunction(
      val.paramNames, val.paramTypes, val.defaultValues,
      val.returnType, val.body, val.finalExpr, val.closureScope, typeDef.name,
      val.paramTypeExprs, val.returnTypeExpr,
    );
  }
  return val;
}

// ── Named list annotation ──

function annotateAsNamedList(
  ctx: EvalContext, val: UzonValue,
  typeDef: { name: string; elementType?: string },
  typeName: string, node: { line: number; col: number },
): UzonValue {
  if (!Array.isArray(val)) {
    throw new UzonTypeError(
      `Cannot annotate ${typeTag(val)} as list type '${typeName}'`,
      node.line, node.col,
    );
  }
  if (typeDef.elementType) {
    const existingElemType = ctx.listElementTypes.get(val);
    if (existingElemType && existingElemType !== typeDef.elementType) {
      throw new UzonTypeError(
        `List element type '${existingElemType}' is not compatible with '${typeDef.elementType}' in type '${typeName}'`,
        node.line, node.col,
      );
    }
  }
  return val;
}

// ── Primitive annotation ──

function annotatePrimitive(
  ctx: EvalContext, val: UzonValue, typeName: string, node: AstNode,
): UzonValue {
  if (/^[iu]\d+$/.test(typeName)) {
    if (typeof val === "number") {
      throw new UzonTypeError(
        `Cannot annotate float as ${typeName} — use 'to ${typeName}' for conversion`,
        node.line, node.col,
      );
    }
    if (typeof val !== "bigint") {
      throw new UzonTypeError(`Cannot annotate ${typeTag(val)} as ${typeName}`, node.line, node.col);
    }
    validateIntegerType(val, typeName, node);
  } else if (/^f\d+$/.test(typeName)) {
    if (typeof val === "bigint") {
      throw new UzonTypeError(
        `Cannot annotate integer as ${typeName} — use 'to ${typeName}' for conversion`,
        node.line, node.col,
      );
    }
    if (typeof val !== "number") {
      throw new UzonTypeError(`Cannot annotate ${typeTag(val)} as ${typeName}`, node.line, node.col);
    }
    validateFloatType(val, typeName, node);
  } else if (typeName === "bool") {
    if (typeof val !== "boolean") {
      throw new UzonTypeError(`Cannot annotate ${typeTag(val)} as bool`, node.line, node.col);
    }
  } else if (typeName === "string") {
    if (typeof val !== "string") {
      throw new UzonTypeError(`Cannot annotate ${typeTag(val)} as string`, node.line, node.col);
    }
  }

  if (/^[iuf]\d+$/.test(typeName)) {
    ctx.numericType = typeName;
  }
  return val;
}

// ── List type annotation ──

function annotateListType(
  ctx: EvalContext,
  val: UzonValue[], innerType: TypeExprNode, scope: Scope, node: AstNode,
): UzonValue[] {
  const elemTypeName = innerType.path.join(".");

  if (/^[iu]\d+$/.test(elemTypeName)) {
    validateListElements(val, "bigint", elemTypeName, `integer (${elemTypeName})`, node);
    for (const el of val) {
      if (el !== null && typeof el === "bigint") validateIntegerType(el, elemTypeName, node);
    }
    ctx.listElementTypes.set(val, elemTypeName);
  } else if (/^f\d+$/.test(elemTypeName)) {
    validateListElements(val, "number", elemTypeName, `float (${elemTypeName})`, node);
    for (const el of val) {
      if (el !== null && typeof el === "number") validateFloatType(el, elemTypeName, node);
    }
    ctx.listElementTypes.set(val, elemTypeName);
  } else if (elemTypeName === "bool") {
    validateListElements(val, "boolean", elemTypeName, "bool", node);
    ctx.listElementTypes.set(val, elemTypeName);
  } else if (elemTypeName === "string") {
    validateListElements(val, "string", elemTypeName, "string", node);
    ctx.listElementTypes.set(val, elemTypeName);
  } else {
    annotateListUserType(val, innerType, elemTypeName, scope, node);
    ctx.listElementTypes.set(val, elemTypeName);
  }
  return val;
}

function validateListElements(
  val: UzonValue[], expectedJsType: string, _elemTypeName: string,
  label: string, node: AstNode,
): void {
  for (let i = 0; i < val.length; i++) {
    if (val[i] !== null && typeof val[i] !== expectedJsType) {
      throw new UzonTypeError(
        `List element ${i} is ${typeTag(val[i])} but expected ${label}`,
        node.line, node.col,
      );
    }
  }
}

function annotateListUserType(
  val: UzonValue[], innerType: TypeExprNode, elemTypeName: string,
  scope: Scope, node: AstNode,
): void {
  const innerTypeDef = scope.getType(innerType.path);
  if (!innerTypeDef) return;
  for (let i = 0; i < val.length; i++) {
    if (val[i] === null) continue;
    if (innerTypeDef.kind === "enum" && !(val[i] instanceof UzonEnum)) {
      throw new UzonTypeError(
        `List element ${i} is ${typeTag(val[i])} but expected enum '${elemTypeName}'`,
        node.line, node.col,
      );
    }
    if (innerTypeDef.kind === "struct") {
      if (typeof val[i] !== "object" || Array.isArray(val[i])
          || val[i] instanceof UzonEnum || val[i] instanceof UzonUnion
          || val[i] instanceof UzonTaggedUnion || val[i] instanceof UzonTuple
          || val[i] instanceof UzonFunction) {
        throw new UzonTypeError(
          `List element ${i} is ${typeTag(val[i])} but expected struct '${elemTypeName}'`,
          node.line, node.col,
        );
      }
    }
    if (innerTypeDef.kind === "function") {
      if (!(val[i] instanceof UzonFunction)) {
        throw new UzonTypeError(
          `List element ${i} is ${typeTag(val[i])} but expected function '${elemTypeName}'`,
          node.line, node.col,
        );
      }
      const fn = val[i] as UzonFunction;
      if (fn.typeName !== innerTypeDef.name) {
        throw new UzonTypeError(
          `List element ${i} has function type '${fn.typeName ?? "(anonymous)"}' but expected '${elemTypeName}'`,
          node.line, node.col,
        );
      }
    }
  }
}

// ── Tuple type annotation ──

function annotateTupleType(
  val: UzonTuple, expectedTypes: TypeExprNode[], scope: Scope, node: AstNode,
): UzonTuple {
  if (val.length !== expectedTypes.length) {
    throw new UzonTypeError(
      `Tuple has ${val.length} element(s) but type expects ${expectedTypes.length}`,
      node.line, node.col,
    );
  }
  for (let i = 0; i < expectedTypes.length; i++) {
    const elemType = typeExprToString(expectedTypes[i]);
    const elem = val.elements[i];
    if (elem === null) continue;
    annotateTupleElement(elem, elemType, expectedTypes[i], i, scope, node);
  }
  return val;
}

function annotateTupleElement(
  elem: UzonValue, elemType: string, typeExpr: TypeExprNode,
  index: number, scope: Scope, node: AstNode,
): void {
  if (/^[iu]\d+$/.test(elemType)) {
    if (typeof elem !== "bigint") {
      throw new UzonTypeError(`Tuple element ${index} is ${typeTag(elem)} but expected ${elemType}`, node.line, node.col);
    }
    validateIntegerType(elem, elemType, node);
  } else if (/^f\d+$/.test(elemType)) {
    if (typeof elem !== "number") {
      throw new UzonTypeError(`Tuple element ${index} is ${typeTag(elem)} but expected ${elemType}`, node.line, node.col);
    }
    validateFloatType(elem, elemType, node);
  } else if (elemType === "bool" && typeof elem !== "boolean") {
    throw new UzonTypeError(`Tuple element ${index} is ${typeTag(elem)} but expected bool`, node.line, node.col);
  } else if (elemType === "string" && typeof elem !== "string") {
    throw new UzonTypeError(`Tuple element ${index} is ${typeTag(elem)} but expected string`, node.line, node.col);
  } else if (!/^[iuf]\d+$/.test(elemType) && elemType !== "bool" && elemType !== "string") {
    const elemTypeDef = scope.getType(typeExpr.path);
    if (elemTypeDef) {
      if (elemTypeDef.kind === "enum" && (!(elem instanceof UzonEnum) || (elem.typeName && elem.typeName !== elemTypeDef.name))) {
        throw new UzonTypeError(`Tuple element ${index} is ${typeTag(elem)} but expected enum '${elemType}'`, node.line, node.col);
      }
      if (elemTypeDef.kind === "struct" && (typeof elem !== "object" || Array.isArray(elem)
          || elem instanceof UzonEnum || elem instanceof UzonUnion
          || elem instanceof UzonTaggedUnion || elem instanceof UzonTuple
          || elem instanceof UzonFunction)) {
        throw new UzonTypeError(`Tuple element ${index} is ${typeTag(elem)} but expected struct '${elemType}'`, node.line, node.col);
      }
    }
  }
}

// ── Struct conformance ──

function checkStructConformance(
  ctx: EvalContext,
  val: Record<string, UzonValue>, template: Record<string, UzonValue>,
  typeName: string, node: AstNode, fieldAnnotations?: Map<string, string>,
): void {
  const valKeys = new Set(Object.keys(val));
  const templateKeys = Object.keys(template);

  for (const key of templateKeys) {
    if (!valKeys.has(key)) {
      throw new UzonTypeError(`Missing field '${key}' required by type '${typeName}'`, node.line, node.col);
    }
  }
  for (const key of valKeys) {
    if (!templateKeys.includes(key)) {
      throw new UzonTypeError(`Extra field '${key}' not defined in type '${typeName}'`, node.line, node.col);
    }
  }

  for (const key of templateKeys) {
    const tVal = template[key];
    const vVal = val[key];
    if (tVal === null || vVal === null) continue;
    const tTag = typeTag(tVal);
    const vTag = typeTag(vVal);
    if (tTag !== vTag) {
      throw new UzonTypeError(
        `Field '${key}' has type ${vTag} but type '${typeName}' expects ${tTag}`,
        node.line, node.col,
      );
    }
    const annotation = fieldAnnotations?.get(key);
    if (annotation && /^[iu]\d+$/.test(annotation) && typeof vVal === "bigint") {
      validateIntegerType(vVal, annotation, node);
    }
    if (annotation && /^f\d+$/.test(annotation) && typeof vVal === "number") {
      validateFloatType(vVal, annotation, node);
    }
    if (tTag === "struct") {
      checkStructConformance(
        ctx,
        vVal as Record<string, UzonValue>,
        tVal as Record<string, UzonValue>,
        typeName, node,
      );
    }
  }
}

// ── Helpers ──

function valueMatchesMemberType(val: UzonValue, memberType: string): boolean {
  if (val === null) return memberType === "null";
  if (typeof val === "bigint") return /^[iu]\d+$/.test(memberType);
  if (typeof val === "number") return /^f\d+$/.test(memberType);
  if (typeof val === "boolean") return memberType === "bool";
  if (typeof val === "string") return memberType === "string";
  if (val instanceof UzonEnum) return val.typeName === memberType;
  if (val instanceof UzonTaggedUnion) return val.typeName === memberType;
  if (val instanceof UzonTuple) {
    if (!memberType.startsWith("(") || !memberType.endsWith(")")) return false;
    const elemTypes = splitTypeList(memberType.slice(1, -1));
    if (elemTypes.length !== val.length) return false;
    for (let i = 0; i < elemTypes.length; i++) {
      if (!valueMatchesMemberType(val.elements[i], elemTypes[i])) return false;
    }
    return true;
  }
  if (Array.isArray(val)) {
    if (!memberType.startsWith("[") || !memberType.endsWith("]")) return false;
    const elemType = memberType.slice(1, -1);
    for (const elem of val) {
      if (!valueMatchesMemberType(elem, elemType)) return false;
    }
    return true;
  }
  return false;
}

// Split a comma-separated type list, respecting nested brackets/parens.
function splitTypeList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

export function validateTypeExists(type: TypeExprNode, scope: Scope, node: AstNode): void {
  if (type.isList) {
    if (type.inner) validateTypeExists(type.inner, scope, node);
    return;
  }
  if (type.isTuple) {
    if (type.tupleElements) {
      for (const elem of type.tupleElements) validateTypeExists(elem, scope, node);
    }
    return;
  }
  if (type.isNull) return;
  const typeName = type.path.join(".");
  if (/^[iuf]\d+$/.test(typeName)) return;
  if (typeName === "bool" || typeName === "string") return;
  if (scope.getType(type.path)) return;
  throw new UzonTypeError(`Unknown type '${typeName}'`, node.line, node.col);
}
