# Changelog

## 0.10.0 (2026-04-20)

Align implementation with UZON specification v0.10.

### Features

- **Standalone type declarations** (§3.2/§3.5/§3.6/§3.7): `A is struct {...}`, `Color is enum ...`, `Id is union ...`, `Result is tagged union ...` — the binding name becomes the type name, no `called` required.
- **Variant shorthand** (§3.5/§3.7): bare variant names resolve via type-context inference — list element type, `if`/`case` unification, `or else` right operand, `in` left operand, `is`/`is not` operand, struct field value, function argument, function return, and `as`-annotated bindings.
- **Struct field defaults** (§3.2): omitted fields in typed struct literals adopt their declared default values.
- **If-expression narrowing** (§5.9 R8): `is type`, `is not type`, `is named`, `is not named` narrow the scrutinee's type inside the speculative branch.
- **Named list type preservation** (§5.16 R4): `std.reverse`, `std.filter`, `std.sort` preserve the named list type of their input.

### Spec alignment

- **`are` binding `as` lift** (§3.4.1/§9): trailing `as type_expr` at the end of an `are` binding is always lifted to list-level; use parentheses for element-level `as` on the final element.
- **Rule 2 enum resolution** (§3.5): bare identifier `+` `as EnumType` resolves as a variant regardless of same-name bindings in scope.
- **Nominal identity** on `as` annotations (§3.5/§6.1) for named enums/structs/tagged unions/functions.
- **Integer-to-float promotion** for untyped literals in unions (§6.3 R7).
- **Union membership** checks handle tuple and list member types (§3.6).
- **`undefined` rejection** in function return, `if` branches, and `or else` operands (§4.5).
- **Function member access** is a type error — functions have no fields.
- **Empty list annotation**: `null as [T]` rejected — use `[] as [T]`.
- **List element type validation** for list annotations (§3.4).
- **Empty interpolation** `{}` and duplicate function parameters are syntax errors.
- **BOM handling** (§2.1): leading BOM stripped; mid-file BOM is a valid identifier character.

## 0.5.0 (2026-04-11)

Initial release implementing the UZON specification v0.5.

### Features

- **Parsing**: `parse()`, `parseFile()` with native mode and bigint options
- **Stringify**: `stringify()`, `stringifyValue()`, `stringifyFile()` with roundtrip support
- **Type system**: integers (bigint), floats, strings, booleans, null, lists, tuples, structs, enums, unions, tagged unions, functions
- **Type guards**: `isNull`, `isBool`, `isInteger`, `isFloat`, `isNumber`, `isString`, `isList`, `isTuple`, `isEnum`, `isUnion`, `isTaggedUnion`, `isStruct`, `isUndefined`
- **Type narrowing**: `asNumber`, `asInteger`, `asString`, `asBool`, `asList`, `asTuple`, `asStruct`, `asEnum`
- **Optional helpers**: `optionalNumber`, `optionalInteger`, `optionalString`, `optionalBool`, `optionalList`, `optionalTuple`, `optionalStruct`, `optionalEnum`
- **Deep access**: `get()`, `getOrThrow()` with dot-path and index syntax
- **Pattern matching**: `match()` for enums and tagged unions
- **JSON interop**: `toJSON()`, `fromJSON()` with tagged union roundtrip
- **Merge**: `merge()`, `mergeValues()` for layered configuration
- **Builder**: `uzon()` with auto-conversion, factory helpers, and tagged template literals
- **Immutable updates**: `withField`, `withoutField`, `append`, `prepend`, `setAt`, `removeAt`, `tupleSetAt`
- **Display**: `displayValue()` and `toString()` on compound types
- **Watch**: `watch()` for live config reloading with debounce
- **Expressions**: arithmetic, string interpolation, conditionals, case/when, comparisons
- **Functions**: first-class pure functions with type annotations
- **Struct imports**: `struct "path.uzon"` with circular dependency detection
- **Environment variables**: `env.VAR` references
- **Error reporting**: source location, import traces, "did you mean" hints
