// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import {
  parse,
  // Type guards
  isNull, isUndefined, isBool, isInteger, isFloat, isNumber,
  isString, isList, isTuple, isEnum, isUnion, isTaggedUnion, isStruct,
  // Type narrowing (optional)
  optionalNumber, optionalInteger, optionalString, optionalBool,
  optionalList, optionalTuple, optionalStruct, optionalEnum,
  // Deep access
  get, getOrThrow,
  // Pattern matching
  match,
  // JSON interop
  toJSON, fromJSON,
  // Merge
  merge, mergeValues,
  // Classes
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple, UZON_UNDEFINED,
} from "../src/index.js";
import type { UzonValue } from "../src/index.js";

// ── Type Guards ─────────────────────────────────────────────────

describe("type guards", () => {
  const r = parse('n is null\nb is true\ni is 42\nf is 3.14\ns is "hello"\nlist is [1, 2]\ntup is (1, 2)\ne is red from red, green, blue');

  it("isNull", () => {
    expect(isNull(r.n)).toBe(true);
    expect(isNull(r.b)).toBe(false);
  });

  it("isUndefined", () => {
    expect(isUndefined(UZON_UNDEFINED)).toBe(true);
    expect(isUndefined(r.n)).toBe(false);
  });

  it("isBool", () => {
    expect(isBool(r.b)).toBe(true);
    expect(isBool(r.i)).toBe(false);
  });

  it("isInteger", () => {
    expect(isInteger(r.i)).toBe(true);
    expect(isInteger(r.f)).toBe(false);
  });

  it("isFloat", () => {
    expect(isFloat(r.f)).toBe(true);
    expect(isFloat(r.i)).toBe(false);
  });

  it("isNumber", () => {
    expect(isNumber(r.i)).toBe(true);
    expect(isNumber(r.f)).toBe(true);
    expect(isNumber(r.s)).toBe(false);
  });

  it("isString", () => {
    expect(isString(r.s)).toBe(true);
    expect(isString(r.i)).toBe(false);
  });

  it("isList", () => {
    expect(isList(r.list)).toBe(true);
    expect(isList(r.tup)).toBe(false);
  });

  it("isTuple", () => {
    expect(isTuple(r.tup)).toBe(true);
    expect(isTuple(r.list)).toBe(false);
  });

  it("isEnum", () => {
    expect(isEnum(r.e)).toBe(true);
    expect(isEnum(r.s)).toBe(false);
  });

  it("isUnion", () => {
    const u = new UzonUnion(42n, ["i32", "string"]);
    expect(isUnion(u)).toBe(true);
    expect(isUnion(r.i)).toBe(false);
  });

  it("isTaggedUnion", () => {
    const tu = new UzonTaggedUnion(7n, "high", new Map([["high", "i32"]]));
    expect(isTaggedUnion(tu)).toBe(true);
    expect(isTaggedUnion(r.i)).toBe(false);
  });

  it("isStruct", () => {
    const r2 = parse('x is { a is 1 }');
    expect(isStruct(r2.x)).toBe(true);
    expect(isStruct(r.list)).toBe(false);
  });
});

// ── Optional Helpers ────────────────────────────────────────────

describe("optional helpers", () => {
  const r = parse('i is 42\ns is "hello"\nb is true\nf is 3.14\nlist is [1]\ntup is (1, 2)\nst is { x is 1 }\ne is red from red, green, blue');

  it("optionalNumber returns number on match", () => {
    expect(optionalNumber(r.i)).toBe(42);
    expect(optionalNumber(r.f)).toBe(3.14);
  });

  it("optionalNumber returns undefined on mismatch", () => {
    expect(optionalNumber(r.s)).toBeUndefined();
  });

  it("optionalInteger returns bigint on match", () => {
    expect(optionalInteger(r.i)).toBe(42n);
  });

  it("optionalInteger returns undefined on mismatch", () => {
    expect(optionalInteger(r.f)).toBeUndefined();
  });

  it("optionalString returns string on match", () => {
    expect(optionalString(r.s)).toBe("hello");
  });

  it("optionalString returns undefined on mismatch", () => {
    expect(optionalString(r.i)).toBeUndefined();
  });

  it("optionalBool returns boolean on match", () => {
    expect(optionalBool(r.b)).toBe(true);
  });

  it("optionalBool returns undefined on mismatch", () => {
    expect(optionalBool(r.i)).toBeUndefined();
  });

  it("optionalList", () => {
    expect(optionalList(r.list)).toHaveLength(1);
    expect(optionalList(r.tup)).toBeUndefined();
  });

  it("optionalTuple", () => {
    expect(optionalTuple(r.tup)).toBeInstanceOf(UzonTuple);
    expect(optionalTuple(r.list)).toBeUndefined();
  });

  it("optionalStruct", () => {
    expect(optionalStruct(r.st)).toBeDefined();
    expect(optionalStruct(r.list)).toBeUndefined();
  });

  it("optionalEnum", () => {
    expect(optionalEnum(r.e)).toBeInstanceOf(UzonEnum);
    expect(optionalEnum(r.s)).toBeUndefined();
  });
});

// ── Deep Access ─────────────────────────────────────────────────

describe("get / getOrThrow", () => {
  const r = parse(`
    config is {
      database is {
        host is "localhost"
        port is 8080
      }
      items is [10, 20, 30]
      matrix is [[1, 2], [3, 4]]
    }
  `);

  it("simple field access", () => {
    expect(get(r.config, "database")).toBeDefined();
  });

  it("nested field access", () => {
    expect(get(r.config, "database.host")).toBe("localhost");
    expect(get(r.config, "database.port")).toBe(8080n);
  });

  it("list indexing", () => {
    expect(get(r.config, "items[0]")).toBe(10n);
    expect(get(r.config, "items[2]")).toBe(30n);
  });

  it("combined field + index", () => {
    expect(get(r.config, "matrix[1][0]")).toBe(3n);
  });

  it("returns undefined for missing path", () => {
    expect(get(r.config, "database.missing")).toBeUndefined();
    expect(get(r.config, "items[10]")).toBeUndefined();
    expect(get(r.config, "nonexistent.deep.path")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    const r2 = parse("x is { a is null }");
    expect(get(r2.x, "a.b")).toBeUndefined();
  });

  it("getOrThrow throws on missing path", () => {
    expect(() => getOrThrow(r.config, "database.missing")).toThrow("Path 'database.missing' not found");
  });

  it("getOrThrow returns value on valid path", () => {
    expect(getOrThrow(r.config, "database.host")).toBe("localhost");
  });

  it("tuple indexing", () => {
    const r2 = parse("x is (10, 20, 30)");
    expect(get(r2.x, "[1]")).toBe(20n);
  });

  it("unwraps tagged union during traversal", () => {
    const inner = { val: 42n } as Record<string, UzonValue>;
    const tu = new UzonTaggedUnion(inner as UzonValue, "high", new Map([["high", "i32"]]));
    expect(get(tu, "val")).toBe(42n);
  });
});

// ── Pattern Matching ────────────────────────────────────────────

describe("match", () => {
  it("matches tagged union by tag", () => {
    const r = parse("x is 42 named high from high as i32, low as i32");
    const result = match(r.x, {
      high: (v) => `High: ${String(v)}`,
      low: (v) => `Low: ${String(v)}`,
    });
    expect(result).toBe("High: 42");
  });

  it("matches enum by variant", () => {
    const r = parse("x is red from red, green, blue");
    const result = match(r.x, {
      red: () => "#ff0000",
      green: () => "#00ff00",
      blue: () => "#0000ff",
    });
    expect(result).toBe("#ff0000");
  });

  it("uses default handler (_) when no match", () => {
    const r = parse("x is red from red, green, blue");
    const result = match(r.x, {
      green: () => "green",
      _: (v) => `other: ${String(v)}`,
    });
    expect(result).toBe("other: red");
  });

  it("throws when no match and no default", () => {
    const r = parse("x is red from red, green, blue");
    expect(() => match(r.x, {
      green: () => "green",
    })).toThrow("No match for variant 'red'");
  });

  it("throws for non-matchable values without default", () => {
    expect(() => match(42n as UzonValue, {
      something: () => "x",
    })).toThrow("match() requires a tagged union or enum");
  });

  it("default handler works for non-matchable values", () => {
    const result = match(42n as UzonValue, {
      _: (v) => `value: ${String(v)}`,
    });
    expect(result).toBe("value: 42");
  });

  it("unwraps union before matching", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    const u = new UzonUnion(e as UzonValue, ["Color", "string"]);
    const result = match(u, {
      red: () => "matched red",
      _: () => "other",
    });
    expect(result).toBe("matched red");
  });
});

// ── JSON Interop ────────────────────────────────────────────────

describe("toJSON", () => {
  it("converts primitives", () => {
    expect(toJSON(null)).toBe(null);
    expect(toJSON(true)).toBe(true);
    expect(toJSON(42n)).toBe(42);
    expect(toJSON(3.14)).toBe(3.14);
    expect(toJSON("hello")).toBe("hello");
  });

  it("converts bigint to string when configured", () => {
    expect(toJSON(42n, { bigint: "string" })).toBe("42");
  });

  it("converts unsafe bigint to string automatically", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(typeof toJSON(big)).toBe("string");
  });

  it("converts NaN/Infinity to null by default", () => {
    expect(toJSON(NaN)).toBe(null);
    expect(toJSON(Infinity)).toBe(null);
    expect(toJSON(-Infinity)).toBe(null);
  });

  it("converts NaN/Infinity to string when configured", () => {
    expect(toJSON(NaN, { nonFinite: "string" })).toBe("NaN");
    expect(toJSON(Infinity, { nonFinite: "string" })).toBe("Infinity");
    expect(toJSON(-Infinity, { nonFinite: "string" })).toBe("-Infinity");
  });

  it("converts enum to string", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    expect(toJSON(e)).toBe("red");
  });

  it("converts tagged union to { _tag, _value }", () => {
    const tu = new UzonTaggedUnion(7n, "high", new Map([["high", "i32"]]));
    expect(toJSON(tu)).toEqual({ _tag: "high", _value: 7 });
  });

  it("converts list/tuple", () => {
    expect(toJSON([1n, 2n, 3n] as UzonValue)).toEqual([1, 2, 3]);
    expect(toJSON(new UzonTuple([1n, 2n]))).toEqual([1, 2]);
  });

  it("converts struct", () => {
    const s = { a: 1n, b: "hello" } as Record<string, UzonValue>;
    expect(toJSON(s as UzonValue)).toEqual({ a: 1, b: "hello" });
  });

  it("result is JSON.stringify safe", () => {
    const r = parse('x is 42\ny is inf\nz is "hello"\nlist is [1, 2]');
    const json = {} as Record<string, any>;
    for (const [k, v] of Object.entries(r)) json[k] = toJSON(v);
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});

describe("fromJSON", () => {
  it("converts primitives", () => {
    expect(fromJSON(null)).toBe(null);
    expect(fromJSON(true)).toBe(true);
    expect(fromJSON(42)).toBe(42n);
    expect(fromJSON(3.14)).toBe(3.14);
    expect(fromJSON("hello")).toBe("hello");
  });

  it("converts arrays", () => {
    const list = fromJSON([1, 2, 3]);
    expect(Array.isArray(list)).toBe(true);
    expect((list as UzonValue[])[0]).toBe(1n);
  });

  it("converts objects to structs", () => {
    const s = fromJSON({ host: "localhost", port: 8080 });
    expect(isStruct(s)).toBe(true);
    expect((s as Record<string, UzonValue>).host).toBe("localhost");
    expect((s as Record<string, UzonValue>).port).toBe(8080n);
  });

  it("roundtrips tagged union via _tag/_value", () => {
    const tu = new UzonTaggedUnion(7n, "high", new Map([["high", "i32"]]));
    const json = toJSON(tu);
    const restored = fromJSON(json as any);
    expect(isTaggedUnion(restored)).toBe(true);
    expect((restored as UzonTaggedUnion).tag).toBe("high");
  });
});

// ── Merge ───────────────────────────────────────────────────────

describe("merge", () => {
  it("merges two structs", () => {
    const base = parse('host is "localhost"\nport is 8080');
    const over = parse('port is 3000');
    const result = merge(base, over);
    expect(result.host).toBe("localhost");
    expect(result.port).toBe(3000n);
  });

  it("deep merges nested structs", () => {
    const base = parse('db is { host is "localhost", port is 5432 }\napp is "myapp"');
    const over = parse('db is { port is 3306 }');
    const result = merge(base, over);
    const db = result.db as Record<string, UzonValue>;
    expect(db.host).toBe("localhost");
    expect(db.port).toBe(3306n);
    expect(result.app).toBe("myapp");
  });

  it("override adds new fields", () => {
    const base = parse('a is 1');
    const over = parse('b is 2');
    const result = merge(base, over);
    expect(result.a).toBe(1n);
    expect(result.b).toBe(2n);
  });

  it("non-struct values are replaced entirely", () => {
    const base = parse('x is [1, 2, 3]');
    const over = parse('x is [4, 5]');
    const result = merge(base, over);
    expect((result.x as UzonValue[]).length).toBe(2);
  });

  it("does not mutate inputs", () => {
    const base = parse('a is 1\nb is 2');
    const over = parse('b is 3\nc is 4');
    const baseCopy = { ...base };
    merge(base, over);
    expect(base.a).toBe(baseCopy.a);
    expect(base.b).toBe(baseCopy.b);
  });
});

describe("mergeValues", () => {
  it("replaces non-struct with override", () => {
    expect(mergeValues(42n, 100n)).toBe(100n);
    expect(mergeValues("old", "new")).toBe("new");
  });

  it("deep merges structs", () => {
    const a = { x: 1n, y: 2n } as Record<string, UzonValue>;
    const b = { y: 3n, z: 4n } as Record<string, UzonValue>;
    const result = mergeValues(a as UzonValue, b as UzonValue) as Record<string, UzonValue>;
    expect(result.x).toBe(1n);
    expect(result.y).toBe(3n);
    expect(result.z).toBe(4n);
  });
});
