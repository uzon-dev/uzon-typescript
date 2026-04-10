// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Control flow expression evaluation.
 *
 * Extracted from Evaluator class — evalOrElse, evalIf, evalCase as free
 * functions receiving an EvalContext for callbacks.
 */

import type { AstNode, WhenClause } from "./ast.js";
import type { Scope } from "./scope.js";
import {
  UZON_UNDEFINED, UzonEnum, UzonUnion, UzonTaggedUnion,
  type UzonValue,
} from "./value.js";
import { UzonRuntimeError, UzonTypeError } from "./error.js";
import { isAdoptable } from "./eval-numeric.js";
import type { EvalContext } from "./eval-context.js";
import { assertSameType, valuesEqual, unwrapValue, assertBool } from "./eval-helpers.js";

// ── Or else ──

export function evalOrElse(
  ctx: EvalContext,
  node: { kind: "OrElse"; left: AstNode; right: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const left = ctx.evalNode(node.left, scope, exclude);
  const leftNumType = ctx.numericType;
  if (left === UZON_UNDEFINED) {
    const right = ctx.evalNode(node.right, scope, exclude);
    if (leftNumType && !isAdoptable(leftNumType)) {
      ctx.numericType = leftNumType;
    }
    return right;
  }
  // §5.7: both operands must be the same type regardless of runtime values
  try {
    const right = ctx.resolveEnumVariantOrEval(node.right, left, scope, exclude);
    if (right !== UZON_UNDEFINED && right !== null && left !== null) {
      assertSameType(left, right, node as AstNode);
    }
  } catch (e) {
    if (e instanceof UzonTypeError) throw e;
  }
  ctx.numericType = leftNumType;
  return left;
}

// ── If expression ──

export function evalIf(
  ctx: EvalContext,
  node: { kind: "IfExpr"; condition: AstNode; thenBranch: AstNode; elseBranch: AstNode; line: number; col: number },
  scope: Scope, exclude?: string,
): UzonValue {
  const cond = unwrapValue(ctx.evalNode(node.condition, scope, exclude));
  assertBool(cond, node.condition);
  const taken = cond === true
    ? ctx.evalNode(node.thenBranch, scope, exclude)
    : ctx.evalNode(node.elseBranch, scope, exclude);
  const takenNumType = ctx.numericType;
  // §5.9: both branches must evaluate to the same type
  try {
    const other = cond === true
      ? ctx.evalNode(node.elseBranch, scope, exclude)
      : ctx.evalNode(node.thenBranch, scope, exclude);
    if (taken !== null && other !== null
        && taken !== UZON_UNDEFINED && other !== UZON_UNDEFINED) {
      assertSameType(taken, other, node as AstNode);
    }
    // §3.4: empty list type inference from other branch
    if (Array.isArray(taken) && taken.length === 0 && Array.isArray(other) && other.length > 0) {
      const otherElemType = ctx.listElementTypes.get(other);
      if (otherElemType) ctx.listElementTypes.set(taken, otherElemType);
    }
  } catch (e) {
    if (e instanceof UzonTypeError) throw e;
  }
  ctx.numericType = takenNumType;
  return taken;
}

// ── Case expression ──

export function evalCase(
  ctx: EvalContext,
  node: {
    kind: "CaseExpr"; scrutinee: AstNode; whenClauses: WhenClause[];
    elseBranch: AstNode; line: number; col: number
  },
  scope: Scope, exclude?: string,
): UzonValue {
  const scrutinee = ctx.evalNode(node.scrutinee, scope, exclude);
  if (scrutinee === UZON_UNDEFINED) {
    throw new UzonRuntimeError(
      "Cannot use 'case' with undefined — use 'is undefined' check before 'case'",
      node.line, node.col,
    );
  }
  // §3.6 / §11.2.1: untagged unions cannot use case
  if (scrutinee instanceof UzonUnion) {
    throw new UzonTypeError(
      "Cannot use 'case' with an untagged union — use a tagged union for variant dispatch",
      node.line, node.col,
    );
  }

  let takenResult: UzonValue | undefined;
  let takenNumType: string | null = null;

  // Evaluate ALL when clauses for type checking
  for (const wc of node.whenClauses) {
    if (wc.isNamed) {
      if (!(scrutinee instanceof UzonTaggedUnion)) {
        throw new UzonTypeError("'when named' requires a tagged union", wc.line, wc.col);
      }
      const variantName = wc.value as string;
      let knownVariants: string[] | undefined;
      if (scrutinee.variants.size > 0) {
        knownVariants = [...scrutinee.variants.keys()];
      } else if (scrutinee.typeName) {
        const typeDef = scope.getType([scrutinee.typeName]);
        if (typeDef && typeDef.variants) knownVariants = typeDef.variants;
      }
      if (knownVariants && !knownVariants.includes(variantName)) {
        throw new UzonTypeError(
          `'${variantName}' is not a valid variant of this tagged union (variants: ${knownVariants.join(", ")})`,
          wc.line, wc.col,
        );
      }
      if (takenResult === undefined && scrutinee.tag === variantName) {
        takenResult = ctx.evalNode(wc.result, scope, exclude);
        takenNumType = ctx.numericType;
      }
    } else {
      const wcNode = wc.value as AstNode;
      if (wcNode.kind === "UndefinedLiteral") {
        throw new UzonRuntimeError(
          "'when undefined' is not allowed — use 'is undefined' check before 'case'",
          wc.line, wc.col,
        );
      }
      let whenVal: UzonValue;
      if (scrutinee instanceof UzonEnum && wcNode.kind === "Identifier") {
        const variantName = (wcNode as { name: string }).name;
        if (scrutinee.variants.includes(variantName)) {
          whenVal = new UzonEnum(variantName, scrutinee.variants, scrutinee.typeName);
        } else {
          whenVal = ctx.evalNode(wcNode, scope, exclude);
        }
      } else {
        whenVal = ctx.evalNode(wcNode, scope, exclude);
      }
      if (whenVal === UZON_UNDEFINED) {
        throw new UzonRuntimeError(
          "'when' clause evaluated to undefined — use 'is undefined' check before 'case'",
          wcNode.line, wcNode.col,
        );
      }
      assertSameType(scrutinee, whenVal, wcNode);
      if (takenResult === undefined && valuesEqual(scrutinee, whenVal)) {
        takenResult = ctx.evalNode(wc.result, scope, exclude);
        takenNumType = ctx.numericType;
      }
    }
  }

  const result = takenResult ?? ctx.evalNode(node.elseBranch, scope, exclude);
  const resultNumType = takenResult !== undefined ? takenNumType : ctx.numericType;

  // §5.10: All branch results must be the same type
  for (const wc of node.whenClauses) {
    try {
      const branchResult = ctx.evalNode(wc.result, scope, exclude);
      if (result !== null && branchResult !== null
          && result !== UZON_UNDEFINED && branchResult !== UZON_UNDEFINED) {
        assertSameType(result, branchResult, node as AstNode);
      }
      if (Array.isArray(result) && result.length === 0 && Array.isArray(branchResult) && branchResult.length > 0) {
        const otherElemType = ctx.listElementTypes.get(branchResult);
        if (otherElemType) ctx.listElementTypes.set(result, otherElemType);
      }
    } catch (e) {
      if (e instanceof UzonTypeError) throw e;
    }
  }
  if (takenResult !== undefined) {
    try {
      const elseResult = ctx.evalNode(node.elseBranch, scope, exclude);
      if (result !== null && elseResult !== null
          && result !== UZON_UNDEFINED && elseResult !== UZON_UNDEFINED) {
        assertSameType(result, elseResult, node as AstNode);
      }
      if (Array.isArray(result) && result.length === 0 && Array.isArray(elseResult) && elseResult.length > 0) {
        const otherElemType = ctx.listElementTypes.get(elseResult);
        if (otherElemType) ctx.listElementTypes.set(result, otherElemType);
      }
    } catch (e) {
      if (e instanceof UzonTypeError) throw e;
    }
  }

  ctx.numericType = resultNumType;
  return result;
}
