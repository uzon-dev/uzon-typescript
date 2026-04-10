// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * String literal parsing with interpolation and multiline support.
 *
 * Extracted from Parser class — handles §4.4 string syntax as
 * free functions receiving a ParseContext.
 */

import { TokenType } from "./token.js";
import type { AstNode, StringPart } from "./ast.js";
import type { ParseContext } from "./parse-context.js";

/** Token types that can start an expression inside interpolation. */
export const INTERP_EXPR_START = new Set([
  TokenType.Identifier, TokenType.Integer, TokenType.Float,
  TokenType.True, TokenType.False, TokenType.Null, TokenType.Undefined,
  TokenType.Inf, TokenType.Nan,
  TokenType.Self, TokenType.Env,
  TokenType.LParen, TokenType.LBrace, TokenType.LBracket,
  TokenType.If, TokenType.Case, TokenType.Struct, TokenType.Function,
  TokenType.Not, TokenType.Minus,
]);

/** Parse a single string segment (possibly with interpolation). */
function parseStringSingleOrInterpolated(ctx: ParseContext): StringPart[] {
  const parts: StringPart[] = [];
  const strTok = ctx.advance(); // String token
  if (strTok.value) parts.push(strTok.value);

  while (ctx.pos < ctx.tokens.length) {
    const raw = ctx.peekRaw();
    if (raw.type === TokenType.String) {
      const st = ctx.advance();
      if (st.value) parts.push(st.value);
      continue;
    }
    if (raw.type === TokenType.Eof || !INTERP_EXPR_START.has(raw.type)) {
      break;
    }
    // Interpolation expression
    const expr = ctx.parseExpression();
    parts.push(expr);
  }
  return parts;
}

/**
 * §4.4.2: Check whether the next line continues a multiline string.
 * Requires exactly one newline between strings — blank lines or comments break the sequence.
 */
function checkMultilineStringContinuation(ctx: ParseContext): boolean {
  if (ctx.suppressMultilineString) return false;
  let i = ctx.pos;
  if (i >= ctx.tokens.length) return false;
  if (ctx.tokens[i].type !== TokenType.Newline) return false;
  const nlTok = ctx.tokens[i];
  i++;
  // §4.4.2: comment between multiline string parts is an error
  if (nlTok.afterComment) {
    let j = i;
    while (j < ctx.tokens.length && ctx.tokens[j].type === TokenType.Newline) j++;
    if (j < ctx.tokens.length && ctx.tokens[j].type === TokenType.String) {
      ctx.error("Comment between multiline string parts is not allowed", ctx.tokens[j]);
    }
    return false;
  }
  if (i < ctx.tokens.length && ctx.tokens[i].type === TokenType.String) return true;
  return false;
}

/** Parse a full string literal, including multiline continuation (§4.4.2). */
export function parseStringLiteral(ctx: ParseContext): AstNode {
  const firstTok = ctx.tokens[ctx.pos];
  const parts = parseStringSingleOrInterpolated(ctx);

  // §4.4.2: multiline strings — adjacent string on the next physical line
  while (checkMultilineStringContinuation(ctx)) {
    parts.push("\n");
    ctx.skipNewlines();
    parts.push(...parseStringSingleOrInterpolated(ctx));
  }

  return { kind: "StringLiteral", parts, line: firstTok.line, col: firstTok.col };
}
