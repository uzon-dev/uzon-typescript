// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { TokenType } from "../src/token.js";

/** Helper: return just the token types. */
function types(src: string): TokenType[] {
  return new Lexer(src).tokenize().map((t) => t.type);
}

describe("Lexer", () => {
  // ── Basic tokens ────────────────────────────────────────────

  describe("basic tokens", () => {
    it("empty input produces only Eof", () => {
      expect(types("")).toEqual([TokenType.Eof]);
    });

    it("simple binding: x is 42", () => {
      expect(types("x is 42")).toEqual([
        TokenType.Identifier, TokenType.Is, TokenType.Integer, TokenType.Eof,
      ]);
    });

    it("arithmetic operators", () => {
      expect(types("+ - * / % ^")).toEqual([
        TokenType.Plus, TokenType.Minus, TokenType.Star,
        TokenType.Slash, TokenType.Percent, TokenType.Caret,
        TokenType.Eof,
      ]);
    });

    it("two-char operators: ++ ** <= >=", () => {
      expect(types("++ ** <= >=")).toEqual([
        TokenType.PlusPlus, TokenType.StarStar,
        TokenType.Le, TokenType.Ge,
        TokenType.Eof,
      ]);
    });

    it("delimiters", () => {
      expect(types("{ } [ ] ( ) , .")).toEqual([
        TokenType.LBrace, TokenType.RBrace,
        TokenType.LBracket, TokenType.RBracket,
        TokenType.LParen, TokenType.RParen,
        TokenType.Comma, TokenType.Dot,
        TokenType.Eof,
      ]);
    });
  });

  // ── Keywords (§2.5) ─────────────────────────────────────────

  describe("keywords", () => {
    it("recognizes all active keywords", () => {
      const src = "is are from called as named with union extends to of and or not if then else case when self env struct in function returns default";
      const toks = new Lexer(src).tokenize();
      const kwTypes = toks.slice(0, -1).map((t) => t.type);
      expect(kwTypes).toEqual([
        TokenType.Is, TokenType.Are, TokenType.From, TokenType.Called,
        TokenType.As, TokenType.Named, TokenType.With, TokenType.Union,
        TokenType.Extends, TokenType.To, TokenType.Of, TokenType.And,
        TokenType.Or, TokenType.Not, TokenType.If, TokenType.Then,
        TokenType.Else, TokenType.Case, TokenType.When, TokenType.Self,
        TokenType.Env, TokenType.Struct, TokenType.In, TokenType.Function,
        TokenType.Returns, TokenType.Default,
      ]);
    });

    it("rejects reserved keywords as identifiers", () => {
      expect(() => new Lexer("lazy is 5").tokenize()).toThrow("reserved keyword");
      expect(() => new Lexer("type is 5").tokenize()).toThrow("reserved keyword");
    });
  });

  // ── Composite operators ─────────────────────────────────────

  describe("composite operators", () => {
    it("or else", () => {
      expect(types("x or else y")).toEqual([
        TokenType.Identifier, TokenType.OrElse, TokenType.Identifier, TokenType.Eof,
      ]);
    });

    it("is not", () => {
      expect(types("x is not y")).toEqual([
        TokenType.Identifier, TokenType.IsNot, TokenType.Identifier, TokenType.Eof,
      ]);
    });

    it("is named", () => {
      expect(types("x is named ok")).toEqual([
        TokenType.Identifier, TokenType.IsNamed, TokenType.Identifier, TokenType.Eof,
      ]);
    });

    it("is not named", () => {
      expect(types("x is not named ok")).toEqual([
        TokenType.Identifier, TokenType.IsNotNamed, TokenType.Identifier, TokenType.Eof,
      ]);
    });

    it("or without else is just Or", () => {
      expect(types("a or b")).toEqual([
        TokenType.Identifier, TokenType.Or, TokenType.Identifier, TokenType.Eof,
      ]);
    });
  });

  // ── Literals (§4) ──────────────────────────────────────────

  describe("literals", () => {
    it("true, false, null, undefined", () => {
      expect(types("true false null undefined")).toEqual([
        TokenType.True, TokenType.False, TokenType.Null, TokenType.Undefined, TokenType.Eof,
      ]);
    });

    it("inf, nan", () => {
      expect(types("inf nan")).toEqual([
        TokenType.Inf, TokenType.Nan, TokenType.Eof,
      ]);
    });

    it("-inf as single token", () => {
      const toks = new Lexer("-inf").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Inf, value: "-inf" });
    });

    it("-nan as single token when not after value", () => {
      const toks = new Lexer("-nan").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Nan, value: "-nan" });
    });

    it("-nan after value token is binary minus + nan", () => {
      const toks = new Lexer("3 - nan").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Integer, value: "3" });
      expect(toks[1]).toMatchObject({ type: TokenType.Minus });
      expect(toks[2]).toMatchObject({ type: TokenType.Nan, value: "nan" });
    });

    it("-inf after value token is binary minus + inf", () => {
      const toks = new Lexer("3 - inf").tokenize();
      expect(toks[1]).toMatchObject({ type: TokenType.Minus });
      expect(toks[2]).toMatchObject({ type: TokenType.Inf, value: "inf" });
    });
  });

  // ── Numbers (§4.2, §4.3) ──────────────────────────────────

  describe("numbers", () => {
    it("decimal integer", () => {
      const toks = new Lexer("42").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Integer, value: "42" });
    });

    it("negative integer after is", () => {
      const toks = new Lexer("x is -7").tokenize();
      expect(toks[2]).toMatchObject({ type: TokenType.Integer, value: "-7" });
    });

    it("hex integer 0xff", () => {
      const toks = new Lexer("0xff").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Integer, value: "0xff" });
    });

    it("octal integer 0o77", () => {
      const toks = new Lexer("0o77").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Integer, value: "0o77" });
    });

    it("binary integer 0b1010", () => {
      const toks = new Lexer("0b1010").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Integer, value: "0b1010" });
    });

    it("underscore separators: 1_000_000", () => {
      const toks = new Lexer("1_000_000").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Integer, value: "1_000_000" });
    });

    it("double underscore is treated as identifier", () => {
      const toks = new Lexer("1__000").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "1__000" });
    });

    it("trailing underscore is treated as identifier", () => {
      const toks = new Lexer("42_").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier });
    });

    it("float: 3.14", () => {
      const toks = new Lexer("3.14").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Float, value: "3.14" });
    });

    it("float with exponent: 1.0e10", () => {
      const toks = new Lexer("1.0e10").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Float, value: "1.0e10" });
    });

    it("float with negative exponent: 2.5E-3", () => {
      const toks = new Lexer("2.5E-3").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Float, value: "2.5E-3" });
    });

    it("identifier starting with digit: 1st", () => {
      const toks = new Lexer("1st").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "1st" });
    });

    it("0xZZ is treated as identifier", () => {
      const toks = new Lexer("0xZZ").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "0xZZ" });
    });

    it("minus as subtraction after value: 3 - 5", () => {
      expect(types("3 - 5")).toEqual([
        TokenType.Integer, TokenType.Minus, TokenType.Integer, TokenType.Eof,
      ]);
    });
  });

  // ── Strings (§4.4) ────────────────────────────────────────

  describe("strings", () => {
    it("simple string", () => {
      const toks = new Lexer('"hello"').tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.String, value: "hello" });
    });

    it("escape sequences: \\n \\t", () => {
      const toks = new Lexer('"a\\nb\\t"').tokenize();
      expect(toks[0].value).toBe("a\nb\t");
    });

    it("null escape: \\0", () => {
      const toks = new Lexer('"a\\0b"').tokenize();
      expect(toks[0].value).toBe("a\0b");
    });

    it("unicode escape: \\u{1F600}", () => {
      const toks = new Lexer('"\\u{1F600}"').tokenize();
      expect(toks[0].value).toBe("\u{1F600}");
    });

    it("hex escape: \\x41 → A", () => {
      const toks = new Lexer('"\\x41"').tokenize();
      expect(toks[0].value).toBe("A");
    });

    it("hex escape out of range: \\x80", () => {
      expect(() => new Lexer('"\\x80"').tokenize()).toThrow("0x00-0x7F");
    });

    it("escaped brace suppresses interpolation", () => {
      const toks = new Lexer('"\\{not interpolation}"').tokenize();
      expect(toks[0].value).toBe("{not interpolation}");
    });

    it("rejects control characters in strings", () => {
      expect(() => new Lexer('"\x01"').tokenize()).toThrow("Control character");
    });

    it("rejects surrogate code points", () => {
      expect(() => new Lexer('"\\u{D800}"').tokenize()).toThrow("Surrogate");
    });

    it("unterminated string", () => {
      expect(() => new Lexer('"hello').tokenize()).toThrow("Unterminated");
    });
  });

  // ── String interpolation ────────────────────────────────────

  describe("string interpolation", () => {
    it("simple interpolation: {self.name}", () => {
      const toks = new Lexer('"hello {self.name}"').tokenize();
      const nonEof = toks.filter((t) => t.type !== TokenType.Eof);
      expect(nonEof.map((t) => t.type)).toEqual([
        TokenType.String,
        TokenType.Self, TokenType.Dot, TokenType.Identifier,
        TokenType.String,
      ]);
      expect(nonEof[0].value).toBe("hello ");
    });

    it("interpolation with arithmetic expression", () => {
      const toks = new Lexer('"{self.a + self.b}"').tokenize();
      const nonEof = toks.filter((t) => t.type !== TokenType.Eof);
      expect(nonEof.map((t) => t.type)).toEqual([
        TokenType.String,
        TokenType.Self, TokenType.Dot, TokenType.Identifier,
        TokenType.Plus,
        TokenType.Self, TokenType.Dot, TokenType.Identifier,
        TokenType.String,
      ]);
    });

    it("nested braces inside interpolation", () => {
      const toks = new Lexer('"val: {self.fn({x is 1})}"').tokenize();
      const nonEof = toks.filter((t) => t.type !== TokenType.Eof);
      expect(nonEof[0].type).toBe(TokenType.String);
      expect(nonEof[nonEof.length - 1].type).toBe(TokenType.String);
    });
  });

  // ── Identifiers (§2.3) ────────────────────────────────────

  describe("identifiers", () => {
    it("unicode identifiers", () => {
      const toks = new Lexer("안녕 is 1").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "안녕" });
    });

    it("emoji identifiers", () => {
      const toks = new Lexer("🚀 is 42").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "🚀" });
    });

    it("keyword escape with @", () => {
      const toks = new Lexer("@is is 3").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "is" });
      expect(toks[1]).toMatchObject({ type: TokenType.Is });
    });

    it("@ on non-keyword is error", () => {
      expect(() => new Lexer("@foo").tokenize()).toThrow("not a keyword");
    });

    it("quoted identifier with special chars", () => {
      const toks = new Lexer("'Content-Type' is 1").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "Content-Type" });
    });

    it("quoted identifier with spaces", () => {
      const toks = new Lexer("'this is a key' is 1").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "this is a key" });
    });

    it("rejects quoted keyword", () => {
      expect(() => new Lexer("'is' is 5").tokenize()).toThrow("keyword");
    });
  });

  // ── Comments (§2.2) ────────────────────────────────────────

  describe("comments", () => {
    it("line comment is stripped", () => {
      expect(types("x is 42 // comment")).toEqual([
        TokenType.Identifier, TokenType.Is, TokenType.Integer, TokenType.Eof,
      ]);
    });

    it("comment preserves newline boundary", () => {
      const toks = new Lexer("x is 1\n// comment\ny is 2").tokenize();
      expect(toks.map((t) => t.type)).toContain(TokenType.Newline);
    });

    it("newline after comment has afterComment flag", () => {
      const toks = new Lexer("x is 1 // comment\ny is 2").tokenize();
      const nl = toks.find((t) => t.type === TokenType.Newline);
      expect(nl?.afterComment).toBe(true);
    });
  });

  // ── Newlines (§8) ──────────────────────────────────────────

  describe("newlines", () => {
    it("emits newline tokens between bindings", () => {
      expect(types("x is 1\ny is 2")).toEqual([
        TokenType.Identifier, TokenType.Is, TokenType.Integer,
        TokenType.Newline,
        TokenType.Identifier, TokenType.Is, TokenType.Integer,
        TokenType.Eof,
      ]);
    });

    it("CRLF is a single newline", () => {
      const toks = new Lexer("a\r\nb").tokenize();
      const nl = toks.find((t) => t.type === TokenType.Newline);
      expect(nl?.value).toBe("\r\n");
    });
  });

  // ── Source location tracking ────────────────────────────────

  describe("line/col tracking", () => {
    it("tracks line and column correctly", () => {
      const toks = new Lexer("x is 1\ny is 2").tokenize();
      expect(toks[0]).toMatchObject({ line: 1, col: 1 }); // x
      expect(toks[4]).toMatchObject({ line: 2, col: 1 }); // y
    });
  });

  // ── BOM handling (§2.1) ────────────────────────────────────

  describe("BOM handling", () => {
    it("strips UTF-8 BOM", () => {
      const toks = new Lexer("\uFEFFx is 1").tokenize();
      expect(toks[0]).toMatchObject({ type: TokenType.Identifier, value: "x" });
    });
  });
});
