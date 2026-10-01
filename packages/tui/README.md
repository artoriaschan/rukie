# @neant/tui

Independent Bun terminal renderer. `render(element, { stdin, stdout })` mounts a React tree synchronously and returns `{ unmount, waitUntilExit }`. State updates paint changed cells after React commits. `stdout` provides `columns`, `rows`, and `write`; `stdin` is reserved for the input ticket.

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

The first frame paints the whole viewport on the main screen, without entering the alternate screen. Subsequent frames compare characters, display widths and styles against the previous viewport and write only changed cells, including spaces to clear removed content. Each mounted renderer owns its frame history. Content beyond terminal height is clipped; the cursor rests at column zero below the content (or on the last row). Input/resize events and inline scrollback are subsequent tickets.

Only `layout` imports `yoga`. The two Yoga files are vendored from dsh-TUI at `646740f12c34546d6c195f5b7031be0dc67421a5`; changes are limited to provenance headers and repository formatting. Their existing unused public APIs and array construction are excluded from Knip and the corresponding lint rules so the port stays intact. See [ADR-0005](../../docs/adr/0005-own-tui-renderer.md) for provenance and the accepted source risk.
