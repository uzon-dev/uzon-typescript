// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Scope — hierarchical binding + type environment for UZON evaluation.
 *
 * Scopes form a tree: each struct literal creates a child scope,
 * and function bodies get a scope chained to the closure scope.
 * Type definitions (§6.2 `called`) are stored in the scope and
 * resolved via dotted paths (e.g., Config.Port → Config's child scope → Port).
 *
 * See SPECIFICATION.md §3 (Types) and §5 (Expressions).
 */

import type { UzonValue } from "./value.js";
import { UZON_UNDEFINED } from "./value.js";
import type { TypeExprNode } from "./ast.js";

// ── TypeDef ──────────────────────────────────────────────────────

export interface TypeDef {
  kind: "enum" | "union" | "tagged_union" | "struct" | "list" | "primitive" | "function";
  name: string;
  /** §3.5: Enum variant names */
  variants?: string[];
  /** §3.7: Tagged union variant → payload type mapping */
  variantTypes?: Map<string, string>;
  /** §3.6: Union member type names */
  memberTypes?: string[];
  /** §3.2: Struct field → type tag mapping */
  fields?: Map<string, string>;
  /** §6.3: Per-field type annotations from AST (for range checking) */
  fieldAnnotations?: Map<string, string>;
  /** §3.2 v0.10: Per-field declared type expressions (for context inference) */
  fieldTypeExprs?: Map<string, TypeExprNode>;
  /** §3.2: Struct template value (for conformance checking) */
  templateValue?: Record<string, any>;
  /** §3.4: List element type name */
  elementType?: string;
  /** §3.8: Function parameter types */
  paramTypes?: string[];
  /** §3.8: Function return type */
  returnType?: string;
}

// ── Scope ────────────────────────────────────────────────────────

export class Scope {
  private bindings = new Map<string, UzonValue>();
  private types = new Map<string, TypeDef>();
  private numericTypes = new Map<string, string>();
  private childScopes = new Map<string, Scope>();
  readonly parent: Scope | null;

  constructor(parent: Scope | null = null) {
    this.parent = parent;
  }

  // ── Binding access ──

  set(name: string, value: UzonValue): void {
    this.bindings.set(name, value);
  }

  /**
   * Look up a binding, walking the parent chain.
   * If `exclude` is provided, skip that name in this scope's own bindings
   * (used for self-exclusion during dependency resolution — §3.1).
   */
  get(name: string, exclude?: string): UzonValue | typeof UZON_UNDEFINED {
    if (name !== exclude && this.bindings.has(name)) {
      return this.bindings.get(name)!;
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return UZON_UNDEFINED;
  }

  has(name: string): boolean {
    return this.bindings.has(name) || (this.parent?.has(name) ?? false);
  }

  hasOwn(name: string): boolean {
    return this.bindings.has(name);
  }

  ownBindingNames(): string[] {
    return [...this.bindings.keys()];
  }

  // ── Type definitions ──

  setType(name: string, def: TypeDef): void {
    this.types.set(name, def);
  }

  hasOwnType(name: string): boolean {
    return this.types.has(name);
  }

  /**
   * Resolve a type by dotted path.
   * Single-segment paths check this scope then walk parents.
   * Multi-segment paths (e.g. ["Config", "Port"]) look up the first
   * segment as a child scope and recurse.
   */
  getType(path: string[]): TypeDef | undefined {
    if (path.length === 1) {
      const found = this.types.get(path[0]);
      if (found) return found;
      return this.parent?.getType(path);
    }
    const scopeEntry = this.childScopes.get(path[0]);
    if (scopeEntry) {
      return scopeEntry.getType(path.slice(1));
    }
    return this.parent?.getType(path);
  }

  /** Iterate over types defined directly in this scope. */
  ownTypes(): IterableIterator<[string, TypeDef]> {
    return this.types.entries();
  }

  // ── Child scopes (for struct bindings → type path resolution) ──

  setChildScope(name: string, scope: Scope): void {
    this.childScopes.set(name, scope);
  }

  getChildScope(name: string): Scope | undefined {
    return this.childScopes.get(name);
  }

  // ── Numeric type tracking (§5 adoptable defaults) ──

  setNumericType(name: string, numType: string): void {
    this.numericTypes.set(name, numType);
  }

  getNumericType(name: string): string | null {
    return this.numericTypes.get(name) ?? this.parent?.getNumericType(name) ?? null;
  }
}
