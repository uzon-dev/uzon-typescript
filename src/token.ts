// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Token types, keyword map, and boundary-character set for the UZON lexer.
 *
 * The token vocabulary follows the UZON lexical structure (§2) and keyword
 * list (§2.5). Composite operators such as "or else" and "is not" are
 * recognised as single tokens so the parser never needs two-token lookahead.
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

  // Identifier
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
  PlusKw,  // "plus" keyword for struct extension (§3.2.2)
  Type,    // "type" keyword for runtime type check (§5.2)

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

  // References (§5.13)
  Env,

  // Import (§7)
  Struct,

  // Membership (§5.8.1)
  In,

  // Function (§3.8)
  Function,
  Returns,
  Default,

  // Composite operators — recognised as single tokens (§9 lexer rules)
  OrElse,      // "or else"
  IsNot,       // "is not"
  IsNamed,     // "is named"
  IsNotNamed,  // "is not named"
  IsType,      // "is type"
  IsNotType,   // "is not type"

  // Arithmetic (§5.3)
  Plus,     // +
  Minus,    // -
  Star,     // *
  Slash,    // /
  Percent,  // %
  Caret,    // ^
  PlusPlus, // ++ concatenation (§5.8.2)
  StarStar, // ** repetition (§5.8.3)

  // Comparison (§5.4)
  Lt,  // <
  Le,  // <=
  Gt,  // >
  Ge,  // >=

  // Punctuation
  Comma,  // ,
  Dot,    // .
  At,     // @ keyword escape (§2.4)

  // Delimiters
  LBrace,    // {
  RBrace,    // }
  LBracket,  // [
  RBracket,  // ]
  LParen,    // (
  RParen,    // )

  // Structural
  Newline,
  Eof,
}

// ── Token interface ────────────────────────────────────────────────

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
  /** True on Newline tokens that follow a comment on the preceding line. */
  afterComment?: boolean;
}

// ── Keyword map (§2.5) ────────────────────────────────────────────

export const KEYWORDS: Record<string, TokenType> = {
  true: TokenType.True,
  false: TokenType.False,
  null: TokenType.Null,
  inf: TokenType.Inf,
  nan: TokenType.Nan,
  undefined: TokenType.Undefined,
  is: TokenType.Is,
  are: TokenType.Are,
  from: TokenType.From,
  called: TokenType.Called,
  as: TokenType.As,
  named: TokenType.Named,
  with: TokenType.With,
  union: TokenType.Union,
  plus: TokenType.PlusKw,
  type: TokenType.Type,
  to: TokenType.To,
  of: TokenType.Of,
  and: TokenType.And,
  or: TokenType.Or,
  not: TokenType.Not,
  if: TokenType.If,
  then: TokenType.Then,
  else: TokenType.Else,
  case: TokenType.Case,
  when: TokenType.When,
  env: TokenType.Env,
  struct: TokenType.Struct,
  in: TokenType.In,
  function: TokenType.Function,
  returns: TokenType.Returns,
  default: TokenType.Default,
};

/** Reserved words that are not yet keywords (§2.5). */
export const RESERVED_KEYWORDS = new Set(["lazy"]);

/**
 * Characters that unconditionally terminate an identifier token (§2.3).
 */
export const TOKEN_BOUNDARY_CHARS = new Set([
  "{", "}", "[", "]", "(", ")", ",", ".", '"', "'", "@",
  "+", "-", "*", "/", "%", "^", "<", ">", "=", "!",
  "?", ":", ";", "|", "&", "$", "~", "#", "\\",
]);

// ── Helpers ────────────────────────────────────────────────────────

/** Token types that can appear as the *last* token of a value expression. */
const VALUE_TOKEN_TYPES = new Set([
  TokenType.Integer, TokenType.Float, TokenType.String,
  TokenType.True, TokenType.False, TokenType.Null,
  TokenType.Inf, TokenType.Nan, TokenType.Undefined,
  TokenType.Identifier, TokenType.Env,
  TokenType.RParen, TokenType.RBracket, TokenType.RBrace,
]);

/** Whether `type` can be the trailing token of a value-producing expression. */
export function isValueToken(type: TokenType): boolean {
  return VALUE_TOKEN_TYPES.has(type);
}
