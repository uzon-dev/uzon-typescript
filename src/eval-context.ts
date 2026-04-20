// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Shared evaluator context interface.
 *
 * All extracted evaluator modules (operators, types, functions,
 * control, structs) receive an EvalContext to call back into
 * the evaluator without creating circular dependencies.
 */

import type { AstNode, BindingNode, TypeExprNode } from "./ast.js";
import type { Scope, TypeDef } from "./scope.js";
import type { UzonValue, UzonFunction } from "./value.js";

export interface EvalContext {
  // Core evaluation
  evalNode(node: AstNode, scope: Scope, exclude?: string): UzonValue;
  evaluateBindings(bindings: BindingNode[], scope: Scope, allowOverloads?: boolean, locals?: Map<string, UzonValue>): void;

  // Contextual resolution (needs evaluator state)
  resolveEnumVariantOrEval(node: AstNode, contextVal: UzonValue, scope: Scope, exclude?: string): UzonValue;
  evalInContext(node: AstNode, typeExpr: TypeExprNode, scope: Scope, exclude?: string): UzonValue;

  // Cross-module operations
  evalIn(left: UzonValue, right: UzonValue, node: AstNode, leftNumType?: string | null, rightNumType?: string | null): boolean;
  callFunctionDirect(fn: UzonFunction, args: UzonValue[], scope: Scope, node: AstNode): UzonValue;

  // Mutable state
  numericType: string | null;
  listElementTypes: WeakMap<UzonValue[], string>;
  listTypeNames: WeakMap<UzonValue[], string>;
  structTypeNames: WeakMap<Record<string, UzonValue>, TypeDef>;
  structScopes: WeakMap<Record<string, UzonValue>, Scope>;
  functionLocals: Map<string, UzonValue> | null;
  callStack: Set<UzonFunction>;
}
