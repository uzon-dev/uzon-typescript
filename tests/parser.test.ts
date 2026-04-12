// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import type { AstNode, BindingNode, DocumentNode } from "../src/ast.js";

function parse(src: string): DocumentNode {
  return new Parser(new Lexer(src).tokenize()).parse();
}

function firstBinding(src: string): BindingNode {
  return parse(src).bindings[0];
}

function firstValue(src: string): AstNode {
  return firstBinding(src).value;
}

describe("Parser", () => {
  // ── Basic bindings (§5.1) ──────────────────────────────────

  describe("basic bindings", () => {
    it("integer binding", () => {
      const b = firstBinding("x is 42");
      expect(b.name).toBe("x");
      expect(b.value).toMatchObject({ kind: "IntegerLiteral", value: "42" });
    });

    it("string binding", () => {
      expect(firstValue('name is "hello"')).toMatchObject({ kind: "StringLiteral" });
    });

    it("boolean bindings", () => {
      expect(firstValue("x is true")).toMatchObject({ kind: "BoolLiteral", value: true });
      expect(firstValue("x is false")).toMatchObject({ kind: "BoolLiteral", value: false });
    });

    it("null binding", () => {
      expect(firstValue("x is null")).toMatchObject({ kind: "NullLiteral" });
    });

    it("undefined literal", () => {
      expect(firstValue("x is undefined")).toMatchObject({ kind: "UndefinedLiteral" });
    });

    it("inf and nan literals", () => {
      expect(firstValue("x is inf")).toMatchObject({ kind: "InfLiteral", negative: false });
      expect(firstValue("x is -inf")).toMatchObject({ kind: "InfLiteral", negative: true });
      expect(firstValue("x is nan")).toMatchObject({ kind: "NanLiteral", negative: false });
      expect(firstValue("x is -nan")).toMatchObject({ kind: "NanLiteral", negative: true });
    });

    it("multiple newline-separated bindings", () => {
      const doc = parse("x is 1\ny is 2");
      expect(doc.bindings).toHaveLength(2);
      expect(doc.bindings[0].name).toBe("x");
      expect(doc.bindings[1].name).toBe("y");
    });

    it("comma-separated bindings", () => {
      const doc = parse("x is 1, y is 2");
      expect(doc.bindings).toHaveLength(2);
    });
  });

  // ── Struct literal (§3.2) ──────────────────────────────────

  describe("struct literal", () => {
    it("inline struct", () => {
      const v = firstValue('s is { name is "hi", port is 8080 }');
      expect(v.kind).toBe("StructLiteral");
      if (v.kind === "StructLiteral") {
        expect(v.fields).toHaveLength(2);
        expect(v.fields[0].name).toBe("name");
        expect(v.fields[1].name).toBe("port");
      }
    });

    it("multiline struct", () => {
      const v = firstValue('s is {\n  host is "localhost"\n  port is 8080\n}');
      expect(v.kind).toBe("StructLiteral");
    });
  });

  // ── List literal (§3.3) ────────────────────────────────────

  describe("list literal", () => {
    it("integer list", () => {
      const v = firstValue("x is [1, 2, 3]");
      expect(v.kind).toBe("ListLiteral");
      if (v.kind === "ListLiteral") expect(v.elements).toHaveLength(3);
    });

    it("empty list", () => {
      const v = firstValue("x is []");
      expect(v.kind).toBe("ListLiteral");
      if (v.kind === "ListLiteral") expect(v.elements).toHaveLength(0);
    });

    it("trailing comma", () => {
      const v = firstValue("x is [1, 2,]");
      expect(v.kind).toBe("ListLiteral");
      if (v.kind === "ListLiteral") expect(v.elements).toHaveLength(2);
    });
  });

  // ── Tuple and grouping (§3.4) ──────────────────────────────

  describe("tuple and grouping", () => {
    it("empty tuple", () => {
      expect(firstValue("x is ()")).toMatchObject({ kind: "TupleLiteral" });
    });

    it("grouping: (expr)", () => {
      expect(firstValue("x is (1 + 2)")).toMatchObject({ kind: "Grouping" });
    });

    it("1-tuple with trailing comma", () => {
      const v = firstValue("x is (1,)");
      expect(v.kind).toBe("TupleLiteral");
      if (v.kind === "TupleLiteral") expect(v.elements).toHaveLength(1);
    });

    it("multi-element tuple", () => {
      const v = firstValue('x is (1, "a", true)');
      expect(v.kind).toBe("TupleLiteral");
      if (v.kind === "TupleLiteral") expect(v.elements).toHaveLength(3);
    });
  });

  // ── are binding (§3.3) ────────────────────────────────────

  describe("are binding", () => {
    it("desugars to list", () => {
      const v = firstValue("names are 1, 2, 3");
      expect(v.kind).toBe("ListLiteral");
      if (v.kind === "ListLiteral") expect(v.elements).toHaveLength(3);
    });

    it("lifts trailing as to list level", () => {
      expect(firstValue("ids are 1, 2, 3 as [i32]")).toMatchObject({ kind: "TypeAnnotation" });
    });

    it("stops at new binding boundary", () => {
      const doc = parse("names are 1, 2, y is 3");
      expect(doc.bindings).toHaveLength(2);
      expect(doc.bindings[0].name).toBe("names");
      expect(doc.bindings[1].name).toBe("y");
    });
  });

  // ── Multiline strings (§4.4.2) ────────────────────────────

  describe("multiline strings", () => {
    it("adjacent lines join with newline", () => {
      const v = firstValue('x is "hello"\n"world"');
      expect(v.kind).toBe("StringLiteral");
      if (v.kind === "StringLiteral") {
        const text = v.parts.filter(p => typeof p === "string").join("");
        expect(text).toBe("hello\nworld");
      }
    });

    it("blank line between breaks sequence", () => {
      expect(() => parse('x is "hello"\n\n"world"')).toThrow();
    });

    it("comment between is an error", () => {
      expect(() => parse('x is "hello"\n// comment\n"world"')).toThrow();
    });
  });

  // ── Arithmetic (§5.3) ─────────────────────────────────────

  describe("arithmetic", () => {
    it("addition", () => {
      expect(firstValue("x is 1 + 2")).toMatchObject({ kind: "BinaryOp", op: "+" });
    });

    it("precedence: * before +", () => {
      const v = firstValue("x is 1 + 2 * 3");
      expect(v.kind).toBe("BinaryOp");
      if (v.kind === "BinaryOp") {
        expect(v.op).toBe("+");
        expect(v.right).toMatchObject({ kind: "BinaryOp", op: "*" });
      }
    });

    it("exponentiation is right-associative", () => {
      const v = firstValue("x is 2 ^ 3 ^ 2");
      expect(v.kind).toBe("BinaryOp");
      if (v.kind === "BinaryOp") {
        expect(v.op).toBe("^");
        expect(v.right).toMatchObject({ kind: "BinaryOp", op: "^" });
      }
    });

    it("unary minus", () => {
      expect(firstValue("x is -(1 + 2)")).toMatchObject({ kind: "UnaryOp", op: "-" });
    });
  });

  // ── Comparison and equality (§5.4 / §5.1) ─────────────────

  describe("comparison and equality", () => {
    it("less than", () => {
      expect(firstValue("x is 1 < 2")).toMatchObject({ kind: "BinaryOp", op: "<" });
    });

    it("is (equality)", () => {
      expect(firstValue("x is 1 is 1")).toMatchObject({ kind: "BinaryOp", op: "is" });
    });

    it("is not", () => {
      expect(firstValue("x is 1 is not 2")).toMatchObject({ kind: "BinaryOp", op: "is not" });
    });

    it("is named", () => {
      expect(firstValue("x is tu is named ok")).toMatchObject({ kind: "BinaryOp", op: "is named" });
    });

    it("is not named", () => {
      expect(firstValue("x is tu is not named ok")).toMatchObject({ kind: "BinaryOp", op: "is not named" });
    });

    it("rejects chained is", () => {
      expect(() => parse("x is 1 is 1 is 1")).toThrow("Chained");
    });
  });

  // ── Logical operators (§5.8) ──────────────────────────────

  describe("logical operators", () => {
    it("and / or precedence: or is lower", () => {
      const v = firstValue("x is true and false or true");
      expect(v.kind).toBe("BinaryOp");
      if (v.kind === "BinaryOp") expect(v.op).toBe("or");
    });

    it("not", () => {
      expect(firstValue("x is not true")).toMatchObject({ kind: "UnaryOp", op: "not" });
    });
  });

  // ── or else (§5.7) ────────────────────────────────────────

  describe("or else", () => {
    it("parses undefined coalescing", () => {
      expect(firstValue("x is a or else 1")).toMatchObject({ kind: "OrElse" });
    });
  });

  // ── Type annotation and conversion (§6.1 / §5.11) ─────────

  describe("type annotation and conversion", () => {
    it("as type annotation", () => {
      expect(firstValue("x is 42 as i32")).toMatchObject({ kind: "TypeAnnotation" });
    });

    it("to type conversion", () => {
      expect(firstValue('x is "8080" to u16')).toMatchObject({ kind: "Conversion" });
    });

    it("precedence: to binds tighter than +", () => {
      const v = firstValue("x is 1 + 2 to f64");
      expect(v.kind).toBe("BinaryOp");
      if (v.kind === "BinaryOp") {
        expect(v.op).toBe("+");
        expect(v.right).toMatchObject({ kind: "Conversion" });
      }
    });

    it("as ... to chaining", () => {
      const v = firstValue("x is 42 as i32 to f64");
      expect(v.kind).toBe("Conversion");
    });
  });

  // ── Member access (§5.15) ─────────────────────────────────

  describe("member access", () => {
    it("dotted field access", () => {
      expect(firstValue("x is config.port")).toMatchObject({ kind: "MemberAccess", member: "port" });
    });

    it("chained: a.b.c", () => {
      expect(firstValue("x is a.b.c")).toMatchObject({ kind: "MemberAccess" });
    });

    it("numeric index: list.0", () => {
      expect(firstValue("x is list.0")).toMatchObject({ kind: "MemberAccess", member: "0" });
    });
  });

  // ── if expression (§5.9) ──────────────────────────────────

  describe("if expression", () => {
    it("simple if/then/else", () => {
      expect(firstValue('x is if true then "yes" else "no"')).toMatchObject({ kind: "IfExpr" });
    });
  });

  // ── case expression (§5.10) ───────────────────────────────

  describe("case expression", () => {
    it("with when clauses", () => {
      const v = firstValue('x is case 1\n  when 0 then "a"\n  when 1 then "b"\n  else "c"');
      expect(v.kind).toBe("CaseExpr");
      if (v.kind === "CaseExpr") expect(v.whenClauses).toHaveLength(2);
    });

    it("case named variant", () => {
      const v = firstValue('x is case named tu\n  when ok then "ok"\n  else "other"');
      expect(v.kind).toBe("CaseExpr");
      if (v.kind === "CaseExpr") expect((v as any).mode).toBe("named");
    });

    it("rejects case with zero when clauses", () => {
      expect(() => parse('x is case 1 else "no"')).toThrow("at least one");
    });
  });

  // ── Enum (§3.5) ───────────────────────────────────────────

  describe("enum", () => {
    it("from clause with variants", () => {
      const v = firstValue("e is green from red, green, blue");
      expect(v.kind).toBe("FromEnum");
      if (v.kind === "FromEnum") expect(v.variants).toEqual(["red", "green", "blue"]);
    });

    it("called names the type", () => {
      const b = firstBinding("e is red from red, green, blue called RGB");
      expect(b.calledName).toBe("RGB");
    });
  });

  // ── Union (§3.6) ──────────────────────────────────────────

  describe("union", () => {
    it("from union with types", () => {
      expect(firstValue("u is 3.14 from union i32, f64, string")).toMatchObject({ kind: "FromUnion" });
    });
  });

  // ── Tagged union (§3.7) ───────────────────────────────────

  describe("tagged union", () => {
    it("named with from variants", () => {
      const v = firstValue("tu is 7 named ln from n as i32, ln as i128, f as f80");
      expect(v.kind).toBe("NamedVariant");
      if (v.kind === "NamedVariant") {
        expect(v.tag).toBe("ln");
        expect(v.variants).toHaveLength(3);
      }
    });
  });

  // ── with (struct override) (§3.2.1) ──────────────────────

  describe("struct override", () => {
    it("parses with clause", () => {
      expect(firstValue("x is base with { debug is true }")).toMatchObject({ kind: "StructOverride" });
    });

    it("rejects chaining with/plus", () => {
      expect(() => parse("x is a with { b is 1 } with { c is 2 }")).toThrow("Chaining");
      expect(() => parse("x is a with { b is 1 } plus { c is 2 }")).toThrow("Chaining");
    });
  });

  // ── plus (struct extension) (§3.2.2) ──────────────────

  describe("struct extension", () => {
    it("parses plus clause", () => {
      expect(firstValue("x is base plus { extra is true }")).toMatchObject({ kind: "StructPlus" });
    });
  });

  // ── of (field extraction) (§5.14) ─────────────────────────

  describe("field extraction", () => {
    it("parses is of", () => {
      const v = firstValue("port is of config");
      expect(v.kind).toBe("FieldExtraction");
      if (v.kind === "FieldExtraction") expect(v.bindingName).toBe("port");
    });
  });

  // ── struct import (§7) ────────────────────────────────────

  describe("struct import", () => {
    it("parses struct path", () => {
      expect(firstValue('q is struct "./mod1"')).toMatchObject({ kind: "StructImport", path: "./mod1" });
    });
  });

  // ── String interpolation ──────────────────────────────────

  describe("string interpolation", () => {
    it("parses interpolated string", () => {
      const v = firstValue('x is "hello {name}!"');
      expect(v.kind).toBe("StringLiteral");
      if (v.kind === "StringLiteral") expect(v.parts.length).toBeGreaterThan(1);
    });
  });

  // ── Collection operators (§5.6 / §5.7) ────────────────────

  describe("collection operators", () => {
    it("concatenation ++", () => {
      expect(firstValue('x is "a" ++ "b"')).toMatchObject({ kind: "BinaryOp", op: "++" });
    });

    it("repetition **", () => {
      expect(firstValue('x is "*" ** 3')).toMatchObject({ kind: "BinaryOp", op: "**" });
    });

    it("membership in", () => {
      expect(firstValue("x is 1 in [1, 2, 3]")).toMatchObject({ kind: "BinaryOp", op: "in" });
    });
  });

  // ── Function expression (§3.8) ────────────────────────────

  describe("function expression", () => {
    it("parses function with params", () => {
      const v = firstValue("f is function x as i32, y as i32 returns i32 { x + y }");
      expect(v.kind).toBe("FunctionExpr");
      if (v.kind === "FunctionExpr") {
        expect(v.params).toHaveLength(2);
        expect(v.params[0].name).toBe("x");
      }
    });

    it("parses zero-parameter function", () => {
      const v = firstValue("f is function returns i32 { 42 }");
      expect(v.kind).toBe("FunctionExpr");
      if (v.kind === "FunctionExpr") expect(v.params).toHaveLength(0);
    });

    it("parses function with default parameter", () => {
      const v = firstValue("f is function x as i32, y as i32 default 0 returns i32 { x + y }");
      expect(v.kind).toBe("FunctionExpr");
      if (v.kind === "FunctionExpr") {
        expect(v.params[1].defaultValue).not.toBeNull();
      }
    });

    it("parses function with body bindings", () => {
      const v = firstValue("f is function x as i32 returns i32 { tmp is x + 1\ntmp * 2 }");
      expect(v.kind).toBe("FunctionExpr");
      if (v.kind === "FunctionExpr") {
        expect(v.body).toHaveLength(1);
      }
    });
  });

  // ── Type expressions (§6) ─────────────────────────────────

  describe("type expressions", () => {
    it("simple type", () => {
      const v = firstValue("x is 42 as i32");
      if (v.kind === "TypeAnnotation") {
        expect(v.type).toMatchObject({ kind: "TypeExpr", path: ["i32"] });
      }
    });

    it("list type", () => {
      const v = firstValue("x is [] as [i32]");
      if (v.kind === "TypeAnnotation") {
        expect(v.type.isList).toBe(true);
      }
    });

    it("dotted type path", () => {
      const v = firstValue("x is 42 as Config.Port");
      if (v.kind === "TypeAnnotation") {
        expect(v.type).toMatchObject({ path: ["Config", "Port"] });
      }
    });
  });

  // ── Binding decomposition (§9) ────────────────────────────

  describe("binding decomposition", () => {
    it("is not at binding position → not expr", () => {
      const v = firstValue("x is not true");
      expect(v).toMatchObject({ kind: "UnaryOp", op: "not" });
    });

    it("is not at binding position with complex expr", () => {
      // "x is not false" → decomposed to binding x = (not false)
      const v = firstValue("x is not false");
      expect(v).toMatchObject({ kind: "UnaryOp", op: "not" });
      if (v.kind === "UnaryOp") {
        expect(v.operand).toMatchObject({ kind: "BoolLiteral", value: false });
      }
    });
  });

  // ── Empty document ────────────────────────────────────────

  describe("edge cases", () => {
    it("empty input produces document with no bindings", () => {
      const doc = parse("");
      expect(doc.kind).toBe("Document");
      expect(doc.bindings).toHaveLength(0);
    });

    it("function call", () => {
      const v = firstValue("x is f(1, 2)");
      expect(v.kind).toBe("FunctionCall");
      if (v.kind === "FunctionCall") {
        expect(v.args).toHaveLength(2);
      }
    });
  });
});
