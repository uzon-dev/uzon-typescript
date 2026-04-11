// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import {
  parse,
  asNumber, asInteger, asString, asBool,
  asList, asTuple, asStruct, asEnum,
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple,
} from "../src/index.js";
import type { UzonValue } from "../src/index.js";

// ── valueOf / toString ──────────────────────────────────────────

describe("valueOf / toString", () => {
  it("UzonEnum valueOf returns variant string", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    expect(e.valueOf()).toBe("red");
    expect(`${e}`).toBe("red");
  });

  it("UzonUnion valueOf returns inner value", () => {
    const u = new UzonUnion(42n, ["i32", "string"]);
    expect(u.valueOf()).toBe(42n);
    expect(`${u}`).toBe("42");
  });

  it("UzonTaggedUnion valueOf returns inner value", () => {
    const tu = new UzonTaggedUnion(
      7n, "high",
      new Map([["high", "i32"], ["low", "i32"]]),
    );
    expect(tu.valueOf()).toBe(7n);
    expect(`${tu}`).toBe("7");
  });
});

// ── asNumber ────────────────────────────────────────────────────

describe("asNumber", () => {
  it("float → number", () => {
    const r = parse("x is 3.14");
    expect(asNumber(r.x)).toBe(3.14);
  });

  it("integer (bigint) → number", () => {
    const r = parse("x is 42");
    expect(asNumber(r.x)).toBe(42);
  });

  it("inf → Infinity", () => {
    const r = parse("x is inf");
    expect(asNumber(r.x)).toBe(Infinity);
  });

  it("unwraps tagged union", () => {
    const r = parse("x is 7 named high from high as i32, low as i32");
    expect(asNumber(r.x)).toBe(7);
  });

  it("throws on string", () => {
    const r = parse('x is "hello"');
    expect(() => asNumber(r.x)).toThrow("Expected a number, got string");
  });

  it("throws on null", () => {
    const r = parse("x is null");
    expect(() => asNumber(r.x)).toThrow("Expected a number, got null");
  });
});

// ── asInteger ───────────────────────────────────────────────────

describe("asInteger", () => {
  it("bigint → bigint", () => {
    const r = parse("x is 42");
    expect(asInteger(r.x)).toBe(42n);
  });

  it("throws on float", () => {
    const r = parse("x is 3.14");
    expect(() => asInteger(r.x)).toThrow("Expected an integer, got float");
  });
});

// ── asString ────────────────────────────────────────────────────

describe("asString", () => {
  it("string → string", () => {
    const r = parse('x is "hello"');
    expect(asString(r.x)).toBe("hello");
  });

  it("enum → variant name", () => {
    const r = parse("x is red from red, green, blue");
    expect(asString(r.x)).toBe("red");
  });

  it("throws on integer", () => {
    const r = parse("x is 42");
    expect(() => asString(r.x)).toThrow("Expected a string, got integer");
  });
});

// ── asBool ──────────────────────────────────────────────────────

describe("asBool", () => {
  it("true → true", () => {
    const r = parse("x is true");
    expect(asBool(r.x)).toBe(true);
  });

  it("false → false", () => {
    const r = parse("x is false");
    expect(asBool(r.x)).toBe(false);
  });

  it("throws on string", () => {
    const r = parse('x is "true"');
    expect(() => asBool(r.x)).toThrow("Expected a bool, got string");
  });
});

// ── asList ──────────────────────────────────────────────────────

describe("asList", () => {
  it("list → array", () => {
    const r = parse("x is [1, 2, 3]");
    const list = asList(r.x);
    expect(list).toHaveLength(3);
    expect(list[0]).toBe(1n);
  });

  it("throws on tuple", () => {
    const r = parse("x is (1, 2)");
    expect(() => asList(r.x)).toThrow("Expected a list, got tuple");
  });
});

// ── asTuple ─────────────────────────────────────────────────────

describe("asTuple", () => {
  it("tuple → UzonTuple", () => {
    const r = parse("x is (1, 2, 3)");
    const t = asTuple(r.x);
    expect(t).toBeInstanceOf(UzonTuple);
    expect(t.length).toBe(3);
  });

  it("throws on list", () => {
    const r = parse("x is [1, 2, 3]");
    expect(() => asTuple(r.x)).toThrow("Expected a tuple, got list");
  });
});

// ── asStruct ────────────────────────────────────────────────────

describe("asStruct", () => {
  it("struct → object", () => {
    const r = parse('x is { name is "test", port is 8080 }');
    const s = asStruct(r.x);
    expect(s.name).toBe("test");
    expect(s.port).toBe(8080n);
  });

  it("throws on list", () => {
    const r = parse("x is [1, 2]");
    expect(() => asStruct(r.x)).toThrow("Expected a struct, got list");
  });
});

// ── asEnum ──────────────────────────────────────────────────────

describe("asEnum", () => {
  it("enum → UzonEnum", () => {
    const r = parse("x is red from red, green, blue called Color");
    const e = asEnum(r.x);
    expect(e).toBeInstanceOf(UzonEnum);
    expect(e.value).toBe("red");
    expect(e.typeName).toBe("Color");
  });

  it("throws on string", () => {
    const r = parse('x is "red"');
    expect(() => asEnum(r.x)).toThrow("Expected an enum, got string");
  });
});

// ── Union unwrapping ────────────────────────────────────────────

describe("union unwrapping", () => {
  it("asNumber unwraps union", () => {
    const u = new UzonUnion(42n, ["i32", "string"]);
    expect(asNumber(u)).toBe(42);
  });

  it("asString unwraps nested union with enum", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    const u = new UzonUnion(e as UzonValue, ["Color", "string"]);
    expect(asString(u)).toBe("red");
  });

  it("asBool unwraps tagged union", () => {
    const tu = new UzonTaggedUnion(
      true, "enabled",
      new Map([["enabled", "bool"], ["disabled", "bool"]]),
    );
    expect(asBool(tu)).toBe(true);
  });
});
