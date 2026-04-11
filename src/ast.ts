// SPDX-FileCopyrightText: © 2026 Suho Kang
// SPDX-License-Identifier: MIT

/**
 * AST node definitions for the UZON parser.
 *
 * Every node carries source location (line, col) for error reporting (§11.2.0).
 * The discriminated union `AstNode` covers all syntactic constructs
 * defined in the UZON grammar (§9).
 */

// ── Base ──────────────────────────────────────────────────────────

export interface NodeBase {
  line: number;
  col: number;
}

// ── Literals (§4) ─────────────────────────────────────────────────

export interface IntegerLiteralNode extends NodeBase {
  kind: "IntegerLiteral";
  value: string;     // raw text including base prefix (e.g. "0xff", "-42")
  negative: boolean;
}

export interface FloatLiteralNode extends NodeBase {
  kind: "FloatLiteral";
  value: string;     // raw text (e.g. "3.14", "-1.0e10")
  negative: boolean;
}

export interface BoolLiteralNode extends NodeBase {
  kind: "BoolLiteral";
  value: boolean;
}

/** String with interpolation support — parts alternate text and expressions. */
export interface StringLiteralNode extends NodeBase {
  kind: "StringLiteral";
  parts: StringPart[];
}

export type StringPart = string | AstNode;

export interface NullLiteralNode extends NodeBase {
  kind: "NullLiteral";
}

export interface UndefinedLiteralNode extends NodeBase {
  kind: "UndefinedLiteral";
}

export interface InfLiteralNode extends NodeBase {
  kind: "InfLiteral";
  negative: boolean;
}

export interface NanLiteralNode extends NodeBase {
  kind: "NanLiteral";
  negative: boolean;
}

// ── Identifiers & References (§5.12, §5.13) ──────────────────────

export interface IdentifierNode extends NodeBase {
  kind: "Identifier";
  name: string;
}

export interface EnvRefNode extends NodeBase {
  kind: "EnvRef";
}

// ── Expressions (§5) ─────────────────────────────────────────────

export interface MemberAccessNode extends NodeBase {
  kind: "MemberAccess";
  object: AstNode;
  member: string;
}

export interface FunctionCallNode extends NodeBase {
  kind: "FunctionCall";
  callee: AstNode;
  args: AstNode[];
}

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%" | "^"
  | "++" | "**"
  | "<" | "<=" | ">" | ">="
  | "and" | "or"
  | "is" | "is not" | "is named" | "is not named"
  | "in";

export interface BinaryOpNode extends NodeBase {
  kind: "BinaryOp";
  op: BinaryOp;
  left: AstNode;
  right: AstNode;
}

export interface UnaryOpNode extends NodeBase {
  kind: "UnaryOp";
  op: "not" | "-";
  operand: AstNode;
}

/** Undefined coalescing: `left or else right` (§5.7) */
export interface OrElseNode extends NodeBase {
  kind: "OrElse";
  left: AstNode;
  right: AstNode;
}

/** Conditional expression: `if cond then a else b` (§5.9) */
export interface IfExprNode extends NodeBase {
  kind: "IfExpr";
  condition: AstNode;
  thenBranch: AstNode;
  elseBranch: AstNode;
}

/** A single `when` arm inside a `case` expression (§5.10) */
export interface WhenClause extends NodeBase {
  isNamed: boolean;
  value: AstNode | string;  // string when isNamed (variant name)
  result: AstNode;
}

/** Pattern-matching expression: `case x when ... else ...` (§5.10) */
export interface CaseExprNode extends NodeBase {
  kind: "CaseExpr";
  scrutinee: AstNode;
  whenClauses: WhenClause[];
  elseBranch: AstNode;
}

// ── Type System (§3, §6) ─────────────────────────────────────────

/** Type expression used in `as`, `to`, `from union`, and annotations. */
export interface TypeExprNode extends NodeBase {
  kind: "TypeExpr";
  path: string[];              // e.g. ["Config", "Port"] for Config.Port
  isList: boolean;             // [Type]
  inner: TypeExprNode | null;  // inner type for list
  isNull: boolean;             // the `null` type
  isTuple: boolean;            // (Type1, Type2)
  tupleElements: TypeExprNode[] | null;
}

/** Type annotation: `expr as Type` (§6.1) */
export interface TypeAnnotationNode extends NodeBase {
  kind: "TypeAnnotation";
  expr: AstNode;
  type: TypeExprNode;
}

/** Type conversion: `expr to Type` (§5.11) */
export interface ConversionNode extends NodeBase {
  kind: "Conversion";
  expr: AstNode;
  type: TypeExprNode;
}

/** Struct override: `base with { ... }` (§3.2.1) */
export interface StructOverrideNode extends NodeBase {
  kind: "StructOverride";
  base: AstNode;
  overrides: StructLiteralNode;
}

/** Struct extension: `base extends { ... }` (§3.2.2) */
export interface StructExtendNode extends NodeBase {
  kind: "StructExtend";
  base: AstNode;
  extensions: StructLiteralNode;
}

/** Enum definition: `value from variant1, variant2, ...` (§3.5) */
export interface FromEnumNode extends NodeBase {
  kind: "FromEnum";
  value: AstNode;
  variants: string[];
}

/** Untagged union: `value from union Type1, Type2` (§3.6) */
export interface FromUnionNode extends NodeBase {
  kind: "FromUnion";
  value: AstNode;
  types: TypeExprNode[];
}

/** Tagged union: `value named tag from ...` or `value named tag as Type` (§3.7) */
export interface NamedVariantNode extends NodeBase {
  kind: "NamedVariant";
  value: AstNode;
  tag: string;
  variants: [string, TypeExprNode][] | null; // null when using `as TypeName`
}

/** Field extraction: `name is of source` (§5.14) */
export interface FieldExtractionNode extends NodeBase {
  kind: "FieldExtraction";
  bindingName: string;
  source: AstNode;
}

// ── Function (§3.8) ──────────────────────────────────────────────

export interface FunctionParam extends NodeBase {
  name: string;
  type: TypeExprNode;
  defaultValue: AstNode | null;
}

/** Function expression: `function [params] returns Type { body }` */
export interface FunctionExprNode extends NodeBase {
  kind: "FunctionExpr";
  params: FunctionParam[];
  returnType: TypeExprNode;
  body: BindingNode[];   // intermediate bindings (may be empty)
  finalExpr: AstNode;    // last expression = return value
}

// ── Compounds (§3.2, §3.3, §3.4) ────────────────────────────────

export interface StructLiteralNode extends NodeBase {
  kind: "StructLiteral";
  fields: BindingNode[];
}

export interface ListLiteralNode extends NodeBase {
  kind: "ListLiteral";
  elements: AstNode[];
}

export interface TupleLiteralNode extends NodeBase {
  kind: "TupleLiteral";
  elements: AstNode[];
}

/** Parenthesised expression — `(expr)` grouping, not a 1-tuple. */
export interface GroupingNode extends NodeBase {
  kind: "Grouping";
  expr: AstNode;
}

// ── Import (§7) ──────────────────────────────────────────────────

export interface StructImportNode extends NodeBase {
  kind: "StructImport";
  path: string;
}

// ── Bindings (§5.1) ──────────────────────────────────────────────

export interface BindingNode extends NodeBase {
  kind: "Binding";
  name: string;
  value: AstNode;
  calledName: string | null; // `called TypeName` — names the type (§6.2)
}

// ── Document ─────────────────────────────────────────────────────

/** Top-level: a UZON document is an anonymous struct (§1). */
export interface DocumentNode extends NodeBase {
  kind: "Document";
  bindings: BindingNode[];
}

// ── Union of all AST nodes ────────────────────────────────────────

export type AstNode =
  | IntegerLiteralNode
  | FloatLiteralNode
  | BoolLiteralNode
  | StringLiteralNode
  | NullLiteralNode
  | UndefinedLiteralNode
  | InfLiteralNode
  | NanLiteralNode
  | IdentifierNode
  | EnvRefNode
  | MemberAccessNode
  | FunctionCallNode
  | BinaryOpNode
  | UnaryOpNode
  | OrElseNode
  | IfExprNode
  | CaseExprNode
  | TypeAnnotationNode
  | ConversionNode
  | StructOverrideNode
  | StructExtendNode
  | FromEnumNode
  | FromUnionNode
  | NamedVariantNode
  | FieldExtractionNode
  | FunctionExprNode
  | StructLiteralNode
  | ListLiteralNode
  | TupleLiteralNode
  | GroupingNode
  | StructImportNode
  | BindingNode
  | DocumentNode
  | TypeExprNode;
