# @neant/tui

Independent Bun terminal renderer. `render(element, { stdin, stdout })` mounts a React tree synchronously and returns `{ unmount, waitUntilExit }`. Later React commits coalesce into at most one frame every 16ms, painting only changed cells. Unmount cancels any pending frame. `stdout` provides `columns`, `rows`, `write`, and optional `on`/`off` resize listeners; `stdin` is a readable stream with optional `setRawMode` and `isRaw`. Both real process streams and injected streams are supported.

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

Rendering starts at the current terminal line on the main screen, preserving output above it. Each mounted renderer owns its active area and frame history. Subsequent frames compare characters, display widths and styles and clear removed content. An active area taller than the terminal shows its bottom rows without sending earlier active frames into scrollback. Resize clears and repaints the active area on the next scheduled frame using the new dimensions, preserving completed output.

`useInput(handler, { isActive?: boolean })` subscribes to parsed input. The handler receives an `InputEvent`: either `{ type: "key", input, key: { name, ctrl, shift, alt } }` or `{ type: "paste", input }`. Key names include `left`, `right`, `up`, `down`, `enter`, `backspace`, `delete`, `escape`, `tab`, `home`, `end`, `pageup`, and `pagedown`. Printable and Ctrl keys also carry their character in `input`; special keys have an empty `input`. UTF-8 and escape sequences may span stdin chunks. Bracketed paste delivers the complete original payload once, including embedded newlines and control bytes. The renderer leaves Ctrl+C and Ctrl+D decisions to the frontend.

`useTerminalSize()` returns `{ columns, rows }` and updates on stdout's `resize` event. Hooks must be called inside a tree mounted by `render`.

```tsx
import { TextInput, render, useInput, useTerminalSize } from "@neant/tui";
import { useState } from "react";

function Prompt() {
  const [value, setValue] = useState("");
  const size = useTerminalSize();
  useInput((event) => {
    if (event.type === "key" && event.key.ctrl && event.key.name === "c") setValue("");
  });
  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={(prompt) => console.error(prompt, size)}
    />
  );
}

const app = render(<Prompt />, { stdin: process.stdin, stdout: process.stdout });
await app.waitUntilExit();
```

`TextInput` is controlled through `value` and `onChange`, with optional `onSubmit(value)` and `isActive` (default `true`). Left/right move across complete graphemes, including Chinese and emoji; Backspace/Delete remove the adjacent grapheme. Shift+Enter inserts a newline. Enter after a backslash at the current line's end replaces the backslash with a newline; other Enter presses call `onSubmit` without changing the value. A paste calls `onChange` once, normalizing CRLF/CR line endings to LF. Input wraps by display columns and preserves spaces. The active input shows the terminal cursor at the editing position; without an active input the cursor is hidden below the content.

Unmount restores stdin's original raw mode, pauses it if it was initially idle/paused, shows the cursor, and disables bracketed paste. Process exit, uncaught exceptions, SIGINT, and SIGTERM restore all mounted terminals; existing frontend signal handlers are preserved. Rendering failures also restore the terminal: startup errors throw synchronously, and later errors reject `waitUntilExit()`.
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
