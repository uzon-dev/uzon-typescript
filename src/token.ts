// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Token types, keyword map, and boundary-character set for the UZON lexer.
 *
 * The token vocabulary follows the UZON lexical structure (§2) and keyword
 * list (§2.5). Composite operators such as "or else" and "is not" are
 * recognised as single tokens so the parser never needs two-token lookahead
 * (§9, lexer rules).
 */

// ── Token type enum ────────────────────────────────────────────────

export enum TokenType {
  // Literals
  Integer,
  Float,
  String,
  True,
  False,
  Null,
  Inf,
  Nan,
  Undefined,

  // Identifier (§2.3)
  Identifier,

  // Binding (§5.1)
  Is,
  Are,

  // Type system (§3, §6)
  From,
  Called,
  As,
  Named,
  With,
  Union,
  Extends,

  // Conversion / extraction (§5.11, §5.14)
  To,
  Of,

  // Logic (§5.6)
  And,
  Or,
  Not,

  // Control (§5.9, §5.10)
  If,
  Then,
  Else,
  Case,
  When,

  // References (§5.12, §5.13)
  Self,
  Env,

  // Import (§7)
  Struct,

  // Membership (§5.8.1)
  In,

  // Function (§3.8)
  Function,
  Returns,
  Default,

  // Reserved (§2.5)
  Lazy,
  Type,

  // Composite operators (§9 lexer rules)
  IsNot,       // "is not"
  IsNamed,     // "is named"
  IsNotNamed,  // "is not named"
  OrElse,      // "or else"

  // Arithmetic (§5.3)
  Plus,     // +
  Minus,    // -
  Star,     // *
  Slash,    // /
  Percent,  // %
  Caret,    // ^

  // Comparison (§5.4)
  Lt,    // <
  LtEq,  // <=
  Gt,    // >
  GtEq,  // >=

  // Collection (§5.8)
  PlusPlus,  // ++ concatenation
  StarStar,  // ** repetition

  // Delimiters (§2.6)
  LBrace,    // {
  RBrace,    // }
  LParen,    // (
  RParen,    // )
  LBracket,  // [
  RBracket,  // ]
  Comma,     // ,
  Dot,       // .

  // Keyword escape (§2.4)
  At,  // @

  // End of file
  Eof,
}

// ── Token structure ────────────────────────────────────────────────

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ── Keyword map ────────────────────────────────────────────────────

export const KEYWORDS: ReadonlyMap<string, TokenType> = new Map([
  ["true", TokenType.True],
  ["false", TokenType.False],
  ["null", TokenType.Null],
  ["inf", TokenType.Inf],
  ["nan", TokenType.Nan],
  ["undefined", TokenType.Undefined],
  ["is", TokenType.Is],
  ["are", TokenType.Are],
  ["from", TokenType.From],
  ["called", TokenType.Called],
  ["as", TokenType.As],
  ["named", TokenType.Named],
  ["with", TokenType.With],
  ["union", TokenType.Union],
  ["extends", TokenType.Extends],
  ["to", TokenType.To],
  ["of", TokenType.Of],
  ["and", TokenType.And],
  ["or", TokenType.Or],
  ["not", TokenType.Not],
  ["if", TokenType.If],
  ["then", TokenType.Then],
  ["else", TokenType.Else],
  ["case", TokenType.Case],
  ["when", TokenType.When],
  ["self", TokenType.Self],
  ["env", TokenType.Env],
  ["struct", TokenType.Struct],
  ["in", TokenType.In],
  ["function", TokenType.Function],
  ["returns", TokenType.Returns],
  ["default", TokenType.Default],
  ["lazy", TokenType.Lazy],
  ["type", TokenType.Type],
]);

// ── Token boundary characters (§2.3) ──────────────────────────────

/**
 * Characters that MUST terminate or cannot appear within an unquoted identifier.
 * Whitespace is handled separately.
 */
export const TOKEN_BOUNDARY_CHARS = new Set(
  "{}[](),.\"'@+-*/%^<>=!?:;|&$~#\\".split(""),
);

/**
 * Returns true if `s` represents a keyword token type.
 */
export function isKeywordType(type: TokenType): boolean {
  return (
    type >= TokenType.True &&
    type <= TokenType.Type &&
    type !== TokenType.Identifier
  );
}
