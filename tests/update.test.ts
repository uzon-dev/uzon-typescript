// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import {
  parse,
  withField, withoutField,
  append, prepend, setAt, removeAt,
  tupleSetAt,
  UzonTuple,
  displayValue,
  UzonEnum, UzonTaggedUnion, UzonUnion, UzonFunction,
} from "../src/index.js";
import type { UzonValue } from "../src/index.js";

function mustParse(src: string): Record<string, UzonValue> {
  const r = parse(src);
  if (r.errors) throw r.errors[0];
  return r.value;
}

// ── Struct updates ──────────────────────────────────────────────

describe("withField", () => {
  it("adds a new field", () => {
    const s = mustParse('a is 1');
    const s2 = withField(s, "b", 2n);
    expect(s2.a).toBe(1n);
    expect(s2.b).toBe(2n);
  });

  it("replaces an existing field", () => {
    const s = mustParse('a is 1');
    const s2 = withField(s, "a", 99n);
    expect(s2.a).toBe(99n);
  });

  it("does not mutate the original", () => {
    const s = mustParse('a is 1');
    withField(s, "b", 2n);
    expect(s.b).toBeUndefined();
  });
});

describe("withoutField", () => {
  it("removes a field", () => {
    const s = mustParse('a is 1\nb is 2');
    const s2 = withoutField(s, "b");
    expect(s2.a).toBe(1n);
    expect(s2.b).toBeUndefined();
  });

  it("does not mutate the original", () => {
    const s = mustParse('a is 1\nb is 2');
    withoutField(s, "b");
    expect(s.b).toBe(2n);
  });

  it("no-op for missing field", () => {
    const s = mustParse('a is 1');
    const s2 = withoutField(s, "missing");
    expect(s2.a).toBe(1n);
  });
});

// ── List updates ────────────────────────────────────────────────

describe("append", () => {
  it("appends to list", () => {
    const list = [1n, 2n] as UzonValue[];
    const list2 = append(list, 3n);
    expect(list2).toEqual([1n, 2n, 3n]);
  });

  it("does not mutate original", () => {
    const list = [1n] as UzonValue[];
    append(list, 2n);
    expect(list).toEqual([1n]);
  });
});

describe("prepend", () => {
  it("prepends to list", () => {
    const list = [2n, 3n] as UzonValue[];
    const list2 = prepend(list, 1n);
    expect(list2).toEqual([1n, 2n, 3n]);
  });
});

describe("setAt", () => {
  it("replaces element at index", () => {
    const list = [1n, 2n, 3n] as UzonValue[];
    const list2 = setAt(list, 1, 99n);
    expect(list2).toEqual([1n, 99n, 3n]);
  });

  it("does not mutate original", () => {
    const list = [1n, 2n] as UzonValue[];
    setAt(list, 0, 99n);
    expect(list[0]).toBe(1n);
  });

  it("throws on out-of-bounds", () => {
    const list = [1n] as UzonValue[];
    expect(() => setAt(list, 5, 99n)).toThrow(RangeError);
    expect(() => setAt(list, -1, 99n)).toThrow(RangeError);
  });
});

describe("removeAt", () => {
  it("removes element at index", () => {
    const list = [1n, 2n, 3n] as UzonValue[];
    const list2 = removeAt(list, 1);
    expect(list2).toEqual([1n, 3n]);
  });

  it("throws on out-of-bounds", () => {
    const list = [1n] as UzonValue[];
    expect(() => removeAt(list, 1)).toThrow(RangeError);
  });
});

// ── Tuple updates ───────────────────────────────────────────────

describe("tupleSetAt", () => {
  it("replaces element at index", () => {
    const t = new UzonTuple([1n, "hello", true]);
    const t2 = tupleSetAt(t, 1, "world");
    expect(t2.elements[0]).toBe(1n);
    expect(t2.elements[1]).toBe("world");
    expect(t2.elements[2]).toBe(true);
  });

  it("returns new tuple instance", () => {
    const t = new UzonTuple([1n, 2n]);
    const t2 = tupleSetAt(t, 0, 99n);
    expect(t2).not.toBe(t);
    expect(t.elements[0]).toBe(1n); // original unchanged
  });

  it("throws on out-of-bounds", () => {
    const t = new UzonTuple([1n]);
    expect(() => tupleSetAt(t, 1, 2n)).toThrow(RangeError);
  });
});

// ── Display ─────────────────────────────────────────────────────

describe("displayValue", () => {
  it("displays null", () => {
    expect(displayValue(null)).toBe("null");
  });

  it("displays booleans", () => {
    expect(displayValue(true)).toBe("true");
    expect(displayValue(false)).toBe("false");
  });

  it("displays integers", () => {
    expect(displayValue(42n)).toBe("42");
  });

  it("displays floats", () => {
    expect(displayValue(3.14)).toBe("3.14");
    expect(displayValue(NaN)).toBe("nan");
    expect(displayValue(Infinity)).toBe("inf");
  });

  it("displays strings with quotes", () => {
    expect(displayValue("hello")).toBe('"hello"');
  });

  it("displays lists", () => {
    expect(displayValue([1n, 2n, 3n] as UzonValue)).toBe("[1, 2, 3]");
  });

  it("displays empty list", () => {
    expect(displayValue([] as UzonValue)).toBe("[]");
  });

  it("displays structs", () => {
    const s = { a: 1n, b: "hello" } as Record<string, UzonValue>;
    expect(displayValue(s as UzonValue)).toBe('{ a: 1, b: "hello" }');
  });

  it("displays empty struct", () => {
    expect(displayValue({} as UzonValue)).toBe("{}");
  });

  it("displays tuples", () => {
    const t = new UzonTuple([1n, "hello", true]);
    expect(displayValue(t)).toBe('(1, "hello", true)');
    expect(t.toString()).toBe('(1, "hello", true)');
  });

  it("displays enums", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    expect(displayValue(e)).toBe("red");
  });

  it("displays tagged unions", () => {
    const tu = new UzonTaggedUnion(42n, "high", new Map([["high", "i32"]]));
    expect(displayValue(tu)).toBe("high(42)");
  });

  it("displays unions", () => {
    const u = new UzonUnion(42n, ["i32", "string"]);
    expect(displayValue(u)).toBe("42");
  });

  it("displays nested structures", () => {
    const s = { items: [1n, 2n] as UzonValue, point: new UzonTuple([10n, 20n]) } as Record<string, UzonValue>;
    expect(displayValue(s as UzonValue)).toBe("{ items: [1, 2], point: (10, 20) }");
  });
});

describe("compound type toString", () => {
  it("UzonTuple toString", () => {
    const t = new UzonTuple([1n, 2n, 3n]);
    expect(String(t)).toBe("(1, 2, 3)");
    expect(`tuple: ${t}`).toBe("tuple: (1, 2, 3)");
  });

  it("UzonEnum toString", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    expect(String(e)).toBe("red");
  });

  it("UzonTaggedUnion toString", () => {
    const tu = new UzonTaggedUnion(42n, "high", new Map([["high", "i32"]]));
    expect(String(tu)).toBe("42");
  });

  it("UzonFunction toString", () => {
    const f = new UzonFunction(
      ["x", "y"], ["i32", "i32"], [null, null], "i32",
      null, null, null,
    );
    expect(String(f)).toBe("fn(x: i32, y: i32) -> i32");
  });
});
