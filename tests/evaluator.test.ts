// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { Evaluator, type EvalOptions } from "../src/evaluator.js";
import {
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
} from "../src/value.js";

// ── Helpers ──────────────────────────────────────────────────────

function evaluate(src: string, opts?: EvalOptions) {
  const tokens = new Lexer(src).tokenize();
  const doc = new Parser(tokens).parse();
  return new Evaluator(opts).evaluate(doc);
}

function evalOne(src: string, name = "x", opts?: EvalOptions) {
  return evaluate(src, opts)[name];
}

// ── Literals (§4) ───────────────────────────────────────────────

describe("Evaluator", () => {
  describe("literals", () => {
    it("integer", () => {
      expect(evalOne("x is 42")).toBe(42n);
    });

    it("negative integer", () => {
      expect(evalOne("x is -7")).toBe(-7n);
    });

    it("hex integer", () => {
      expect(evalOne("x is 0xff")).toBe(255n);
    });

    it("octal integer", () => {
      expect(evalOne("x is 0o77")).toBe(63n);
    });

    it("binary integer", () => {
      expect(evalOne("x is 0b1010")).toBe(10n);
    });

    it("float", () => {
      expect(evalOne("x is 3.14")).toBeCloseTo(3.14);
    });

    it("boolean true", () => {
      expect(evalOne("x is true")).toBe(true);
    });

    it("boolean false", () => {
      expect(evalOne("x is false")).toBe(false);
    });

    it("null", () => {
      expect(evalOne("x is null")).toBe(null);
    });

    it("string", () => {
      expect(evalOne('x is "hello"')).toBe("hello");
    });

    it("inf", () => {
      expect(evalOne("x is inf")).toBe(Infinity);
    });

    it("-inf", () => {
      expect(evalOne("x is -inf")).toBe(-Infinity);
    });

    it("nan", () => {
      expect(evalOne("x is nan")).toBeNaN();
    });
  });

  // ── Arithmetic (§5.3) ──────────────────────────────────────────

  describe("arithmetic", () => {
    it("addition", () => {
      expect(evalOne("x is 2 + 3")).toBe(5n);
    });

    it("subtraction", () => {
      expect(evalOne("x is 10 - 4")).toBe(6n);
    });

    it("multiplication", () => {
      expect(evalOne("x is 3 * 7")).toBe(21n);
    });

    it("integer division truncates toward zero", () => {
      expect(evalOne("x is 7 / 2")).toBe(3n);
    });

    it("negative integer division truncates toward zero", () => {
      expect(evalOne("x is -7 / 2")).toBe(-3n);
    });

    it("modulo", () => {
      expect(evalOne("x is 10 % 3")).toBe(1n);
    });

    it("exponentiation", () => {
      expect(evalOne("x is 2 ^ 10")).toBe(1024n);
    });

    it("float arithmetic", () => {
      expect(evalOne("x is 1.5 + 2.5")).toBe(4.0);
    });

    it("division by zero returns inf for floats", () => {
      expect(evalOne("x is 1.0 / 0.0")).toBe(Infinity);
    });

    it("integer division by zero throws", () => {
      expect(() => evalOne("x is 1 / 0")).toThrow();
    });

    it("precedence: * before +", () => {
      expect(evalOne("x is 2 + 3 * 4")).toBe(14n);
    });
  });

  // ── Comparison (§5.4) ──────────────────────────────────────────

  describe("comparison", () => {
    it("less than", () => {
      expect(evalOne("x is 1 < 2")).toBe(true);
    });

    it("greater or equal", () => {
      expect(evalOne("x is 3 >= 3")).toBe(true);
    });

    it("string comparison", () => {
      expect(evalOne('x is "a" < "b"')).toBe(true);
    });
  });

  // ── Equality (§5.5) ───────────────────────────────────────────

  describe("equality", () => {
    it("is operator", () => {
      expect(evalOne("x is 1 is 1")).toBe(true);
    });

    it("is not operator", () => {
      expect(evalOne("x is 1 is not 2")).toBe(true);
    });

    it("null comparison", () => {
      expect(evalOne("x is null is null")).toBe(true);
    });

    it("nan is not equal to itself", () => {
      expect(evalOne("x is nan is nan")).toBe(false);
    });

    it("deep list equality", () => {
      expect(evalOne("x is [1, 2, 3] is [1, 2, 3]")).toBe(true);
    });

    it("deep struct equality", () => {
      expect(evalOne("x is {a is 1} is {a is 1}")).toBe(true);
    });
  });

  // ── Logical operators (§5.6) ──────────────────────────────────

  describe("logical operators", () => {
    it("and", () => {
      expect(evalOne("x is true and false")).toBe(false);
    });

    it("or", () => {
      expect(evalOne("x is false or true")).toBe(true);
    });

    it("not", () => {
      expect(evalOne("x is not true")).toBe(false);
    });

    it("short-circuit: and with false", () => {
      expect(evalOne("x is false and (1 / 0 is 0)")).toBe(false);
    });

    it("short-circuit: or with true", () => {
      expect(evalOne("x is true or (1 / 0 is 0)")).toBe(true);
    });
  });

  // ── Self reference (§3.1) ─────────────────────────────────────

  describe("self reference", () => {
    it("basic self.field", () => {
      const r = evaluate("a is 10\nb is self.a + 5");
      expect(r.b).toBe(15n);
    });

    it("forward reference", () => {
      const r = evaluate("a is self.b + 1\nb is 10");
      expect(r.a).toBe(11n);
    });

    it("self-exclusion returns undefined", () => {
      const r = evaluate("x is self.x or else 42");
      expect(r.x).toBe(42n);
    });

    it("nested struct self", () => {
      const r = evaluate("s is { a is 1, b is self.a + 1 }");
      expect((r.s as any).b).toBe(2n);
    });

    it("circular reference throws", () => {
      expect(() => evaluate("a is self.b\nb is self.a")).toThrow();
    });
  });

  // ── Environment reference (§5.11) ─────────────────────────────

  describe("env reference", () => {
    it("reads environment variable", () => {
      const r = evaluate('x is env.MY_VAR', { env: { MY_VAR: "hello" } });
      expect(r.x).toBe("hello");
    });

    it("returns undefined when not set", () => {
      const r = evaluate("x is env.MISSING or else 99", { env: {} });
      expect(r.x).toBe(99n);
    });
  });

  // ── Or else (§5.7) ────────────────────────────────────────────

  describe("or else", () => {
    it("returns left when defined", () => {
      expect(evalOne("x is 42 or else 99")).toBe(42n);
    });

    it("returns right when undefined", () => {
      const r = evaluate("x is env.MISSING or else 99", { env: {} });
      expect(r.x).toBe(99n);
    });

    it("null is not undefined (returns null)", () => {
      expect(evalOne("x is null or else 99")).toBe(null);
    });
  });

  // ── If expression (§5.9) ──────────────────────────────────────

  describe("if expression", () => {
    it("true branch", () => {
      expect(evalOne("x is if true then 1 else 2")).toBe(1n);
    });

    it("false branch", () => {
      expect(evalOne("x is if false then 1 else 2")).toBe(2n);
    });

    it("non-bool condition throws", () => {
      expect(() => evalOne("x is if 42 then 1 else 2")).toThrow();
    });
  });

  // ── Case expression (§5.10) ───────────────────────────────────

  describe("case expression", () => {
    it("matches when clause", () => {
      expect(evalOne("x is case 2 when 1 then 10 when 2 then 20 else 30")).toBe(20n);
    });

    it("falls to else", () => {
      expect(evalOne("x is case 5 when 1 then 10 else 99")).toBe(99n);
    });
  });

  // ── String interpolation (§4.4) ───────────────────────────────

  describe("string interpolation", () => {
    it("basic interpolation", () => {
      const r = evaluate('name is "world"\ngreeting is "hello {self.name}"');
      expect(r.greeting).toBe("hello world");
    });

    it("arithmetic in interpolation", () => {
      const r = evaluate('a is 2\nb is 3\nc is "{self.a + self.b}"');
      expect(r.c).toBe("5");
    });
  });

  // ── Struct literal (§3.2) ─────────────────────────────────────

  describe("struct", () => {
    it("inline struct", () => {
      const r = evalOne("x is { a is 1, b is 2 }") as Record<string, any>;
      expect(r.a).toBe(1n);
      expect(r.b).toBe(2n);
    });

    it("nested struct access", () => {
      const r = evaluate("s is { inner is { val is 42 } }\nx is self.s.inner.val");
      expect(r.x).toBe(42n);
    });

    it("duplicate field throws", () => {
      expect(() => evalOne("x is { a is 1, a is 2 }")).toThrow();
    });
  });

  // ── List literal (§3.4) ───────────────────────────────────────

  describe("list", () => {
    it("basic list", () => {
      const r = evalOne("x is [1, 2, 3]") as bigint[];
      expect(r).toEqual([1n, 2n, 3n]);
    });

    it("empty list with type annotation", () => {
      const r = evalOne("x is [] as [i32]") as any[];
      expect(r).toEqual([]);
    });

    it("element access by ordinal", () => {
      const r = evaluate("items is [10, 20, 30]\nx is self.items.first");
      expect(r.x).toBe(10n);
    });

    it("out of bounds returns undefined", () => {
      const r = evaluate("items is [10]\nx is self.items.second or else 99");
      expect(r.x).toBe(99n);
    });
  });

  // ── Tuple literal (§3.3) ──────────────────────────────────────

  describe("tuple", () => {
    it("basic tuple", () => {
      const r = evalOne("x is (1, 2, 3)") as UzonTuple;
      expect(r).toBeInstanceOf(UzonTuple);
      expect(r.elements).toEqual([1n, 2n, 3n]);
    });

    it("empty tuple", () => {
      const r = evalOne("x is ()") as UzonTuple;
      expect(r.elements).toEqual([]);
    });
  });

  // ── Are binding (§3.1) ────────────────────────────────────────

  describe("are binding", () => {
    it("desugars to list", () => {
      const r = evaluate("items are 1, 2, 3");
      expect(r.items).toEqual([1n, 2n, 3n]);
    });
  });

  // ── Collection operators (§5.8) ───────────────────────────────

  describe("collection operators", () => {
    it("string concatenation", () => {
      expect(evalOne('x is "hello" ++ " world"')).toBe("hello world");
    });

    it("list concatenation", () => {
      expect(evalOne("x is [1, 2] ++ [3, 4]")).toEqual([1n, 2n, 3n, 4n]);
    });

    it("string repetition", () => {
      expect(evalOne('x is "ab" ** 3')).toBe("ababab");
    });

    it("list repetition", () => {
      expect(evalOne("x is [1, 2] ** 2")).toEqual([1n, 2n, 1n, 2n]);
    });

    it("in operator for list membership", () => {
      expect(evalOne("x is 2 in [1, 2, 3]")).toBe(true);
    });

    it("in operator negative", () => {
      expect(evalOne("x is 5 in [1, 2, 3]")).toBe(false);
    });
  });

  // ── Type annotation - as (§5.13) ──────────────────────────────

  describe("type annotation (as)", () => {
    it("integer type check passes", () => {
      expect(evalOne("x is 42 as i32")).toBe(42n);
    });

    it("integer overflow throws", () => {
      expect(() => evalOne("x is 200 as i8")).toThrow();
    });

    it("float type", () => {
      expect(evalOne("x is 3.14 as f64")).toBeCloseTo(3.14);
    });
  });

  // ── Type conversion - to (§5.14) ──────────────────────────────

  describe("type conversion (to)", () => {
    it("string to integer", () => {
      expect(evalOne('x is "42" to i32')).toBe(42n);
    });

    it("float to integer truncates", () => {
      expect(evalOne("x is 3.7 to i32")).toBe(3n);
    });

    it("undefined propagation", () => {
      const r = evaluate("x is env.MISSING to i32 or else 99", { env: {} });
      expect(r.x).toBe(99n);
    });

    it("bool to string", () => {
      expect(evalOne('x is true to string')).toBe("true");
    });

    it("null to string", () => {
      expect(evalOne('x is null to string')).toBe("null");
    });
  });

  // ── With - struct override (§3.2.1) ───────────────────────────

  describe("with (struct override)", () => {
    it("overrides existing field", () => {
      const r = evaluate("base is { a is 1, b is 2 }\nx is self.base with { a is 10 }");
      expect((r.x as any).a).toBe(10n);
      expect((r.x as any).b).toBe(2n);
    });

    it("rejects new field", () => {
      expect(() => evaluate("base is { a is 1 }\nx is self.base with { z is 9 }")).toThrow();
    });
  });

  // ── Enum (§3.5) ───────────────────────────────────────────────

  describe("enum", () => {
    it("creates enum value", () => {
      const r = evaluate("c is red from red, green, blue called Color");
      expect(r.c).toBeInstanceOf(UzonEnum);
      expect((r.c as UzonEnum).value).toBe("red");
    });

    it("invalid variant access throws", () => {
      expect(() => evaluate(
        "c is red from red, green called Color\nx is Color.purple"
      )).toThrow();
    });

    it("called names the type", () => {
      const r = evaluate("c is red from red, green, blue called RGB");
      expect((r.c as UzonEnum).typeName).toBe("RGB");
    });

    it("enum equality via is", () => {
      const r = evaluate(
        "c is red from red, green, blue called Color\n" +
        "x is self.c is red"
      );
      expect(r.x).toBe(true);
    });
  });

  // ── Union (§3.6) ──────────────────────────────────────────────

  describe("union", () => {
    it("creates union value", () => {
      const r = evaluate("u is 42 from union i32, f64, string");
      expect(r.u).toBeInstanceOf(UzonUnion);
    });
  });

  // ── Tagged union (§3.7) ───────────────────────────────────────

  describe("tagged union", () => {
    it("creates tagged union", () => {
      const r = evaluate(
        'h is "ok" named ok from ok as string, err as string'
      );
      expect(r.h).toBeInstanceOf(UzonTaggedUnion);
      expect((r.h as UzonTaggedUnion).tag).toBe("ok");
    });

    it("is named check", () => {
      const r = evaluate(
        'h is "ok" named ok from ok as string, err as string\n' +
        'x is self.h is named ok'
      );
      expect(r.x).toBe(true);
    });

    it("transparency: arithmetic on inner value", () => {
      const r = evaluate(
        "score is 7 named high from high as i32, low as i32 called Score\n" +
        "x is self.score + 3"
      );
      expect(r.x).toBe(10n);
    });

    it("transparency: comparison on inner value", () => {
      const r = evaluate(
        "score is 7 named high from high as i32, low as i32 called Score\n" +
        "x is self.score > 5"
      );
      expect(r.x).toBe(true);
    });
  });

  // ── Of - field extraction (§5.15) ─────────────────────────────

  describe("of (field extraction)", () => {
    it("extracts field", () => {
      const r = evaluate("s is { a is 1, b is 2 }\na is of self.s");
      expect(r.a).toBe(1n);
    });
  });

  // ── Grouping ──────────────────────────────────────────────────

  describe("grouping", () => {
    it("parentheses override precedence", () => {
      expect(evalOne("x is (2 + 3) * 4")).toBe(20n);
    });
  });

  // ── Escape sequences (§4.4) ───────────────────────────────────

  describe("escape sequences", () => {
    it("newline", () => {
      expect(evalOne('x is "a\\nb"')).toBe("a\nb");
    });

    it("tab", () => {
      expect(evalOne('x is "a\\tb"')).toBe("a\tb");
    });

    it("unicode", () => {
      expect(evalOne('x is "\\u{1F600}"')).toBe("\u{1F600}");
    });
  });

  // ── Undefined propagation ─────────────────────────────────────

  describe("undefined propagation", () => {
    it("member access on undefined", () => {
      const r = evaluate("x is env.MISSING.foo or else 99", { env: {} });
      expect(r.x).toBe(99n);
    });

    it("to operator on undefined", () => {
      const r = evaluate('x is env.MISSING to string or else "fallback"', { env: {} });
      expect(r.x).toBe("fallback");
    });
  });

  // ── In operator type check (§5.8.1) ──────────────────────────

  describe("in operator type check", () => {
    it("rejects type mismatch", () => {
      expect(() => evalOne('x is "hello" in [1, 2, 3]')).toThrow();
    });

    it("null in list with null", () => {
      expect(evalOne("x is null in [1, null, 3]")).toBe(true);
    });
  });

  // ── With struct shape validation (§3.2.1) ─────────────────────

  describe("with struct shape validation", () => {
    it("rejects unknown fields", () => {
      expect(() => evaluate("base is { a is 1 }\nx is self.base with { b is 2 }")).toThrow();
    });
  });

  // ── Untyped literal compatibility (§5) ────────────────────────

  describe("untyped literal compatibility", () => {
    it("type adoption: untyped + typed", () => {
      expect(evalOne("x is (1 as i32) + 2")).toBe(3n);
    });

    it("overflow detection on adopted type", () => {
      expect(() => evalOne("x is (127 as i8) + 1")).toThrow();
    });
  });

  // ── Enum variant type-context inference (§3.5 point 4) ────────

  describe("enum variant inference", () => {
    it("bare identifier in is context", () => {
      const r = evaluate(
        "c is red from red, green, blue called Color\n" +
        "x is self.c is red"
      );
      expect(r.x).toBe(true);
    });
  });

  // ── Functions (§3.8) ──────────────────────────────────────────

  describe("functions", () => {
    it("basic function definition and call", () => {
      const r = evaluate(
        "add is function a as i32, b as i32 returns i32 { a + b }\n" +
        "x is self.add(1, 2)"
      );
      expect(r.x).toBe(3n);
    });

    it("zero-parameter function", () => {
      const r = evaluate(
        'greeting is function returns string { "hello" }\n' +
        "x is self.greeting()"
      );
      expect(r.x).toBe("hello");
    });

    it("default parameters", () => {
      const r = evaluate(
        'greet is function name as string, prefix as string default "Hello" returns string { "{prefix} {name}" }\n' +
        'x is self.greet("world")'
      );
      expect(r.x).toBe("Hello world");
    });

    it("multi-expression body", () => {
      const r = evaluate(
        "clamp is function val as i32, lo as i32, hi as i32 returns i32 {\n" +
        "  clamped is if val < lo then lo else if val > hi then hi else val\n" +
        "  clamped\n" +
        "}\n" +
        "x is self.clamp(150, 0, 100)"
      );
      expect(r.x).toBe(100n);
    });

    it("wrong argument count throws", () => {
      expect(() => evaluate(
        "f is function a as i32 returns i32 { a }\n" +
        "x is self.f(1, 2)"
      )).toThrow();
    });

    it("type mismatch throws", () => {
      expect(() => evaluate(
        'f is function a as i32 returns i32 { a }\nx is self.f("hello")'
      )).toThrow();
    });

    it("calling non-function throws", () => {
      expect(() => evaluate("f is 42\nx is self.f(1)")).toThrow();
    });

    it("recursion detection", () => {
      expect(() => evaluate(
        "f is function n as i32 returns i32 { self.f(n - 1) }\nx is self.f(5)"
      )).toThrow();
    });

    it("function as value", () => {
      const r = evaluate("f is function a as i32 returns i32 { a + 1 }");
      expect(r.f).toBeInstanceOf(UzonFunction);
    });

    it("function equality throws", () => {
      expect(() => evaluate(
        "f is function returns i32 { 1 }\n" +
        "g is function returns i32 { 1 }\n" +
        "x is self.f is self.g"
      )).toThrow();
    });

    it("function calling another function", () => {
      const r = evaluate(
        "double is function n as i32 returns i32 { n * 2 }\n" +
        "addOne is function n as i32 returns i32 { n + 1 }\n" +
        "transform is function n as i32 returns i32 { self.addOne(self.double(n)) }\n" +
        "x is self.transform(5)"
      );
      expect(r.x).toBe(11n);
    });
  });

  // ── Struct extends (§3.2.2) ───────────────────────────────────

  describe("struct extends", () => {
    it("adds new fields", () => {
      const r = evaluate("base is { a is 1 }\nx is self.base extends { b is 2 }");
      expect((r.x as any).a).toBe(1n);
      expect((r.x as any).b).toBe(2n);
    });

    it("override and add", () => {
      const r = evaluate("base is { a is 1 }\nx is self.base extends { a is 10, b is 2 }");
      expect((r.x as any).a).toBe(10n);
      expect((r.x as any).b).toBe(2n);
    });

    it("rejects extends with no new fields", () => {
      expect(() => evaluate("base is { a is 1 }\nx is self.base extends { a is 2 }")).toThrow();
    });

    it("rejects extends on non-struct", () => {
      expect(() => evaluate("x is 42 extends { a is 1 }")).toThrow();
    });
  });

  // ── Standard library (§5.16) ──────────────────────────────────

  describe("standard library", () => {
    it("std.len on list", () => {
      expect(evalOne("x is std.len([1, 2, 3])")).toBe(3n);
    });

    it("std.len on string", () => {
      expect(evalOne('x is std.len("hello")')).toBe(5n);
    });

    it("std.has", () => {
      const r = evaluate('s is { a is 1 }\nx is std.has(self.s, "a")');
      expect(r.x).toBe(true);
    });

    it("std.get", () => {
      const r = evaluate('s is { a is 42 }\nx is std.get(self.s, "a")');
      expect(r.x).toBe(42n);
    });

    it("std.keys", () => {
      const r = evaluate("s is { a is 1, b is 2 }\nx is std.keys(self.s)");
      expect(r.x).toEqual(["a", "b"]);
    });

    it("std.values", () => {
      const r = evaluate("s is { a is 1, b is 2 }\nx is std.values(self.s)");
      const val = r.x as UzonTuple;
      expect(val).toBeInstanceOf(UzonTuple);
      expect(val.elements).toEqual([1n, 2n]);
    });

    it("std.map", () => {
      const r = evaluate(
        "double is function n as i32 returns i32 { n * 2 }\n" +
        "x is std.map([1, 2, 3], self.double)"
      );
      expect(r.x).toEqual([2n, 4n, 6n]);
    });

    it("std.filter", () => {
      const r = evaluate(
        "isEven is function n as i32 returns bool { n % 2 is 0 }\n" +
        "x is std.filter([1, 2, 3, 4], self.isEven)"
      );
      expect(r.x).toEqual([2n, 4n]);
    });

    it("std.reduce", () => {
      const r = evaluate(
        "add is function acc as i32, n as i32 returns i32 { acc + n }\n" +
        "x is std.reduce([1, 2, 3, 4], 0, self.add)"
      );
      expect(r.x).toBe(10n);
    });

    it("std.sort", () => {
      const r = evaluate(
        "asc is function a as i64, b as i64 returns bool { a < b }\n" +
        "x is std.sort([3, 1, 2], self.asc)"
      );
      expect(r.x).toEqual([1n, 2n, 3n]);
    });

    it("std.isNan", () => {
      expect(evalOne("x is std.isNan(nan)")).toBe(true);
      expect(evalOne("x is std.isNan(1.0)")).toBe(false);
    });

    it("std.isInf", () => {
      expect(evalOne("x is std.isInf(inf)")).toBe(true);
      expect(evalOne("x is std.isInf(1.0)")).toBe(false);
    });

    it("std.isFinite", () => {
      expect(evalOne("x is std.isFinite(1.0)")).toBe(true);
      expect(evalOne("x is std.isFinite(inf)")).toBe(false);
    });

    it("std.join", () => {
      expect(evalOne('x is std.join(["a", "b", "c"], ", ")')).toBe("a, b, c");
    });

    it("std.split", () => {
      expect(evalOne('x is std.split("a,b,c", ",")')).toEqual(["a", "b", "c"]);
    });

    it("std.trim", () => {
      expect(evalOne('x is std.trim("  hello  ")')).toBe("hello");
    });

    it("std.replace", () => {
      expect(evalOne('x is std.replace("hello world", "world", "uzon")')).toBe("hello uzon");
    });
  });

  // ── Speculative branch evaluation (§5.9) ──────────────────────

  describe("speculative evaluation", () => {
    it("non-taken branch type errors are suppressed", () => {
      const r = evaluate(
        "x is if true then 42 else self.missing + 1"
      );
      expect(r.x).toBe(42n);
    });
  });

  // ── Multiline strings (§4.4) ──────────────────────────────────

  describe("multiline strings", () => {
    it("adjacent strings join with newline", () => {
      const r = evalOne('x is "line1"\n  "line2"');
      expect(r).toBe("line1\nline2");
    });
  });

  // ── Unary operators ───────────────────────────────────────────

  describe("unary operators", () => {
    it("unary minus", () => {
      const r = evaluate("a is 5\nx is -self.a");
      expect(r.x).toBe(-5n);
    });

    it("double not", () => {
      expect(evalOne("x is not not true")).toBe(true);
    });
  });

  // ── Complex integration tests ─────────────────────────────────

  describe("integration", () => {
    it("fibonacci-like computation", () => {
      const r = evaluate(
        "a is 1\n" +
        "b is 1\n" +
        "c is self.a + self.b\n" +
        "d is self.b + self.c\n" +
        "e is self.c + self.d"
      );
      expect(r.a).toBe(1n);
      expect(r.b).toBe(1n);
      expect(r.c).toBe(2n);
      expect(r.d).toBe(3n);
      expect(r.e).toBe(5n);
    });

    it("struct with function and std.map", () => {
      const r = evaluate(
        "double is function n as i32 returns i32 { n * 2 }\n" +
        "nums is [1, 2, 3]\n" +
        "x is std.map(self.nums, self.double)"
      );
      expect(r.x).toEqual([2n, 4n, 6n]);
    });

    it("nested struct override", () => {
      const r = evaluate(
        "config is {\n" +
        "  db is { host is \"localhost\", port is 5432 }\n" +
        "}\n" +
        "x is self.config.db with { port is 3306 }"
      );
      expect((r.x as any).host).toBe("localhost");
      expect((r.x as any).port).toBe(3306n);
    });

    it("enum in case expression", () => {
      const r = evaluate(
        "c is green from red, green, blue called Color\n" +
        "x is case self.c\n" +
        "  when red then 1\n" +
        "  when green then 2\n" +
        "  when blue then 3\n" +
        "  else 0"
      );
      expect(r.x).toBe(2n);
    });

    it("multiple bindings with dependencies", () => {
      const r = evaluate(
        "width is 10\nheight is 20\narea is self.width * self.height\n" +
        "perimeter is 2 * (self.width + self.height)\n" +
        'label is "Area: {self.area}, Perimeter: {self.perimeter}"'
      );
      expect(r.area).toBe(200n);
      expect(r.perimeter).toBe(60n);
      expect(r.label).toBe("Area: 200, Perimeter: 60");
    });
  });

  // ── Import system (§6.1) ──────────────────────────────────────

  describe("imports", () => {
    it("imports from file", () => {
      const fileReader = (path: string) => {
        if (path.endsWith("other.uzon")) {
          return "value is 42";
        }
        throw new Error(`File not found: ${path}`);
      };
      const r = evaluate(
        'data is struct "other.uzon"\nx is self.data.value',
        { fileReader, filename: "/test/main.uzon" }
      );
      expect(r.x).toBe(42n);
    });

    it("circular import detection", () => {
      const fileReader = (path: string) => {
        if (path.endsWith("a.uzon")) return 'b is struct "b.uzon"';
        if (path.endsWith("b.uzon")) return 'a is struct "a.uzon"';
        throw new Error(`Not found: ${path}`);
      };
      expect(() => evaluate(
        'a is struct "a.uzon"',
        { fileReader, filename: "/test/main.uzon" }
      )).toThrow();
    });

    it("import caching", () => {
      let callCount = 0;
      const fileReader = (_path: string) => {
        callCount++;
        return "val is 1";
      };
      const cache = new Map();
      evaluate(
        'a is struct "shared.uzon"\nb is struct "shared.uzon"',
        { fileReader, filename: "/test/main.uzon", importCache: cache }
      );
      expect(callCount).toBe(1);
    });
  });

  // ── Numeric type validation ───────────────────────────────────

  describe("numeric types", () => {
    it("i8 range validation", () => {
      expect(evalOne("x is 127 as i8")).toBe(127n);
      expect(() => evalOne("x is 128 as i8")).toThrow();
    });

    it("u8 range validation", () => {
      expect(evalOne("x is 255 as u8")).toBe(255n);
      expect(() => evalOne("x is 256 as u8")).toThrow();
      expect(() => evalOne("x is -1 as u8")).toThrow();
    });

    it("same-type arithmetic", () => {
      expect(evalOne("x is (1 as i32) + (2 as i32)")).toBe(3n);
    });

    it("different typed arithmetic throws", () => {
      expect(() => evalOne("x is (1 as i32) + (2 as i64)")).toThrow();
    });

    it("typed + untyped adopts type", () => {
      expect(evalOne("x is (1 as i32) + 2")).toBe(3n);
    });

    it("float type annotation", () => {
      expect(evalOne("x is 3.14 as f32")).toBeCloseTo(3.14);
    });

    it("conversion between numeric types", () => {
      expect(evalOne("x is (3.7 as f64) to i32")).toBe(3n);
    });
  });

  // ── Null conversion type errors ───────────────────────────────

  describe("null conversion", () => {
    it("null to i32 throws", () => {
      expect(() => evalOne("x is null to i32")).toThrow();
    });

    it("null to bool throws", () => {
      expect(() => evalOne("x is null to bool")).toThrow();
    });

    it("null to string is allowed", () => {
      expect(evalOne("x is null to string")).toBe("null");
    });

    it("null to null is identity", () => {
      expect(evalOne("x is null to null")).toBe(null);
    });
  });

  // ── And/Or/Not on undefined ───────────────────────────────────

  describe("logical on undefined", () => {
    it("and on undefined throws", () => {
      expect(() => evaluate("x is env.MISSING and true", { env: {} })).toThrow();
    });

    it("or on undefined throws", () => {
      expect(() => evaluate("x is env.MISSING or true", { env: {} })).toThrow();
    });

    it("suppressed in non-taken branches", () => {
      const r = evaluate("x is if true then 42 else env.MISSING and true", { env: {} });
      expect(r.x).toBe(42n);
    });
  });

  // ── Function type registration ────────────────────────────────

  describe("function type registration", () => {
    it("called names function type", () => {
      const r = evaluate(
        "mapper is function a as i32 returns i32 { a * 2 } called Mapper\n" +
        "f is function x as i32 returns i32 { x + 1 } as Mapper"
      );
      expect(r.f).toBeInstanceOf(UzonFunction);
    });
  });

  // ── With type preservation ────────────────────────────────────

  describe("with type preservation", () => {
    it("preserves named struct type after with", () => {
      const r = evaluate(
        "base is { x is 0 as i32, y is 0 as i32 } called Point\n" +
        "p is self.base with { x is 5 }\n" +
        "q is self.p with { y is 10 }"
      );
      expect((r.q as any).x).toBe(5n);
      expect((r.q as any).y).toBe(10n);
    });
  });

  // ── Empty list type inference ─────────────────────────────────

  describe("empty list type inference", () => {
    it("if branch type adoption", () => {
      const r = evaluate(
        "x is if true then [1, 2, 3] else [] as [i32]"
      );
      expect(r.x).toEqual([1n, 2n, 3n]);
    });
  });
});
