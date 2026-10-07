import { Type, type Static } from "typebox";

const kind = Type.Union([
  Type.Literal("read"),
  Type.Literal("edit"),
  Type.Literal("delete"),
  Type.Literal("move"),
  Type.Literal("search"),
  Type.Literal("execute"),
  Type.Literal("fetch"),
  Type.Literal("task"),
  Type.Literal("other"),
]);
const common = { kind, displayKey: Type.Optional(Type.String()) };
const diff = Type.Union([
  Type.Object({
    path: Type.String(),
    oldText: Type.Union([Type.String(), Type.Null()]),
    newText: Type.String(),
  }),
  Type.Object({ path: Type.String(), patch: Type.String() }),
]);
const diffs = Type.Array(diff);
export const ToolCallViewSchema = Type.Union([
  Type.Object({
    ...common,
    card: Type.Literal("generic"),
    title: Type.Optional(Type.String()),
    rawInput: Type.Optional(Type.Unknown()),
    server: Type.Optional(Type.String()),
    tool: Type.Optional(Type.String()),
  }),
  Type.Object({ ...common, card: Type.Literal("terminal"), command: Type.String() }),
  Type.Object({ ...common, card: Type.Literal("diff"), diffs }),
]);
/** Output notices are facts separate from body text: frontends keep them visible outside folds.
 * Read continuation offsets come from upstream truncation metadata; recovery paths may expire. */
export const ToolResultViewSchema = Type.Union([
  Type.Object({ ...common, card: Type.Literal("generic"), text: Type.String() }),
  Type.Object({
    ...common,
    card: Type.Literal("terminal"),
    output: Type.String(),
    exitCode: Type.Optional(Type.Number()),
    signal: Type.Optional(Type.String()),
    outputUnavailable: Type.Optional(Type.Boolean()),
    fullOutputPath: Type.Optional(Type.String()),
  }),
  Type.Object({ ...common, card: Type.Literal("diff"), diffs }),
  Type.Object({
    ...common,
    card: Type.Literal("search"),
    shape: Type.Literal("paths"),
    paths: Type.Array(Type.String()),
    total: Type.Optional(Type.Number()),
  }),
  Type.Object({
    ...common,
    card: Type.Literal("search"),
    shape: Type.Literal("matches"),
    matches: Type.Array(
      Type.Object({ path: Type.String(), line: Type.Optional(Type.Number()), text: Type.String() }),
    ),
    total: Type.Optional(Type.Number()),
  }),
  Type.Object({
    ...common,
    card: Type.Literal("read"),
    path: Type.String(),
    offset: Type.Optional(Type.Number()),
    totalLines: Type.Optional(Type.Number()),
    outputUnavailable: Type.Optional(Type.Boolean()),
    nextOffset: Type.Optional(Type.Number()),
    content: Type.String(),
  }),
  Type.Object({
    ...common,
    card: Type.Literal("web"),
    url: Type.String(),
    markdown: Type.String(),
  }),
]);
export type ToolCallView = Static<typeof ToolCallViewSchema>;
export type ToolResultView = Static<typeof ToolResultViewSchema>;
export type ToolKind = ToolCallView["kind"];
