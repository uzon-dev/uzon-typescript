// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import {
  uzon,
  UzonEnum, UzonUnion, UzonTaggedUnion, UzonTuple,
  isInteger, isFloat, isStruct, isList, isTuple, isEnum, isTaggedUnion,
} from "../src/index.js";
import type { UzonValue } from "../src/index.js";

// ── uzon() auto-convert ────────────────────────────────────────

describe("uzon() auto-convert", () => {
  it("converts integers (number → bigint)", () => {
    const r = uzon({ x: 42 });
    expect(r.x).toBe(42n);
    expect(isInteger(r.x)).toBe(true);
  });

  it("preserves floats", () => {
    const r = uzon({ x: 3.14 });
    expect(r.x).toBe(3.14);
    expect(isFloat(r.x)).toBe(true);
  });

  it("preserves strings", () => {
    const r = uzon({ s: "hello" });
    expect(r.s).toBe("hello");
  });

  it("preserves booleans", () => {
    const r = uzon({ b: true });
    expect(r.b).toBe(true);
  });

  it("preserves null", () => {
    const r = uzon({ n: null });
    expect(r.n).toBe(null);
  });

  it("preserves bigint", () => {
    const r = uzon({ x: 100n });
    expect(r.x).toBe(100n);
  });

  it("converts nested objects to structs", () => {
    const r = uzon({ db: { host: "localhost", port: 5432 } });
    expect(isStruct(r.db)).toBe(true);
    const db = r.db as Record<string, UzonValue>;
    expect(db.host).toBe("localhost");
    expect(db.port).toBe(5432n);
  });

  it("converts arrays to lists", () => {
    const r = uzon({ items: [1, 2, 3] });
    expect(isList(r.items)).toBe(true);
    expect((r.items as UzonValue[])[0]).toBe(1n);
  });

  it("passes through UzonEnum instances", () => {
    const e = new UzonEnum("red", ["red", "green", "blue"]);
    const r = uzon({ color: e });
    expect(isEnum(r.color)).toBe(true);
  });
});

// ── Factory helpers ─────────────────────────────────────────────

describe("uzon.int", () => {
  it("creates bigint from number", () => {
    expect(uzon.int(42)).toBe(42n);
  });

  it("creates bigint from bigint", () => {
    expect(uzon.int(100n)).toBe(100n);
  });
});

describe("uzon.float", () => {
  it("creates float, even for integer values", () => {
    const r = uzon({ rate: uzon.float(42) });
    expect(r.rate).toBe(42);
    expect(typeof r.rate).toBe("number");
  });

  it("preserves non-integer floats", () => {
    const r = uzon({ rate: uzon.float(3.14) });
    expect(r.rate).toBe(3.14);
  });
});

describe("uzon.enum", () => {
  it("creates UzonEnum", () => {
    const e = uzon.enum("red", ["red", "green", "blue"]);
    expect(e).toBeInstanceOf(UzonEnum);
    expect(e.value).toBe("red");
    expect(e.variants).toEqual(["red", "green", "blue"]);
  });

  it("supports typeName", () => {
    const e = uzon.enum("red", ["red", "green", "blue"], "Color");
    expect(e.typeName).toBe("Color");
  });
});

describe("uzon.tuple", () => {
  it("creates UzonTuple with auto-converted elements", () => {
    const t = uzon.tuple(1, "hello", true);
    expect(t).toBeInstanceOf(UzonTuple);
    expect(t.length).toBe(3);
    expect(t.elements[0]).toBe(1n);
    expect(t.elements[1]).toBe("hello");
    expect(t.elements[2]).toBe(true);
  });

  it("empty tuple", () => {
    const t = uzon.tuple();
    expect(t.length).toBe(0);
  });
});

describe("uzon.tagged", () => {
  it("creates UzonTaggedUnion", () => {
    const tu = uzon.tagged("high", 7, { high: "i32", low: "i32" });
    expect(tu).toBeInstanceOf(UzonTaggedUnion);
    expect(tu.tag).toBe("high");
    expect(tu.value).toBe(7n);
    expect(tu.variants.get("high")).toBe("i32");
  });

  it("supports typeName", () => {
    const tu = uzon.tagged("ok", "success", { ok: "string", err: "string" }, "Result");
    expect(tu.typeName).toBe("Result");
  });
});

describe("uzon.union", () => {
  it("creates UzonUnion", () => {
    const u = uzon.union(42, ["i32", "string"]);
    expect(u).toBeInstanceOf(UzonUnion);
    expect(u.value).toBe(42n);
    expect(u.types).toEqual(["i32", "string"]);
  });
});

describe("uzon.list", () => {
  it("creates list with auto-converted elements", () => {
    const l = uzon.list(1, 2, 3);
    expect(l).toEqual([1n, 2n, 3n]);
  });

  it("empty list", () => {
    const l = uzon.list();
    expect(l).toEqual([]);
  });
});

describe("uzon.struct", () => {
  it("creates struct with auto-converted values", () => {
    const s = uzon.struct({ a: 1, b: "hello" });
    expect(s.a).toBe(1n);
    expect(s.b).toBe("hello");
  });
});

describe("uzon.value", () => {
  it("auto-converts a single value", () => {
    expect(uzon.value(42)).toBe(42n);
    expect(uzon.value("hello")).toBe("hello");
    expect(uzon.value(3.14)).toBe(3.14);
    expect(uzon.value(null)).toBe(null);
    expect(uzon.value(true)).toBe(true);
  });
});

// ── Tagged template literal ─────────────────────────────────────

describe("uzon template literal", () => {
  it("parses simple UZON", () => {
    const r = uzon`
      host is "localhost"
      port is 8080
    `;
    expect(r.host).toBe("localhost");
    expect(r.port).toBe(8080n);
  });

  it("interpolates numbers", () => {
    const port = 8080;
    const r = uzon`port is ${port}`;
    expect(r.port).toBe(8080n);
  });

  it("interpolates strings", () => {
    const host = "example.com";
    const r = uzon`host is ${host}`;
    expect(r.host).toBe("example.com");
  });

  it("interpolates booleans", () => {
    const enabled = true;
    const r = uzon`enabled is ${enabled}`;
    expect(r.enabled).toBe(true);
  });

  it("interpolates null", () => {
    const r = uzon`x is ${null}`;
    expect(r.x).toBe(null);
  });

  it("interpolates arrays", () => {
    const items = [1, 2, 3];
    const r = uzon`items is ${items}`;
    expect(isList(r.items)).toBe(true);
    expect((r.items as UzonValue[])[0]).toBe(1n);
  });

  it("interpolates objects", () => {
    const db = { host: "localhost", port: 5432 };
    const r = uzon`config is ${db}`;
    expect(isStruct(r.config)).toBe(true);
    const config = r.config as Record<string, UzonValue>;
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(5432n);
  });

  it("interpolates bigint", () => {
    const big = 999999999999999999n;
    const r = uzon`x is ${big}`;
    expect(r.x).toBe(999999999999999999n);
  });

  it("mixed interpolation and UZON syntax", () => {
    const host = "localhost";
    const port = 8080;
    const r = uzon`
      host is ${host}
      port is ${port}
      color is red from red, green, blue
    `;
    expect(r.host).toBe("localhost");
    expect(r.port).toBe(8080n);
    expect(isEnum(r.color)).toBe(true);
  });

  it("escapes special characters in interpolated strings", () => {
    const msg = 'say "hello"\nnew line';
    const r = uzon`msg is ${msg}`;
    expect(r.msg).toBe('say "hello"\nnew line');
  });
});

// ── Combined usage ──────────────────────────────────────────────

describe("combined usage", () => {
  it("factory helpers inside uzon()", () => {
    const r = uzon({
      host: "localhost",
      port: 8080,
      rate: uzon.float(60),
      color: uzon.enum("red", ["red", "green", "blue"], "Color"),
      point: uzon.tuple(10, 20),
      status: uzon.tagged("ok", "success", { ok: "string", err: "string" }),
    });
    expect(r.host).toBe("localhost");
    expect(r.port).toBe(8080n);
    expect(typeof r.rate).toBe("number");
    expect(r.rate).toBe(60);
    expect(isEnum(r.color)).toBe(true);
    expect(isTuple(r.point)).toBe(true);
    expect(isTaggedUnion(r.status)).toBe(true);
  });
});
