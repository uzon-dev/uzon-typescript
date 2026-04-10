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

export class UzonError extends Error {
  readonly line?: number;
  readonly col?: number;
  filename?: string;

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
    if (this.line != null && this.col != null) {
      this.message = `${filename}:${this.line}:${this.col}: ${this.message.replace(/^Line \d+, col \d+: /, "")}`;
    }
    return this;
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
