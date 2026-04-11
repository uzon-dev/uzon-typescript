# uzon

TypeScript/JavaScript implementation of [UZON](https://github.com/uzon-dev) — a typed, human-readable data expression format.

```
npm install @uzon/uzon
```

## Quick Start

```typescript
import { parse } from "@uzon/uzon";

const config = parse(`
  host is "localhost"
  port is 8080
  debug is true
`);

console.log(config.host);  // "localhost"
console.log(config.port);  // 8080n (bigint)
console.log(config.debug); // true
```

## UZON at a Glance

UZON is a configuration and data format with a rich type system:

```
# Primitives
name is "Alice"
age is 30
rate is 3.14
active is true
nothing is null

# Lists and tuples
tags is ["api", "v2"]
point is (10, 20)

# Structs (nested objects)
database is {
    host is "localhost"
    port is 5432
}

# Enums and tagged unions
color is red from red, green, blue
status is "ok" named success from success as string, failure as string

# Expressions
total is price * quantity
greeting is "Hello, {name}!"

# Environment variables
port is env.PORT

# Struct imports
shared is struct "shared.uzon"
```

## Value Types

UZON values in TypeScript are represented by the `UzonValue` type:

| UZON type | TypeScript type | Example |
|-----------|----------------|---------|
| integer | `bigint` | `42n` |
| float | `number` | `3.14` |
| string | `string` | `"hello"` |
| bool | `boolean` | `true` |
| null | `null` | `null` |
| list | `UzonValue[]` | `[1n, 2n, 3n]` |
| tuple | `UzonTuple` | `UzonTuple([1n, "a"])` |
| struct | `Record<string, UzonValue>` | `{ host: "localhost" }` |
| enum | `UzonEnum` | `UzonEnum("red", ["red", "green", "blue"])` |
| union | `UzonUnion` | `UzonUnion(42n, ["i32", "string"])` |
| tagged union | `UzonTaggedUnion` | `UzonTaggedUnion(42n, "ok", variants)` |
| function | `UzonFunction` | (first-class, pure) |
| undefined | `typeof UZON_UNDEFINED` | sentinel for unresolved lookups |

---

## API Reference

### Parsing

#### `parse(source, options?)`

Parse UZON source text and return evaluated bindings.

```typescript
function parse(source: string, options?: ParseOptions): Record<string, UzonValue>;
function parse(source: string, options: ParseOptions & { native: true }): Record<string, any>;
```

By default, returns `UzonValue` types. Pass `{ native: true }` to get plain JS types (numbers instead of bigints, etc.).

```typescript
import { parse } from "@uzon/uzon";

// Default: UzonValue types
const r = parse('x is 42');
r.x; // 42n (bigint)

// Native: plain JS types
const r2 = parse('x is 42', { native: true });
r2.x; // 42 (number)

// With bigint mode
const r3 = parse('x is 42', { native: true, bigint: "string" });
r3.x; // "42"
```

#### `parseFile(filePath, options?)`

Parse a UZON file from disk. Struct imports are resolved relative to the file's directory.

```typescript
function parseFile(filePath: string, options?: ParseOptions): Record<string, UzonValue>;
function parseFile(filePath: string, options: ParseOptions & { native: true }): Record<string, any>;
```

```typescript
import { parseFile } from "@uzon/uzon";

const config = parseFile("config.uzon");
const native = parseFile("config.uzon", { native: true });
```

#### `ParseOptions`

```typescript
interface ParseOptions {
  env?: Record<string, string>;           // Environment variables for env.* references
  filename?: string;                       // Filename for error messages
  fileReader?: (path: string) => string;   // Custom file reader (default: readFileSync)
  native?: boolean;                        // Convert to plain JS types
  bigint?: "number" | "bigint" | "string"; // bigint conversion mode (default: "number")
}
```

---

### Stringify

#### `stringify(bindings, options?)`

Convert a record of bindings back to UZON source text.

```typescript
function stringify(bindings: Record<string, any>, options?: StringifyOptions): string;
```

```typescript
import { parse, stringify } from "@uzon/uzon";

const config = parse('host is "localhost"\nport is 8080');
stringify(config);
// 'host is "localhost"\nport is 8080'
```

#### `stringifyValue(value, indent?, multilineThreshold?, depth?)`

Convert a single value to its UZON text representation.

```typescript
function stringifyValue(value: any, indent?: string, multilineThreshold?: number, depth?: number): string;
```

```typescript
import { stringifyValue } from "@uzon/uzon";

stringifyValue(42n);          // "42"
stringifyValue(3.14);         // "3.14"
stringifyValue("hello");      // '"hello"'
stringifyValue([1n, 2n, 3n]); // "[1, 2, 3]"
```

#### `stringifyFile(filePath, bindings, options?)`

Write UZON bindings to a file.

```typescript
function stringifyFile(filePath: string, bindings: Record<string, UzonValue>, options?: StringifyOptions): void;
```

```typescript
import { parse, stringifyFile } from "@uzon/uzon";

const config = parse('host is "localhost"\nport is 8080');
stringifyFile("output.uzon", config);
```

#### `StringifyOptions`

```typescript
interface StringifyOptions {
  indent?: string;                               // Indentation per level (default: "    ")
  multilineThreshold?: number;                   // Inline structs up to N fields (default: 1)
  listElementTypes?: WeakMap<UzonValue[], string>; // List element type metadata
}
```

---

### Type Conversion

#### `toJS(value, options?)`

Convert a `UzonValue` to a plain JS value.

```typescript
function toJS(value: UzonValue, options?: ToJSOptions): any;
```

```typescript
import { parse, toJS } from "@uzon/uzon";

const r = parse('x is 42\ny is 3.14');
toJS(r.x); // 42 (number)
toJS(r.y); // 3.14
```

#### `ToJSOptions`

```typescript
interface ToJSOptions {
  bigint?: "number" | "bigint" | "string"; // How to convert bigint (default: "number")
}
```

---

### Type Guards

All type guards return `true`/`false` and narrow the TypeScript type.

```typescript
function isNull(value: UzonValue): value is null;
function isUndefined(value: UzonValue): value is typeof UZON_UNDEFINED;
function isBool(value: UzonValue): value is boolean;
function isInteger(value: UzonValue): value is bigint;
function isFloat(value: UzonValue): value is number;
function isNumber(value: UzonValue): value is number | bigint;
function isString(value: UzonValue): value is string;
function isList(value: UzonValue): value is UzonValue[];
function isTuple(value: UzonValue): value is UzonTuple;
function isEnum(value: UzonValue): value is UzonEnum;
function isUnion(value: UzonValue): value is UzonUnion;
function isTaggedUnion(value: UzonValue): value is UzonTaggedUnion;
function isStruct(value: UzonValue): value is Record<string, UzonValue>;
```

```typescript
import { parse, isInteger, isString, isStruct } from "@uzon/uzon";

const r = parse('x is 42\nname is "Alice"\ndb is { host is "localhost" }');

if (isInteger(r.x)) {
  console.log(r.x + 1n); // 43n — TypeScript knows r.x is bigint
}
if (isStruct(r.db)) {
  console.log(r.db.host); // "localhost"
}
```

---

### Type Narrowing

Safe extraction with type checking. All functions transparently unwrap `UzonUnion` and `UzonTaggedUnion`. Throw `TypeError` on type mismatch.

```typescript
function asNumber(value: UzonValue): number;   // Accepts integer (→ number) and float
function asInteger(value: UzonValue): bigint;
function asString(value: UzonValue): string;    // Also accepts UzonEnum (→ variant name)
function asBool(value: UzonValue): boolean;
function asList(value: UzonValue): UzonValue[];
function asTuple(value: UzonValue): UzonTuple;
function asStruct(value: UzonValue): Record<string, UzonValue>;
function asEnum(value: UzonValue): UzonEnum;
```

```typescript
import { parse, asNumber, asString } from "@uzon/uzon";

const r = parse('port is 8080\nhost is "localhost"');
const port: number = asNumber(r.port); // 8080
const host: string = asString(r.host); // "localhost"

asNumber(r.host); // throws TypeError
```

---

### Optional Helpers

Like type narrowing, but return `undefined` instead of throwing on mismatch.

```typescript
function optionalNumber(value: UzonValue): number | undefined;
function optionalInteger(value: UzonValue): bigint | undefined;
function optionalString(value: UzonValue): string | undefined;
function optionalBool(value: UzonValue): boolean | undefined;
function optionalList(value: UzonValue): UzonValue[] | undefined;
function optionalTuple(value: UzonValue): UzonTuple | undefined;
function optionalStruct(value: UzonValue): Record<string, UzonValue> | undefined;
function optionalEnum(value: UzonValue): UzonEnum | undefined;
```

```typescript
import { parse, optionalNumber } from "@uzon/uzon";

const r = parse('port is 8080');
const port = optionalNumber(r.port) ?? 3000; // 8080
const missing = optionalNumber(r.host) ?? 3000; // 3000
```

---

### Deep Access

Navigate nested values with dot-path syntax. Supports struct fields, list/tuple indexing, and combinations. Transparently unwraps unions and tagged unions at each level.

#### `get(value, path)`

Returns `undefined` if any segment is missing.

```typescript
function get(value: UzonValue, path: string): UzonValue | undefined;
```

#### `getOrThrow(value, path)`

Throws `TypeError` if the path doesn't resolve.

```typescript
function getOrThrow(value: UzonValue, path: string): UzonValue;
```

```typescript
import { parse, get, getOrThrow } from "@uzon/uzon";

const r = parse(`
  config is {
    database is {
      host is "localhost"
      port is 5432
    }
    servers is ["alpha", "beta"]
    matrix is [[1, 2], [3, 4]]
  }
`);

get(r.config, "database.host");   // "localhost"
get(r.config, "servers[0]");      // "alpha"
get(r.config, "matrix[1][0]");    // 3n
get(r.config, "database.missing"); // undefined

getOrThrow(r.config, "database.host");    // "localhost"
getOrThrow(r.config, "database.missing"); // throws TypeError
```

---

### Pattern Matching

Match on tagged unions and enums by variant.

```typescript
function match<T>(
  value: UzonValue,
  cases: Record<string, (value: UzonValue) => T> & { _?: (value: UzonValue) => T },
): T;
```

- **Tagged unions**: matches on `.tag`, passes `.value` to the handler
- **Enums**: matches on `.value` (variant name), passes the `UzonEnum` to the handler
- **Unions**: unwraps and recurses
- Use `_` as a default/fallback handler
- Throws `TypeError` if no match and no `_` handler

```typescript
import { parse, match, asString } from "@uzon/uzon";

// Enum matching
const r = parse('color is red from red, green, blue');
const hex = match(r.color, {
  red:   () => "#ff0000",
  green: () => "#00ff00",
  blue:  () => "#0000ff",
});
// "#ff0000"

// Tagged union matching
const r2 = parse('status is "ok" named success from success as string, failure as string');
const msg = match(r2.status, {
  success: (v) => `Success: ${asString(v)}`,
  failure: (v) => `Error: ${asString(v)}`,
});

// Default handler
const result = match(r.color, {
  red: () => "primary",
  _:   () => "other",
});
```

---

### JSON Interop

#### `toJSON(value, options?)`

Convert a `UzonValue` to a JSON-safe value (safe for `JSON.stringify`).

```typescript
function toJSON(value: UzonValue, options?: ToJSONOptions): JSONValue;
```

- `bigint` → `number` (default) or `"string"`. Unsafe bigints (> `Number.MAX_SAFE_INTEGER`) automatically become strings.
- `NaN` / `Infinity` → `null` (default) or `"string"` representation
- `UzonEnum` → `string` (variant name)
- `UzonTaggedUnion` → `{ _tag: string, _value: JSONValue }`
- `UzonTuple` → `array`

#### `fromJSON(value)`

Convert a JSON-compatible value back to `UzonValue`.

```typescript
function fromJSON(value: any): UzonValue;
```

- Safe integers → `bigint`
- Non-integer numbers → `number`
- Objects with `_tag` and `_value` → `UzonTaggedUnion` (roundtrip support)
- Arrays → `UzonValue[]`
- Objects → `Record<string, UzonValue>`

#### `ToJSONOptions`

```typescript
interface ToJSONOptions {
  bigint?: "number" | "string";      // bigint handling (default: "number")
  nonFinite?: "null" | "string";     // NaN/Infinity handling (default: "null")
}
```

```typescript
import { parse, toJSON, fromJSON } from "@uzon/uzon";

const r = parse('x is 42\ny is inf\ncolor is red from red, green, blue');

toJSON(r.x);     // 42
toJSON(r.y);     // null
toJSON(r.color); // "red"

toJSON(r.y, { nonFinite: "string" }); // "Infinity"

// Roundtrip
const json = toJSON(r.x);
const back = fromJSON(json); // 42n
```

---

### Merge

Deep merge for layered configuration (base + overrides).

#### `merge(base, override)`

Deep merge two binding records. Struct fields are merged recursively; non-struct values are replaced. Returns a new object — inputs are not mutated.

```typescript
function merge(
  base: Record<string, UzonValue>,
  override: Record<string, UzonValue>,
): Record<string, UzonValue>;
```

#### `mergeValues(base, override)`

Merge two individual `UzonValue` values. Structs are merged recursively; everything else is replaced by the override.

```typescript
function mergeValues(base: UzonValue, override: UzonValue): UzonValue;
```

```typescript
import { parse, merge } from "@uzon/uzon";

const base = parse(`
  database is {
    host is "localhost"
    port is 5432
  }
  debug is false
`);

const prod = parse(`
  database is {
    host is "prod-db.example.com"
  }
  debug is false
`);

const config = merge(base, prod);
// database.host → "prod-db.example.com" (overridden)
// database.port → 5432n (preserved from base)
// debug → false
```

---

### Builder

Create UZON values from plain JavaScript without writing UZON syntax.

#### `uzon(object)`

Auto-convert a plain JS object. Integer numbers become `bigint`, nested objects become structs, arrays become lists.

```typescript
import { uzon } from "@uzon/uzon";

const config = uzon({
  host: "localhost",
  port: 8080,            // → 8080n (bigint)
  rate: 3.14,            // stays number (float)
  tags: ["api", "v2"],   // → list
  db: { port: 5432 },    // → struct
});
```

#### `` uzon`...` `` (tagged template literal)

Write UZON syntax inline with JS interpolation.

```typescript
import { uzon } from "@uzon/uzon";

const host = "localhost";
const port = 8080;

const config = uzon`
  host is ${host}
  port is ${port}
  color is red from red, green, blue
`;
```

#### Factory Helpers

```typescript
uzon.int(value: number | bigint): bigint
```
Create an integer value.

```typescript
uzon.float(value: number): ExplicitFloat
```
Force a float, even for integer-valued numbers. Without this, `uzon({ rate: 60 })` would produce `60n` (bigint). Use `uzon({ rate: uzon.float(60) })` to keep it as `60` (number).

```typescript
uzon.enum(variant: string, variants: string[], typeName?: string): UzonEnum
```
Create an enum value.

```typescript
uzon.tuple(...elements: JSInput[]): UzonTuple
```
Create a tuple. Elements are auto-converted.

```typescript
uzon.tagged(tag: string, value: JSInput, variants: Record<string, string | null>, typeName?: string): UzonTaggedUnion
```
Create a tagged union.

```typescript
uzon.union(value: JSInput, types: string[], typeName?: string): UzonUnion
```
Create an untagged union.

```typescript
uzon.list(...elements: JSInput[]): UzonValue[]
```
Create a list. Elements are auto-converted.

```typescript
uzon.struct(obj: Record<string, JSInput>): Record<string, UzonValue>
```
Create a struct. Values are auto-converted.

```typescript
uzon.value(value: JSInput): UzonValue
```
Auto-convert a single value.

```typescript
import { uzon } from "@uzon/uzon";

const config = uzon({
  host: "localhost",
  port: 8080,
  rate: uzon.float(60),
  color: uzon.enum("red", ["red", "green", "blue"], "Color"),
  point: uzon.tuple(10, 20),
  status: uzon.tagged("ok", "success", { ok: "string", err: "string" }),
});
```

---

### Immutable Updates

All update functions return new values — originals are never mutated.

#### Struct Updates

```typescript
function withField(struct: Record<string, UzonValue>, key: string, value: UzonValue): Record<string, UzonValue>;
function withoutField(struct: Record<string, UzonValue>, key: string): Record<string, UzonValue>;
```

```typescript
import { parse, withField, withoutField } from "@uzon/uzon";

const config = parse('host is "localhost"\nport is 8080\ndebug is true');

const updated = withField(config, "port", 3000n);
// { host: "localhost", port: 3000n, debug: true }

const removed = withoutField(config, "debug");
// { host: "localhost", port: 8080n }
```

#### List Updates

```typescript
function append(list: UzonValue[], value: UzonValue): UzonValue[];
function prepend(list: UzonValue[], value: UzonValue): UzonValue[];
function setAt(list: UzonValue[], index: number, value: UzonValue): UzonValue[];   // throws RangeError
function removeAt(list: UzonValue[], index: number): UzonValue[];                   // throws RangeError
```

```typescript
import { append, prepend, setAt, removeAt } from "@uzon/uzon";

const list = [1n, 2n, 3n];

append(list, 4n);     // [1n, 2n, 3n, 4n]
prepend(list, 0n);    // [0n, 1n, 2n, 3n]
setAt(list, 1, 99n);  // [1n, 99n, 3n]
removeAt(list, 0);    // [2n, 3n]
```

#### Tuple Updates

```typescript
function tupleSetAt(tuple: UzonTuple, index: number, value: UzonValue): UzonTuple; // throws RangeError
```

---

### Display

#### `displayValue(value)`

Human-readable display of any `UzonValue`. Useful for debugging and logging.

```typescript
function displayValue(value: UzonValue): string;
```

```typescript
import { parse, displayValue, UzonTuple } from "@uzon/uzon";

displayValue(42n);                            // "42"
displayValue("hello");                        // '"hello"'
displayValue([1n, 2n, 3n]);                   // "[1, 2, 3]"
displayValue({ a: 1n, b: "hi" });             // '{ a: 1, b: "hi" }'
displayValue(new UzonTuple([1n, "a", true])); // '(1, "a", true)'
```

Compound types also support `toString()`:

```typescript
const t = new UzonTuple([1n, 2n, 3n]);
`${t}`; // "(1, 2, 3)"

const f = new UzonFunction(["x"], ["i32"], [null], "i32", ...);
`${f}`; // "fn(x: i32) -> i32"
```

---

### Watch

Watch a UZON file for changes and re-parse on modification.

```typescript
function watch(
  filePath: string,
  callback: (bindings: Record<string, UzonValue>) => void,
  options?: WatchOptions,
): () => void; // returns cleanup function
```

#### `WatchOptions`

```typescript
interface WatchOptions {
  debounce?: number;                    // Debounce interval in ms (default: 100)
  interval?: number;                    // Polling interval in ms (default: 1000)
  immediate?: boolean;                  // Invoke callback immediately (default: true)
  onError?: (error: Error) => void;     // Called on parse errors
  env?: Record<string, string>;         // Environment variables
}
```

```typescript
import { watch } from "@uzon/uzon";

const stop = watch("config.uzon", (config) => {
  console.log("Config reloaded:", config);
}, {
  onError: (err) => console.error("Parse error:", err.message),
});

// Later: stop watching
stop();
```

---

### Value Classes

#### `UzonEnum`

```typescript
class UzonEnum {
  constructor(value: string, variants: readonly string[], typeName?: string | null);

  readonly value: string;                   // Selected variant
  readonly variants: readonly string[];     // All variants
  readonly typeName: string | null;         // Type name (if named)

  valueOf(): string;    // Returns variant name
  toString(): string;   // Returns variant name
}
```

#### `UzonUnion`

```typescript
class UzonUnion {
  constructor(value: UzonValue, types: readonly string[], typeName?: string | null);

  readonly value: UzonValue;            // Inner value
  readonly types: readonly string[];    // Possible type names
  readonly typeName: string | null;

  valueOf(): UzonValue;  // Returns inner value
  toString(): string;    // String representation of inner value
}
```

#### `UzonTaggedUnion`

```typescript
class UzonTaggedUnion {
  constructor(value: UzonValue, tag: string, variants: ReadonlyMap<string, string | null>, typeName?: string | null);

  readonly value: UzonValue;                             // Inner value
  readonly tag: string;                                  // Variant tag
  readonly variants: ReadonlyMap<string, string | null>; // Tag → payload type
  readonly typeName: string | null;

  valueOf(): UzonValue;  // Returns inner value
  toString(): string;    // String representation of inner value
}
```

#### `UzonTuple`

```typescript
class UzonTuple {
  constructor(elements: readonly UzonValue[]);

  readonly elements: readonly UzonValue[];
  readonly length: number;

  [Symbol.iterator](): Iterator<UzonValue>;  // Iterable
  toString(): string;                        // e.g. "(1, 2, 3)"
}
```

#### `UzonFunction`

```typescript
class UzonFunction {
  constructor(
    paramNames: readonly string[],
    paramTypes: readonly string[],
    defaultValues: readonly (UzonValue | null)[],
    returnType: string,
    body: unknown,
    finalExpr: unknown,
    closureScope: unknown,
    typeName?: string | null,
  );

  readonly paramNames: readonly string[];
  readonly paramTypes: readonly string[];
  readonly defaultValues: readonly (UzonValue | null)[];
  readonly returnType: string;
  readonly typeName: string | null;

  toString(): string;  // e.g. "fn(x: i32, y: i32) -> i32"
}
```

#### `UZON_UNDEFINED`

```typescript
const UZON_UNDEFINED: unique symbol;
type UzonUndefined = typeof UZON_UNDEFINED;
```

Sentinel for unresolved lookups (e.g. `self.missing`, `env.UNSET`). Not a valid value — propagates through member access but causes errors in operations.

---

### Errors

All UZON errors extend `UzonError` and carry source location information.

```typescript
class UzonError extends Error {
  readonly line?: number;
  readonly col?: number;
  filename?: string;
  readonly importTrace: ImportFrame[];

  withFilename(filename: string): this;
  addImportFrame(filename: string, line: number, col: number): this;
}

class UzonSyntaxError extends UzonError {}   // Lexical/grammatical violations
class UzonTypeError extends UzonError {}     // Type annotation mismatches
class UzonRuntimeError extends UzonError {}  // Overflow, division by zero, etc.
class UzonCircularError extends UzonError {} // Circular dependency between bindings

interface ImportFrame {
  filename: string;
  line: number;
  col: number;
}
```

```typescript
import { parse, UzonSyntaxError } from "@uzon/uzon";

try {
  parse('x is is is');
} catch (e) {
  if (e instanceof UzonSyntaxError) {
    console.log(`${e.line}:${e.col}: ${e.message}`);
  }
}
```

---

### Low-Level API

For advanced use cases, the lexer, parser, and evaluator are exposed directly.

```typescript
import { Lexer, Parser, Evaluator } from "@uzon/uzon";

const tokens = new Lexer(source).tokenize();
const ast = new Parser(tokens).parse();
const bindings = new Evaluator({ env: process.env }).evaluate(ast);
```

#### `Lexer`

```typescript
class Lexer {
  constructor(src: string);
  tokenize(): Token[];
}
```

#### `Parser`

```typescript
class Parser {
  constructor(tokens: Token[]);
  parse(): DocumentNode;
}
```

#### `Evaluator`

```typescript
class Evaluator {
  constructor(options?: EvalOptions);
  evaluate(doc: DocumentNode): Record<string, UzonValue>;
}
```

#### `EvalOptions`

```typescript
interface EvalOptions {
  env?: Record<string, string>;
  filename?: string;
  fileReader?: (path: string) => string;
  importCache?: Map<string, Record<string, UzonValue>>;
  scopeCache?: Map<string, Scope>;
  importStack?: string[];
}
```

#### `Scope`

```typescript
class Scope {
  constructor(parent?: Scope | null);

  set(name: string, value: UzonValue): void;
  get(name: string, exclude?: string): UzonValue | typeof UZON_UNDEFINED;
  has(name: string): boolean;
  hasOwn(name: string): boolean;
  ownBindingNames(): string[];
  setType(name: string, def: TypeDef): void;
}
```

#### `TypeDef`

Type definition stored in a `Scope`. Used by the evaluator for type checking and annotation resolution.

```typescript
interface TypeDef {
  kind: "enum" | "union" | "tagged_union" | "struct" | "list" | "primitive" | "function";
  name: string;
  variants?: string[];                     // Enum variant names
  variantTypes?: Map<string, string>;      // Tagged union: tag → payload type
  memberTypes?: string[];                  // Union member type names
  fields?: Map<string, string>;            // Struct: field → type tag
  fieldAnnotations?: Map<string, string>;  // Struct: per-field type annotations
  elementType?: string;                    // List element type
  paramTypes?: string[];                   // Function parameter types
  returnType?: string;                     // Function return type
}
```

#### AST Types

```typescript
// Top-level document
interface DocumentNode { kind: "Document"; bindings: BindingNode[]; line: number; col: number; }

// A named binding: `name is value`
interface BindingNode { kind: "Binding"; name: string; value: AstNode; line: number; col: number; }

// All binary operators
type BinaryOp =
  | "+" | "-" | "*" | "/" | "%" | "^" | "++" | "**"
  | "<" | "<=" | ">" | ">="
  | "and" | "or"
  | "is" | "is not" | "is named" | "is not named"
  | "in";

// AstNode is a discriminated union of all expression node types
type AstNode = IntegerLiteralNode | FloatLiteralNode | StringLiteralNode | BoolLiteralNode
  | NullLiteralNode | IdentifierNode | BinaryOpNode | UnaryOpNode | IfExprNode
  | StructLiteralNode | ListLiteralNode | TupleLiteralNode | /* ... and more */;
```

#### `TokenType` (enum)

Covers all UZON token types: `Integer`, `Float`, `String`, `True`, `False`, `Null`, `Identifier`, `Is`, `From`, `Called`, `As`, `Named`, `With`, `Plus`, `Minus`, `Star`, `Slash`, `LBrace`, `RBrace`, `LBracket`, `RBracket`, `LParen`, `RParen`, `Comma`, `Dot`, `Newline`, `Eof`, and more.

#### `formatUzonFloat(value)`

Format a number as a UZON float literal (shortest round-trip form, always includes a decimal point).

```typescript
function formatUzonFloat(value: number): string;
```

```typescript
formatUzonFloat(42);       // "42.0"
formatUzonFloat(3.14);     // "3.14"
formatUzonFloat(Infinity); // "inf"
formatUzonFloat(NaN);      // "nan"
```

---

## Iteration

UZON compound types support standard JS iteration:

```typescript
import { parse } from "@uzon/uzon";

const r = parse('items is [1, 2, 3]\npoint is (10, 20)');

// Lists are arrays — all array methods work
for (const item of r.items as any[]) { ... }

// Tuples are iterable via Symbol.iterator
for (const elem of r.point as UzonTuple) { ... }

// Structs are plain objects — use Object.entries
for (const [key, value] of Object.entries(r)) { ... }
```

---

## License

[MIT](LICENSE)
