// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * Error hierarchy for the UZON parser/evaluator.
 *
 * Four error classes cover distinct failure modes per §11.2:
 *   - UzonSyntaxError   — lexical or grammatical violations
 *   - UzonTypeError     — type-system violations (annotation mismatch, etc.)
 *   - UzonRuntimeError  — runtime failures (overflow, division by zero, etc.)
 *   - UzonCircularError — circular dependency between bindings
 *
 * Error priority (§11.2): syntax > circular > type > runtime.
 * All errors include line/col location per §11.2.0.
 */

export interface ImportFrame {
  filename: string;
  line: number;
  col: number;
}

export class UzonError extends Error {
  readonly line?: number;
  readonly col?: number;
  filename?: string;
  readonly importTrace: ImportFrame[] = [];

  constructor(message: string, line?: number, col?: number) {
    const loc =
      line != null && col != null ? `Line ${line}, col ${col}: ` : "";
    super(`${loc}${message}`);
    this.name = "UzonError";
    this.line = line;
    this.col = col;
  }

  /** Attach a filename and rewrite the message to include it (§11.2.0). */
  withFilename(filename: string): this {
    if (this.filename) return this;
    this.filename = filename;
    this.rebuildMessage();
    return this;
  }

  /** Add an import-site frame to the trace (called by the importing evaluator). */
  addImportFrame(filename: string, line: number, col: number): this {
    this.importTrace.push({ filename, line, col });
    this.rebuildMessage();
    return this;
  }

  private rebuildMessage(): void {
    // Core message without any location prefix
    const core = this.message.replace(/^(?:.*?:\d+:\d+: |Line \d+, col \d+: )/, "");

    // Error origin line
    let msg: string;
    if (this.filename && this.line != null && this.col != null) {
      msg = `${this.filename}:${this.line}:${this.col}: ${core}`;
    } else if (this.line != null && this.col != null) {
      msg = `Line ${this.line}, col ${this.col}: ${core}`;
    } else {
      msg = core;
    }

    // Import stack trace
    for (const frame of this.importTrace) {
      msg += `\n  at ${frame.filename}:${frame.line}:${frame.col}`;
    }

    this.message = msg;
  }
}

export class UzonSyntaxError extends UzonError {
  override name = "UzonSyntaxError";
}

export class UzonTypeError extends UzonError {
  override name = "UzonTypeError";
}

export class UzonRuntimeError extends UzonError {
  override name = "UzonRuntimeError";
}

export class UzonCircularError extends UzonError {
  override name = "UzonCircularError";
}
