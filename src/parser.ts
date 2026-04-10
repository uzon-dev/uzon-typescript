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
 *   14. is / is not / is named / is not named — equality (non-assoc)
 *   13. in              — membership (non-assoc)
 *   12. < <= > >=       — relational (non-assoc)
 *   11. ++              — concatenation (left-assoc)
 *   10. + -             — additive (left-assoc)
 *    9. * / % **        — multiplicative / repetition (left-assoc)
 *    8. unary -         — negation (right-assoc)
 *    7. ^               — exponentiation (right-assoc)
 *   5–6. from / named   — enum, union, tagged union
 *    4. as              — type annotation (non-assoc)
 *    3. with / extends  — struct override / extension (non-assoc)
 *    2. to              — type conversion (non-assoc)
 *    1. . / ()          — member access / function call (left-assoc)
 */

import { TokenType, Token } from "./token.js";
import { UzonSyntaxError } from "./error.js";
import type {
  AstNode, BindingNode, DocumentNode, StructLiteralNode, ListLiteralNode,
  TupleLiteralNode, GroupingNode, IfExprNode, CaseExprNode, WhenClause,
  TypeExprNode, StringPart, BinaryOp, FunctionParam,
} from "./ast.js";

export class Parser {
  private tokens: Token[];
  private pos = 0;
  /** Suppress multiline string continuation inside function body bindings. */
  private suppressMultilineString = false;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): DocumentNode {
    const bindings = this.parseBindings(TokenType.Eof);
    return { kind: "Document", bindings, line: 1, col: 1 };
  }

  // ── Token helpers ──────────────────────────────────────────

  /** Peek at the next non-newline token, optionally skipping `skip` tokens. */
  private peek(skip = 0): Token {
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
  private peekRaw(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  /** Consume and return the next non-newline token. */
  private advance(): Token {
    this.skipNewlines();
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private skipNewlines() {
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === TokenType.Newline) {
      this.pos++;
    }
  }

  /** Consume and return a token of the expected type, or throw. */
  private expect(type: TokenType, what?: string): Token {
    this.skipNewlines();
    const tok = this.advance();
    if (tok.type !== type) {
      this.error(what ? `Expected ${what}` : `Expected ${TokenType[type]}, got ${TokenType[tok.type]}`, tok);
    }
    return tok;
  }

  private error(msg: string, tok?: Token): never {
    const t = tok ?? this.peek();
    throw new UzonSyntaxError(msg, t.line, t.col);
  }

  // ── Bindings (§5.1) ───────────────────────────────────────

  private parseBindings(until: TokenType): BindingNode[] {
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
    const nameTok = this.expect(TokenType.Identifier, "binding name");
    const name = nameTok.value;

    this.skipNewlines();
    const isTok = this.peek();

    // Handle composite operators at binding position (§9 binding decomposition).
    // "x is not true" → binding x = (not true)
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

    const value = this.parseExpression();
    const calledName = this.tryParseCalled();
    return { kind: "Binding", name, value, calledName, line: nameTok.line, col: nameTok.col };
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
  private isCommaFollowedByBinding(): boolean {
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
  private tryParseCalled(): string | null {
    this.skipNewlines();
    if (this.peek().type === TokenType.Called) {
      this.advance();
      const tok = this.expect(TokenType.Identifier, "type name after 'called'");
      return tok.value;
    }
    return null;
  }

  // ── Expression parsing (precedence climbing) ──────────────

  private parseExpression(): AstNode {
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

  // Level 14: is, is not, is named, is not named (§5.1, §3.7) — non-associative
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

    // §3.7: `named tag from ...` — tagged union
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
  private parseVariantName(): string {
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

  // Level 3: with / extends (§3.2.1, §3.2.2) — non-associative, no chaining
  private parseStructOverride(): AstNode {
    let expr = this.parseConversion();

    if (this.peek().type === TokenType.With) {
      const withTok = this.advance();
      const overrides = this.parseStructLiteral();
      expr = { kind: "StructOverride", base: expr, overrides, line: withTok.line, col: withTok.col };
      if (this.peek().type === TokenType.With || this.peek().type === TokenType.Extends) {
        this.error("Chaining 'with'/'extends' is not permitted — use an intermediate binding", this.peek());
      }
    } else if (this.peek().type === TokenType.Extends) {
      const extTok = this.advance();
      const extensions = this.parseStructLiteral();
      expr = { kind: "StructExtend", base: expr, extensions, line: extTok.line, col: extTok.col };
      if (this.peek().type === TokenType.With || this.peek().type === TokenType.Extends) {
        this.error("Chaining 'with'/'extends' is not permitted — use an intermediate binding", this.peek());
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
        const memberTok = this.advance();
        const member = memberTok.value;
        expr = { kind: "MemberAccess", object: expr, member, line: dotTok.line, col: dotTok.col };
      } else if (this.peek().type === TokenType.LParen) {
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
      const memberTok = this.advance();
      expr = { kind: "MemberAccess", object: expr, member: memberTok.value, line: dotTok.line, col: dotTok.col };
    }

    return expr;
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
        return this.parseStringLiteral();
      case TokenType.Self:
        this.advance();
        return { kind: "SelfRef", line: tok.line, col: tok.col };
      case TokenType.Env:
        this.advance();
        return { kind: "EnvRef", line: tok.line, col: tok.col };
      case TokenType.Identifier:
        this.advance();
        return { kind: "Identifier", name: tok.value, line: tok.line, col: tok.col };
      case TokenType.LBrace:
        return this.parseStructLiteral();
      case TokenType.LBracket:
        return this.parseListLiteral();
      case TokenType.LParen:
        return this.parseTupleOrGrouping();
      case TokenType.If:
        return this.parseIfExpr();
      case TokenType.Case:
        return this.parseCaseExpr();
      case TokenType.Struct:
        return this.parseStructImport();
      case TokenType.Function:
        return this.parseFunctionExpr();
      default:
        this.error(`Unexpected token: '${tok.value}' (${TokenType[tok.type]})`, tok);
    }
  }

  // ── Function expression (§3.8) ─────────────────────────────

  private parseFunctionExpr(): AstNode {
    const funcTok = this.expect(TokenType.Function, "'function'");

    // Parameters — may be empty (zero-arity functions allowed)
    const params: FunctionParam[] = [];
    let seenDefault = false;

    this.skipNewlines();
    if (this.peek().type !== TokenType.Returns) {
      const firstParam = this.parseFunctionParam();
      if (firstParam.defaultValue !== null) seenDefault = true;
      params.push(firstParam);

      while (this.peek().type === TokenType.Comma) {
        this.advance();
        this.skipNewlines();
        if (this.peek().type === TokenType.Returns) break;
        const param = this.parseFunctionParam();
        if (param.defaultValue !== null) {
          seenDefault = true;
        } else if (seenDefault) {
          this.error("Required parameter after a defaulted parameter is not allowed", this.peek());
        }
        params.push(param);
      }
    }

    this.expect(TokenType.Returns, "'returns'");
    const returnType = this.parseTypeExpr();

    // Body: { [bindings...] finalExpr }
    this.expect(TokenType.LBrace, "'{'");
    const { bindings: bodyBindings, finalExpr } = this.parseFunctionBody();
    this.expect(TokenType.RBrace, "'}'");

    return {
      kind: "FunctionExpr", params, returnType,
      body: bodyBindings, finalExpr,
      line: funcTok.line, col: funcTok.col,
    };
  }

  private parseFunctionParam(): FunctionParam {
    this.skipNewlines();
    const nameTok = this.advance();
    if (nameTok.type !== TokenType.Identifier) {
      this.error("Expected parameter name", nameTok);
    }
    this.expect(TokenType.As, "'as' after parameter name");
    const type = this.parseTypeExpr();

    let defaultValue: AstNode | null = null;
    if (this.peek().type === TokenType.Default) {
      this.advance();
      defaultValue = this.parseExpression();
    }

    return { name: nameTok.value, type, defaultValue, line: nameTok.line, col: nameTok.col };
  }

  private parseFunctionBody(): { bindings: BindingNode[]; finalExpr: AstNode } {
    const bindings: BindingNode[] = [];
    this.skipNewlines();

    // 2-token lookahead: `identifier is` means binding; otherwise it's the final expression
    while (this.peek().type !== TokenType.RBrace) {
      if (this.peek().type === TokenType.Identifier && this.peek(1).type === TokenType.Is) {
        bindings.push(this.parseFuncBinding());
        this.skipNewlines();
        if (this.peek().type === TokenType.Comma) {
          this.advance();
          this.skipNewlines();
        }
        this.skipNewlines();
      } else {
        break;
      }
    }

    if (this.peek().type === TokenType.RBrace) {
      this.error("Function body must have a final expression (return value)");
    }
    const finalExpr = this.parseExpression();
    this.skipNewlines();

    return { bindings, finalExpr };
  }

  /** Parse a binding inside a function body, suppressing multiline string continuation. */
  private parseFuncBinding(): BindingNode {
    this.skipNewlines();
    const nameTok = this.expect(TokenType.Identifier, "binding name");
    this.expect(TokenType.Is, "'is'");
    const prev = this.suppressMultilineString;
    this.suppressMultilineString = true;
    const value = this.parseExpression();
    this.suppressMultilineString = prev;
    return { kind: "Binding", name: nameTok.value, value, calledName: null, line: nameTok.line, col: nameTok.col };
  }

  // ── String literal with interpolation and multiline (§4.4) ─

  /** Token types that can start an expression inside interpolation. */
  private static readonly INTERP_EXPR_START = new Set([
    TokenType.Identifier, TokenType.Integer, TokenType.Float,
    TokenType.True, TokenType.False, TokenType.Null, TokenType.Undefined,
    TokenType.Inf, TokenType.Nan,
    TokenType.Self, TokenType.Env,
    TokenType.LParen, TokenType.LBrace, TokenType.LBracket,
    TokenType.If, TokenType.Case, TokenType.Struct, TokenType.Function,
    TokenType.Not, TokenType.Minus,
  ]);

  /** Parse a single string segment (possibly with interpolation). */
  private parseStringSingleOrInterpolated(): StringPart[] {
    const parts: StringPart[] = [];
    const strTok = this.advance(); // String token
    if (strTok.value) parts.push(strTok.value);

    while (this.pos < this.tokens.length) {
      const raw = this.peekRaw();
      if (raw.type === TokenType.String) {
        const st = this.advance();
        if (st.value) parts.push(st.value);
        continue;
      }
      if (raw.type === TokenType.Eof || !Parser.INTERP_EXPR_START.has(raw.type)) {
        break;
      }
      // Interpolation expression
      const expr = this.parseExpression();
      parts.push(expr);
    }
    return parts;
  }

  /** Parse a full string literal, including multiline continuation (§4.4.2). */
  private parseStringLiteral(): AstNode {
    const firstTok = this.tokens[this.pos];
    const parts = this.parseStringSingleOrInterpolated();

    // §4.4.2: multiline strings — adjacent string on the next physical line
    while (this.checkMultilineStringContinuation()) {
      parts.push("\n");
      this.skipNewlines();
      parts.push(...this.parseStringSingleOrInterpolated());
    }

    return { kind: "StringLiteral", parts, line: firstTok.line, col: firstTok.col };
  }

  /**
   * §4.4.2: Check whether the next line continues a multiline string.
   * Requires exactly one newline between strings — blank lines or comments break the sequence.
   */
  private checkMultilineStringContinuation(): boolean {
    if (this.suppressMultilineString) return false;
    let i = this.pos;
    if (i >= this.tokens.length) return false;
    if (this.tokens[i].type !== TokenType.Newline) return false;
    const nlTok = this.tokens[i];
    i++;
    // §4.4.2: comment between multiline string parts is an error
    if (nlTok.afterComment) {
      let j = i;
      while (j < this.tokens.length && this.tokens[j].type === TokenType.Newline) j++;
      if (j < this.tokens.length && this.tokens[j].type === TokenType.String) {
        this.error("Comment between multiline string parts is not allowed", this.tokens[j]);
      }
      return false;
    }
    if (i < this.tokens.length && this.tokens[i].type === TokenType.String) return true;
    return false;
  }

  // ── Compound literals ──────────────────────────────────────

  private parseStructLiteral(): StructLiteralNode {
    const lbrace = this.expect(TokenType.LBrace, "'{'");
    const fields = this.parseBindings(TokenType.RBrace);
    this.expect(TokenType.RBrace, "'}'");
    return { kind: "StructLiteral", fields, line: lbrace.line, col: lbrace.col };
  }

  private parseListLiteral(): ListLiteralNode {
    const lbrack = this.expect(TokenType.LBracket, "'['");
    const elements: AstNode[] = [];

    this.skipNewlines();
    if (this.peek().type !== TokenType.RBracket) {
      elements.push(this.parseExpression());
      while (this.peek().type === TokenType.Comma) {
        this.advance();
        this.skipNewlines();
        if (this.peek().type === TokenType.RBracket) break;
        elements.push(this.parseExpression());
      }
    }
    this.skipNewlines();
    this.expect(TokenType.RBracket, "']'");
    return { kind: "ListLiteral", elements, line: lbrack.line, col: lbrack.col };
  }

  private parseTupleOrGrouping(): AstNode {
    const lparen = this.expect(TokenType.LParen, "'('");
    this.skipNewlines();

    // Empty tuple: ()
    if (this.peek().type === TokenType.RParen) {
      this.advance();
      return { kind: "TupleLiteral", elements: [], line: lparen.line, col: lparen.col } as TupleLiteralNode;
    }

    const first = this.parseExpression();
    this.skipNewlines();

    // Grouping: (expr)
    if (this.peek().type === TokenType.RParen) {
      this.advance();
      return { kind: "Grouping", expr: first, line: lparen.line, col: lparen.col } as GroupingNode;
    }

    // Tuple: (expr, expr, ...) — comma presence means tuple
    if (this.peek().type === TokenType.Comma) {
      const elements: AstNode[] = [first];
      while (this.peek().type === TokenType.Comma) {
        this.advance();
        this.skipNewlines();
        if (this.peek().type === TokenType.RParen) break;
        elements.push(this.parseExpression());
        this.skipNewlines();
      }
      this.expect(TokenType.RParen, "')'");
      return { kind: "TupleLiteral", elements, line: lparen.line, col: lparen.col } as TupleLiteralNode;
    }

    this.error("Expected ',' or ')' in tuple/grouping", this.peek());
  }

  // ── Control flow ───────────────────────────────────────────

  /** §5.9: if condition then expr else expr */
  private parseIfExpr(): IfExprNode {
    const ifTok = this.expect(TokenType.If, "'if'");
    const condition = this.parseExpression();
    this.expect(TokenType.Then, "'then'");
    const thenBranch = this.parseExpression();
    this.expect(TokenType.Else, "'else'");
    const elseBranch = this.parseExpression();
    return { kind: "IfExpr", condition, thenBranch, elseBranch, line: ifTok.line, col: ifTok.col };
  }

  /** §5.10: case expr when value then expr ... else expr */
  private parseCaseExpr(): CaseExprNode {
    const caseTok = this.expect(TokenType.Case, "'case'");
    const scrutinee = this.parseExpression();

    const whenClauses: WhenClause[] = [];
    this.skipNewlines();
    while (this.peek().type === TokenType.When) {
      const whenTok = this.advance();
      this.skipNewlines();

      let isNamed = false;
      let value: AstNode | string;

      if (this.peek().type === TokenType.Named) {
        this.advance();
        isNamed = true;
        value = this.parseVariantName();
      } else {
        value = this.parseExpression();
      }

      this.expect(TokenType.Then, "'then'");
      const result = this.parseExpression();
      whenClauses.push({ isNamed, value, result, line: whenTok.line, col: whenTok.col });
      this.skipNewlines();
    }

    // §5.10: case must have at least one when clause
    if (whenClauses.length === 0) {
      this.error("'case' requires at least one 'when' clause", caseTok);
    }

    this.expect(TokenType.Else, "'else'");
    const elseBranch = this.parseExpression();

    return { kind: "CaseExpr", scrutinee, whenClauses, elseBranch, line: caseTok.line, col: caseTok.col };
  }

  // ── Struct import (§7) ────────────────────────────────────

  private parseStructImport(): AstNode {
    const structTok = this.expect(TokenType.Struct, "'struct'");
    this.skipNewlines();
    const pathTok = this.expect(TokenType.String, "file path string");
    // §7.1: import paths must be non-interpolated strings
    const nextRaw = this.peekRaw();
    if (Parser.INTERP_EXPR_START.has(nextRaw.type) || nextRaw.type === TokenType.String) {
      this.error("Interpolation is not allowed in import paths — use a plain string", nextRaw);
    }
    return { kind: "StructImport", path: pathTok.value, line: structTok.line, col: structTok.col };
  }

  // ── Type expressions (§6) ─────────────────────────────────

  private parseTypeExpr(): TypeExprNode {
    this.skipNewlines();
    const tok = this.peek();

    // List type: [Type]
    if (tok.type === TokenType.LBracket) {
      const lbrack = this.advance();
      const inner = this.parseTypeExpr();
      this.expect(TokenType.RBracket, "']'");
      return { kind: "TypeExpr", path: [], isList: true, inner, isNull: false, isTuple: false, tupleElements: null, line: lbrack.line, col: lbrack.col };
    }

    // Tuple type: (Type, Type, ...)
    if (tok.type === TokenType.LParen) {
      const lparen = this.advance();
      const elements: TypeExprNode[] = [];
      this.skipNewlines();
      elements.push(this.parseTypeExpr());
      if (this.peek().type !== TokenType.Comma) {
        this.error("Tuple type requires at least two element types", this.peek());
      }
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
