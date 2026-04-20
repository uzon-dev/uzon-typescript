// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Conformance tests — validate against the UZON conformance suite.
 *
 * Recursively walks conformance/parse/valid and conformance/parse/invalid,
 * registering every .uzon file as a test case.
 *
 * Valid tests: should parse and evaluate without errors.
 * Invalid tests: should throw an error during parse or evaluation.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { Evaluator } from "../src/evaluator.js";
import { stringify } from "../src/stringify.js";
import type { StringifyOptions } from "../src/stringify.js";
import type { UzonValue } from "../src/value.js";
import { valuesEqual } from "../src/eval-helpers.js";

const CONFORMANCE_DIR = join(__dirname, "../../conformance");

/** Parse and evaluate a UZON source string. */
function parseAndEval(src: string, filename?: string) {
  const fileReader = (path: string) => readFileSync(path, "utf-8");
  const tokens = new Lexer(src).tokenize();
  const doc = new Parser(tokens).parse();
  return new Evaluator({ fileReader, filename }).evaluate(doc);
}

/** Parse and evaluate, returning both bindings and evaluator metadata. */
function parseAndEvalWithMeta(src: string, filename?: string) {
  const fileReader = (path: string) => readFileSync(path, "utf-8");
  const tokens = new Lexer(src).tokenize();
  const doc = new Parser(tokens).parse();
  const evaluator = new Evaluator({ fileReader, filename });
  const bindings = evaluator.evaluate(doc);
  return { bindings, listElementTypes: evaluator.listElementTypes };
}

/** Recursively collect all .uzon files under a directory.
 *  Convention: when a directory contains `entry.uzon`, only that file is
 *  collected — its siblings are treated as imported modules. */
function collectUzonFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const hasEntry = entries.includes("entry.uzon");
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectUzonFilesRecursive(full));
    } else if (entry.endsWith(".uzon")) {
      if (hasEntry && entry !== "entry.uzon") continue;
      results.push(full);
    }
  }
  return results.sort();
}

// ── Valid parse tests ───────────────────────────────────────────

const validDir = join(CONFORMANCE_DIR, "parse/valid");
const validFiles = collectUzonFilesRecursive(validDir);

describe("conformance: valid", () => {
  for (const filePath of validFiles) {
    const label = relative(validDir, filePath);
    it(label, () => {
      const src = readFileSync(filePath, "utf-8");
      expect(() => parseAndEval(src, filePath)).not.toThrow();
    });
  }
});

// ── Invalid parse tests ─────────────────────────────────────────

const invalidDir = join(CONFORMANCE_DIR, "parse/invalid");
const invalidFiles = collectUzonFilesRecursive(invalidDir);

describe("conformance: invalid", () => {
  for (const filePath of invalidFiles) {
    const label = relative(invalidDir, filePath);
    it(label, () => {
      const src = readFileSync(filePath, "utf-8");
      expect(() => parseAndEval(src, filePath)).toThrow();
    });
  }
});

// ── Eval conformance tests ──────────────────────────────────────
// Each .uzon file is evaluated and compared against its .expected.uzon

const evalDir = join(CONFORMANCE_DIR, "eval");
const evalInputFiles = collectUzonFilesRecursive(evalDir)
  .filter(f => !f.endsWith(".expected.uzon"));

describe("conformance: eval", () => {
  for (const inputPath of evalInputFiles) {
    const label = relative(evalDir, inputPath);
    const expectedPath = inputPath.replace(/\.uzon$/, ".expected.uzon");

    it(label, () => {
      const inputSrc = readFileSync(inputPath, "utf-8");
      const expectedSrc = readFileSync(expectedPath, "utf-8");

      const actual = parseAndEval(inputSrc, inputPath);
      const expected = parseAndEval(expectedSrc, expectedPath);

      // Compare each binding from the expected result
      for (const key of Object.keys(expected)) {
        const act = actual[key];
        const exp = expected[key];
        // NaN === NaN should be true for conformance purposes (unlike IEEE 754)
        const nanMatch = typeof act === "number" && typeof exp === "number"
          && Number.isNaN(act) && Number.isNaN(exp);
        if (!nanMatch && !valuesEqual(act, exp)) {
          // Produce readable diff via stringify
          const actStr = act !== undefined ? stringify({ [key]: act }) : `${key} is <missing>`;
          const expStr = stringify({ [key]: exp });
          expect.fail(
            `Binding '${key}' mismatch:\n  actual:   ${actStr}\n  expected: ${expStr}`,
          );
        }
      }
    });
  }
});

// ── Roundtrip conformance tests ──────────────────────────────────
// Parse → stringify → parse again → values must match

const roundtripDir = join(CONFORMANCE_DIR, "roundtrip");
const roundtripFiles = collectUzonFilesRecursive(roundtripDir)
  .filter(f => f.endsWith(".uzon"));

describe("conformance: roundtrip", () => {
  for (const filePath of roundtripFiles) {
    const label = relative(roundtripDir, filePath);

    it(label, () => {
      const src = readFileSync(filePath, "utf-8");
      const { bindings: original, listElementTypes } = parseAndEvalWithMeta(src, filePath);
      const text = stringify(original, { listElementTypes } as StringifyOptions);
      const reparsed = parseAndEval(text);

      for (const key of Object.keys(original)) {
        const orig = original[key];
        const re = reparsed[key];
        if (!valuesEqual(orig, re)) {
          const origStr = orig !== undefined ? stringify({ [key]: orig }) : `${key} is <missing>`;
          const reStr = re !== undefined ? stringify({ [key]: re }) : `${key} is <missing>`;
          if (origStr !== reStr) {
            expect.fail(
              `Roundtrip mismatch for '${key}':\n  original:  ${origStr}\n  reparsed:  ${reStr}\n  stringify: ${text}`,
            );
          }
        }
      }

      for (const key of Object.keys(reparsed)) {
        if (!(key in original)) {
          expect.fail(`Extra binding '${key}' appeared after roundtrip`);
        }
      }
    });
  }
});
