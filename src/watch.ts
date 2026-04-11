// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * File watcher for UZON config files.
 *
 * Watches a .uzon file and re-parses on changes, invoking a callback
 * with the new bindings. Includes debouncing to handle rapid writes.
 */

import { readFileSync, watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { Evaluator } from "./evaluator.js";
import type { UzonValue } from "./value.js";

export interface WatchOptions {
  /** Debounce interval in milliseconds (default: 100) */
  debounce?: number;
  /** Polling interval in milliseconds for fs.watchFile (default: 1000) */
  interval?: number;
  /** If true, invoke callback immediately with current file contents (default: true) */
  immediate?: boolean;
  /** Called when a parse error occurs during reload */
  onError?: (error: Error) => void;
  /** Environment variables for env.* references */
  env?: Record<string, string>;
}

/**
 * Watch a UZON file for changes and invoke callback with parsed bindings.
 *
 * Returns a cleanup function that stops watching.
 *
 * ```ts
 * const stop = watch("config.uzon", (config) => {
 *   console.log("Config reloaded:", config);
 * });
 *
 * // Later: stop watching
 * stop();
 * ```
 */
export function watch(
  filePath: string,
  callback: (bindings: Record<string, UzonValue>) => void,
  options: WatchOptions = {},
): () => void {
  const absPath = resolve(filePath);
  const debounceMs = options.debounce ?? 100;
  const interval = options.interval ?? 1000;
  const immediate = options.immediate ?? true;
  const onError = options.onError ?? (() => {});
  const env = options.env;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function parseFile() {
    try {
      const source = readFileSync(absPath, "utf-8");
      const fileReader = (path: string) => readFileSync(path, "utf-8");
      const tokens = new Lexer(source).tokenize();
      const doc = new Parser(tokens).parse();
      const result = new Evaluator({ fileReader, filename: absPath, env }).evaluate(doc);
      callback(result);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function onFileChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(parseFile, debounceMs);
  }

  if (immediate) parseFile();

  watchFile(absPath, { interval }, onFileChange);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unwatchFile(absPath, onFileChange);
  };
}
