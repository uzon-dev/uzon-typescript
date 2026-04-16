// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import {
  stringify, stringifyValue, toJS, parse,
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UzonFunction,
  UZON_UNDEFINED,
} from "../src/index.js";
import type { ParseOptions, UzonValue } from "../src/index.js";

function mustParse(src: string, opts?: ParseOptions): Record<string, UzonValue> {
  const r = parse(src, opts);
  if (r.errors) throw r.errors[0];
  return r.value;
}

describe("stringifyValue", () => {
  // ── Primitives ────────────────────────────────────────────────

  describe("primitives", () => {
    it("null", () => {
      expect(stringifyValue(null)).toBe("null");
    });

    it("boolean true", () => {
      expect(stringifyValue(true)).toBe("true");
    });

    it("boolean false", () => {
      expect(stringifyValue(false)).toBe("false");
    });

    it("integer (bigint)", () => {
      expect(stringifyValue(42n)).toBe("42");
    });

    it("negative integer", () => {
      expect(stringifyValue(-7n)).toBe("-7");
    });

    it("float", () => {
      expect(stringifyValue(3.14)).toBe("3.14");
    });

    it("inf", () => {
      expect(stringifyValue(Infinity)).toBe("inf");
    });

    it("-inf", () => {
      expect(stringifyValue(-Infinity)).toBe("-inf");
    });

    it("nan", () => {
      expect(stringifyValue(NaN)).toBe("nan");
    });
  });

  // ── Strings ───────────────────────────────────────────────────

  describe("strings", () => {
    it("simple string", () => {
      expect(stringifyValue("hello")).toBe('"hello"');
    });

    it("escapes quotes", () => {
      expect(stringifyValue('say "hi"')).toBe('"say \\"hi\\""');
    });

    it("escapes newlines", () => {
      expect(stringifyValue("a\nb")).toBe('"a\\nb"');
    });

    it("escapes tabs", () => {
      expect(stringifyValue("a\tb")).toBe('"a\\tb"');
    });

    it("escapes backslashes", () => {
      expect(stringifyValue("a\\b")).toBe('"a\\\\b"');
    });

    it("escapes braces", () => {
      expect(stringifyValue("{x}")).toBe('"\\{x}"');
    });
  });

  // ── Lists ─────────────────────────────────────────────────────

  describe("lists", () => {
    it("empty list", () => {
      expect(stringifyValue([])).toBe("[]");
    });

    it("integer list", () => {
      expect(stringifyValue([1n, 2n, 3n])).toBe("[ 1, 2, 3 ]");
    });

    it("mixed list", () => {
      expect(stringifyValue([1n, "hello", true])).toBe('[ 1, "hello", true ]');
    });
  });

  // ── Tuples ────────────────────────────────────────────────────

  describe("tuples", () => {
    it("empty tuple", () => {
      expect(stringifyValue(new UzonTuple([]))).toBe("()");
    });

    it("single-element tuple (trailing comma)", () => {
      expect(stringifyValue(new UzonTuple([42n]))).toBe("(42,)");
    });

    it("multi-element tuple", () => {
      expect(stringifyValue(new UzonTuple([1n, "a", true]))).toBe('(1, "a", true)');
    });
  });

  // ── Structs ───────────────────────────────────────────────────

  describe("structs", () => {
    it("single field inline", () => {
      expect(stringifyValue({ x: 1n })).toBe("{ x is 1 }");
    });

    it("multiline for multiple fields", () => {
      const result = stringifyValue({ a: 1n, b: 2n });
      expect(result).toContain("a is 1");
      expect(result).toContain("b is 2");
      expect(result).toContain("\n");
    });

    it("nested struct", () => {
      const result = stringifyValue({ inner: { x: 1n } });
      expect(result).toContain("inner is { x is 1 }");
    });

    it("empty struct", () => {
      expect(stringifyValue({})).toBe("{}");
    });
  });

  // ── Enums ─────────────────────────────────────────────────────

  describe("enums", () => {
    it("unnamed enum", () => {
      const e = new UzonEnum("red", ["red", "green", "blue"]);
      expect(stringifyValue(e)).toBe("red from red, green, blue");
    });

    it("named enum (called)", () => {
      const e = new UzonEnum("red", ["red", "green", "blue"], "Color");
      expect(stringifyValue(e)).toBe("red from red, green, blue called Color");
    });
  });

  // ── Unions ────────────────────────────────────────────────────

  describe("unions", () => {
    it("untagged union", () => {
      const u = new UzonUnion(42n, ["i32", "string"]);
      expect(stringifyValue(u)).toBe("42 from union i32, string");
    });

    it("named union", () => {
      const u = new UzonUnion(42n, ["i32", "string"], "IntOrStr");
      expect(stringifyValue(u)).toBe("42 from union i32, string called IntOrStr");
    });
  });

  // ── Tagged unions ─────────────────────────────────────────────

  describe("tagged unions", () => {
    it("tagged union with types", () => {
      const tu = new UzonTaggedUnion(
        "ok", "ok",
        new Map([["ok", "string"], ["err", "string"]]),
      );
      expect(stringifyValue(tu)).toBe('"ok" named ok from ok as string, err as string');
    });

    it("named tagged union", () => {
      const tu = new UzonTaggedUnion(
        7n, "high",
        new Map([["high", "i32"], ["low", "i32"]]),
        "Score",
      );
      expect(stringifyValue(tu)).toBe("7 named high from high as i32, low as i32 called Score");
    });
  });

  // ── Functions ─────────────────────────────────────────────────

  describe("functions", () => {
    it("throws for function values", () => {
      const fn = new UzonFunction(
        ["n"], ["i32"], [null],
        "i32",
        [],
        { kind: "Identifier", name: "n", line: 0, col: 0 },
        null as any,
      );
      expect(() => stringifyValue(fn)).toThrow("not serializable");
    });
  });

  // ── UZON_UNDEFINED ────────────────────────────────────────────

  describe("UZON_UNDEFINED", () => {
    it("throws for undefined value", () => {
      expect(() => stringifyValue(UZON_UNDEFINED)).toThrow();
    });
  });
});

// ── stringify (document) ────────────────────────────────────────

describe("stringify", () => {
  it("converts bindings to UZON text", () => {
    const result = stringify({ name: "test", port: 8080n });
    expect(result).toBe('name is "test"\nport is 8080');
  });

  it("escapes keyword identifiers", () => {
    const result = stringify({ is: 42n });
    expect(result).toContain("@is is 42");
  });

  it("quotes identifiers with special chars", () => {
    const result = stringify({ "Content-Type": "json" });
    expect(result).toContain("'Content-Type' is \"json\"");
  });

  it("handles plain JS number conversion", () => {
    const result = stringify({ x: 42 });
    expect(result).toBe("x is 42.0");
  });
});

// ── toJS ────────────────────────────────────────────────────────

describe("toJS", () => {
  it("null → null", () => {
    expect(toJS(null)).toBe(null);
  });

  it("boolean → boolean", () => {
    expect(toJS(true)).toBe(true);
  });

  it("bigint → number (default)", () => {
    expect(toJS(42n)).toBe(42);
  });

  it("bigint → string", () => {
    expect(toJS(42n, { bigint: "string" })).toBe("42");
  });

  it("bigint → bigint", () => {
    expect(toJS(42n, { bigint: "bigint" })).toBe(42n);
  });

  it("float → number", () => {
    expect(toJS(3.14)).toBe(3.14);
  });

  it("string → string", () => {
    expect(toJS("hello")).toBe("hello");
  });

  it("UzonEnum → string", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    expect(toJS(e)).toBe("red");
  });

  it("UzonTaggedUnion → { tag, value }", () => {
    const tu = new UzonTaggedUnion(
      7n, "high",
      new Map([["high", "i32"], ["low", "i32"]]),
    );
    expect(toJS(tu)).toEqual({ tag: "high", value: 7 });
  });

  it("UzonTuple → array", () => {
    const t = new UzonTuple([1n, 2n, 3n]);
    expect(toJS(t)).toEqual([1, 2, 3]);
  });

  it("list → array", () => {
    expect(toJS([1n, 2n] as UzonValue)).toEqual([1, 2]);
  });

  it("struct → object", () => {
    const s = { a: 1n, b: "hello" } as Record<string, UzonValue>;
    expect(toJS(s as UzonValue)).toEqual({ a: 1, b: "hello" });
  });

  it("UZON_UNDEFINED → undefined", () => {
    expect(toJS(UZON_UNDEFINED)).toBeUndefined();
  });

  it("UzonFunction → throws", () => {
    const fn = new UzonFunction(
      ["n"], ["i32"], [null],
      "i32",
      [],
      { kind: "Identifier", name: "n", line: 0, col: 0 },
      null as any,
    );
    expect(() => toJS(fn)).toThrow();
  });
});

// ── Roundtrip tests ─────────────────────────────────────────────

describe("roundtrip (parse → stringify → parse)", () => {
  function roundtrip(src: string) {
    const result = mustParse(src);
    const text = stringify(result);
    return mustParse(text, { native: true });
  }

  it("primitives", () => {
    const r = roundtrip("x is 42\ny is 3.14\nz is true\nn is null");
    expect(r.x).toBe(42);
    expect(r.y).toBeCloseTo(3.14);
    expect(r.z).toBe(true);
    expect(r.n).toBe(null);
  });

  it("strings", () => {
    const r = roundtrip('s is "hello world"');
    expect(r.s).toBe("hello world");
  });

  it("lists", () => {
    const r = roundtrip("items is [1, 2, 3]");
    expect(r.items).toEqual([1, 2, 3]);
  });

  it("structs", () => {
    const r = roundtrip("config is { host is \"localhost\", port is 8080 }");
    expect(r.config).toEqual({ host: "localhost", port: 8080 });
  });

  it("enums", () => {
    const r = roundtrip("c is red from red, green, blue called Color");
    expect(r.c).toBe("red");
  });

  it("special floats", () => {
    const r = roundtrip("a is inf\nb is -inf\nc is nan");
    expect(r.a).toBe(Infinity);
    expect(r.b).toBe(-Infinity);
    expect(r.c).toBeNaN();
  });

  it("escape sequences", () => {
    const r = roundtrip('s is "tab\\there\\nnewline"');
    expect(r.s).toBe("tab\there\nnewline");
  });

  it("empty tuple roundtrips", () => {
    const r = roundtrip("t is ()");
    expect(r.t).toEqual([]);
  });
});

// ── parse convenience function ──────────────────────────────────

describe("parse", () => {
  it("returns UzonValue by default", () => {
    const r = mustParse("x is 42");
    expect(r.x).toBe(42n);
  });

  it("returns plain JS with native: true", () => {
    const r = mustParse("x is 42", { native: true });
    expect(r.x).toBe(42);
  });

  it("passes env to evaluator", () => {
    const r = mustParse("x is env.MY_VAR", { env: { MY_VAR: "hello" }, native: true });
    expect(r.x).toBe("hello");
  });
});
