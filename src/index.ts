// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * UZON — typed, human-readable data expression format.
 *
 * Public API for parsing and serialising UZON documents.
 * See the UZON specification (v0.6) for the full language definition.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
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
  displayValue,
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

export {
  // Type guards
  isNull, isUndefined, isBool, isInteger, isFloat, isNumber,
  isString, isList, isTuple, isEnum, isUnion, isTaggedUnion, isStruct,
  // Type narrowing
  asNumber, asInteger, asString, asBool,
  asList, asTuple, asStruct, asEnum,
  // Optional (safe) access
  optionalNumber, optionalInteger, optionalString, optionalBool,
  optionalList, optionalTuple, optionalStruct, optionalEnum,
} from "./convert.js";

export { get, getOrThrow } from "./access.js";

export { match } from "./match.js";

export { toJSON, fromJSON } from "./json.js";
export type { ToJSONOptions } from "./json.js";

export { merge, mergeValues } from "./merge.js";

export { watch } from "./watch.js";
export type { WatchOptions } from "./watch.js";

export { uzon } from "./builder.js";

export {
  withField, withoutField,
  append, prepend, setAt, removeAt,
  tupleSetAt,
} from "./update.js";

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

/** Parse result: either a value or one or more detailed errors. */
export type ParseResult =
  | { value: Record<string, UzonValue>; errors?: never }
  | { value?: never; errors: UzonError[] };

/** Wrap a single error in a ParseResult. */
function singleError(e: UzonError): ParseResult {
  return { errors: [e] };
}

/** Safe realpathSync wrapper — falls back to input on failure. */
function safeRealpath(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/**
 * Parse UZON source text and return a ParseResult.
 *
 * Returns `{ value }` on success or `{ errors }` on failure.
 * Multiple errors are returned when there are multiple circular dependencies.
 *
 * ```ts
 * const result = parse('x is 42');
 * if ('errors' in result) console.error(result.errors);
 * else console.log(result.value); // { x: 42n }
 * ```
 */
export function parse(
  source: string,
  options: ParseOptions = {},
): ParseResult {
  const filename = options.filename ? safeRealpath(resolve(options.filename)) : undefined;
  const evalOpts = {
    ...options,
    filename,
    fileReader: options.fileReader ?? ((p: string) => readFileSync(p, "utf-8")),
    realpath: safeRealpath,
    importStack: filename ? [filename] : [] as string[],
  };

  const evaluator = new Evaluator(evalOpts);
  try {
    const tokens = new Lexer(source).tokenize();
    const doc = new Parser(tokens).parse();
    const result = evaluator.evaluate(doc);
    if (options.native) {
      const jsResult: Record<string, any> = {};
      for (const [k, v] of Object.entries(result)) {
        jsResult[k] = toJS(v, { bigint: options.bigint });
      }
      return { value: jsResult };
    }
    return { value: result };
  } catch (e) {
    // Multi-error: if the evaluator collected multiple errors, return them all
    if (evaluator.collectedErrors.length > 0) {
      for (const err of evaluator.collectedErrors) {
        if (filename && !err.filename) err.withFilename(filename);
      }
      return { errors: evaluator.collectedErrors };
    }
    if (e instanceof UzonError) {
      if (filename && !e.filename) e.withFilename(filename);
      return singleError(e);
    }
    throw e; // non-Uzon errors (e.g. OOM) propagate
  }
}

/**
 * Parse a UZON file from disk and return a ParseResult.
 * Struct imports are resolved relative to the file's directory.
 */
export function parseFile(
  filePath: string,
  options: ParseOptions = {},
): ParseResult {
  // Normalize path via realpath for symlink consistency
  const absPath = safeRealpath(resolve(filePath));
  let source: string;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch {
    return singleError(new UzonError("cannot open file", 0, 0));
  }
  const result = parse(source, { ...options, filename: absPath });
  // Attach filename to errors if not already set
  if (result.errors) {
    for (const e of result.errors) {
      if (!e.filename) e.withFilename(absPath);
    }
  }
  return result;
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
