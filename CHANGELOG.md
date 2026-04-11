# Changelog

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
