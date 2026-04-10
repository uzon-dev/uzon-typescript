// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * UZON — typed, human-readable data expression format.
 *
 * Public API for parsing and serialising UZON documents.
 * See the UZON specification (v0.5) for the full language definition.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { Evaluator } from "./evaluator.js";
import { UzonError } from "./error.js";
import { stringify, toJS } from "./stringify.js";
import type { StringifyOptions } from "./stringify.js";
import type { UzonValue } from "./value.js";

// ── Re-exports ──────────────────────────────────────────────────

export {
  UzonError,
  UzonSyntaxError,
  UzonTypeError,
  UzonRuntimeError,
  UzonCircularError,
} from "./error.js";

export type { ImportFrame } from "./error.js";

export {
  UZON_UNDEFINED,
  UzonEnum,
  UzonUnion,
  UzonTaggedUnion,
  UzonTuple,
  UzonFunction,
  formatUzonFloat,
} from "./value.js";

export type { UzonValue, UzonUndefined } from "./value.js";

export { TokenType } from "./token.js";
export type { Token } from "./token.js";

export { Lexer } from "./lexer.js";
export { Parser } from "./parser.js";

export type { AstNode, DocumentNode, BindingNode, BinaryOp } from "./ast.js";

export { Scope } from "./scope.js";
export type { TypeDef } from "./scope.js";

export { Evaluator } from "./evaluator.js";
export type { EvalOptions } from "./evaluator.js";

export { stringify, stringifyValue, toJS } from "./stringify.js";
export type { StringifyOptions, ToJSOptions } from "./stringify.js";

// ── Convenience API ─────────────────────────────────────────────

export interface ParseOptions {
  env?: Record<string, string>;
  filename?: string;
  fileReader?: (path: string) => string;
  /** If true, convert result to plain JS types (number instead of bigint, etc.) */
  native?: boolean;
  /** How to convert bigint when native is true (default: "number") */
  bigint?: "number" | "bigint" | "string";
}

/**
 * Parse UZON source text and return evaluated bindings.
 *
 * By default, returns UzonValue types (bigint for integers, UzonEnum, etc.).
 * Pass `{ native: true }` to get plain JS types instead.
 *
 * ```ts
 * parse('x is 42')                    // { x: 42n }
 * parse('x is 42', { native: true })  // { x: 42 }
 * ```
 */
export function parse(
  source: string,
  options?: ParseOptions & { native: true },
): Record<string, any>;
export function parse(
  source: string,
  options?: ParseOptions,
): Record<string, UzonValue>;
export function parse(
  source: string,
  options: ParseOptions = {},
): Record<string, UzonValue> | Record<string, any> {
  const evalOpts = {
    ...options,
    fileReader: options.fileReader ?? ((p: string) => readFileSync(p, "utf-8")),
  };
  if (evalOpts.filename) {
    evalOpts.filename = resolve(evalOpts.filename);
  }
  try {
    const tokens = new Lexer(source).tokenize();
    const doc = new Parser(tokens).parse();
    const result = new Evaluator(evalOpts).evaluate(doc);
    if (options.native) {
      const jsResult: Record<string, any> = {};
      for (const [k, v] of Object.entries(result)) {
        jsResult[k] = toJS(v, { bigint: options.bigint });
      }
      return jsResult;
    }
    return result;
  } catch (e) {
    if (e instanceof UzonError && evalOpts.filename && !e.filename) {
      e.withFilename(evalOpts.filename);
    }
    throw e;
  }
}

/**
 * Parse a UZON file from disk and return evaluated bindings.
 * Struct imports are resolved relative to the file's directory.
 * Pass `{ native: true }` to get plain JS types.
 */
export function parseFile(
  filePath: string,
  options?: ParseOptions & { native: true },
): Record<string, any>;
export function parseFile(
  filePath: string,
  options?: ParseOptions,
): Record<string, UzonValue>;
export function parseFile(
  filePath: string,
  options: ParseOptions = {},
): Record<string, UzonValue> | Record<string, any> {
  const absPath = resolve(filePath);
  const source = readFileSync(absPath, "utf-8");
  return parse(source, { ...options, filename: absPath });
}

/**
 * Convert evaluated bindings to UZON source text and write to a file.
 */
export function stringifyFile(
  filePath: string,
  bindings: Record<string, UzonValue>,
  options: StringifyOptions = {},
): void {
  const absPath = resolve(filePath);
  writeFileSync(absPath, stringify(bindings, options) + "\n", "utf-8");
}
