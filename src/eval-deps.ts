// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Dependency graph — collects binding dependencies and performs topological sort.
 *
 * Used by the evaluator to determine binding evaluation order (§3.1).
 */

import type { AstNode, BindingNode } from "./ast.js";
import { UzonCircularError } from "./error.js";

/** Collect the set of self-referenced binding names from an AST node. */
export function collectDeps(node: AstNode, scopeNames: Set<string>): Set<string> {
  const deps = new Set<string>();
  walkDeps(node, deps, scopeNames);
  return deps;
}

/** Recursively walk AST nodes collecting dependency names. */
function walkDeps(node: AstNode, deps: Set<string>, scopeNames: Set<string>): void {
  switch (node.kind) {
    case "MemberAccess":
      walkDeps(node.object, deps, scopeNames);
      break;
    case "BinaryOp":
      walkDeps(node.left, deps, scopeNames);
      walkDeps(node.right, deps, scopeNames);
      break;
    case "UnaryOp":
      walkDeps(node.operand, deps, scopeNames);
      break;
    case "OrElse":
      walkDeps(node.left, deps, scopeNames);
      walkDeps(node.right, deps, scopeNames);
      break;
    case "IfExpr":
      walkDeps(node.condition, deps, scopeNames);
      walkDeps(node.thenBranch, deps, scopeNames);
      walkDeps(node.elseBranch, deps, scopeNames);
      break;
    case "CaseExpr":
      walkDeps(node.scrutinee, deps, scopeNames);
      for (const wc of node.whenClauses) {
        if (typeof wc.value !== "string") walkDeps(wc.value, deps, scopeNames);
        walkDeps(wc.result, deps, scopeNames);
      }
      walkDeps(node.elseBranch, deps, scopeNames);
      break;
    case "TypeAnnotation":
      walkDeps(node.expr, deps, scopeNames);
      break;
    case "Conversion":
      walkDeps(node.expr, deps, scopeNames);
      break;
    case "StructOverride":
      walkDeps(node.base, deps, scopeNames);
      for (const f of node.overrides.fields) walkDeps(f.value, deps, scopeNames);
      break;
    case "StructExtend":
      walkDeps(node.base, deps, scopeNames);
      for (const f of node.extensions.fields) walkDeps(f.value, deps, scopeNames);
      break;
    case "FunctionExpr":
      for (const p of node.params) {
        if (p.defaultValue) walkDeps(p.defaultValue, deps, scopeNames);
      }
      for (const b of node.body) walkDeps(b.value, deps, scopeNames);
      walkDeps(node.finalExpr, deps, scopeNames);
      break;
    case "FunctionCall":
      walkDeps(node.callee, deps, scopeNames);
      for (const a of node.args) walkDeps(a, deps, scopeNames);
      break;
    case "FromEnum":
      walkDeps(node.value, deps, scopeNames);
      break;
    case "FromUnion":
      walkDeps(node.value, deps, scopeNames);
      break;
    case "NamedVariant":
      walkDeps(node.value, deps, scopeNames);
      break;
    case "FieldExtraction":
      walkDeps(node.source, deps, scopeNames);
      break;
    case "StructLiteral":
      for (const f of node.fields) walkDeps(f.value, deps, scopeNames);
      break;
    case "ListLiteral":
      for (const e of node.elements) walkDeps(e, deps, scopeNames);
      break;
    case "TupleLiteral":
      for (const e of node.elements) walkDeps(e, deps, scopeNames);
      break;
    case "Grouping":
      walkDeps(node.expr, deps, scopeNames);
      break;
    case "StringLiteral":
      for (const p of node.parts) {
        if (typeof p !== "string") walkDeps(p, deps, scopeNames);
      }
      break;
    case "Identifier":
      if (scopeNames.has(node.name)) deps.add(node.name);
      break;
    // Terminals — no deps
    case "IntegerLiteral": case "FloatLiteral": case "BoolLiteral":
    case "NullLiteral": case "UndefinedLiteral": case "InfLiteral":
    case "NanLiteral": case "EnvRef":
    case "StructImport": case "TypeExpr": case "Document": case "Binding":
      break;
  }
}

/** Topological sort of binding dependency graph. Throws on cycles. */
export function topoSort(deps: Map<string, Set<string>>, bindings: BindingNode[]): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (inStack.has(name)) {
      const b = bindings.find(b => b.name === name);
      throw new UzonCircularError(
        `Circular dependency detected involving '${name}'`,
        b?.line, b?.col,
      );
    }
    inStack.add(name);
    const d = deps.get(name);
    if (d) {
      for (const dep of d) {
        if (deps.has(dep)) visit(dep);
      }
    }
    inStack.delete(name);
    visited.add(name);
    result.push(name);
  };

  for (const b of bindings) visit(b.name);
  return result;
}
