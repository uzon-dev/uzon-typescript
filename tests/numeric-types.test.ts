// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { Evaluator } from "../src/evaluator.js";

function eval_(src: string, env?: Record<string, string>) {
  const tokens = new Lexer(src).tokenize();
  const doc = new Parser(tokens).parse();
  return new Evaluator({ env }).evaluate(doc);
}

function throws(src: string, msgPart?: string) {
  expect(() => eval_(src)).toThrow(msgPart);
}

describe("Typed Numerics — Comprehensive Operations", () => {
  describe("Arithmetic", () => {
    it("same typed int: +, -, *, /, %, ^", () => {
      expect(eval_("x is (10 as i32) + (20 as i32)").x).toBe(30n);
      expect(eval_("x is (100 as u8) + (50 as u8)").x).toBe(150n);
      expect(eval_("x is (100 as i16) - (200 as i16)").x).toBe(-100n);
      expect(eval_("x is (10 as u16) * (5 as u16)").x).toBe(50n);
      expect(eval_("x is (100 as i32) / (3 as i32)").x).toBe(33n);
      expect(eval_("x is (17 as u8) % (5 as u8)").x).toBe(2n);
      expect(eval_("x is (2 as u8) ^ (7 as u8)").x).toBe(128n);
    });

    it("same typed float: +, -, *, /", () => {
      expect(eval_("x is (1.5 as f32) + (2.5 as f32)").x).toBe(4.0);
      expect(eval_("x is (10.0 as f64) - (3.5 as f64)").x).toBe(6.5);
      expect(eval_("x is (2.0 as f32) * (3.0 as f32)").x).toBe(6.0);
      expect(eval_("x is (10.0 as f64) / (4.0 as f64)").x).toBe(2.5);
    });

    it("typed + untyped → untyped adopts", () => {
      expect(eval_("x is (10 as i32) + 20").x).toBe(30n);
      expect(eval_("x is 100 + (50 as u16)").x).toBe(150n);
      expect(eval_("x is (1.5 as f32) + 2.5").x).toBe(4.0);
    });

    it("different typed → error", () => {
      throws("x is (10 as i32) + (20 as u32)", "same type");
      throws("x is (1 as i8) + (2 as i16)", "same type");
      throws("x is (1.0 as f32) + (2.0 as f64)", "same type");
      throws("x is (1 as u8) + (1 as i8)", "same type");
    });

    it("overflow on result → runtime error", () => {
      throws("x is (200 as u8) + (100 as u8)", "does not fit");
      throws("x is (-100 as i8) - (100 as i8)", "does not fit");
      throws("x is (20 as u8) * (20 as u8)", "does not fit");
      throws("x is (2 as u8) ^ (8 as u8)", "does not fit");
    });

    it("float overflow on result → runtime error", () => {
      throws("x is (1.7e38 as f32) * (3.0 as f32)", "does not fit");
      throws("x is (60000.0 as f16) + (10000.0 as f16)", "does not fit");
    });

    it("division/modulo by zero → runtime error", () => {
      throws("x is (10 as i32) / (0 as i32)", "Division by zero");
      throws("x is (10 as i32) % (0 as i32)", "Modulo by zero");
    });

    it("negative exponent for integer → runtime error", () => {
      throws("x is (2 as i32) ^ ((-1) as i32)", "non-negative");
    });
  });

  describe("Comparison (<, <=, >, >=)", () => {
    it("same typed int comparison", () => {
      expect(eval_("x is (10 as i32) < (20 as i32)").x).toBe(true);
      expect(eval_("x is (255 as u8) >= (0 as u8)").x).toBe(true);
      expect(eval_("x is (5 as u16) > (10 as u16)").x).toBe(false);
      expect(eval_("x is (42 as i64) <= (42 as i64)").x).toBe(true);
    });

    it("same typed float comparison", () => {
      expect(eval_("x is (3.14 as f64) <= (3.14 as f64)").x).toBe(true);
      expect(eval_("x is (1.0 as f32) > (2.0 as f32)").x).toBe(false);
    });

    it("typed + untyped comparison", () => {
      expect(eval_("x is (10 as i32) < 20").x).toBe(true);
      expect(eval_("x is 5 < (10 as u16)").x).toBe(true);
    });

    it("different typed comparison → error", () => {
      throws("x is (10 as i32) < (20 as u32)", "same type");
      throws("x is (1.0 as f32) < (2.0 as f64)", "same type");
      throws("x is (1 as u8) >= (1 as i8)", "same type");
    });
  });

  describe("Equality (is / is not)", () => {
    it("same typed equality", () => {
      expect(eval_("x is (42 as i32) is (42 as i32)").x).toBe(true);
      expect(eval_("x is (42 as i32) is (43 as i32)").x).toBe(false);
      expect(eval_("x is (1 as u8) is not (2 as u8)").x).toBe(true);
      expect(eval_("x is (3.14 as f64) is (3.14 as f64)").x).toBe(true);
    });

    it("null is always compatible with typed", () => {
      expect(eval_("x is (42 as i32) is null").x).toBe(false);
      expect(eval_("x is null is (42 as i32)").x).toBe(false);
    });
  });

  describe("Unary Negation", () => {
    it("negate typed int", () => {
      expect(eval_("x is -(10 as i32)").x).toBe(-10n);
      expect(eval_("x is -(127 as i8)").x).toBe(-127n);
    });

    it("negate typed float", () => {
      expect(eval_("x is -(1.5 as f32)").x).toBe(-1.5);
    });

    it("negate overflow → runtime error", () => {
      throws("x is -((-128) as i8)", "does not fit");
    });
  });

  describe("Type Annotation (as)", () => {
    it("valid int annotations", () => {
      expect(eval_("x is 42 as i32").x).toBe(42n);
      expect(eval_("x is 255 as u8").x).toBe(255n);
      expect(eval_("x is 0 as i0").x).toBe(0n);
      expect(eval_("x is 0 as u0").x).toBe(0n);
    });

    it("valid float annotations", () => {
      expect(eval_("x is 3.14 as f32").x).toBe(3.14);
      expect(eval_("x is 100.0 as f16").x).toBe(100.0);
      expect(eval_("x is 1.0e30 as f32").x).toBe(1.0e30);
    });

    it("inf/nan valid for all float types", () => {
      expect(eval_("x is inf as f16").x).toBe(Infinity);
      expect(eval_("x is -inf as f64").x).toBe(-Infinity);
      expect(Number.isNaN(eval_("x is nan as f32").x)).toBe(true);
    });

    it("overflow → error", () => {
      throws("x is 256 as u8", "does not fit");
      throws("x is -129 as i8", "does not fit");
      throws("x is -1 as u8", "does not fit");
      throws("x is 70000.0 as f16", "does not fit");
      throws("x is 3.5e38 as f32", "does not fit");
    });

    it("cross-category → type error", () => {
      throws("x is 3.14 as i32", "Cannot annotate float");
      throws("x is 42 as f32", "Cannot annotate integer");
      throws('x is "hello" as i32', "Cannot annotate");
      throws("x is true as i32", "Cannot annotate");
    });
  });

  describe("Conversion (to)", () => {
    it("int → int (range checked)", () => {
      expect(eval_("x is (1000 as i32) to u16").x).toBe(1000n);
      expect(eval_("x is (255 as u8) to i32").x).toBe(255n);
      throws("x is (256 as i32) to u8", "does not fit");
      throws("x is (-1 as i32) to u8", "does not fit");
    });

    it("int → float (widening)", () => {
      expect(eval_("x is (42 as i32) to f64").x).toBe(42);
      expect(eval_("x is (255 as u8) to f32").x).toBe(255);
    });

    it("float → int (truncates toward zero)", () => {
      expect(eval_("x is (3.9 as f64) to i32").x).toBe(3n);
      expect(eval_("x is (-3.9 as f64) to i32").x).toBe(-3n);
      throws("x is (inf as f64) to i32", "Cannot convert inf");
      throws("x is (nan as f64) to i32", "Cannot convert nan");
    });

    it("float → float (precision change)", () => {
      const r = eval_("x is (3.14 as f32) to f64");
      expect(Math.abs((r.x as number) - 3.14)).toBeLessThan(0.001);
    });

    it("typed → string", () => {
      expect(eval_("x is (42 as i32) to string").x).toBe("42");
      expect(eval_("x is (3.14 as f64) to string").x).toBe("3.14");
      expect(eval_("x is (255 as u8) to string").x).toBe("255");
    });

    it("string → typed int", () => {
      expect(eval_('x is "8080" to u16').x).toBe(8080n);
      expect(eval_('x is "-42" to i8').x).toBe(-42n);
      throws('x is "256" to u8');
      throws('x is "-1" to u8');
    });

    it("string → typed float", () => {
      const r = eval_('x is "3.14" to f64');
      expect(Math.abs((r.x as number) - 3.14)).toBeLessThan(0.001);
      expect(eval_('x is "inf" to f32').x).toBe(Infinity);
    });
  });

  describe("String Interpolation", () => {
    it("interpolates typed ints and floats", () => {
      expect(eval_('x is 42 as i32\ny is "val={x}"').y).toBe("val=42");
      expect(eval_('x is 255 as u8\ny is "val={x}"').y).toBe("val=255");
      expect(eval_('x is 3.14 as f32\ny is "val={x}"').y).toBe("val=3.14");
      expect(eval_('x is inf as f64\ny is "val={x}"').y).toBe("val=inf");
    });
  });

  describe("Or Else", () => {
    it("undefined or else typed → typed returned", () => {
      expect(eval_("x is missing or else (8080 as u16)").x).toBe(8080n);
    });

    it("typed or else same → left returned", () => {
      expect(eval_("a is 10 as i32\nx is a or else (0 as i32)").x).toBe(10n);
    });

    it("typed or else untyped → left returned", () => {
      expect(eval_("a is 42 as i32\nx is a or else 0").x).toBe(42n);
    });

    it("null or else typed → null passes through", () => {
      expect(eval_("a is null\nx is a or else (0 as i32)").x).toBe(null);
    });
  });

  describe("If/Case branches", () => {
    it("if with typed branches", () => {
      expect(eval_("x is if true then (10 as i32) else (20 as i32)").x).toBe(10n);
      expect(eval_("x is if false then (10 as i32) else (20 as i32)").x).toBe(20n);
    });

    it("if typed + untyped → untyped adopts", () => {
      expect(eval_("x is if true then (10 as i32) else 20").x).toBe(10n);
      expect(eval_("x is if false then (10 as i32) else 20").x).toBe(20n);
    });

    it("if typed + null", () => {
      expect(eval_("x is if true then (42 as u8) else null").x).toBe(42n);
      expect(eval_("x is if false then (42 as u8) else null").x).toBe(null);
    });

    it("case with typed branches", () => {
      const r = eval_(`
        x is 1 as i32
        y is case x
          when 1 as i32 then 10 as i32
          when 2 as i32 then 20 as i32
          else 0 as i32
      `);
      expect(r.y).toBe(10n);
    });
  });

  describe("List with typed elements", () => {
    it("list as [type] annotation", () => {
      expect(eval_("x is [1, 2, 3] as [i32]").x).toEqual([1n, 2n, 3n]);
      expect(eval_("x is [0, 127, 255] as [u8]").x).toEqual([0n, 127n, 255n]);
      expect(eval_("x is [1.0, 2.0] as [f32]").x).toEqual([1.0, 2.0]);
    });

    it("list as [type] overflow → error", () => {
      throws("x is [0, 256] as [u8]", "does not fit");
    });

    it("list element access preserves type for arithmetic", () => {
      expect(eval_(`
        x is [10, 20, 30] as [i32]
        y is x.first + (5 as i32)
      `).y).toBe(15n);
    });

    it("list concat preserves element type", () => {
      expect(eval_(`
        a is [1, 2] as [i32]
        b is [3, 4] as [i32]
        c is a ++ b
        y is c.first + (10 as i32)
      `).y).toBe(11n);
    });

    it("list repetition preserves element type", () => {
      expect(eval_(`
        a is [1, 2] as [i32]
        b is a ** 2
        y is b.first + (10 as i32)
      `).y).toBe(11n);
    });

    it("in operator with typed list", () => {
      expect(eval_(`
        x is [10, 20, 30] as [i32]
        y is (20 as i32) in x
      `).y).toBe(true);

      expect(eval_(`
        x is [10, 20, 30] as [i32]
        y is 20 in x
      `).y).toBe(true);

      expect(eval_(`
        x is [10, 20, 30] as [i32]
        y is 99 in x
      `).y).toBe(false);
    });
  });

  describe("Tuple with typed elements", () => {
    it("tuple element access preserves type", () => {
      expect(eval_(`
        x is (10 as i32, "hello", 3.14 as f64)
        y is x.first + (5 as i32)
      `).y).toBe(15n);
    });

    it("tuple third element typed float", () => {
      const r = eval_(`
        x is (1, 2, 3.14 as f64)
        y is x.third + (0.86 as f64)
      `);
      expect(Math.abs((r.y as number) - 4.0)).toBeLessThan(0.001);
    });
  });

  describe("Struct field typed numerics", () => {
    it("struct field preserves type for arithmetic", () => {
      const r = eval_(`
        config is { port is 8080 as u16, timeout is 30 as u8 }
        x is config.port + (1 as u16)
        y is config.timeout + (10 as u8)
      `);
      expect(r.x).toBe(8081n);
      expect(r.y).toBe(40n);
    });

    it("struct field different types → arithmetic error", () => {
      throws(`
        config is { port is 8080 as u16, timeout is 30 as u8 }
        x is config.port + config.timeout
      `, "same type");
    });

    it("nested struct field preserves type", () => {
      expect(eval_(`
        outer is { inner is { val is 42 as i32 } }
        x is outer.inner.val + (8 as i32)
      `).x).toBe(50n);
    });
  });

  describe("With override typed numerics", () => {
    it("same typed override", () => {
      expect(eval_(`
        config is { port is 8080 as u16 }
        new_config is config with { port is 9090 as u16 }
        x is new_config.port
      `).x).toBe(9090n);
    });

    it("untyped literal adopts base field type", () => {
      expect(eval_(`
        config is { port is 8080 as u16 }
        new_config is config with { port is 9090 }
        x is new_config.port
      `).x).toBe(9090n);
    });

    it("untyped literal overflow → runtime error", () => {
      throws(`
        config is { port is 8080 as u16 }
        new_config is config with { port is 70000 }
      `, "does not fit");
    });

    it("different typed override → type error", () => {
      throws(`
        config is { port is 8080 as u16 }
        new_config is config with { port is 9090 as u32 }
      `, "types must match");
    });

    it("with preserves type for subsequent arithmetic", () => {
      expect(eval_(`
        config is { port is 8080 as u16 }
        new_config is config with { port is 9090 }
        x is new_config.port + (10 as u16)
      `).x).toBe(9100n);
    });
  });

  describe("Type propagation through control flow", () => {
    it("if preserves numericType of taken branch", () => {
      expect(eval_(`
        x is if true then (42 as i32) else (0 as i32)
        y is x + (8 as i32)
      `).y).toBe(50n);
    });

    it("case preserves numericType", () => {
      expect(eval_(`
        flag is true
        x is case flag
          when true then 100 as u16
          else 0 as u16
        y is x + (5 as u16)
      `).y).toBe(105n);
    });

    it("or else preserves type of left", () => {
      expect(eval_(`
        a is 42 as i32
        x is a or else 0
        y is x + (8 as i32)
      `).y).toBe(50n);
    });

    it("chained typed arithmetic", () => {
      expect(eval_(`
        a is 10 as i32
        b is 20 as i32
        c is a + b
        d is c * (2 as i32)
      `).d).toBe(60n);
    });
  });

  describe("Edge Cases", () => {
    it("large bit widths", () => {
      expect(eval_("x is 170141183460469231731687303715884105727 as i128").x)
        .toBe(170141183460469231731687303715884105727n);
      expect(eval_("x is 18446744073709551615 as u64").x)
        .toBe(18446744073709551615n);
      throws("x is 18446744073709551616 as u64", "does not fit");
    });

    it("1-bit types", () => {
      expect(eval_("x is 0 as i1").x).toBe(0n);
      expect(eval_("x is -1 as i1").x).toBe(-1n);
      throws("x is 1 as i1", "does not fit");

      expect(eval_("x is 0 as u1").x).toBe(0n);
      expect(eval_("x is 1 as u1").x).toBe(1n);
      throws("x is 2 as u1", "does not fit");
    });

    it("float division by zero → inf (not error)", () => {
      expect(eval_("x is (1.0 as f64) / (0.0 as f64)").x).toBe(Infinity);
    });

    it("f32 inf arithmetic stays inf", () => {
      expect(eval_("x is (inf as f32) + (1.0 as f32)").x).toBe(Infinity);
    });

    it("f64 nan propagation", () => {
      expect(Number.isNaN(eval_("x is (nan as f64) + (1.0 as f64)").x)).toBe(true);
    });
  });

  describe("Speculative Evaluation with typed numerics", () => {
    it("runtime error (overflow) in non-taken branch → suppressed", () => {
      expect(eval_("x is if true then (10 as u8) else (200 as u8) + (200 as u8)").x).toBe(10n);
    });

    it("type error (mismatched types) in non-taken branch → NOT suppressed", () => {
      throws('x is if true then (10 as i32) else "hello"', "same type");
    });
  });

  describe("Default types (i64/f64)", () => {
    it("bare integer defaults to i64", () => {
      expect(eval_("x is 7").x).toBe(7n);
    });

    it("bare integer + bare integer → both i64, result i64", () => {
      expect(eval_("x is 7 + 8").x).toBe(15n);
    });

    it("bare integer exceeding i64 range → error", () => {
      throws("x is 9223372036854775808", "does not fit in i64");
    });

    it("bare negative integer at i64 min → valid", () => {
      expect(eval_("x is -9223372036854775808").x).toBe(-9223372036854775808n);
    });

    it("as overrides default — large value with as i128 is valid", () => {
      expect(eval_("x is 170141183460469231731687303715884105727 as i128").x)
        .toBe(170141183460469231731687303715884105727n);
    });

    it("as overrides default — large value with as u128 is valid", () => {
      expect(eval_("x is 18446744073709551616 as u128").x)
        .toBe(18446744073709551616n);
    });

    it("bare literal adopts explicit type in arithmetic", () => {
      expect(eval_("x is 7 + (10 as u8)").x).toBe(17n);
      expect(eval_("x is (10 as u8) + 7").x).toBe(17n);
    });

    it("literal adoption validates range", () => {
      throws("x is 1000 + (10 as u8)", "does not fit");
      throws("x is -1 + (10 as u8)", "does not fit");
    });

    it("binding reference is NOT adoptable (concrete i64)", () => {
      throws(`
        a is 7
        x is a + (10 as u8)
      `, "same type");
    });

    it("binding reference same default → both i64 → works", () => {
      expect(eval_(`
        a is 7
        b is 8
        x is a + b
      `).x).toBe(15n);
    });

    it("bare float defaults to f64", () => {
      expect(eval_("x is 3.14").x).toBe(3.14);
    });

    it("bare float literal adopts f32 in arithmetic", () => {
      expect(eval_("x is 1.5 + (2.5 as f32)").x).toBe(4.0);
    });

    it("large bare integer in arithmetic → i64 overflow", () => {
      throws("x is 9223372036854775807 + 1", "does not fit");
    });

    it("literal in comparison adopts explicit type", () => {
      expect(eval_("x is 10 < (20 as u8)").x).toBe(true);
    });

    it("literal overflow in comparison adoption", () => {
      throws("x is 1000 < (20 as u8)", "does not fit");
    });
  });
});
