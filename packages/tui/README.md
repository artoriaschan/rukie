# @neant/tui

Independent Bun terminal renderer. `render(element, { stdin, stdout })` mounts a React tree synchronously and returns `{ unmount, waitUntilExit }`. Later React commits coalesce into at most one frame every 16ms, painting only changed cells. Unmount cancels any pending frame. `stdout` provides `columns`, `rows`, and `write`; `stdin` is reserved for the input ticket.

```tsx
import { Box, Text, render } from "@neant/tui";

const app = render(
  <Box flexDirection="column" padding={1} borderStyle="single">
    <Text color="cyan" bold>
      你好 Neant
    </Text>
    <Box gap={1}>
      <Text>Left</Text>
      <Text dimColor>Right</Text>
    </Box>
  </Box>,
  { stdin: process.stdin, stdout: process.stdout },
);

app.unmount();
await app.waitUntilExit();
```

Box dimensions and spacing use terminal cells. Direction defaults to `row`; grow and shrink default to zero. Padding and margin accept a uniform value, X/Y values, or individual edges (individual edges take precedence). `borderStyle="single"` adds a one-cell border. Text supports the eight ANSI color names, `gray`, six-digit RGB hex colors, `bold`, and `dimColor`. Nested Text inherits styles, with explicit `false` disabling inherited bold/dim styles. Text uses `Bun.wrapAnsi` to wrap at word boundaries, splitting long words by display columns and trimming whitespace at line boundaries; `wrap="truncate"` clips each explicit line. A wide glyph that cannot fit even on an empty line is omitted.

Rendering starts at the current terminal line on the main screen, preserving output above it. Each mounted renderer owns its active area and frame history. Subsequent frames compare characters, display widths and styles and clear removed content. An active area taller than the terminal shows its bottom rows without sending earlier active frames into scrollback. The cursor rests at column zero below the content (or on the last row). Input/resize events are subsequent tickets.

`Static` accepts append-only React children. Give each item a stable, unique key and keep the same `Static` mounted for the session. Newly committed items render once, in order, above the active area; as the terminal fills, they advance into its native scrollback. Completed items take no space in the active layout, are excluded from frame diffs, and cannot be edited, reordered or printed again by reusing their keys. Static items completed between frames are retained even if React removes them before the next paint.

```tsx
<Box flexDirection="column">
  <Static>
    {completed.map((item) => (
      <Text key={item.id}>{item.text}</Text>
    ))}
  </Static>
  <Box gap={1}>
    <Spinner color="cyan" />
    <Text>Working…</Text>
  </Box>
</Box>
```

`Spinner` advances its one-column glyph every 80ms, accepts Text's color, bold and dim options, and clears its interval when unmounted.

Only `layout` imports `yoga`. The two Yoga files are vendored from dsh-TUI at `646740f12c34546d6c195f5b7031be0dc67421a5`; changes are limited to provenance headers and repository formatting. Their existing unused public APIs and array construction are excluded from Knip and the corresponding lint rules so the port stays intact. See [ADR-0005](../../docs/adr/0005-own-tui-renderer.md) for provenance and the accepted source risk.
