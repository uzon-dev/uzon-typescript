// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * UZON recursive descent parser.
 *
 * Converts a flat token stream (from the Lexer) into an AST.
 *
 * Operator precedence (lowest → highest, §5.5):
 *   18. or else         — undefined coalescing (left-assoc)
 *   17. or              — logical OR (left-assoc)
 *   16. and             — logical AND (left-assoc)
 *   15. not             — logical NOT (right-assoc)
 *   14. is / is not / is named / is not named / is type / is not type — equality (non-assoc)
 *   13. in              — membership (non-assoc)
 *   12. < <= > >=       — relational (non-assoc)
 *   11. ++              — concatenation (left-assoc)
 *   10. + -             — additive (left-assoc)
 *    9. * / % **        — multiplicative / repetition (left-assoc)
 *    8. unary -         — negation (right-assoc)
 *    7. ^               — exponentiation (right-assoc)
 *   5–6. from / named   — enum, union, tagged union
 *    4. as              — type annotation (non-assoc)
 *    3. with / plus     — struct override / extension (non-assoc)
 *    2. to              — type conversion (non-assoc)
 *    1. . / ()          — member access / function call (left-assoc)
 */

import { TokenType, Token, KEYWORDS } from "./token.js";
import { UzonSyntaxError } from "./error.js";
import type {
  AstNode, BindingNode, DocumentNode,
  TypeExprNode, BinaryOp,
} from "./ast.js";
import type { ParseContext } from "./parse-context.js";

// ── Extracted modules ──
import { parseStringLiteral } from "./parse-strings.js";
import { parseFunctionExpr } from "./parse-functions.js";
import {
  parseStructLiteral, parseListLiteral, parseTupleOrGrouping,
  parseIfExpr, parseCaseExpr, parseStructImport,
} from "./parse-compounds.js";


/** Token types that are keywords — accepted as member names after `.`. */
const KEYWORD_TOKEN_TYPES = new Set<TokenType>(Object.values(KEYWORDS));

export class Parser implements ParseContext {
  tokens: Token[];
  pos = 0;
  suppressMultilineString = false;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): DocumentNode {
    const bindings = this.parseBindings(TokenType.Eof);
    return { kind: "Document", bindings, line: 1, col: 1 };
  }

  // ── Token helpers ──────────────────────────────────────────

  /** Peek at the next non-newline token, optionally skipping `skip` tokens. */
  peek(skip = 0): Token {
    let i = this.pos;
    let skipped = 0;
    while (i < this.tokens.length) {
      if (this.tokens[i].type === TokenType.Newline) { i++; continue; }
      if (skipped === skip) return this.tokens[i];
      skipped++;
      i++;
    }
    return this.tokens[this.tokens.length - 1]; // Eof
  }

  /** Peek at the raw next token without skipping newlines. */
  peekRaw(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  /** Consume and return the next non-newline token. */
  advance(): Token {
    this.skipNewlines();
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  skipNewlines() {
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === TokenType.Newline) {
      this.pos++;
    }
  }

  /** Consume and return a token of the expected type, or throw. */
  expect(type: TokenType, what?: string): Token {
    this.skipNewlines();
    const tok = this.advance();
    if (tok.type !== type) {
      this.error(what ? `Expected ${what}` : `Expected ${TokenType[type]}, got ${TokenType[tok.type]}`, tok);
    }
    return tok;
  }

  error(msg: string, tok?: Token): never {
    const t = tok ?? this.peek();
    throw new UzonSyntaxError(msg, t.line, t.col);
  }

  // ── Bindings (§5.1) ───────────────────────────────────────

  parseBindings(until: TokenType): BindingNode[] {
    const bindings: BindingNode[] = [];
    this.skipNewlines();

    while (this.peek().type !== until) {
      bindings.push(this.parseBinding());
      this.skipNewlines();
      if (this.peek().type === TokenType.Comma) {
        this.advance();
        this.skipNewlines();
      }
      this.skipNewlines();
    }
    return bindings;
  }

  private parseBinding(): BindingNode {
    this.skipNewlines();
    const nameTok = this.peek();
    // §11.2: suggest @keyword escape when a keyword appears at binding position.
    if (nameTok.type !== TokenType.Identifier && KEYWORD_TOKEN_TYPES.has(nameTok.type)) {
      const next = this.peek(1);
      if (next.type === TokenType.Is || next.type === TokenType.Are
        || next.type === TokenType.IsNot || next.type === TokenType.IsNamed
        || next.type === TokenType.IsNotNamed || next.type === TokenType.IsType
        || next.type === TokenType.IsNotType) {
        this.error(
          `"${nameTok.value}" is a keyword; to use it as a binding name, write @${nameTok.value}`,
          nameTok,
        );
      }
    }
    this.expect(TokenType.Identifier, "binding name");
    const name = nameTok.value;

    this.skipNewlines();
    const isTok = this.peek();

    // Handle composite operators at binding position (§9 binding decomposition).
    if (isTok.type === TokenType.IsNot) {
      this.advance();
      this.tokens.splice(this.pos, 0, {
        type: TokenType.Not, value: "not", line: isTok.line, col: isTok.col,
      });
      const value = this.parseExpression();
      const calledName = this.tryParseCalled();
      return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
    }
    if (isTok.type === TokenType.IsNamed) {
      this.advance();
      this.tokens.splice(this.pos, 0, {
        type: TokenType.Named, value: "named", line: isTok.line, col: isTok.col,
      });
      const value = this.parseExpression();
      const calledName = this.tryParseCalled();
      return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
    }
    if (isTok.type === TokenType.IsNotNamed) {
      this.advance();
      this.tokens.splice(this.pos, 0,
        { type: TokenType.Not, value: "not", line: isTok.line, col: isTok.col },
        { type: TokenType.Named, value: "named", line: isTok.line, col: isTok.col },
      );
      const value = this.parseExpression();
      const calledName = this.tryParseCalled();
      return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
    }
    if (isTok.type === TokenType.IsType) {
      this.advance();
      this.tokens.splice(this.pos, 0, {
        type: TokenType.Type, value: "type", line: isTok.line, col: isTok.col,
      });
      const value = this.parseExpression();
      const calledName = this.tryParseCalled();
      return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
    }
    if (isTok.type === TokenType.IsNotType) {
      this.advance();
      this.tokens.splice(this.pos, 0,
        { type: TokenType.Not, value: "not", line: isTok.line, col: isTok.col },
        { type: TokenType.Type, value: "type", line: isTok.line, col: isTok.col },
      );
      const value = this.parseExpression();
      const calledName = this.tryParseCalled();
      return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
    }

    // §3.4.1: `are` keyword — syntactic sugar for list binding
    if (isTok.type === TokenType.Are) {
      this.advance();
      return this.parseAreBinding(name, nameTok);
    }

    this.expect(TokenType.Is, "'is' or 'are'");

    // §5.14: field extraction — `name is of source`
    this.skipNewlines();
    if (this.peek().type === TokenType.Of) {
      this.advance();
      const source = this.parseMemberAccessOnly();
      const calledName = this.tryParseCalled();
      return {
        kind: "Binding", name,
        value: { kind: "FieldExtraction", bindingName: name, source, line: nameTok.line, col: nameTok.col },
        calledName,
        line: nameTok.line, col: nameTok.col,
      };
    }

    // §3.2 / §3.5 / §3.6 / §3.7: Standalone type declarations at binding position.
    // The binding name becomes the type name — synthesized here via calledName.
    const standalone = this.tryParseStandaloneTypeDecl(name, nameTok);
    if (standalone) return standalone;

    const value = this.parseExpression();
    const calledName = this.tryParseCalled();
    return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
  }

  /**
   * §3.2 / §3.5 / §3.6 / §3.7: Detect and parse a standalone type declaration
   * after `is`. Returns a complete Binding node (with auto-populated calledName)
   * or null if the upcoming tokens are not a standalone type declaration.
   */
  private tryParseStandaloneTypeDecl(name: string, nameTok: Token): BindingNode | null {
    this.skipNewlines();
    const first = this.peek();

    // `A is struct { ... }` — distinct from `A is struct "path"` (import expression)
    if (first.type === TokenType.Struct) {
      const after = this.peek(1);
      if (after.type === TokenType.LBrace) {
        this.advance(); // consume 'struct'
        const body = parseStructLiteral(this);
        this.rejectCalled("struct");
        return { kind: "Binding", name, value: body, calledName: name, line: nameTok.line, col: nameTok.col };
      }
    }

    // `A is enum v1, v2, ...`
    if (first.type === TokenType.Enum) {
      const enumTok = this.advance();
      this.skipNewlines();
      const variants = this.parseEnumVariants();
      this.rejectCalled("enum");
      const valueNode: AstNode = variants.length > 0
        ? { kind: "Identifier", name: variants[0], line: enumTok.line, col: enumTok.col }
        : { kind: "NullLiteral", line: enumTok.line, col: enumTok.col };
      const fromEnum: AstNode = {
        kind: "FromEnum", value: valueNode, variants,
        line: enumTok.line, col: enumTok.col,
      };
      return { kind: "Binding", name, value: fromEnum, calledName: name, line: nameTok.line, col: nameTok.col };
    }

    // `A is tagged union v1 as T1, v2 as T2, ...`
    if (first.type === TokenType.Tagged) {
      const taggedTok = this.advance();
      this.skipNewlines();
      this.expect(TokenType.Union, "'union' after 'tagged'");
      const variants = this.parseTaggedUnionVariants();
      this.rejectCalled("tagged union");
      const decl: AstNode = {
        kind: "StandaloneTaggedUnion", variants,
        line: taggedTok.line, col: taggedTok.col,
      };
      return { kind: "Binding", name, value: decl, calledName: name, line: nameTok.line, col: nameTok.col };
    }

    // `A is union T1, T2, ...`
    if (first.type === TokenType.Union) {
      const unionTok = this.advance();
      this.skipNewlines();
      const types: TypeExprNode[] = [];
      types.push(this.parseTypeExpr());
      while (this.peek().type === TokenType.Comma) {
        if (this.isCommaFollowedByBinding()) break;
        this.advance();
        this.skipNewlines();
        types.push(this.parseTypeExpr());
      }
      this.rejectCalled("union");
      const decl: AstNode = {
        kind: "StandaloneUnion", types,
        line: unionTok.line, col: unionTok.col,
      };
      return { kind: "Binding", name, value: decl, calledName: name, line: nameTok.line, col: nameTok.col };
    }

    return null;
  }

  /**
   * §3.6/§3.7: `called` is forbidden on standalone type declarations —
   * the binding name is already the type name.
   */
  private rejectCalled(kind: string): void {
    this.skipNewlines();
    if (this.peek().type === TokenType.Called) {
      this.error(
        `'called' is not permitted on standalone ${kind} declarations — the binding name already names the type`,
        this.peek(),
      );
    }
  }

  /**
   * §3.4.1: `name are e1, e2, e3` → desugar to `name is [e1, e2, e3]`.
   * A trailing `as` on the last element is lifted to the list level.
   */
  private parseAreBinding(name: string, nameTok: Token): BindingNode {
    const elements: AstNode[] = [];
    elements.push(this.parseExpression());

    while (this.peek().type === TokenType.Comma) {
      if (this.isCommaFollowedByBinding()) break;
      this.advance();
      this.skipNewlines();
      elements.push(this.parseExpression());
    }

    // Lift trailing `as` from the last element to the list level
    let typeAnnotation: TypeExprNode | null = null;
    if (elements.length > 0) {
      const last = elements[elements.length - 1];
      if (last.kind === "TypeAnnotation") {
        typeAnnotation = last.type;
        elements[elements.length - 1] = last.expr;
      }
    }

    const calledName = this.tryParseCalled();

    let listNode: AstNode = {
      kind: "ListLiteral", elements,
      line: nameTok.line, col: nameTok.col,
    };

    if (typeAnnotation) {
      listNode = {
        kind: "TypeAnnotation", expr: listNode, type: typeAnnotation,
        line: nameTok.line, col: nameTok.col,
      };
    }

    return { kind: "Binding", name, value: listNode, calledName, line: nameTok.line, col: nameTok.col };
  }

  /**
   * Lookahead: does comma + identifier + is/are follow?
   * Used to terminate `are`, enum variants, and union types at binding boundaries (§3.5).
   */
  isCommaFollowedByBinding(): boolean {
    let i = this.pos + 1; // after comma
    while (i < this.tokens.length && this.tokens[i].type === TokenType.Newline) i++;
    if (i >= this.tokens.length) return false;
    if (this.tokens[i].type !== TokenType.Identifier) return false;
    i++;
    while (i < this.tokens.length && this.tokens[i].type === TokenType.Newline) i++;
    if (i >= this.tokens.length) return false;
    const t = this.tokens[i].type;
    return t === TokenType.Is || t === TokenType.Are;
  }

  /** §6.2: `called TypeName` — names the type of a binding. */
  tryParseCalled(): string | null {
    this.skipNewlines();
    if (this.peek().type === TokenType.Called) {
      this.advance();
      const tok = this.expect(TokenType.Identifier, "type name after 'called'");
      return tok.value;
    }
    return null;
  }

  // ── Expression parsing (precedence climbing) ──────────────

  parseExpression(): AstNode {
    return this.parseOrElse();
  }

  // Level 18: or else (§5.7)
  private parseOrElse(): AstNode {
    let left = this.parseOr();
    while (this.peek().type === TokenType.OrElse) {
      const op = this.advance();
      const right = this.parseOr();
      left = { kind: "OrElse", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 17: or (§5.6)
  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.peek().type === TokenType.Or) {
      const op = this.advance();
      const right = this.parseAnd();
      left = { kind: "BinaryOp", op: "or", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 16: and (§5.6)
  private parseAnd(): AstNode {
    let left = this.parseNot();
    while (this.peek().type === TokenType.And) {
      const op = this.advance();
      const right = this.parseNot();
      left = { kind: "BinaryOp", op: "and", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 15: not (§5.6)
  private parseNot(): AstNode {
    if (this.peek().type === TokenType.Not) {
      const op = this.advance();
      const operand = this.parseNot();
      return { kind: "UnaryOp", op: "not", operand, line: op.line, col: op.col };
    }
    return this.parseEquality();
  }

  // Level 14: is, is not, is named, is not named, is type, is not type (§5.1, §3.7, §5.2) — non-associative
  private parseEquality(): AstNode {
    let left = this.parseMembership();

    const t = this.peek().type;
    if (t === TokenType.Is) {
      const op = this.advance();
      const right = this.parseMembership();
      left = { kind: "BinaryOp", op: "is", left, right, line: op.line, col: op.col };
      // §5.1: chained `is` forbidden
      if (this.peek().type === TokenType.Is || this.peek().type === TokenType.IsNot) {
        this.error("Chained 'is' is not allowed — use parentheses", this.peek());
      }
    } else if (t === TokenType.IsNot) {
      const op = this.advance();
      const right = this.parseMembership();
      left = { kind: "BinaryOp", op: "is not", left, right, line: op.line, col: op.col };
    } else if (t === TokenType.IsNamed) {
      const op = this.advance();
      this.skipNewlines();
      const nameTok = this.advance();
      left = {
        kind: "BinaryOp", op: "is named" as BinaryOp, left,
        right: { kind: "Identifier", name: nameTok.value, line: nameTok.line, col: nameTok.col },
        line: op.line, col: op.col,
      };
    } else if (t === TokenType.IsNotNamed) {
      const op = this.advance();
      this.skipNewlines();
      const nameTok = this.advance();
      left = {
        kind: "BinaryOp", op: "is not named" as BinaryOp, left,
        right: { kind: "Identifier", name: nameTok.value, line: nameTok.line, col: nameTok.col },
        line: op.line, col: op.col,
      };
    } else if (t === TokenType.IsType) {
      const op = this.advance();
      this.skipNewlines();
      const typeExpr = this.parseTypeExpr();
      left = {
        kind: "BinaryOp", op: "is type" as BinaryOp, left,
        right: typeExpr,
        line: op.line, col: op.col,
      };
    } else if (t === TokenType.IsNotType) {
      const op = this.advance();
      this.skipNewlines();
      const typeExpr = this.parseTypeExpr();
      left = {
        kind: "BinaryOp", op: "is not type" as BinaryOp, left,
        right: typeExpr,
        line: op.line, col: op.col,
      };
    }

    return left;
  }

  // Level 13: in (§5.8.1)
  private parseMembership(): AstNode {
    const left = this.parseRelational();
    if (this.peek().type === TokenType.In) {
      const op = this.advance();
      const right = this.parseRelational();
      return { kind: "BinaryOp", op: "in", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 12: < <= > >= (§5.4)
  private parseRelational(): AstNode {
    const left = this.parseConcat();
    const t = this.peek().type;
    if (t === TokenType.Lt || t === TokenType.Le || t === TokenType.Gt || t === TokenType.Ge) {
      const op = this.advance();
      const right = this.parseConcat();
      return { kind: "BinaryOp", op: op.value as BinaryOp, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 11: ++ (§5.8.2)
  private parseConcat(): AstNode {
    let left = this.parseAddition();
    while (this.peek().type === TokenType.PlusPlus) {
      const op = this.advance();
      const right = this.parseAddition();
      left = { kind: "BinaryOp", op: "++", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 10: + - (§5.3)
  private parseAddition(): AstNode {
    let left = this.parseMultiplication();
    while (this.peek().type === TokenType.Plus || this.peek().type === TokenType.Minus) {
      const op = this.advance();
      const right = this.parseMultiplication();
      left = { kind: "BinaryOp", op: op.value as BinaryOp, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 9: * / % ** (§5.3, §5.8.3)
  private parseMultiplication(): AstNode {
    let left = this.parseUnary();
    while (
      this.peek().type === TokenType.Star ||
      this.peek().type === TokenType.Slash ||
      this.peek().type === TokenType.Percent ||
      this.peek().type === TokenType.StarStar
    ) {
      const op = this.advance();
      const right = this.parseUnary();
      left = { kind: "BinaryOp", op: op.value as BinaryOp, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Level 8: unary - (§5.3)
  private parseUnary(): AstNode {
    if (this.peek().type === TokenType.Minus) {
      const op = this.advance();
      const operand = this.parseUnary();
      return { kind: "UnaryOp", op: "-", operand, line: op.line, col: op.col };
    }
    return this.parsePower();
  }

  // Level 7: ^ right-associative (§5.3)
  private parsePower(): AstNode {
    const base = this.parseTypeDecl();
    if (this.peek().type === TokenType.Caret) {
      const op = this.advance();
      const exp = this.parseUnary(); // right-associative
      return { kind: "BinaryOp", op: "^", left: base, right: exp, line: op.line, col: op.col };
    }
    return base;
  }

  // Levels 5–6: from / named (§3.5, §3.6, §3.7)
  private parseTypeDecl(): AstNode {
    let expr = this.parseTypeAnnotation();

    // `from` clause — enum or union
    if (this.peek().type === TokenType.From) {
      const fromTok = this.advance();
      this.skipNewlines();

      if (this.peek().type === TokenType.Union) {
        // §3.6: untagged union — `from union Type1, Type2, ...`
        this.advance();
        const types: TypeExprNode[] = [];
        types.push(this.parseTypeExpr());
        while (this.peek().type === TokenType.Comma) {
          if (this.isCommaFollowedByBinding()) break;
          this.advance();
          this.skipNewlines();
          types.push(this.parseTypeExpr());
        }
        expr = { kind: "FromUnion", value: expr, types, line: fromTok.line, col: fromTok.col };
      } else {
        // §3.5: enum — `from variant1, variant2, ...`
        const variants = this.parseEnumVariants();
        expr = { kind: "FromEnum", value: expr, variants, line: fromTok.line, col: fromTok.col };
      }
    }

    // §3.7: `named tag from ...` or `named tag as Type` — tagged union
    if (this.peek().type === TokenType.Named) {
      const namedTok = this.advance();
      this.skipNewlines();
      const tagTok = this.advance();
      const tag = tagTok.value;

      let variantDefs: [string, TypeExprNode][] | null = null;
      this.skipNewlines();
      if (this.peek().type === TokenType.From) {
        this.advance();
        variantDefs = this.parseTaggedUnionVariants();
      } else if (this.peek().type === TokenType.As) {
        // §6.3: `as Type` must precede `named variant` — reverse order is a syntax error
        this.error("'as Type' must come before 'named variant' — write 'as Type named variant', not 'named variant as Type'", this.peek());
      }

      expr = { kind: "NamedVariant", value: expr, tag, variants: variantDefs, line: namedTok.line, col: namedTok.col };
    }

    return expr;
  }

  /** Parse comma-separated variant names for an enum (§3.5). */
  private parseEnumVariants(): string[] {
    const variants: string[] = [];
    variants.push(this.parseVariantName());

    while (this.peek().type === TokenType.Comma) {
      if (this.isCommaFollowedByBinding()) break;
      this.advance();
      this.skipNewlines();
      if (this.peek().type === TokenType.Called) break;
      variants.push(this.parseVariantName());
    }
    return variants;
  }

  /** Read a variant name — identifiers and keywords are both valid (§3.5). */
  parseVariantName(): string {
    this.skipNewlines();
    const tok = this.advance();
    if (tok.type === TokenType.Identifier) return tok.value;
    if (tok.value && tok.type !== TokenType.Eof && tok.type !== TokenType.Comma
        && tok.type !== TokenType.RBrace && tok.type !== TokenType.RBracket
        && tok.type !== TokenType.RParen) return tok.value;
    this.error("Expected variant name", tok);
  }

  /** Parse tagged union variant definitions: `name as Type, ...` (§3.7). */
  private parseTaggedUnionVariants(): [string, TypeExprNode][] {
    const variants: [string, TypeExprNode][] = [];
    this.skipNewlines();
    const name = this.parseVariantName();
    this.expect(TokenType.As, "'as' after variant name");
    const type = this.parseTypeExpr();
    variants.push([name, type]);

    while (this.peek().type === TokenType.Comma) {
      if (this.isCommaFollowedByBinding()) break;
      this.advance();
      this.skipNewlines();
      if (this.peek().type === TokenType.Called) break;
      const vName = this.parseVariantName();
      this.expect(TokenType.As, "'as' after variant name");
      const vType = this.parseTypeExpr();
      variants.push([vName, vType]);
    }
    return variants;
  }

  // Level 4: as (§6.1)
  private parseTypeAnnotation(): AstNode {
    let expr = this.parseStructOverride();

    if (this.peek().type === TokenType.As) {
      const asTok = this.advance();
      const type = this.parseTypeExpr();
      expr = { kind: "TypeAnnotation", expr, type, line: asTok.line, col: asTok.col };
      // Allow `as Type to Type` chaining: (expr as T1) to T2
      if (this.peek().type === TokenType.To) {
        const toTok = this.advance();
        const toType = this.parseTypeExpr();
        expr = { kind: "Conversion", expr, type: toType, line: toTok.line, col: toTok.col };
      }
    }

    return expr;
  }

  // Level 3: with / plus (§3.2.1, §3.2.2) — non-associative, no chaining
  private parseStructOverride(): AstNode {
    let expr = this.parseConversion();

    if (this.peek().type === TokenType.With) {
      const withTok = this.advance();
      const overrides = parseStructLiteral(this);
      expr = { kind: "StructOverride", base: expr, overrides, line: withTok.line, col: withTok.col };
      if (this.peek().type === TokenType.With || this.peek().type === TokenType.PlusKw) {
        this.error("Chaining 'with'/'plus' is not permitted — use an intermediate binding", this.peek());
      }
    } else if (this.peek().type === TokenType.PlusKw) {
      const plusTok = this.advance();
      const extensions = parseStructLiteral(this);
      expr = { kind: "StructPlus", base: expr, extensions, line: plusTok.line, col: plusTok.col };
      if (this.peek().type === TokenType.With || this.peek().type === TokenType.PlusKw) {
        this.error("Chaining 'with'/'plus' is not permitted — use an intermediate binding", this.peek());
      }
    }

    return expr;
  }

  // Level 2: to (§5.11)
  private parseConversion(): AstNode {
    let expr = this.parseCallOrAccess();

    if (this.peek().type === TokenType.To) {
      const toTok = this.advance();
      const type = this.parseTypeExpr();
      expr = { kind: "Conversion", expr, type, line: toTok.line, col: toTok.col };
    }

    return expr;
  }

  // Level 1: . member access + () function call (§5.15)
  private parseCallOrAccess(): AstNode {
    let expr = this.parsePrimary();

    while (true) {
      if (this.peek().type === TokenType.Dot) {
        const dotTok = this.advance();
        this.skipNewlines();
        const member = this.parseMemberName();
        expr = { kind: "MemberAccess", object: expr, member, line: dotTok.line, col: dotTok.col };
      } else if (this.peekRaw().type === TokenType.LParen) {
        const lpTok = this.advance();
        const args: AstNode[] = [];
        this.skipNewlines();
        if (this.peek().type !== TokenType.RParen) {
          args.push(this.parseExpression());
          while (this.peek().type === TokenType.Comma) {
            this.advance();
            this.skipNewlines();
            if (this.peek().type === TokenType.RParen) break;
            args.push(this.parseExpression());
          }
        }
        this.skipNewlines();
        this.expect(TokenType.RParen, "')' after function arguments");
        expr = { kind: "FunctionCall", callee: expr, args, line: lpTok.line, col: lpTok.col };
      } else {
        break;
      }
    }

    return expr;
  }

  /** Member access only (no function calls) — used by `of` (§5.14). */
  private parseMemberAccessOnly(): AstNode {
    let expr = this.parsePrimary();

    while (this.peek().type === TokenType.Dot) {
      const dotTok = this.advance();
      this.skipNewlines();
      const member = this.parseMemberName();
      expr = { kind: "MemberAccess", object: expr, member, line: dotTok.line, col: dotTok.col };
    }

    return expr;
  }

  /**
   * Parse a member name after `.` — accepts identifiers, @keyword escapes,
   * and bare keywords (§5.12, matching Go reference).
   */
  private parseMemberName(): string {
    const tok = this.peek();
    if (tok.type === TokenType.Identifier || tok.type === TokenType.Integer) {
      this.advance();
      return tok.value;
    }
    // @keyword escape in member position
    if (tok.type === TokenType.At) {
      this.advance(); // consume @
      const kwTok = this.advance();
      return kwTok.value;
    }
    // Bare keywords as member names
    if (KEYWORD_TOKEN_TYPES.has(tok.type)) {
      this.advance();
      return tok.value;
    }
    this.error(`Expected member name, got ${TokenType[tok.type]}`, tok);
  }

  // ── Primary expressions ────────────────────────────────────

  private parsePrimary(): AstNode {
    this.skipNewlines();
    const tok = this.peek();

    switch (tok.type) {
      case TokenType.Integer: {
        this.advance();
        return { kind: "IntegerLiteral", value: tok.value, negative: tok.value.startsWith("-"), line: tok.line, col: tok.col };
      }
      case TokenType.Float: {
        this.advance();
        return { kind: "FloatLiteral", value: tok.value, negative: tok.value.startsWith("-"), line: tok.line, col: tok.col };
      }
      case TokenType.Inf: {
        this.advance();
        return { kind: "InfLiteral", negative: tok.value === "-inf", line: tok.line, col: tok.col };
      }
      case TokenType.Nan: {
        this.advance();
        return { kind: "NanLiteral", negative: tok.value === "-nan", line: tok.line, col: tok.col };
      }
      case TokenType.True:
        this.advance();
        return { kind: "BoolLiteral", value: true, line: tok.line, col: tok.col };
      case TokenType.False:
        this.advance();
        return { kind: "BoolLiteral", value: false, line: tok.line, col: tok.col };
      case TokenType.Null:
        this.advance();
        return { kind: "NullLiteral", line: tok.line, col: tok.col };
      case TokenType.Undefined:
        this.advance();
        return { kind: "UndefinedLiteral", line: tok.line, col: tok.col };
      case TokenType.String:
        return parseStringLiteral(this);
      case TokenType.Env:
        this.advance();
        return { kind: "EnvRef", line: tok.line, col: tok.col };
      case TokenType.Identifier:
        this.advance();
        return { kind: "Identifier", name: tok.value, line: tok.line, col: tok.col };
      case TokenType.LBrace:
        return parseStructLiteral(this);
      case TokenType.LBracket:
        return parseListLiteral(this);
      case TokenType.LParen:
        return parseTupleOrGrouping(this);
      case TokenType.If:
        return parseIfExpr(this);
      case TokenType.Case:
        return parseCaseExpr(this);
      case TokenType.Struct:
        return parseStructImport(this);
      case TokenType.Function:
        return parseFunctionExpr(this);
      // §9 binding decomposition: keyword tokens that appear as primaries
      // after composite Is* decomposition are treated as identifiers.
      case TokenType.Named:
      case TokenType.Type:
        this.advance();
        return { kind: "Identifier", name: tok.value, line: tok.line, col: tok.col };
      default:
        this.error(`Unexpected token: '${tok.value}' (${TokenType[tok.type]})`, tok);
    }
  }

  // ── Type expressions (§6) ─────────────────────────────────

  /** Parse a type expression and return its string name (for case type / when). */
  parseTypeExprAsString(): string {
    const typeNode = this.parseTypeExpr();
    return typeExprNodeToString(typeNode);
  }

  parseTypeExpr(): TypeExprNode {
    this.skipNewlines();
    const tok = this.peek();

    // List type: [Type]
    if (tok.type === TokenType.LBracket) {
      const lbrack = this.advance();
      const inner = this.parseTypeExpr();
      this.expect(TokenType.RBracket, "']'");
      return { kind: "TypeExpr", path: [], isList: true, inner, isNull: false, isTuple: false, tupleElements: null, line: lbrack.line, col: lbrack.col };
    }

    // Tuple type or grouped type expression: (), (Type), (Type,), (Type, Type, ...)
    if (tok.type === TokenType.LParen) {
      const lparen = this.advance();
      this.skipNewlines();

      // Empty tuple type: ()
      if (this.peek().type === TokenType.RParen) {
        this.advance();
        return { kind: "TypeExpr", path: [], isList: false, inner: null, isNull: false, isTuple: true, tupleElements: [], line: lparen.line, col: lparen.col };
      }

      const first = this.parseTypeExpr();
      this.skipNewlines();

      // Grouped type expression: (Type) — no comma, returns inner type directly
      if (this.peek().type === TokenType.RParen) {
        this.advance();
        return first;
      }

      // Tuple type: (Type,) or (Type, Type, ...)
      const elements: TypeExprNode[] = [first];
      while (this.peek().type === TokenType.Comma) {
        this.advance();
        this.skipNewlines();
        if (this.peek().type === TokenType.RParen) break;
        elements.push(this.parseTypeExpr());
        this.skipNewlines();
      }
      this.expect(TokenType.RParen, "')' after tuple type");
      return { kind: "TypeExpr", path: [], isList: false, inner: null, isNull: false, isTuple: true, tupleElements: elements, line: lparen.line, col: lparen.col };
    }

    // Null type
    if (tok.type === TokenType.Null) {
      this.advance();
      return { kind: "TypeExpr", path: [], isList: false, inner: null, isNull: true, isTuple: false, tupleElements: null, line: tok.line, col: tok.col };
    }

    // Simple or dotted type name: TypeName or Module.TypeName
    const first = this.advance();
    const path = [first.value];
    while (this.peek().type === TokenType.Dot) {
      this.advance();
      const seg = this.advance();
      path.push(seg.value);
    }

    return { kind: "TypeExpr", path, isList: false, inner: null, isNull: false, isTuple: false, tupleElements: null, line: first.line, col: first.col };
  }
}

function typeExprNodeToString(type: TypeExprNode): string {
  if (type.isNull) return "null";
  if (type.isList && type.inner) return `[${typeExprNodeToString(type.inner)}]`;
  if (type.isTuple && type.tupleElements) {
    return `(${type.tupleElements.map(t => typeExprNodeToString(t)).join(", ")})`;
  }
  return type.path.join(".");
}
