// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Compound literal and control flow expression parsing.
 *
 * Extracted from Parser class — handles struct/list/tuple literals,
 * if/case expressions, and struct imports.
 */

import { TokenType } from "./token.js";
import type {
  AstNode, StructLiteralNode, ListLiteralNode,
  TupleLiteralNode, GroupingNode, IfExprNode, CaseExprNode, WhenClause,
} from "./ast.js";
import type { ParseContext } from "./parse-context.js";
import { INTERP_EXPR_START } from "./parse-strings.js";

// ── Compound literals (§3.2, §3.3, §3.4) ──

export function parseStructLiteral(ctx: ParseContext): StructLiteralNode {
  const lbrace = ctx.expect(TokenType.LBrace, "'{'");
  const fields = ctx.parseBindings(TokenType.RBrace);
  ctx.expect(TokenType.RBrace, "'}'");
  return { kind: "StructLiteral", fields, line: lbrace.line, col: lbrace.col };
}

export function parseListLiteral(ctx: ParseContext): ListLiteralNode {
  const lbrack = ctx.expect(TokenType.LBracket, "'['");
  const elements: AstNode[] = [];

  ctx.skipNewlines();
  if (ctx.peek().type !== TokenType.RBracket) {
    elements.push(ctx.parseExpression());
    while (ctx.peek().type === TokenType.Comma) {
      ctx.advance();
      ctx.skipNewlines();
      if (ctx.peek().type === TokenType.RBracket) break;
      elements.push(ctx.parseExpression());
    }
  }
  ctx.skipNewlines();
  ctx.expect(TokenType.RBracket, "']'");
  return { kind: "ListLiteral", elements, line: lbrack.line, col: lbrack.col };
}

export function parseTupleOrGrouping(ctx: ParseContext): AstNode {
  const lparen = ctx.expect(TokenType.LParen, "'('");
  ctx.skipNewlines();

  // Empty tuple: ()
  if (ctx.peek().type === TokenType.RParen) {
    ctx.advance();
    return { kind: "TupleLiteral", elements: [], line: lparen.line, col: lparen.col } as TupleLiteralNode;
  }

  const first = ctx.parseExpression();
  ctx.skipNewlines();

  // Grouping: (expr)
  if (ctx.peek().type === TokenType.RParen) {
    ctx.advance();
    return { kind: "Grouping", expr: first, line: lparen.line, col: lparen.col } as GroupingNode;
  }

  // Tuple: (expr, expr, ...) — comma presence means tuple
  if (ctx.peek().type === TokenType.Comma) {
    const elements: AstNode[] = [first];
    while (ctx.peek().type === TokenType.Comma) {
      ctx.advance();
      ctx.skipNewlines();
      if (ctx.peek().type === TokenType.RParen) break;
      elements.push(ctx.parseExpression());
      ctx.skipNewlines();
    }
    ctx.expect(TokenType.RParen, "')'");
    return { kind: "TupleLiteral", elements, line: lparen.line, col: lparen.col } as TupleLiteralNode;
  }

  ctx.error("Expected ',' or ')' in tuple/grouping", ctx.peek());
}

// ── Control flow (§5.9, §5.10) ──

/** §5.9: if condition then expr else expr */
export function parseIfExpr(ctx: ParseContext): IfExprNode {
  const ifTok = ctx.expect(TokenType.If, "'if'");
  const condition = ctx.parseExpression();
  ctx.expect(TokenType.Then, "'then'");
  const thenBranch = ctx.parseExpression();
  ctx.expect(TokenType.Else, "'else'");
  const elseBranch = ctx.parseExpression();
  return { kind: "IfExpr", condition, thenBranch, elseBranch, line: ifTok.line, col: ifTok.col };
}

/** §5.10: case [type|named] expr when value then expr ... else expr */
export function parseCaseExpr(ctx: ParseContext): CaseExprNode {
  const caseTok = ctx.expect(TokenType.Case, "'case'");

  // Determine case mode: value, type, or named
  let mode: "value" | "type" | "named" = "value";
  if (ctx.peek().type === TokenType.Type) {
    ctx.advance();
    mode = "type";
  } else if (ctx.peek().type === TokenType.Named) {
    ctx.advance();
    mode = "named";
  }

  const scrutinee = ctx.parseExpression();

  const whenClauses: WhenClause[] = [];
  ctx.skipNewlines();
  while (ctx.peek().type === TokenType.When) {
    const whenTok = ctx.advance();
    ctx.skipNewlines();

    let value: AstNode | string;

    if (mode === "named") {
      value = ctx.parseVariantName();
    } else if (mode === "type") {
      value = ctx.parseTypeExprAsString();
    } else {
      value = ctx.parseExpression();
    }

    ctx.expect(TokenType.Then, "'then'");
    const result = ctx.parseExpression();
    whenClauses.push({ value, result, line: whenTok.line, col: whenTok.col });
    ctx.skipNewlines();
  }

  // §5.10: case must have at least one when clause
  if (whenClauses.length === 0) {
    ctx.error("'case' requires at least one 'when' clause", caseTok);
  }

  ctx.expect(TokenType.Else, "'else'");
  const elseBranch = ctx.parseExpression();

  return { kind: "CaseExpr", mode, scrutinee, whenClauses, elseBranch, line: caseTok.line, col: caseTok.col };
}

// ── Struct import (§7) ──

export function parseStructImport(ctx: ParseContext): AstNode {
  const structTok = ctx.expect(TokenType.Struct, "'struct'");
  ctx.skipNewlines();
  const pathTok = ctx.expect(TokenType.String, "file path string");
  // §7.1: import paths must be non-interpolated strings
  const nextRaw = ctx.peekRaw();
  if (INTERP_EXPR_START.has(nextRaw.type) || nextRaw.type === TokenType.String) {
    ctx.error("Interpolation is not allowed in import paths — use a plain string", nextRaw);
  }
  return { kind: "StructImport", path: pathTok.value, line: structTok.line, col: structTok.col };
}
