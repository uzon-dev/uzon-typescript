// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * UZON lexer — converts source text into a flat token stream.
 *
 * The lexer operates in three modes:
 *   - Normal: keywords, identifiers, numbers, operators, delimiters
 *   - String: accumulates string content until closing `"`
 *   - Interpolation: normal mode entered via `{` inside a string
 *
 * Key spec references:
 *   - Encoding & BOM: §2.1
 *   - Comments: §2.2
 *   - Identifiers & boundary chars: §2.3
 *   - Keyword escaping (`@`): §2.4
 *   - Keywords & reserved words: §2.5
 *   - String literals & escape sequences: §4.4
 *   - Numeric literals: §4.2, §4.3
 *   - Composite operators: §9 lexer rules
 */

import {
  TokenType,
  Token,
  KEYWORDS,
  RESERVED_KEYWORDS,
  TOKEN_BOUNDARY_CHARS,
  isValueToken,
} from "./token.js";
import { UzonSyntaxError } from "./error.js";

/** Value-literal keywords that deserve a "did you mean" hint on case mismatch. */
const CASE_HINT_KEYWORDS = new Set(["true", "false", "null", "inf", "nan", "undefined"]);

const enum Mode {
  Normal,
  String,
  Interpolation,
}

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];
  private modeStack: Mode[] = [Mode.Normal];
  private braceDepth: number[] = [];
  /** §4.4.1: token count snapshot when each interpolation opened — used to
   * detect empty interpolations `{}` (no tokens between `{` and `}`). */
  private interpOpenTokenCount: number[] = [];
  /** §4.4.1: line/col of each opening `{` for empty-interpolation error reporting. */
  private interpOpenPos: { line: number; col: number }[] = [];
  /** §4.4.2: track whether last consumed content was a comment. */
  private lastWasComment = false;

  constructor(src: string) {
    // §2.1: Strip BOM if present
    this.src = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  }

  /** Tokenize the full source and return the token array. */
  tokenize(): Token[] {
    while (this.pos < this.src.length) {
      const mode = this.modeStack[this.modeStack.length - 1];
      if (mode === Mode.String) {
        this.lexStringContent();
      } else {
        this.lexNormal();
      }
    }
    this.push(TokenType.Eof, "", this.line, this.col);
    return this.tokens;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private ch(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  private advance(n = 1): string {
    const slice = this.src.slice(this.pos, this.pos + n);
    for (let i = 0; i < n; i++) {
      const code = this.src.charCodeAt(this.pos + i);
      if (this.src[this.pos + i] === "\n") {
        this.line++;
        this.col = 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        // §11.2: Low surrogate of a surrogate pair — already counted
        // col for the high surrogate, so skip.
      } else {
        this.col++;
      }
    }
    this.pos += n;
    return slice;
  }

  private push(type: TokenType, value: string, line: number, col: number) {
    this.tokens.push({ type, value, line, col });
  }

  private error(msg: string, line?: number, col?: number): never {
    throw new UzonSyntaxError(msg, line ?? this.line, col ?? this.col);
  }

  /** Return the most recent non-newline token type, or null. */
  private lastTokenType(): TokenType | null {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      if (this.tokens[i].type !== TokenType.Newline) return this.tokens[i].type;
    }
    return null;
  }

  // ── Normal mode ────────────────────────────────────────────────

  private lexNormal() {
    this.skipWhitespace();
    if (this.pos >= this.src.length) return;

    const c = this.ch();
    const line = this.line;
    const col = this.col;

    if (this.tryLexNewline(c, line, col)) return;
    if (this.tryLexInterpolationString(c, line, col)) return;
    if (this.tryLexStringStart(c, line, col)) return;
    if (this.tryLexInterpolationClose(c)) return;
    if (this.tryLexTwoCharOp(c, line, col)) return;
    if (this.tryLexSingleCharOp(c, line, col)) return;
    if (this.tryLexMinus(c, line, col)) return;
    if (this.tryLexAtEscape(c, line, col)) return;
    if (c === "'") { this.lexQuotedIdentifier(line, col); return; }
    if (c >= "0" && c <= "9") { this.lexNumber(line, col, false); return; }
    if (!this.isWhitespace(c) && !TOKEN_BOUNDARY_CHARS.has(c)) {
      this.lexIdentifierOrKeyword(line, col);
      return;
    }
    this.error(`Unexpected character: '${c}'`);
  }

  // ── Newlines (§8) ──

  private tryLexNewline(c: string, line: number, col: number): boolean {
    if (c !== "\n" && !(c === "\r" && this.ch(1) === "\n")) return false;
    const val = c === "\r" ? "\r\n" : "\n";
    this.advance(val.length);
    const tok: Token = { type: TokenType.Newline, value: val, line, col };
    if (this.lastWasComment) {
      tok.afterComment = true;
      this.lastWasComment = false;
    }
    this.tokens.push(tok);
    return true;
  }

  // ── String literal start (§4.4) ──

  private tryLexStringStart(c: string, _line: number, col: number): boolean {
    if (c !== '"') return false;
    this.advance();
    this.modeStack.push(Mode.String);
    this.push(TokenType.String, "", this.line, col);
    return true;
  }

  // ── Escaped string inside interpolation: \"content\" ──

  private tryLexInterpolationString(c: string, line: number, col: number): boolean {
    if (
      c !== "\\" || this.pos + 1 >= this.src.length || this.ch(1) !== '"' ||
      this.modeStack[this.modeStack.length - 1] !== Mode.Interpolation
    ) return false;

    this.advance(); // consume backslash
    this.advance(); // consume opening "
    let content = "";
    while (this.pos < this.src.length) {
      const sc = this.ch();
      if (sc === "\\" && this.pos + 1 < this.src.length && this.ch(1) === '"') {
        this.advance(); // consume backslash
        this.advance(); // consume closing "
        this.push(TokenType.String, content, line, col);
        return true;
      }
      if (sc === "\\") { content += this.lexEscape(); continue; }
      if (sc === "\n" || sc === "\r") this.error("Unterminated string literal");
      content += this.advance();
    }
    this.error("Unterminated escaped string in interpolation");
  }

  // ── Interpolation closing brace ──

  private tryLexInterpolationClose(c: string): boolean {
    if (c !== "}" || this.modeStack[this.modeStack.length - 1] !== Mode.Interpolation) return false;
    const depth = this.braceDepth[this.braceDepth.length - 1];
    if (depth !== 0) return false;
    // §4.4.1: an interpolation must contain an expression. If no non-newline
    // tokens were emitted between the opening `{` and this `}`, reject it.
    const openCount = this.interpOpenTokenCount[this.interpOpenTokenCount.length - 1];
    let hasContent = false;
    for (let i = openCount; i < this.tokens.length; i++) {
      if (this.tokens[i].type !== TokenType.Newline) { hasContent = true; break; }
    }
    if (!hasContent) {
      const pos = this.interpOpenPos[this.interpOpenPos.length - 1];
      this.error("Empty interpolation '{}' is not allowed — expression required", pos.line, pos.col);
    }
    this.advance();
    this.braceDepth.pop();
    this.modeStack.pop();
    this.interpOpenTokenCount.pop();
    this.interpOpenPos.pop();
    this.tokens.push({
      type: TokenType.String, value: "",
      line: this.line, col: this.col, isInterpCont: true,
    });
    return true;
  }

  // ── Two-character operators and comments ──

  private tryLexTwoCharOp(c: string, line: number, col: number): boolean {
    if (this.pos + 1 >= this.src.length) return false;
    const two = c + this.ch(1);
    if (two === "//") {
      while (this.pos < this.src.length && this.ch() !== "\n") this.advance();
      this.lastWasComment = true;
      return true;
    }
    if (two === "++") { this.advance(2); this.push(TokenType.PlusPlus, "++", line, col); return true; }
    if (two === "**") { this.advance(2); this.push(TokenType.StarStar, "**", line, col); return true; }
    if (two === "<=") { this.advance(2); this.push(TokenType.Le, "<=", line, col); return true; }
    if (two === ">=") { this.advance(2); this.push(TokenType.Ge, ">=", line, col); return true; }
    return false;
  }

  // ── Single-character operators and delimiters ──

  private tryLexSingleCharOp(c: string, line: number, col: number): boolean {
    switch (c) {
      case "{": this.advance(); this.push(TokenType.LBrace, "{", line, col); this.trackBrace(1); return true;
      case "}": this.advance(); this.push(TokenType.RBrace, "}", line, col); this.trackBrace(-1); return true;
      case "[": this.advance(); this.push(TokenType.LBracket, "[", line, col); return true;
      case "]": this.advance(); this.push(TokenType.RBracket, "]", line, col); return true;
      case "(": this.advance(); this.push(TokenType.LParen, "(", line, col); return true;
      case ")": this.advance(); this.push(TokenType.RParen, ")", line, col); return true;
      case ",": this.advance(); this.push(TokenType.Comma, ",", line, col); return true;
      case ".": this.advance(); this.push(TokenType.Dot, ".", line, col); return true;
      case "+": this.advance(); this.push(TokenType.Plus, "+", line, col); return true;
      case "*": this.advance(); this.push(TokenType.Star, "*", line, col); return true;
      case "/": this.advance(); this.push(TokenType.Slash, "/", line, col); return true;
      case "%": this.advance(); this.push(TokenType.Percent, "%", line, col); return true;
      case "^": this.advance(); this.push(TokenType.Caret, "^", line, col); return true;
      case "<": this.advance(); this.push(TokenType.Lt, "<", line, col); return true;
      case ">": this.advance(); this.push(TokenType.Gt, ">", line, col); return true;
    }
    return false;
  }

  // ── Minus: context-sensitive (§4.2, §5.3) ──

  private tryLexMinus(c: string, line: number, col: number): boolean {
    if (c !== "-") return false;
    const prev = this.lastTokenType();
    // After a value token, minus is binary subtraction
    if (prev !== null && isValueToken(prev)) {
      this.advance(); this.push(TokenType.Minus, "-", line, col); return true;
    }
    // Before a digit, minus is part of a negative number literal
    if (this.ch(1) >= "0" && this.ch(1) <= "9") {
      this.lexNumber(line, col, true); return true;
    }
    // -inf as single token
    if (this.src.slice(this.pos + 1, this.pos + 4) === "inf") {
      const after = this.src[this.pos + 4] ?? "";
      if (after === "" || /\s/.test(after) || TOKEN_BOUNDARY_CHARS.has(after)) {
        this.advance(4); this.push(TokenType.Inf, "-inf", line, col); return true;
      }
    }
    // -nan as single token
    if (this.src.slice(this.pos + 1, this.pos + 4) === "nan") {
      const after = this.src[this.pos + 4] ?? "";
      if (after === "" || /\s/.test(after) || TOKEN_BOUNDARY_CHARS.has(after)) {
        this.advance(4); this.push(TokenType.Nan, "-nan", line, col); return true;
      }
    }
    // Otherwise, minus is unary negation operator
    this.advance(); this.push(TokenType.Minus, "-", line, col); return true;
  }

  // ── @keyword escape (§2.4) ──

  private tryLexAtEscape(c: string, line: number, col: number): boolean {
    if (c !== "@") return false;
    this.advance();
    const idLine = this.line;
    const idCol = this.col;
    const word = this.readRawIdentifier();
    if (!word) this.error("Expected identifier after @", idLine, idCol);
    if (!(word in KEYWORDS) && !RESERVED_KEYWORDS.has(word)) {
      this.error(`'${word}' is not a keyword — @ escape is unnecessary`, idLine, idCol);
    }
    this.push(TokenType.Identifier, word, line, col);
    return true;
  }

  /**
   * Track brace depth for interpolation. When the depth drops below 0,
   * we've closed the interpolation and return to String mode.
   */
  private trackBrace(delta: number) {
    if (this.braceDepth.length > 0) {
      this.braceDepth[this.braceDepth.length - 1] += delta;
      if (this.braceDepth[this.braceDepth.length - 1] < 0) {
        this.braceDepth.pop();
        this.modeStack.pop();
        // Remove the RBrace token — it's the interpolation end, not a real brace
        this.tokens.pop();
        this.push(TokenType.String, "", this.line, this.col);
      }
    }
  }

  /** Skip horizontal whitespace (spaces and tabs). Newlines are tokens. */
  private skipWhitespace() {
    while (this.pos < this.src.length) {
      const c = this.ch();
      if (c === " " || c === "\t") {
        this.advance();
      } else if (c === "\r" && this.ch(1) !== "\n") {
        this.advance(); // bare CR
      } else {
        break;
      }
    }
  }

  // ── String mode (§4.4) ────────────────────────────────────────

  private lexStringContent() {
    const parts: string[] = [];
    let buf = "";

    while (this.pos < this.src.length) {
      const c = this.ch();

      // End of string
      if (c === '"') {
        if (buf) parts.push(buf);
        this.advance();
        const tok = this.findLastStringToken();
        tok.value = parts.join("");
        this.modeStack.pop();
        return;
      }

      // Escape sequence (§4.4)
      if (c === "\\") {
        buf += this.lexEscape();
        continue;
      }

      // Interpolation start: `{expr}` inside string
      if (c === "{") {
        if (buf) parts.push(buf);
        buf = "";
        const tok = this.findLastStringToken();
        tok.value = parts.join("");
        parts.length = 0;

        const openLine = this.line;
        const openCol = this.col;
        this.advance();
        this.modeStack.push(Mode.Interpolation);
        this.braceDepth.push(0);
        this.interpOpenTokenCount.push(this.tokens.length);
        this.interpOpenPos.push({ line: openLine, col: openCol });
        return;
      }

      // §4.4: newlines inside string are an error
      if (c === "\n" || c === "\r") {
        this.error("Unterminated string literal");
      }

      // §4.4: reject control characters U+0000–U+001F
      const code = c.charCodeAt(0);
      if (code <= 0x1f) {
        this.error(
          `Control character U+${code.toString(16).padStart(4, "0").toUpperCase()} is not allowed in strings — use an escape sequence`,
        );
      }

      buf += this.advance();
    }

    this.error("Unterminated string literal");
  }

  /** Walk backwards through the token array to find the most recent String token. */
  private findLastStringToken(): Token {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      if (this.tokens[i].type === TokenType.String) return this.tokens[i];
    }
    this.error("Internal: no string token found");
  }

  /**
   * Parse a single escape sequence (§4.4).
   * Supports: \\ \" \n \r \t \0 \{ \xHH \u{HHHHHH}
   */
  private lexEscape(): string {
    const line = this.line;
    const col = this.col;
    this.advance(); // consume backslash
    const c = this.ch();
    switch (c) {
      case '"':  this.advance(); return '"';
      case "\\": this.advance(); return "\\";
      case "n":  this.advance(); return "\n";
      case "r":  this.advance(); return "\r";
      case "t":  this.advance(); return "\t";
      case "0":  this.advance(); return "\0";
      case "{":  this.advance(); return "{"; // suppress interpolation
      case "x": {
        // §4.4: \xHH — byte value 0x00–0x7F
        this.advance();
        const h1 = this.advance();
        const h2 = this.advance();
        const code = parseInt(h1 + h2, 16);
        if (isNaN(code)) this.error("Invalid \\x escape", line, col);
        if (code > 0x7f) this.error("\\x escape must be in range 0x00-0x7F", line, col);
        return String.fromCharCode(code);
      }
      case "u": {
        // §4.4: \u{HHHHHH} — Unicode scalar value
        this.advance();
        if (this.ch() !== "{") this.error("Expected '{' after \\u", line, col);
        this.advance();
        let hex = "";
        while (this.ch() !== "}" && this.pos < this.src.length) {
          hex += this.advance();
        }
        if (this.ch() !== "}") this.error("Unterminated \\u{...} escape", line, col);
        this.advance();
        if (hex.length < 1 || hex.length > 6) {
          this.error("\\u{...} must have 1-6 hex digits", line, col);
        }
        const code = parseInt(hex, 16);
        if (isNaN(code) || code > 0x10ffff) {
          this.error("Invalid Unicode scalar value", line, col);
        }
        // §4.4: surrogates not allowed
        if (code >= 0xd800 && code <= 0xdfff) {
          this.error("Surrogate code points are not allowed", line, col);
        }
        return String.fromCodePoint(code);
      }
      default:
        this.error(`Invalid escape sequence: \\${c}`, line, col);
    }
  }

  // ── Numbers (§4.2, §4.3) ──────────────────────────────────────

  private lexNumber(line: number, col: number, negative: boolean) {
    const start = this.pos;
    if (negative) this.advance(); // consume -

    // §4.2: hex (0x), octal (0o), binary (0b) prefix
    if (this.ch() === "0" && this.pos + 1 < this.src.length) {
      const next = this.ch(1).toLowerCase();
      if (next === "x" || next === "o" || next === "b") {
        this.lexPrefixedInteger(start, next, line, col);
        return;
      }
    }

    this.lexDecimalNumber(start, line, col);
  }

  /** §4.2: hex, octal, binary integer literals. */
  private lexPrefixedInteger(start: number, base: string, line: number, col: number) {
    this.advance(2);
    if (this.pos < this.src.length && this.ch() === "_") {
      this.lexIdentifierFrom(start, line, col);
      return;
    }
    this.consumeDigits(base === "x" ? "hex" : base === "o" ? "oct" : "bin");
    if (!this.validateNumberToken(start, line, col)) return;
    this.push(TokenType.Integer, this.src.slice(start, this.pos), line, col);
  }

  /** §4.2/§4.3: decimal integer or float literal. */
  private lexDecimalNumber(start: number, line: number, col: number) {
    let isFloat = false;
    this.consumeDigits("dec");

    // Decimal point — requires digit after the dot to avoid ambiguity with member access
    if (this.ch() === "." && this.ch(1) >= "0" && this.ch(1) <= "9") {
      isFloat = true;
      this.advance();
      this.consumeDigits("dec");
    }

    // Exponent part (e/E)
    if (this.ch().toLowerCase() === "e") {
      isFloat = true;
      this.advance();
      if (this.ch() === "+" || this.ch() === "-") this.advance();
      if (this.pos >= this.src.length || !(this.ch() >= "0" && this.ch() <= "9")) {
        this.lexIdentifierFrom(start, line, col);
        return;
      }
      this.consumeDigits("dec");
    }

    if (!this.validateNumberToken(start, line, col)) return;
    this.push(isFloat ? TokenType.Float : TokenType.Integer, this.src.slice(start, this.pos), line, col);
  }

  /** Validate the consumed number token: trailing underscore, double underscore, token end. */
  private validateNumberToken(start: number, line: number, col: number): boolean {
    if (!this.atTokenEnd()) {
      this.lexIdentifierFrom(start, line, col);
      return false;
    }
    if (this.src[this.pos - 1] === "_") {
      this.lexIdentifierFrom(start, line, col);
      return false;
    }
    if (this.src.slice(start, this.pos).includes("__")) {
      this.lexIdentifierFrom(start, line, col);
      return false;
    }
    return true;
  }

  /** Consume digits (with underscore separators) for the given numeric base. */
  private consumeDigits(base: "dec" | "hex" | "oct" | "bin") {
    const check =
      base === "hex" ? (c: string) => /[0-9a-fA-F_]/.test(c) :
      base === "oct" ? (c: string) => /[0-7_]/.test(c) :
      base === "bin" ? (c: string) => c === "0" || c === "1" || c === "_" :
      (c: string) => /[0-9_]/.test(c);

    while (this.pos < this.src.length && check(this.ch())) {
      this.advance();
    }
  }

  /** Whether the current position is at a token boundary. */
  private atTokenEnd(): boolean {
    if (this.pos >= this.src.length) return true;
    const c = this.ch();
    return this.isWhitespace(c) || TOKEN_BOUNDARY_CHARS.has(c);
  }

  /**
   * When a numeric-looking sequence turns out to be an identifier (e.g. "1st"),
   * continue consuming to the end of the identifier.
   */
  private lexIdentifierFrom(start: number, line: number, col: number) {
    while (
      this.pos < this.src.length &&
      !this.isWhitespace(this.ch()) &&
      !TOKEN_BOUNDARY_CHARS.has(this.ch())
    ) {
      this.advance();
    }
    const word = this.src.slice(start, this.pos);
    this.push(TokenType.Identifier, word, line, col);
  }

  // ── Identifiers and keywords (§2.3, §2.5) ────────────────────

  /** Read a raw identifier (no keyword resolution). */
  private readRawIdentifier(): string {
    let word = "";
    while (
      this.pos < this.src.length &&
      !this.isWhitespace(this.ch()) &&
      !TOKEN_BOUNDARY_CHARS.has(this.ch())
    ) {
      word += this.advance();
    }
    return word;
  }

  private lexIdentifierOrKeyword(line: number, col: number) {
    const word = this.readRawIdentifier();

    // §2.5: reserved keywords cannot be used as identifiers
    if (RESERVED_KEYWORDS.has(word)) {
      this.error(
        `'${word}' is a reserved keyword and cannot be used as an identifier. Use @${word} to escape it.`,
        line, col,
      );
    }

    if (word in KEYWORDS) {
      const kwType = KEYWORDS[word];

      // Composite operator lookahead: "or else", "is not", "is named", "is not named", "is type", "is not type"
      if (kwType === TokenType.Or) {
        if (this.tryComposite("else")) {
          this.push(TokenType.OrElse, "or else", line, col);
          return;
        }
      }
      if (kwType === TokenType.Is) {
        if (this.tryComposite("not")) {
          if (this.tryComposite("named")) {
            this.push(TokenType.IsNotNamed, "is not named", line, col);
            return;
          }
          if (this.tryComposite("type")) {
            this.push(TokenType.IsNotType, "is not type", line, col);
            return;
          }
          this.push(TokenType.IsNot, "is not", line, col);
          return;
        }
        if (this.tryComposite("named")) {
          this.push(TokenType.IsNamed, "is named", line, col);
          return;
        }
        if (this.tryComposite("type")) {
          this.push(TokenType.IsType, "is type", line, col);
          return;
        }
      }

      this.push(kwType, word, line, col);
      return;
    }

    const lower = word.toLowerCase();
    if (lower !== word && CASE_HINT_KEYWORDS.has(lower)) {
      this.error(`'${word}' is not a keyword — did you mean '${lower}'?`, line, col);
    }
    this.push(TokenType.Identifier, word, line, col);
  }

  /**
   * Attempt to consume the next word if it matches `expected`.
   * Skips whitespace (including newlines) and comments (§8, §9).
   * Restores position on failure.
   */
  private tryComposite(expected: string): boolean {
    const savedPos = this.pos;
    const savedLine = this.line;
    const savedCol = this.col;

    // Skip whitespace (horizontal + newlines) and comments
    let p = this.pos;
    while (p < this.src.length) {
      const c = this.src[p];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        p++;
      } else if (c === "/" && this.src[p + 1] === "/") {
        p += 2;
        while (p < this.src.length && this.src[p] !== "\n") p++;
      } else {
        break;
      }
    }

    // Read next word
    let end = p;
    while (end < this.src.length && !this.isWhitespaceOrBoundary(this.src[end])) end++;

    if (this.src.slice(p, end) === expected) {
      while (this.pos < end) this.advance();
      return true;
    }

    // Restore on failure
    this.pos = savedPos;
    this.line = savedLine;
    this.col = savedCol;
    return false;
  }

  /** §2.3: Quoted identifier — `'name with spaces'` */
  private lexQuotedIdentifier(line: number, col: number) {
    this.advance(); // consume opening '
    let name = "";
    while (this.pos < this.src.length) {
      const c = this.ch();
      if (c === "'") {
        this.advance(); // consume closing '
        if (name in KEYWORDS) {
          this.error(
            `'${name}' is a keyword — use @${name} to escape it as an identifier`,
            line, col,
          );
        }
        if (RESERVED_KEYWORDS.has(name)) {
          this.error(
            `'${name}' is a reserved keyword — use @${name} to escape it`,
            line, col,
          );
        }
        this.push(TokenType.Identifier, name, line, col);
        return;
      }
      if (c === "\n" || c === "\r") {
        this.error("Unterminated quoted identifier", line, col);
      }
      name += this.advance();
    }
    this.error("Unterminated quoted identifier", line, col);
  }

  // ── Utilities ──────────────────────────────────────────────────

  private isWhitespace(c: string): boolean {
    return c === " " || c === "\t" || c === "\n" || c === "\r";
  }

  private isWhitespaceOrBoundary(c: string): boolean {
    return this.isWhitespace(c) || TOKEN_BOUNDARY_CHARS.has(c);
  }
}
