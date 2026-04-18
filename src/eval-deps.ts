// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Dependency graph — collects binding dependencies and performs topological sort.
 *
 * Used by the evaluator to determine binding evaluation order (§3.1).
 */

import type { AstNode, BindingNode } from "./ast.js";

/** Result of topological sort: non-cycle bindings in order, plus cycle participant names. */
export interface TopoResult {
  order: string[];
  cycleNames: string[];
}

/** Collect the set of referenced binding names from an AST node. */
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
    case "StructPlus":
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
    case "StandaloneUnion":
    case "StandaloneTaggedUnion":
      // Type references only — no binding deps.
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

/** A function call edge: caller → callee with the call site location. */
interface CallEdge {
  callee: string;
  line: number;
  col: number;
}

/** Info about a function participating in a call cycle, with the call site that closes the cycle. */
export interface FnCycleEntry {
  name: string;
  line: number;
  col: number;
}

/** Walk a function body to find direct calls to known function bindings. */
function collectFunctionCalls(node: AstNode, funcNames: Set<string>): CallEdge[] {
  const edges: CallEdge[] = [];
  walkCalls(node, funcNames, edges);
  return edges;
}

function walkCalls(node: AstNode, funcNames: Set<string>, edges: CallEdge[]): void {
  if (node.kind === "FunctionCall" && node.callee.kind === "Identifier") {
    if (funcNames.has(node.callee.name)) {
      edges.push({ callee: node.callee.name, line: node.callee.line, col: node.callee.col });
    }
  }
  // Recurse into children (same traversal as walkDeps minus the dep collection)
  switch (node.kind) {
    case "FunctionCall":
      walkCalls(node.callee, funcNames, edges);
      for (const a of node.args) walkCalls(a, funcNames, edges);
      break;
    case "FunctionExpr":
      for (const p of node.params) {
        if (p.defaultValue) walkCalls(p.defaultValue, funcNames, edges);
      }
      for (const b of node.body) walkCalls(b.value, funcNames, edges);
      walkCalls(node.finalExpr, funcNames, edges);
      break;
    case "BinaryOp":
      walkCalls(node.left, funcNames, edges);
      walkCalls(node.right, funcNames, edges);
      break;
    case "UnaryOp":
      walkCalls(node.operand, funcNames, edges);
      break;
    case "IfExpr":
      walkCalls(node.condition, funcNames, edges);
      walkCalls(node.thenBranch, funcNames, edges);
      walkCalls(node.elseBranch, funcNames, edges);
      break;
    case "CaseExpr":
      walkCalls(node.scrutinee, funcNames, edges);
      for (const wc of node.whenClauses) {
        if (typeof wc.value !== "string") walkCalls(wc.value, funcNames, edges);
        walkCalls(wc.result, funcNames, edges);
      }
      walkCalls(node.elseBranch, funcNames, edges);
      break;
    case "OrElse":
      walkCalls(node.left, funcNames, edges);
      walkCalls(node.right, funcNames, edges);
      break;
    case "MemberAccess":
      walkCalls(node.object, funcNames, edges);
      break;
    case "TypeAnnotation":
      walkCalls(node.expr, funcNames, edges);
      break;
    case "Conversion":
      walkCalls(node.expr, funcNames, edges);
      break;
    case "Grouping":
      walkCalls(node.expr, funcNames, edges);
      break;
    case "StructOverride":
      walkCalls(node.base, funcNames, edges);
      for (const f of node.overrides.fields) walkCalls(f.value, funcNames, edges);
      break;
    case "StructPlus":
      walkCalls(node.base, funcNames, edges);
      for (const f of node.extensions.fields) walkCalls(f.value, funcNames, edges);
      break;
    case "FromEnum": walkCalls(node.value, funcNames, edges); break;
    case "FromUnion": walkCalls(node.value, funcNames, edges); break;
    case "NamedVariant": walkCalls(node.value, funcNames, edges); break;
    case "StandaloneUnion": case "StandaloneTaggedUnion": break;
    case "FieldExtraction": walkCalls(node.source, funcNames, edges); break;
    case "StructLiteral":
      for (const f of node.fields) walkCalls(f.value, funcNames, edges);
      break;
    case "ListLiteral":
      for (const e of node.elements) walkCalls(e, funcNames, edges);
      break;
    case "TupleLiteral":
      for (const e of node.elements) walkCalls(e, funcNames, edges);
      break;
    case "StringLiteral":
      for (const p of node.parts) {
        if (typeof p !== "string") walkCalls(p, funcNames, edges);
      }
      break;
  }
}

/**
 * Check that the function call graph is a DAG (§3.8).
 * Returns cycle participants with the call site location that creates the cycle.
 */
export function checkFunctionCallDag(bindings: BindingNode[]): FnCycleEntry[] {
  // Identify function bindings
  const funcNames = new Set<string>();
  for (const b of bindings) {
    if (b.value.kind === "FunctionExpr") funcNames.add(b.name);
  }
  if (funcNames.size === 0) return [];

  // Build call graph with location info
  const graph = new Map<string, CallEdge[]>();
  for (const b of bindings) {
    if (!funcNames.has(b.name)) continue;
    graph.set(b.name, collectFunctionCalls(b.value, funcNames));
  }

  // DFS cycle detection (3-color: 0=white, 1=gray, 2=black)
  const color = new Map<string, number>();
  const results: FnCycleEntry[] = [];
  const reported = new Set<string>();

  function dfs(name: string): boolean {
    color.set(name, 1); // gray
    for (const edge of graph.get(name) ?? []) {
      const c = color.get(edge.callee) ?? 0;
      if (c === 1) {
        // Back-edge → cycle. Collect all gray nodes as participants.
        for (const [n, nc] of color) {
          if (nc === 1 && !reported.has(n)) {
            // Find the call edge FROM this node to another gray node (call site)
            const callEdge = (graph.get(n) ?? []).find(
              e => (color.get(e.callee) ?? 0) === 1,
            );
            if (callEdge) {
              results.push({ name: n, line: callEdge.line, col: callEdge.col });
            }
            reported.add(n);
          }
        }
        return true;
      }
      if (c === 0 && dfs(edge.callee)) return true;
    }
    color.set(name, 2); // black
    return false;
  }

  for (const name of funcNames) {
    if ((color.get(name) ?? 0) === 0) dfs(name);
  }
  return results;
}

/**
 * Topological sort via Kahn's algorithm.
 * Returns the partial evaluation order (non-cycle bindings) and names of cycle participants.
 */
export function topoSort(deps: Map<string, Set<string>>, bindings: BindingNode[]): TopoResult {
  const allNames = new Set(bindings.map(b => b.name));

  // in-degree = number of dependencies within the binding set
  const inDegree = new Map<string, number>();
  // reverse adjacency: name → who depends on name
  const rdeps = new Map<string, string[]>();

  for (const name of allNames) {
    rdeps.set(name, []);
  }
  for (const [name, depSet] of deps) {
    let count = 0;
    for (const dep of depSet) {
      if (allNames.has(dep)) {
        count++;
        rdeps.get(dep)!.push(name);
      }
    }
    inDegree.set(name, count);
  }

  // Kahn's: start with nodes that have no dependencies
  const queue: string[] = [];
  for (const name of allNames) {
    if ((inDegree.get(name) ?? 0) === 0) queue.push(name);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    order.push(name);
    for (const dependent of rdeps.get(name)!) {
      const deg = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, deg);
      if (deg === 0) queue.push(dependent);
    }
  }

  // Bindings not in order are cycle participants (in_degree > 0)
  const orderSet = new Set(order);
  const cycleNames = bindings
    .filter(b => !orderSet.has(b.name))
    .map(b => b.name);

  return { order, cycleNames };
}
