// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { Evaluator } from "../src/evaluator.js";
import { UzonFunction, UzonTuple } from "../src/value.js";

function evaluate(src: string) {
  const tokens = new Lexer(src).tokenize();
  const doc = new Parser(tokens).parse();
  return new Evaluator().evaluate(doc);
}

describe("Functions (§3.8)", () => {
  describe("basic function definition and call", () => {
    it("defines and calls a simple function", () => {
      const r = evaluate(`
        double is function n as i32 returns i32 { n * 2 }
        result is double(5)
      `);
      expect(r.result).toBe(10n);
    });

    it("zero-parameter function", () => {
      const r = evaluate(`
        getAnswer is function returns i32 { 42 }
        result is getAnswer()
      `);
      expect(r.result).toBe(42n);
    });

    it("function with multiple params", () => {
      const r = evaluate(`
        add is function a as i32, b as i32 returns i32 { a + b }
        result is add(3, 7)
      `);
      expect(r.result).toBe(10n);
    });

    it("function returning bool", () => {
      const r = evaluate(`
        isEven is function n as i64 returns bool { n % 2 is 0 }
        result is isEven(4)
      `);
      expect(r.result).toBe(true);
    });

    it("function returning string", () => {
      const r = evaluate(`
        greet is function name as string returns string { "Hello, " ++ name }
        result is greet("UZON")
      `);
      expect(r.result).toBe("Hello, UZON");
    });

    it("function with float params", () => {
      const r = evaluate(`
        area is function r as f64 returns f64 { r * r * 3.14 }
        result is area(2.0)
      `);
      expect(r.result).toBeCloseTo(12.56);
    });
  });

  describe("default parameters", () => {
    it("uses default when argument omitted", () => {
      const r = evaluate(`
        greet is function name as string default "world" returns string {
          "Hello, " ++ name
        }
        result is greet()
      `);
      expect(r.result).toBe("Hello, world");
    });

    it("overrides default when argument provided", () => {
      const r = evaluate(`
        greet is function name as string default "world" returns string {
          "Hello, " ++ name
        }
        result is greet("UZON")
      `);
      expect(r.result).toBe("Hello, UZON");
    });

    it("multiple params with defaults", () => {
      const r = evaluate(`
        f is function a as i32, b as i32 default 10, c as i32 default 20 returns i32 {
          a + b + c
        }
        r1 is f(1)
        r2 is f(1, 2)
        r3 is f(1, 2, 3)
      `);
      expect(r.r1).toBe(31n);
      expect(r.r2).toBe(23n);
      expect(r.r3).toBe(6n);
    });
  });

  describe("multi-expression body", () => {
    it("intermediate bindings in function body", () => {
      const r = evaluate(`
        clamp is function n as i32, lo as i32, hi as i32 returns i32 {
          clamped_lo is if n < lo then lo else n
          if clamped_lo > hi then hi else clamped_lo
        }
        r1 is clamp(5, 0, 10)
        r2 is clamp(-5, 0, 10)
        r3 is clamp(15, 0, 10)
      `);
      expect(r.r1).toBe(5n);
      expect(r.r2).toBe(0n);
      expect(r.r3).toBe(10n);
    });
  });

  describe("outer references in function body", () => {
    it("references outer binding", () => {
      const r = evaluate(`
        base is 10
        addBase is function n as i64 returns i64 { n + base }
        result is addBase(5)
      `);
      expect(r.result).toBe(15n);
    });

    it("function calling another function", () => {
      const r = evaluate(`
        double is function n as i32 returns i32 { n * 2 }
        addOne is function n as i32 returns i32 { n + 1 }
        transform is function n as i32 returns i32 { addOne(double(n)) }
        result is transform(5)
      `);
      expect(r.result).toBe(11n);
    });
  });

  describe("function as value", () => {
    it("function is a UzonFunction value", () => {
      const r = evaluate(`
        f is function n as i32 returns i32 { n * 2 }
      `);
      expect(r.f).toBeInstanceOf(UzonFunction);
    });
  });

  describe("error cases", () => {
    it("wrong argument count", () => {
      expect(() => evaluate(`
        add is function a as i32, b as i32 returns i32 { a + b }
        result is add(1)
      `)).toThrow();
    });

    it("too many arguments", () => {
      expect(() => evaluate(`
        f is function n as i32 returns i32 { n }
        result is f(1, 2)
      `)).toThrow();
    });

    it("argument type mismatch", () => {
      expect(() => evaluate(`
        f is function n as i32 returns i32 { n }
        result is f("hello")
      `)).toThrow();
    });

    it("return type mismatch", () => {
      expect(() => evaluate(`
        f is function n as i32 returns bool { n }
        result is f(1)
      `)).toThrow();
    });

    it("calling non-function is type error", () => {
      expect(() => evaluate(`
        x is 42
        result is x(1)
      `)).toThrow();
    });

    it("function equality is type error", () => {
      expect(() => evaluate(`
        f is function n as i32 returns i32 { n }
        g is function n as i32 returns i32 { n }
        result is f is g
      `)).toThrow(/function/i);
    });

    it("recursion is detected", () => {
      expect(() => evaluate(`
        f is function n as i32 returns i32 { g(n) }
        g is function n as i32 returns i32 { f(n) }
        result is f(1)
      `)).toThrow();
    });
  });
});

describe("Struct Extend (§3.2.2)", () => {
  it("adds new fields to a struct", () => {
    const r = evaluate(`
      base is { host is "localhost", port is 8080 }
      extended is base extends { environment is "production" }
    `);
    expect(r.extended).toEqual({
      host: "localhost",
      port: 8080n,
      environment: "production",
    });
  });

  it("overrides existing fields and adds new ones", () => {
    const r = evaluate(`
      base is { host is "localhost", port is 8080 }
      secure is base extends { port is 443, tls is true, cert is "/path" }
    `);
    expect(r.secure).toEqual({
      host: "localhost",
      port: 443n,
      tls: true,
      cert: "/path",
    });
  });

  it("rejects extends with no new fields", () => {
    expect(() => evaluate(`
      base is { x is 1, y is 2 }
      alt is base extends { x is 10 }
    `)).toThrow(/new field/i);
  });

  it("rejects extends on non-struct", () => {
    expect(() => evaluate(`
      x is 42
      result is x extends { a is 1 }
    `)).toThrow(/struct/i);
  });

  it("rejects type-incompatible override in extends", () => {
    expect(() => evaluate(`
      base is { x is 1, y is 2 }
      result is base extends { x is "hello", z is 3 }
    `)).toThrow(/type/i);
  });

  it("override field with null is allowed", () => {
    const r = evaluate(`
      base is { x is 1, y is 2 }
      result is base extends { x is null, z is 3 }
    `);
    expect(r.result).toEqual({ x: null, y: 2n, z: 3n });
  });
});

describe("Standard Library (§5.16)", () => {
  describe("std.len", () => {
    it("list length", () => {
      const r = evaluate(`result is std.len([1, 2, 3])`);
      expect(r.result).toBe(3n);
    });

    it("tuple length", () => {
      const r = evaluate(`result is std.len((1, "two", true))`);
      expect(r.result).toBe(3n);
    });

    it("struct field count", () => {
      const r = evaluate(`result is std.len({ a is 1, b is 2 })`);
      expect(r.result).toBe(2n);
    });

    it("empty list", () => {
      const r = evaluate(`result is std.len([] as [i32])`);
      expect(r.result).toBe(0n);
    });
  });

  describe("std.has", () => {
    it("list contains value", () => {
      const r = evaluate(`result is std.has([1, 2, 3], 2)`);
      expect(r.result).toBe(true);
    });

    it("list does not contain value", () => {
      const r = evaluate(`result is std.has([1, 2, 3], 5)`);
      expect(r.result).toBe(false);
    });

    it("struct has field", () => {
      const r = evaluate(`result is std.has({ name is "UZON" }, "name")`);
      expect(r.result).toBe(true);
    });

    it("struct missing field", () => {
      const r = evaluate(`result is std.has({ name is "UZON" }, "port")`);
      expect(r.result).toBe(false);
    });
  });

  describe("std.get", () => {
    it("list element by index", () => {
      const r = evaluate(`result is std.get([10, 20, 30], 1)`);
      expect(r.result).toBe(20n);
    });

    it("out of bounds returns undefined (filtered from result)", () => {
      const r = evaluate(`result is std.get([10, 20], 5) or else -1`);
      expect(r.result).toBe(-1n);
    });

    it("struct field by key", () => {
      const r = evaluate(`result is std.get({ port is 8080 }, "port")`);
      expect(r.result).toBe(8080n);
    });
  });

  describe("std.keys", () => {
    it("returns field names", () => {
      const r = evaluate(`result is std.keys({ host is "localhost", port is 8080 })`);
      expect(r.result).toEqual(["host", "port"]);
    });
  });

  describe("std.values", () => {
    it("returns field values as tuple", () => {
      const r = evaluate(`result is std.values({ a is 1, b is 2, c is 3 })`);
      expect(r.result).toBeInstanceOf(UzonTuple);
      expect((r.result as UzonTuple).elements).toEqual([1n, 2n, 3n]);
    });

    it("supports mixed-type structs", () => {
      const r = evaluate(`result is std.values({ a is 1, b is "hi" })`);
      expect(r.result).toBeInstanceOf(UzonTuple);
      expect((r.result as UzonTuple).elements).toEqual([1n, "hi"]);
    });
  });

  describe("std.map", () => {
    it("maps a function over a list", () => {
      const r = evaluate(`
        numbers are 1, 2, 3, 4, 5
        doubled is std.map(numbers, function n as i64 returns i64 { n * 2 })
      `);
      expect(r.doubled).toEqual([2n, 4n, 6n, 8n, 10n]);
    });
  });

  describe("std.filter", () => {
    it("filters a list", () => {
      const r = evaluate(`
        numbers are 1, 2, 3, 4, 5
        evens is std.filter(numbers, function n as i64 returns bool { n % 2 is 0 })
      `);
      expect(r.evens).toEqual([2n, 4n]);
    });
  });

  describe("std.sort", () => {
    it("sorts ascending", () => {
      const r = evaluate(`
        numbers are 5, 2, 8, 1, 9
        ascending is std.sort(numbers, function a as i64, b as i64 returns bool { a < b })
      `);
      expect(r.ascending).toEqual([1n, 2n, 5n, 8n, 9n]);
    });

    it("sorts descending", () => {
      const r = evaluate(`
        numbers are 5, 2, 8, 1, 9
        descending is std.sort(numbers, function a as i64, b as i64 returns bool { a > b })
      `);
      expect(r.descending).toEqual([9n, 8n, 5n, 2n, 1n]);
    });

    it("sorts structs by field", () => {
      const r = evaluate(`
        entries are
            { name is "Charlie", score is 70 as i32 },
            { name is "Alice", score is 95 as i32 },
            { name is "Bob", score is 85 as i32 }
            called Entry

        by_score is std.sort(
            entries,
            function a as Entry, b as Entry returns bool { a.score > b.score }
        )
      `);
      expect((r.by_score as any)[0].name).toBe("Alice");
      expect((r.by_score as any)[1].name).toBe("Bob");
      expect((r.by_score as any)[2].name).toBe("Charlie");
    });

    it("is stable — equal elements keep original order", () => {
      const r = evaluate(`
        items are
            { key is "a", val is 1 as i32 },
            { key is "b", val is 1 as i32 },
            { key is "c", val is 2 as i32 }
            called Item

        sorted is std.sort(
            items,
            function a as Item, b as Item returns bool { a.val < b.val }
        )
      `);
      expect((r.sorted as any)[0].key).toBe("a");
      expect((r.sorted as any)[1].key).toBe("b");
      expect((r.sorted as any)[2].key).toBe("c");
    });

    it("returns empty list for empty input", () => {
      const r = evaluate(`
        empty are "x" as [string]
        empty2 is std.filter(empty, function s as string returns bool { false })
        sorted is std.sort(empty2, function a as string, b as string returns bool { a < b })
      `);
      expect(r.sorted).toEqual([]);
    });

    it("rejects non-bool comparator", () => {
      expect(() => evaluate(`
        numbers are 1, 2, 3
        bad is std.sort(numbers, function a as i64, b as i64 returns i64 { a })
      `)).toThrow(/must return bool/);
    });
  });

  describe("std.reduce", () => {
    it("reduces a list to a sum", () => {
      const r = evaluate(`
        numbers are 1, 2, 3, 4, 5
        total is std.reduce(numbers, 0, function acc as i64, n as i64 returns i64 { acc + n })
      `);
      expect(r.total).toBe(15n);
    });
  });

  describe("numeric utilities", () => {
    it("std.isNan detects nan", () => {
      const r = evaluate(`
        result is std.isNan(nan)
        notNan is std.isNan(3.14)
      `);
      expect(r.result).toBe(true);
      expect(r.notNan).toBe(false);
    });

    it("std.isInf detects infinity", () => {
      const r = evaluate(`
        posInf is std.isInf(inf)
        negInf is std.isInf(-inf)
        notInf is std.isInf(3.14)
      `);
      expect(r.posInf).toBe(true);
      expect(r.negInf).toBe(true);
      expect(r.notInf).toBe(false);
    });

    it("std.isFinite checks finiteness", () => {
      const r = evaluate(`
        finite is std.isFinite(3.14)
        infNotFinite is std.isFinite(inf)
        nanNotFinite is std.isFinite(nan)
      `);
      expect(r.finite).toBe(true);
      expect(r.infNotFinite).toBe(false);
      expect(r.nanNotFinite).toBe(false);
    });
  });

  describe("string utilities", () => {
    it("std.join joins string list", () => {
      const r = evaluate(`result is std.join(["a", "b", "c"], ":")`);
      expect(r.result).toBe("a:b:c");
    });

    it("std.join with empty list", () => {
      const r = evaluate(`result is std.join([] as [string], ":")`);
      expect(r.result).toBe("");
    });

    it("std.join with single element", () => {
      const r = evaluate(`result is std.join(["hello"], ":")`);
      expect(r.result).toBe("hello");
    });

    it("std.replace replaces all occurrences", () => {
      const r = evaluate(`result is std.replace("a:b:c", ":", "-")`);
      expect(r.result).toBe("a-b-c");
    });

    it("std.replace with no match", () => {
      const r = evaluate(`result is std.replace("hello", "xyz", "!")`);
      expect(r.result).toBe("hello");
    });

    it("std.replace with empty target returns original", () => {
      const r = evaluate(`result is std.replace("hello", "", "x")`);
      expect(r.result).toBe("hello");
    });

    it("std.split splits by delimiter", () => {
      const r = evaluate(`result is std.split("a:b:c", ":")`);
      expect(r.result).toEqual(["a", "b", "c"]);
    });

    it("std.split with no delimiter match", () => {
      const r = evaluate(`result is std.split("hello", ":")`);
      expect(r.result).toEqual(["hello"]);
    });

    it("std.split empty string", () => {
      const r = evaluate(`result is std.split("", ":")`);
      expect(r.result).toEqual([""]);
    });

    it("std.trim removes whitespace", () => {
      const r = evaluate(`result is std.trim("  hello  ")`);
      expect(r.result).toBe("hello");
    });

    it("std.trim no-op on clean string", () => {
      const r = evaluate(`result is std.trim("hello")`);
      expect(r.result).toBe("hello");
    });

    it("std.join and std.split roundtrip", () => {
      const r = evaluate(`result is std.join(std.split("a:b:c", ":"), ":")`);
      expect(r.result).toBe("a:b:c");
    });
  });
});

describe("Function type registration and conformance (§3.8)", () => {
  it("function with called registers a named function type", () => {
    const r = evaluate(`
      mapper is function a as i32 returns i32 { a * 2 } called Mapper
      f is function x as i32 returns i32 { x + 1 } as Mapper
    `);
    expect(r.f).toBeInstanceOf(UzonFunction);
  });

  it("anonymous function conforms to named function type", () => {
    const r = evaluate(`
      transform is function n as i64 returns i64 { n } called Transform
      identity is function n as i64 returns i64 { n } as Transform
      result is identity(42)
    `);
    expect(r.result).toBe(42n);
  });

  it("rejects non-function annotated as function type", () => {
    expect(() => evaluate(`
      fn is function n as i32 returns i32 { n } called Fn
      x is 42 as Fn
    `)).toThrow(/function type/i);
  });

  it("rejects function with wrong param count", () => {
    expect(() => evaluate(`
      bop is function a as i32, b as i32 returns i32 { a + b } called BinaryOp
      f is function n as i32 returns i32 { n } as BinaryOp
    `)).toThrow(/parameter/i);
  });

  it("rejects function with wrong param type", () => {
    expect(() => evaluate(`
      fn is function n as i32 returns i32 { n } called Fn
      f is function n as i64 returns i32 { n to i32 } as Fn
    `)).toThrow(/parameter.*type/i);
  });

  it("rejects function with wrong return type", () => {
    expect(() => evaluate(`
      fn is function n as i32 returns i32 { n } called Fn
      f is function n as i32 returns i64 { n to i64 } as Fn
    `)).toThrow(/return type/i);
  });

  it("nominal identity: separately called types are incompatible", () => {
    expect(() => evaluate(`
      a is function n as i32 returns i32 { n } called TypeA
      b is function n as i32 returns i32 { n } called TypeB
      f is a as TypeB
    `)).toThrow(/nominal identity/i);
  });
});

describe("With/Extends chaining prevention", () => {
  it("rejects chained with expressions", () => {
    expect(() => evaluate(`
      base is { x is 1, y is 2 }
      result is base with { x is 10 } with { y is 20 }
    `)).toThrow(/chaining/i);
  });

  it("rejects chained extends expressions", () => {
    expect(() => evaluate(`
      base is { x is 1 }
      result is base extends { y is 2 } extends { z is 3 }
    `)).toThrow(/chaining/i);
  });

  it("rejects mixed with/extends chaining", () => {
    expect(() => evaluate(`
      base is { x is 1 }
      result is base extends { y is 2 } with { x is 10 }
    `)).toThrow(/chaining/i);
  });
});

describe("Tagged union ordered comparison (§5.4)", () => {
  it("rejects ordered comparison between tagged unions", () => {
    expect(() => evaluate(`
      a is 5 named high from high as i32, low as i32
      b is 3 named high from high as i32, low as i32
      result is a < b
    `)).toThrow(/tagged union/i);
  });
});

describe("Tuple type annotation (§3.3)", () => {
  it("validates matching tuple type", () => {
    const r = evaluate(`result is (1, "hello", true) as (i64, string, bool)`);
    expect(r.result).toBeTruthy();
  });

  it("rejects tuple with wrong element count", () => {
    expect(() => evaluate(`
      result is (1, 2) as (i64, i64, i64)
    `)).toThrow(/element/i);
  });

  it("rejects tuple with wrong element type", () => {
    expect(() => evaluate(`
      result is (1, 2, "hello") as (i64, i64, i64)
    `)).toThrow(/element.*string.*expected.*i64/i);
  });
});

describe("List type annotation for non-numeric types (§3.4)", () => {
  it("validates [bool] list annotation", () => {
    const r = evaluate(`result is [true, false, true] as [bool]`);
    expect(r.result).toEqual([true, false, true]);
  });

  it("rejects wrong element type for [bool]", () => {
    expect(() => evaluate(`
      result is [1, 2, 3] as [bool]
    `)).toThrow(/element.*expected bool/i);
  });

  it("validates [string] list annotation", () => {
    const r = evaluate(`result is ["a", "b", "c"] as [string]`);
    expect(r.result).toEqual(["a", "b", "c"]);
  });

  it("rejects wrong element type for [string]", () => {
    expect(() => evaluate(`
      result is [1, 2, 3] as [string]
    `)).toThrow(/element.*expected string/i);
  });

  it("null is allowed in typed list", () => {
    const r = evaluate(`result is [true, null, false] as [bool]`);
    expect(r.result).toEqual([true, null, false]);
  });
});

describe("With on undefined base (§3.2.1)", () => {
  it("throws runtime error when with base is undefined", () => {
    expect(() => evaluate(`
      result is nonexistent with { x is 1 }
    `)).toThrow(/undefined/i);
  });
});

describe("Untagged union case rejection (§3.6)", () => {
  it("rejects case on untagged union", () => {
    expect(() => evaluate(`
      u is 42 from union i32, string
      result is case u when 42 then "yes" else "no"
    `)).toThrow(/untagged union/i);
  });
});

describe("Null conversion type errors (§5.11.0)", () => {
  it("null to i32 is type error", () => {
    expect(() => evaluate(`result is null to i32`)).toThrow(/null.*i32/i);
  });

  it("null to bool is type error", () => {
    expect(() => evaluate(`result is null to bool`)).toThrow(/null.*bool/i);
  });

  it("null to string is allowed", () => {
    const r = evaluate(`result is null to string`);
    expect(r.result).toBe("null");
  });

  it("null to null is identity", () => {
    const r = evaluate(`result is null to null`);
    expect(r.result).toBe(null);
  });
});

describe("With type preservation (§3.2.1)", () => {
  it("with preserves named struct type", () => {
    const r = evaluate(`
      base is { x is 0 as i32, y is 0 as i32 } called Point
      p is base with { x is 10 }
      q is p as Point
    `);
    expect(r.q).toEqual({ x: 10n, y: 0n });
  });
});

describe("Named list types (§3.4)", () => {
  it("registers list type via called", () => {
    const r = evaluate(`
      colors are "red", "green", "blue" called Colors
      more are "cyan", "magenta" as Colors
    `);
    expect(r.more).toEqual(["cyan", "magenta"]);
  });
});

describe("Enum variant inference in or else (§3.5)", () => {
  it("or else right operand resolves bare identifier as enum variant", () => {
    const r = evaluate(`
      color is red from red, green, blue called Color
      result is color or else green
    `);
    expect(r.result).toBeTruthy();
  });
});

describe("Numeric conversion overflow checks (§5.11)", () => {
  it("integer to f16 overflow is rejected", () => {
    expect(() => evaluate(`result is 70000 to f16`)).toThrow();
  });

  it("float to f16 overflow is rejected", () => {
    expect(() => evaluate(`result is 70000.0 to f16`)).toThrow();
  });

  it("integer to f32 within range is valid", () => {
    const r = evaluate(`result is 100 to f32`);
    expect(r.result).toBe(100);
  });

  it("string 'Infinity' to f64 is rejected", () => {
    expect(() => evaluate(`result is "Infinity" to f64`)).toThrow();
  });

  it("string 'inf' to f64 is valid", () => {
    const r = evaluate(`result is "inf" to f64`);
    expect(r.result).toBe(Infinity);
  });
});

describe("and/or/not on undefined (§3.1)", () => {
  it("and with undefined is runtime error", () => {
    expect(() => evaluate(`result is missing and true`)).toThrow(/undefined/i);
  });

  it("or with undefined is runtime error", () => {
    expect(() => evaluate(`result is missing or false`)).toThrow(/undefined/i);
  });

  it("not with undefined is runtime error", () => {
    expect(() => evaluate(`result is not missing`)).toThrow(/undefined/i);
  });

  it("and/or undefined in non-taken branch is suppressed", () => {
    const r = evaluate(`result is if true then 42 else missing and true`);
    expect(r.result).toBe(42n);
  });
});

describe("Undefined as function argument (§3.1)", () => {
  it("undefined argument is a runtime error (suppressed in speculative eval)", () => {
    const r = evaluate(`
      f is function n as i32 returns i32 { n }
      result is if true then 42 else f(missing)
    `);
    expect(r.result).toBe(42n);
  });

  it("undefined argument in taken branch is an error", () => {
    expect(() => evaluate(`
      f is function n as i32 returns i32 { n }
      result is f(missing)
    `)).toThrow(/undefined/i);
  });
});

describe("std.filter return type validation (§5.16.2)", () => {
  it("rejects non-bool return type even on empty list", () => {
    expect(() => evaluate(`
      result is std.filter([] as [i32], function n as i32 returns i32 { n })
    `)).toThrow(/bool/i);
  });
});

describe("from union in struct with binding termination (§9)", () => {
  it("union type list terminates before next binding", () => {
    const r = evaluate(`
      config is {
        u is 3.14 from union i32, f64
        x is "hello"
      }
    `);
    expect(r.config).toEqual({ u: expect.anything(), x: "hello" });
  });
});

describe("Multiline string comment detection (§4.4.2)", () => {
  it("rejects comment between multiline string parts", () => {
    expect(() => evaluate(`result is "hello" // comment\n"world"`)).toThrow(/comment.*multiline/i);
  });

  it("allows multiline string without comment", () => {
    const r = evaluate(`result is "hello"\n"world"`);
    expect(r.result).toBe("hello\nworld");
  });
});

describe("Empty list type inference in if/case (§3.4)", () => {
  it("if-then empty list adopts type from else branch", () => {
    const r = evaluate(`
      items is [1, 2, 3]
      result is if true then [] else items
    `);
    expect(r.result).toEqual([]);
  });

  it("if-else empty list adopts type from then branch", () => {
    const r = evaluate(`
      items is [1, 2, 3]
      result is if false then items else []
    `);
    expect(r.result).toEqual([]);
  });

  it("case empty list adopts type from other branch", () => {
    const r = evaluate(`
      items is [10, 20]
      x is 1
      result is case x
        when 1 then []
        when 2 then items
        else items
    `);
    expect(r.result).toEqual([]);
  });
});

describe("Empty list concat (§3.4)", () => {
  it("[] ++ typed_list infers type", () => {
    const r = evaluate(`result is [] ++ [1, 2, 3]`);
    expect(r.result).toEqual([1n, 2n, 3n]);
  });

  it("typed_list ++ [] infers type", () => {
    const r = evaluate(`result is [1, 2, 3] ++ []`);
    expect(r.result).toEqual([1n, 2n, 3n]);
  });

  it("[] ++ [] is invalid", () => {
    expect(() => evaluate(`result is [] ++ []`)).toThrow(/empty list/i);
  });
});
