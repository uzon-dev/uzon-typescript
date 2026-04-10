// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Shared parser context interface.
 *
 * Extracted parser modules (strings, functions, compounds, control)
 * receive a ParseContext to call back into the parser without
 * creating circular dependencies.
 */

import type { Token, TokenType } from "./token.js";
import type { AstNode, BindingNode, TypeExprNode } from "./ast.js";

export interface ParseContext {
  // ── Token manipulation ──
  peek(skip?: number): Token;
  peekRaw(): Token;
  advance(): Token;
  skipNewlines(): void;
  expect(type: TokenType, what?: string): Token;
  error(msg: string, tok?: Token): never;

  // ── Mutable state ──
  suppressMultilineString: boolean;
  readonly tokens: Token[];
  pos: number;

  // ── Cross-module parse callbacks ──
  parseExpression(): AstNode;
  parseBindings(until: TokenType): BindingNode[];
  parseTypeExpr(): TypeExprNode;
  parseVariantName(): string;
  isCommaFollowedByBinding(): boolean;
  tryParseCalled(): string | null;
}
