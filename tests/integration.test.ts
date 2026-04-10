// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { parse } from "../src/index.js";
import { stringify } from "../src/stringify.js";
import { UzonEnum, UzonTaggedUnion, UzonTuple } from "../src/value.js";

function roundtrip(src: string): Record<string, any> {
  const first = parse(src);
  const text = stringify(first);
  return parse(text);
}

describe("integration: parse → stringify → parse", () => {
  it("primitives round-trip", () => {
    const result = roundtrip('a is 42\nb is 3.14\nc is true\nd is null\ne is "hello"');
    expect(result.a).toBe(42n);
    expect(result.b).toBe(3.14);
    expect(result.c).toBe(true);
    expect(result.d).toBe(null);
    expect(result.e).toBe("hello");
  });

  it("list round-trip", () => {
    const result = roundtrip("nums is [1, 2, 3]");
    expect(result.nums).toEqual([1n, 2n, 3n]);
  });

  it("struct round-trip", () => {
    const result = roundtrip('server is { host is "localhost", port is 8080 }');
    expect(result.server).toEqual({ host: "localhost", port: 8080n });
  });

  it("nested struct round-trip", () => {
    const result = roundtrip('config is { db is { host is "127.0.0.1", port is 5432 }, debug is false }');
    expect(result.config).toEqual({
      db: { host: "127.0.0.1", port: 5432n },
      debug: false,
    });
  });

  it("enum round-trip", () => {
    const result = roundtrip("color is green from red, green, blue");
    expect(result.color).toBeInstanceOf(UzonEnum);
    expect((result.color as UzonEnum).value).toBe("green");
  });

  it("tagged union round-trip", () => {
    const result = roundtrip("val is 7 named ln from n as i32, ln as i128, f as f80");
    expect(result.val).toBeInstanceOf(UzonTaggedUnion);
    expect((result.val as UzonTaggedUnion).tag).toBe("ln");
    expect((result.val as UzonTaggedUnion).value).toBe(7n);
  });

  it("special floats round-trip", () => {
    const result = roundtrip("a is inf\nb is -inf");
    expect(result.a).toBe(Infinity);
    expect(result.b).toBe(-Infinity);
  });

  it("string with escapes round-trip", () => {
    const result = roundtrip('msg is "line1\\nline2\\ttab"');
    expect(result.msg).toBe("line1\nline2\ttab");
  });

  it("empty containers round-trip", () => {
    const result = roundtrip("b is ()");
    expect(result.b).toBeInstanceOf(UzonTuple);
    expect((result.b as UzonTuple).elements).toEqual([]);
  });
});

describe("integration: parse convenience function", () => {
  it("parses simple document", () => {
    const result = parse('name is "uzon"\nversion is 1');
    expect(result.name).toBe("uzon");
    expect(result.version).toBe(1n);
  });

  it("supports env option", () => {
    const result = parse("port is env.PORT", { env: { PORT: "3000" } });
    expect(result.port).toBe("3000");
  });
});
