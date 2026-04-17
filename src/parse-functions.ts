// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
/**
 * Function expression parsing.
 *
 * Extracted from Parser class — handles §3.8 function syntax
 * (parameters, return type, body with local bindings).
 */

import { TokenType, KEYWORDS } from "./token.js";
import type { AstNode, BindingNode, FunctionParam } from "./ast.js";
import type { ParseContext } from "./parse-context.js";

/** §3.8: Parse a function expression — `function params returns Type { body }` */
export function parseFunctionExpr(ctx: ParseContext): AstNode {
  const funcTok = ctx.expect(TokenType.Function, "'function'");

  // Parameters — may be empty (zero-arity functions allowed)
  const params: FunctionParam[] = [];
  let seenDefault = false;

  ctx.skipNewlines();
  if (ctx.peek().type !== TokenType.Returns) {
    const firstParam = parseFunctionParam(ctx);
    if (firstParam.defaultValue !== null) seenDefault = true;
    params.push(firstParam);

    while (ctx.peek().type === TokenType.Comma) {
      ctx.advance();
      ctx.skipNewlines();
      if (ctx.peek().type === TokenType.Returns) break;
      const param = parseFunctionParam(ctx);
      if (param.defaultValue !== null) {
        seenDefault = true;
      } else if (seenDefault) {
        ctx.error("Required parameter after a defaulted parameter is not allowed", ctx.peek());
      }
      params.push(param);
    }
  }

  // §3.8: Reject duplicate parameter names
  for (let i = 1; i < params.length; i++) {
    for (let j = 0; j < i; j++) {
      if (params[i].name === params[j].name) {
        ctx.error(`Duplicate parameter name '${params[i].name}'`, { line: params[i].line, col: params[i].col } as any);
      }
    }
  }

  ctx.expect(TokenType.Returns, "'returns'");
  const returnType = ctx.parseTypeExpr();

  // Body: { [bindings...] finalExpr }
  ctx.expect(TokenType.LBrace, "'{'");
  const { bindings: bodyBindings, finalExpr } = parseFunctionBody(ctx);
  ctx.expect(TokenType.RBrace, "'}'");

  return {
    kind: "FunctionExpr", params, returnType,
    body: bodyBindings, finalExpr,
    line: funcTok.line, col: funcTok.col,
  };
}

function parseFunctionParam(ctx: ParseContext): FunctionParam {
  ctx.skipNewlines();
  const nameTok = ctx.advance();
  if (nameTok.type !== TokenType.Identifier) {
    if (nameTok.value in KEYWORDS) {
      ctx.error(`"${nameTok.value}" is a keyword; to use it as a parameter name, write @${nameTok.value}`, nameTok);
    }
    ctx.error("Expected parameter name", nameTok);
  }
  ctx.expect(TokenType.As, "'as' after parameter name");
  const type = ctx.parseTypeExpr();

  let defaultValue: AstNode | null = null;
  if (ctx.peek().type === TokenType.Default) {
    ctx.advance();
    defaultValue = ctx.parseExpression();
  }

  return { name: nameTok.value, type, defaultValue, line: nameTok.line, col: nameTok.col };
}

function parseFunctionBody(ctx: ParseContext): { bindings: BindingNode[]; finalExpr: AstNode } {
  const bindings: BindingNode[] = [];
  ctx.skipNewlines();

  // 2-token lookahead: `identifier is` means binding; otherwise it's the final expression.
  // Only plain Is trigger bindings — composite operators (IsNamed, IsType, etc.)
  // are expression operators, not binding starts.
  while (ctx.peek().type !== TokenType.RBrace) {
    if (ctx.peek().type === TokenType.Identifier && ctx.peek(1).type === TokenType.Are) {
      ctx.error(
        "'are' bindings are not permitted inside function bodies — use 'is' with a list literal instead",
        ctx.peek(),
      );
    }
    if (ctx.peek().type === TokenType.Identifier && ctx.peek(1).type === TokenType.Is) {
      bindings.push(parseFuncBinding(ctx));
      ctx.skipNewlines();
      // §3.8: 'called' is not permitted inside function bodies
      if (ctx.peek().type === TokenType.Called) {
        ctx.error(
          "'called' is not permitted inside function bodies — use 'as' with a type annotation instead",
          ctx.peek(),
        );
      }
      if (ctx.peek().type === TokenType.Comma) {
        ctx.advance();
        ctx.skipNewlines();
      }
      ctx.skipNewlines();
    } else {
      break;
    }
  }

  if (ctx.peek().type === TokenType.RBrace) {
    ctx.error("Function body must have a final expression (return value)");
  }
  const finalExpr = ctx.parseExpression();
  ctx.skipNewlines();

  return { bindings, finalExpr };
}

/** Parse a binding inside a function body, suppressing multiline string continuation. */
function parseFuncBinding(ctx: ParseContext): BindingNode {
  ctx.skipNewlines();
  const nameTok = ctx.expect(TokenType.Identifier, "binding name");
  ctx.expect(TokenType.Is, "'is'");
  const prev = ctx.suppressMultilineString;
  ctx.suppressMultilineString = true;
  const value = ctx.parseExpression();
  ctx.suppressMultilineString = prev;
  return { kind: "Binding", name: nameTok.value, value, calledName: null, line: nameTok.line, col: nameTok.col };
}
