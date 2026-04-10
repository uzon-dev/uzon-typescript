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

const CONFORMANCE_DIR = join(__dirname, "../../conformance");

/** Parse and evaluate a UZON source string. */
function parseAndEval(src: string, filename?: string) {
  const fileReader = (path: string) => readFileSync(path, "utf-8");
  const tokens = new Lexer(src).tokenize();
  const doc = new Parser(tokens).parse();
  return new Evaluator({ fileReader, filename }).evaluate(doc);
}

/** Recursively collect all .uzon files under a directory. */
function collectUzonFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectUzonFilesRecursive(full));
    } else if (entry.endsWith(".uzon")) {
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
      expect(() => parseAndEval(src)).toThrow();
    });
  }
});
