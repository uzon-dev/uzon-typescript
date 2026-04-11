// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFile, stringifyFile, watch } from "../src/index.js";

// ── Temp dir helpers ────────────────────────────────────────────

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "uzon-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true }); } catch {}
  }
  tempDirs = [];
});

// ── parseFile ───────────────────────────────────────────────────

describe("parseFile", () => {
  it("parses a simple UZON file", () => {
    const dir = makeTempDir();
    const file = join(dir, "test.uzon");
    writeFileSync(file, 'host is "localhost"\nport is 8080\n');

    const result = parseFile(file);
    expect(result.host).toBe("localhost");
    expect(result.port).toBe(8080n);
  });

  it("resolves relative path", () => {
    const dir = makeTempDir();
    const file = join(dir, "config.uzon");
    writeFileSync(file, 'x is 42\n');

    const result = parseFile(file);
    expect(result.x).toBe(42n);
  });

  it("supports native option", () => {
    const dir = makeTempDir();
    const file = join(dir, "native.uzon");
    writeFileSync(file, 'x is 42\ny is 3.14\n');

    const result = parseFile(file, { native: true });
    expect(result.x).toBe(42);
    expect(typeof result.x).toBe("number");
    expect(result.y).toBe(3.14);
  });

  it("supports native with bigint option", () => {
    const dir = makeTempDir();
    const file = join(dir, "bigint.uzon");
    writeFileSync(file, 'x is 42\n');

    const result = parseFile(file, { native: true, bigint: "string" });
    expect(result.x).toBe("42");
  });

  it("throws on missing file", () => {
    expect(() => parseFile("/nonexistent/path/file.uzon")).toThrow();
  });

  it("throws on syntax error", () => {
    const dir = makeTempDir();
    const file = join(dir, "bad.uzon");
    writeFileSync(file, 'x is is is\n');

    expect(() => parseFile(file)).toThrow();
  });

  it("resolves struct imports relative to file", () => {
    const dir = makeTempDir();
    const baseFile = join(dir, "base.uzon");
    const mainFile = join(dir, "main.uzon");
    writeFileSync(baseFile, 'x is 1\ny is 2\n');
    writeFileSync(mainFile, 'config is struct "base.uzon"\n');

    const result = parseFile(mainFile);
    const config = result.config as Record<string, any>;
    expect(config.x).toBe(1n);
    expect(config.y).toBe(2n);
  });

  it("supports env option", () => {
    const dir = makeTempDir();
    const file = join(dir, "env.uzon");
    writeFileSync(file, 'port is env.PORT\n');

    const result = parseFile(file, { env: { PORT: "3000" } });
    expect(result.port).toBe("3000");
  });
});

// ── stringifyFile ───────────────────────────────────────────────

describe("stringifyFile", () => {
  it("writes UZON to file", () => {
    const dir = makeTempDir();
    const file = join(dir, "output.uzon");

    stringifyFile(file, { host: "localhost", port: 8080n });

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("host");
    expect(content).toContain("localhost");
    expect(content).toContain("port");
    expect(content).toContain("8080");
  });

  it("roundtrips through parseFile", () => {
    const dir = makeTempDir();
    const file = join(dir, "roundtrip.uzon");
    const original = { name: "test", count: 42n, rate: 3.14 };

    stringifyFile(file, original);
    const result = parseFile(file);

    expect(result.name).toBe("test");
    expect(result.count).toBe(42n);
    expect(result.rate).toBe(3.14);
  });

  it("writes with trailing newline", () => {
    const dir = makeTempDir();
    const file = join(dir, "newline.uzon");

    stringifyFile(file, { x: 1n });

    const content = readFileSync(file, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("overwrites existing file", () => {
    const dir = makeTempDir();
    const file = join(dir, "overwrite.uzon");
    writeFileSync(file, "old content\n");

    stringifyFile(file, { x: 99n });

    const content = readFileSync(file, "utf-8");
    expect(content).not.toContain("old content");
    expect(content).toContain("99");
  });
});

// ── watch ───────────────────────────────────────────────────────

describe("watch", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const stop of cleanups) stop();
    cleanups.length = 0;
  });

  it("invokes callback immediately with current contents", () => {
    const dir = makeTempDir();
    const file = join(dir, "watch.uzon");
    writeFileSync(file, 'x is 42\n');

    let received: Record<string, any> | null = null;
    const stop = watch(file, (bindings) => { received = bindings; });
    cleanups.push(stop);

    expect(received).not.toBeNull();
    expect(received!.x).toBe(42n);
  });

  it("does not invoke immediately when immediate is false", () => {
    const dir = makeTempDir();
    const file = join(dir, "watch-no-imm.uzon");
    writeFileSync(file, 'x is 42\n');

    let callCount = 0;
    const stop = watch(file, () => { callCount++; }, { immediate: false });
    cleanups.push(stop);

    expect(callCount).toBe(0);
  });

  it("calls onError on parse error", () => {
    const dir = makeTempDir();
    const file = join(dir, "watch-err.uzon");
    writeFileSync(file, 'x is is is\n');

    let errorCaught: Error | null = null;
    const stop = watch(file, () => {}, {
      onError: (err) => { errorCaught = err; },
    });
    cleanups.push(stop);

    expect(errorCaught).toBeInstanceOf(Error);
  });

  it("cleanup function stops watching", () => {
    const dir = makeTempDir();
    const file = join(dir, "watch-stop.uzon");
    writeFileSync(file, 'x is 1\n');

    const stop = watch(file, () => {});
    // Should not throw when called
    expect(() => stop()).not.toThrow();
  });

  it("passes env option through to evaluator", () => {
    const dir = makeTempDir();
    const file = join(dir, "watch-env.uzon");
    writeFileSync(file, 'port is env.PORT\n');

    let received: Record<string, any> | null = null;
    const stop = watch(file, (bindings) => { received = bindings; }, {
      env: { PORT: "9090" },
    });
    cleanups.push(stop);

    expect(received).not.toBeNull();
    expect(received!.port).toBe("9090");
  });

  it("calls onError on missing file", () => {
    let errorCaught: Error | null = null;
    const stop = watch("/nonexistent/watch.uzon", () => {}, {
      onError: (err) => { errorCaught = err; },
    });
    cleanups.push(stop);

    expect(errorCaught).toBeInstanceOf(Error);
  });
});
