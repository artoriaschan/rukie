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

Box dimensions and spacing use terminal cells. Direction defaults to `row`; grow and shrink default to zero. Padding and margin accept a uniform value, X/Y values, or individual edges (individual edges take precedence). `borderStyle="single"` adds a one-cell border; `borderStyle="round"` uses the same layout with `╭╮╰╯` corners. Text supports the eight ANSI color names, `gray`, six-digit RGB hex colors, `bold`, `dimColor`, `italic`, `inverse`, and `underline`. Nested Text inherits styles, with explicit `false` disabling inherited emphasis, including underline (SGR 4). Text uses `Bun.wrapAnsi` to wrap at word boundaries, splitting long words by display columns and trimming whitespace at line boundaries; `wrap="truncate"` clips each explicit line. A wide glyph that cannot fit even on an empty line is omitted.

`Box` accepts `backgroundColor` in raw ANSI names or RGB hex colors, filling its rectangle including padding and empty cells. Descendant text inherits this background unless it sets its own; nested boxes can override it. Backgrounds follow the same scroll clipping and `NO_COLOR` behavior as text colors.

`ThemedText` resolves both `color` and `backgroundColor` theme tokens through the current `ThemeProvider`, while accepting raw ANSI names and RGB hex colors. `ThemedBox` resolves background tokens and scopes its foreground color to descendant themed text. The dark theme includes `userPromptLabel` (`#FFDF80`) for bold gold user prompts without a background fill, `bashBorder` (`#D194AE`) for local command headings, and `barSystem`, `barPrompt`, `barAssistant`, `barThinking`, `barTools`, `barFree`, and `barFreeText` for context usage bars. An omitted background retains normal inheritance without using the default foreground color.

In fullscreen mode, mouse tracking includes button motion (1002) and any motion (1003), using SGR coordinates (1006). `Box` accepts `onMouseEnter()` and `onMouseLeave()`. Hover uses the last painted screen rectangles, including ScrollBox offsets and clipping, and includes the hit node's ancestors with hover callbacks. Callbacks run from the innermost Box outward, with all leaves before any enters; repeated motion in the same cell does nothing. Resize dispatches leaves and clears hover until the next frame. Fullscreen terminals also enable focus reporting (1004); `useInput` receives `{ type: "focus", focused }` for focus-in/out, including split input sequences. `useTerminalFocus()` reads the last reported focus, defaulting to true, so newly mounted animations share the same state. Mouse tracking and focus reporting are disabled on exit.

Rendering starts at the current terminal line on the main screen, preserving output above it. Each mounted renderer owns its active area and frame history. Subsequent frames compare characters, display widths and styles and clear removed content. An active area taller than the terminal shows its bottom rows without sending earlier active frames into scrollback. Resize clears and repaints the active area on the next scheduled frame using the new dimensions, preserving completed output.

`useInput(handler, { isActive?: boolean })` subscribes to parsed input. The handler receives an `InputEvent`: either `{ type: "key", input, key: { name, ctrl, shift, alt } }` or `{ type: "paste", input }`. Key names include `left`, `right`, `up`, `down`, `enter`, `backspace`, `delete`, `escape`, `tab`, `home`, `end`, `pageup`, and `pagedown`. Printable and Ctrl keys also carry their character in `input`; special keys have an empty `input`. UTF-8 and escape sequences may span stdin chunks. Bracketed paste delivers the complete original payload once, including embedded newlines and control bytes. The renderer leaves Ctrl+C and Ctrl+D decisions to the frontend.

`ScrollBox` owns a clipped column and exposes `ScrollHandle.getSnapshot()`, `scrollBy(lines)` and `scrollToBottom()`. A snapshot records both absolute `top` and `following`; restore both with `initialTop` and `initialFollow` when remounting. For content that can change height while unmounted, give its enclosing `Box` a unique, stable `scrollAnchorId` and pass the captured `snapshot.anchor` as `initialAnchor`. The anchor identifies that box, its descendant text path, and a text offset, so duplicate text and width reflow do not confuse identity. Keep the logical content's ID through presentation changes and keep its descendant structure stable; use a new ID for replacement content. A missing ID or text path falls back to `initialTop`, clamped to the current content. Following snapshots still restore at the bottom. Mounted width changes retain the existing text anchor behavior. These APIs carry no frontend or Session semantics.

`useTerminalSize()` returns `{ columns, rows }` and updates on stdout's `resize` event. Hooks must be called inside a tree mounted by `render`.

Mouse input also delivers `{ type: "move", x, y }` for motion with no button held, and `{ type: "wheel", input: "", x, y, delta }` for wheel scrolling (`delta` is -1 up or 1 down). Coordinates are zero-based screen cells. Input handlers should narrow by `type` before reading keyboard or paste fields; `TextInput` ignores mouse events.

`Box.onWheel(event)` routes wheel input to the nearest handler on the topmost painted box or its ancestors, using the same bounds and scroll clipping as clicks. Routing runs before `useInput` subscribers; those subscribers still receive the event, so frontends that also scroll in `useInput` must avoid handling a routed event twice.

`ScrollBox` clips an independent reading column. `initialFollow` and `initialTop` set its position at mount; its `ScrollHandle` exposes `scrollBy(lines)`, `scrollToBottom()` and `getSnapshot()`, while `onScroll` observes painted viewport updates. By default, fitting content and scrolling to the bottom enable following future output. The follow policy is chosen at mount. Readers can combine `initialFollow={false}` with `followOnReachBottom={false}` to keep the current top when content grows, including after an explicit `scrollToBottom()`. Resize or shrinking content still clamps that position into the valid range. Save the handle's current top before unmount and pass it as `initialTop` when returning to a page.

`createTextInputHistory(entries)` retains the draft and caret during recall; `isBrowsing()` lets a completion menu leave arrow keys with an active history walk. `reset()` ends that walk when the owner submits, clears, or externally replaces the input.

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

`TextInput` accepts `onPaste(text, insert)` for screen-owned paste admission. `filterInput(event, insert)` also supplies this insertion callback for screen-owned keyboard actions. The original payload reaches the callback once; calling `insert` normalizes line endings and inserts at the editor's live caret. The owner must discard asynchronous results after the editor's context changes or unmounts. Without `onPaste`, pastes insert immediately as before. `highlightRanges` paints ordered, non-overlapping UTF-16 ranges with optional foreground `color` and `inverse` emphasis; ranges affect only presentation and leave editing unchanged.

`atomicRanges` supplies ordered, non-overlapping UTF-16 ranges within a single explicit line. They are generic editing units: caret movement snaps to the range's boundary in the direction of travel (or the nearer boundary for external positioning), Backspace/Delete remove a touched unit, and wrapping moves a complete unit to the next line. Shift+arrows/Home/End extend a highlighted selection; selection edges expand across any touched unit, and typing or pasting replaces the selection. `onChange(value, edit)` reports the replaced `{ start, end, text }` range, allowing an owner to retain attachment identity through edits without inferring it from labels. History replacement has no edit range; `onHistoryRecall()` runs before it so owners can discard draft capabilities while retaining plain text. These renderer APIs have no Agent Core dependency.

`Image` reserves its `width` × `height` in terminal cells and accepts original PNG `data` as base64, `mimeType`, `sourceWidth`, and `sourceHeight`. Its optional `crop: { x, y, width, height }` selects original source pixels before terminal scaling. The renderer fits the selected source inside that reserved box using reported pixel cell dimensions (nominal 1:2 without metrics), rounds the fitted dimensions down to whole cells with a one-cell minimum, and centers it. Scroll clipping intersects this fitted rectangle before converting visible cells to source pixels, so clipped padding does not discard image content. Kitty preserves source aspect within the final cell rectangle; subcell rounding can retain a small border. The owning app supplies fallback copy. Other media types reserve layout without drawing pixels. Image dimensions must match the PNG IHDR; base64 control characters and malformed payload lengths are rejected.

`useTerminalGraphics()` returns `{ supported, cellWidth, cellHeight }`. Fullscreen renderers query Kitty support and pixel cell dimensions at runtime. Support requires a positive Kitty query reply; pixel dimensions can remain undefined, allowing Fit thumbnails while apps disable original-pixel inspection. `RenderOptions.env` defaults to `process.env` and can be injected; tmux/screen environments and inline mode disable graphics. APC, cell-size and DA replies are consumed by the input parser, including split and late replies, without producing editor keys. Bracketed paste retains its original payload.

PNG bytes use Kitty `f=100`, transmitted in at most 4096-byte base64 chunks. Visible occurrences share one upload but own separate placements. Scroll clipping adjusts the source pixel crop, and changed placements preserve uploaded bytes. The live resource budget is 32 distinct images, 32 MiB encoded source bytes, and 64 Mi pixels; this includes a single 8000×8000 admitted image. Over-budget occurrences reserve geometry without drawing. Resources hold content hashes and numeric IDs rather than retained source bytes. Offscreen/unmounted images, resize, renderer disposal and rendering failures delete owned terminal data. Protocol output preserves the text cursor. IDs do not collide across renderer mounts.

Mouse motion with a held button uses `{ type: "move", x, y, button }`, with primary button `0`; unheld motion retains the existing event without `button`. Apps can use this generic event for drag interactions without outputting terminal protocol sequences.

The implementation independently follows [Kitty's protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) and references dsh-TUI's image behavior at `646740f12c34546d6c195f5b7031be0dc67421a5`; no dsh renderer source or decoder dependency is imported (ADR-0005).

`TextInput.onCursorChange(offset)` reports the UTF-16 caret position after grapheme and atomic-range snapping, on mount and whenever the offset changes, including controlled value resets. It only observes editing and does not change input ownership.

`SyntaxHighlightedText` renders source with semantic theme colors. Supply `text` and a `language` or file `path` to select a grammar; unsupported extensions stay plain. For folded code and aligned diffs, call `highlightSyntax(text, { path })` on the complete source first, then pass a selected line's `runs` to `SyntaxHighlightedText`. This preserves multiline comments and strings across the visible window. Runs contain text plus theme token names, so a theme change updates colors without relexing.

`Box.onMouseEnter({ x, y })` receives terminal viewport cell coordinates from the last painted hit target; callbacks that do not use coordinates remain valid. Place one `TooltipProvider` around the full terminal tree, then wrap a title in `Tooltip content={fullText}` only when its visible form hides content. It waits 600 ms before showing one overlay, wraps by grapheme display widths, chooses space above or below the entry point, and clips to the viewport. Leave, unmount, keyboard / click / wheel input, focus loss, and resize cancel pending and visible overlays. Frontends call `useDismissTooltip()` when opening a modal or replacing a page. Fewer than three columns or rows suppress the overlay.

`alignSplitDiff(lines)` 将含路径、hunk 间隔与语法 runs 的 unified 行对齐为 split 行；`SplitDiffView({ rows, width, onToggle?, onPathClick? })` 在给定宽度内逐行渲染固定左右栏，长行截断，不换行。等长替换逐行配对，不等长替换通过 `diffLines` 识别忽略大小写的共同项；配对行用 `diffWordsWithSpace` 标记变化词，变化背景覆盖语法色，共同词保留语法色。应用负责选择布局、折叠窗口和提供 callbacks；路径 callback 只传递路径事实，组件不执行外部操作。点击命中源文本或路径，栏内空白与分隔符不触发 callback。

`Box.textSearch` supplies a literal case-insensitive query and optional foreground / background colors for descendant text. Highlighting changes glyph styles without changing text layout or underlying syntax spans. `ScrollHandle.scrollToText(id, query, occurrence = 0)` targets an occurrence within a stable `scrollAnchorId` on the next layout and pauses bottom following. The request uses current wrapped rows and scroll clipping; if the query is absent, the box's start is the fallback. Frontends own the full search corpus and any bounded content windows.

`Text.onClick()` activates on primary press and release on the same Text's painted non-whitespace graphemes. Both cells of a fully visible wide grapheme belong to it; a grapheme crossing a horizontal clip is omitted by painting and has no hit target. Wrapping, ScrollBox clipping, and resize use the painted layout. Spaces, empty rows, and trailing blank cells do not activate Text. A clickable Text takes precedence over its enclosing Box on its glyphs; Box rectangle clicks retain their existing behavior. Inline styled Text inherits the enclosing text hit target.

`TextInput.onAtomicRangeClick(offset)` opts an editable input into primary clicks on its atomic units. Press and release must land on the same unit in the last painted viewport, including internal spaces; blank cells outside the unit, clipped content, and ordinary text do not activate it. Activation moves the caret to the unit start, clears selection/history recall, and reports the original UTF-16 start even when the caret is already there. `onCursorChange` keeps its change-only contract. Inactive/read-only inputs do not activate units. This callback has no attachment or preview semantics.

`Markdown({ text, onClick? })` 在 design system 内解析 CommonMark、GFM 与 TeX，绘制原生终端块、带语法色的代码框、表格、Unicode 公式和 Mermaid 图。未闭合公式及不支持或过宽的表达保留源文，代码和 HTML 中的 TeX 分隔符不参与归一化。`markdownText(source, columns?)` 与 `markdownProjection(source, columns?)` 提供可搜索的文字及其源行对应；传入终端列数以匹配宽度相关的公式与图形降级。数学 Unicode renderer 来自 Pi 的 MIT 文件，归属与许可保留在 [源码](src/design-system/markdown/latex.ts)。

`SmoothRevealProvider` 为一个显示 Session 保存游标身份；`useSmoothText(key, text, active, enabled = true)` 只为 live 或 fresh 内容创建文本游标，已存在的游标在 `active` 变为 false 后仍追赶到最终内容，非前缀替换立即显示。历史以 `active = false` 初次呈现时直接显示；`enabled = false` 将已有游标收束。`useSmoothReveal(key, total, enabled)` 保留工具行数的同一节拍。两者共享约 30fps 的自适应调度，所有订阅释放或游标追赶完成后停止定时器；已完成的身份不重新播放。

### Painted text selection

`Box` and `ScrollBox` opt a viewport into primary drag selection with `textSelection={{ key, backgroundColor, onCopy, onResult }}`. The renderer selects only the last painted, clipped glyphs; Unicode graphemes remain whole, logical newlines are preserved, and soft wraps are joined. `Text`/`Box selectable={false}` excludes inherited decorations, including nested inline Text. `Text softWrap` marks prewrapped rows that continue the preceding logical line. `textSelection={false}` fences an overlay out of an underlying selection region. These APIs have no Agent Core dependency.

Release clears highlighting and calls the frontend's `onCopy(text): Promise<boolean | "sent">`. `onResult` reports `copied`, `sent` (terminal transport without acknowledgment), `unavailable` (including rejected transport), or `stale` if selected bytes changed before release. Selection suppresses the pressed card action after pointer movement. Wheel, resize, focus loss and keyboard input clear the gesture; Escape consumes an active gesture before frontend key handlers. A changed region `key` or unmount invalidates the gesture and pending result feedback. Selection starts empty after mount and does not persist across Sessions.

`Markdown` accepts `dimColor` to dim all body text, including syntax highlighted code, while preserving Markdown emphasis and token colors.

`alignSplitDiff` returns each aligned row's `sourceLines` identities so callers can retain source positions when switching unified/split layouts. `SplitDiffView` accepts both `scrollAnchorId` and `alternateScrollAnchorId` for paired old/new source rows; pane separators are excluded from selection while source text remains selectable.

Multi-click selection uses presses less than 500ms apart and at most one cell away on each axis. Double press highlights the Unicode/path word immediately; triple and later presses highlight a rendered row. Release copies and clears; dragging extends whole word/line units. Shift/Alt/Ctrl mouse presses reset the click chain and select characters. While a pointer gesture remains active, Shift+arrows/Home/End extends its fixed-anchor text range, with horizontal row wrapping and viewport clamping, then pointer release commits the same stale-content check. With no active text gesture these keys remain frontend input. Modal/Interaction ownership fences out transcript selection.
