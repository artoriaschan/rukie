# Rukie Design System

Design rules for the React DOM interface of the desktop app and future Web frontend. The terminal renderer does not use this file.

This file is meant for coding agents. When generating or editing GUI code, follow this file before inventing new visual rules.

## Baseline

The GUI is built from [beUI](https://beui.dev) first and [shadcn/ui](https://ui.shadcn.com) for what beUI does not provide, both installed through the shadcn CLI (sourcing rules: [AGENTS.md](AGENTS.md#ui-components)). beUI's default style is the visual baseline for every component, including shadcn ones: structure, surfaces, borders, radius, elevation, and motion. Rukie changes this baseline only where this file says so:

- Colors come from GitHub Light and GitHub Dark (see [Themes](#themes)), not from the beUI or shadcn default palettes; beUI's glass and neon tokens take their GitHub-derived values below.
- Interface font sizes use the `text-ui-*` scale (see [Typography](#typography)).
- Copy is localized through `@rukie/i18n`; hard-coded English strings in copied components are replaced.

When this file and a beUI or shadcn default disagree, this file wins. When neither covers a need, update this file first instead of adding one-off values.

## Product Character

Rukie is a desktop-first, Web-compatible coding-agent workspace. Design for:

- long sessions and high information density
- readable chat and tool output
- keyboard-driven workflows
- macOS, Windows, and Linux rendering
- internationalization and variable text length
- light and dark themes

Avoid oversized marketing-style spacing and full-surface brand fills.

## Themes

User-facing theme choices are System, Light, and Dark. Light uses GitHub Light and Dark uses GitHub Dark. Values are copied from the functional themes of `@primer/primitives` 11.10.0; Rukie does not depend on the package at runtime.

The theme keeps beUI's token names (shadcn semantic tokens plus beUI extensions) and the `dark` class variant, so beUI and shadcn components work unmodified.

| Token                  | Light                     | Dark                      | Primer source                   |
| ---------------------- | ------------------------- | ------------------------- | ------------------------------- |
| `--background`         | `#ffffff`                 | `#0d1117`                 | `bgColor-default`               |
| `--foreground`         | `#1f2328`                 | `#f0f6fc`                 | `fgColor-default`               |
| `--card`               | `#f6f8fa`                 | `#151b23`                 | `bgColor-muted`                 |
| `--muted-foreground`   | `#59636e`                 | `#9198a1`                 | `fgColor-muted`                 |
| `--border`             | `#d1d9e0b3`               | `#3d444db3`               | `borderColor-muted`             |
| `--border-strong`      | `#d1d9e0`                 | `#3d444d`                 | `borderColor-default`           |
| `--primary`            | `#0969da`                 | `#1f6feb`                 | `bgColor-accent-emphasis`       |
| `--primary-foreground` | `#ffffff`                 | `#ffffff`                 | `fgColor-onEmphasis`            |
| `--accent`             | `#0969da`                 | `#4493f8`                 | `fgColor-accent`                |
| `--accent-fg`          | `#ffffff`                 | `#0d1117`                 | contrast pair                   |
| `--ring`               | `#0969da`                 | `#1f6feb`                 | `borderColor-accent-emphasis`   |
| `--danger`             | `#d1242f`                 | `#f85149`                 | `fgColor-danger`                |
| `--success`            | `#1a7f37`                 | `#3fb950`                 | `fgColor-success`               |
| `--warning`            | `#9a6700`                 | `#d29922`                 | `fgColor-attention`             |
| `--neon`               | `#1a7f37`                 | `#3fb950`                 | `fgColor-success`               |
| `--violet`             | `#8250df`                 | `#ab7df8`                 | `fgColor-done`                  |
| `--glass-bg`           | `rgb(255 255 255 / 0.55)` | `rgb(21 27 35 / 0.55)`    | background or card with alpha   |
| `--glass-border`       | `rgb(31 35 40 / 0.08)`    | `rgb(240 246 252 / 0.08)` | foreground with alpha           |
| `--glass-strong-bg`    | `rgb(255 255 255 / 0.7)`  | `rgb(21 27 35 / 0.6)`     | card with alpha                 |
| `--glass-thin-bg`      | `rgb(255 255 255 / 0.45)` | `rgb(13 17 23 / 0.45)`    | background with alpha           |
| `--diff-added`         | `#dafbe1`                 | `#2ea04326`               | `diffBlob-additionLine-bgColor` |
| `--diff-added-word`    | `#aceebb`                 | `#2ea04366`               | `diffBlob-additionWord-bgColor` |
| `--diff-removed`       | `#ffebe9`                 | `#f851491a`               | `diffBlob-deletionLine-bgColor` |
| `--diff-removed-word`  | `#ffcecb`                 | `#f8514966`               | `diffBlob-deletionWord-bgColor` |

The remaining shadcn tokens keep beUI's derivations: `--card-foreground`, `--popover-foreground`, and `--secondary-foreground` use `--foreground`; `--popover`, `--secondary`, and `--muted` use `--card`; `--accent-foreground` uses `--accent-fg`; `--destructive` uses `--danger`; `--input` uses `--border`. The `--diff-*` tokens are Rukie extensions exposed as `--color-diff-*` in `@theme inline`.

Code blocks and diffs highlighted by shiki use the `github-light` and `github-dark` themes, replacing beUI's high-contrast default.

### Color rules

- Use theme tokens, not raw color values. Registry interaction and hierarchy alpha values on `foreground`, `background`, and semantic state tokens are allowed; do not introduce raw alpha fills such as `text-white/60`.
- Use semantic colors (`danger`, `success`, `warning`) only for real states, together with readable text.
- Diff UI uses the `diff-*` tokens, not `success` or `destructive`.
- Keep `primary` for the main action in a region; do not fill large surfaces with it.
- Verify every component in both Light and Dark.

## Typography

### Font families

- **Sans**: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`, matching GitHub.
- **Mono**: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`. Use `font-mono` for paths, commands, code, identifiers, shortcuts, commit hashes, model IDs, and terminal-like output.

### UI font scale

All interface typography uses the `text-ui-*` scale, derived from `--ui-font-size` (default `14px`):

| Token             | Formula                | Default | Replaces      |
| ----------------- | ---------------------- | ------: | ------------- |
| `text-ui-xl`      | `--ui-font-size + 4px` |    18px | `text-lg`     |
| `text-ui-lg`      | `--ui-font-size + 2px` |    16px | `text-base`   |
| `text-ui-base`    | `--ui-font-size`       |    14px | `text-sm`     |
| `text-ui-sm`      | `--ui-font-size - 2px` |    12px | `text-xs`     |
| `text-ui-xs`      | `--ui-font-size - 4px` |    10px | `text-[10px]` |
| `text-ui-caption` | `--ui-font-size - 3px` |    11px | `text-[11px]` |
| `text-ui-control` | `--ui-font-size - 1px` |    13px | `text-[13px]` |

Line heights preserve Tailwind ratios: xl `1.75 / 1.125`, lg `1.5`, base `1.25 / 0.875`, sm `1 / 0.75`, xs and caption `1.4`, control `1.5`. Loader glyphs use `text-ui-loader`, whose `--loader-font-size` follows the registry glyph size rather than interface text.

At the default size the scale reproduces the Tailwind sizes used by shadcn and beUI, so copied components keep their look. When a registry component is added, rewrite its Tailwind `text-*` size classes with the right column.

- Do not use Tailwind's built-in `text-xs`, `text-sm`, `text-base`, `text-lg`, arbitrary sizes such as `text-[13px]`, or inline `font-size` for interface text.
- Interface font scaling changes only `--ui-font-size`; never change the root `html` font size. Icons, spacing, and radius do not scale with it.
- Code, Diff, and terminal-like content may use their own numeric font-size settings; their headers, labels, and controls still use `text-ui-*`.

### Type roles

| Token          | Roles                                                           |
| -------------- | --------------------------------------------------------------- |
| `text-ui-xl`   | Markdown `h1` and first-level reading headings                  |
| `text-ui-lg`   | Markdown `h2` and second-level reading headings                 |
| `text-ui-base` | Markdown `h3`–`h6`, body copy, buttons, and section titles      |
| `text-ui-sm`   | Secondary copy, helper text, tooltips, and Markdown inline code |
| `text-ui-xs`   | Badges, counters, shortcut labels, and very weak metadata       |

- Markdown `h3`–`h4` use `font-semibold`, `h5` uses `font-medium`, and `h6` uses `font-normal`.
- Pair secondary copy with `text-muted-foreground`. Size and color hierarchy are independent decisions.
- Do not hard-code layouts that only fit short English labels, and do not rely on truncation as the only way a label survives translation.

## Spacing and sizing

- Base spacing unit is `4px`; prefer the repeated rhythm `4px`, `8px`, `12px`, `16px`, `20px`–`24px`.
- In flex layouts with text, add `min-w-0` where truncation or shrink is required; in nested scroll or split panels, add `min-h-0`.
- `size-4` is the default icon size. Prefer fluid widths for content; fixed widths are acceptable for menus, popovers, dialogs, and side panels.
- Avoid arbitrary `w-[...]`, `h-[...]`, and spacing values unless a registry component already uses them.

## Radius, elevation, and motion

- Components keep their registry's radius scale (`--radius`), shadows, and Motion spring settings; do not invent radii, shadows, or springs.
- beUI surfaces keep their shipped `bg-card` / `bg-popover` tokens. Where a registry component uses glass utilities (`glass`, `glass-strong`, `glass-thin`), backdrop blur and neon accents resolve to the GitHub-derived `--glass-*` and `--neon` tokens in [Themes](#themes). Do not add new blur levels or accent colors.
- A shadcn component used next to beUI ones keeps its structure but takes the matching beUI surface when one exists, so overlays and panels look the same wherever they come from.
- A custom component borrows structure, surface, radius, elevation, and motion from the closest beUI component, falling back to the closest shadcn component.
- Use beUI's easing tokens (`--ease-out`, `--ease-in-out`, `--ease-drawer`) for CSS transitions.
- Respect `prefers-reduced-motion`: springs and decorative animations (`marquee`, `shimmer`) stop or reduce to an opacity change.
- Long Transcripts must stay responsive; do not animate every streamed token or every row on scroll.

## Components

- Component sourcing (existing → beUI → shadcn/ui → dedicated libraries for editors, terminals, diffs, and virtualization → custom) and the install workflow are defined in [AGENTS.md](AGENTS.md#ui-components).
- Click menus with submenus use shadcn `dropdown-menu`, because beUI context menus require right-click/long-press and bloom menus lack menu keyboard semantics. Its surface matches the beUI select panel.
- Every copied or custom component uses theme tokens, `text-ui-*` sizes, and localized copy.
- Keep a clear action hierarchy: one primary action per region; secondary, ghost, and destructive variants for the rest.
- Menus and option lists stay dense and scannable. Interactive overlays render above passive tooltips.
- Tool output, terminal-like blocks, paths, hashes, and commands use monospace.
- Markdown in messages is rendered by Rukie's micromark renderer, styled with the type roles above.

## Accessibility and internationalization

- Keyboard navigation is a first-class path; every interactive element has visible focus using `--ring`.
- Keep contrast safe in Light and Dark.
- Prefer a text label over icon-only meaning when practical; icon-only buttons have an accessible name.
- All user-visible copy, including copy inside copied registry components, goes through `@rukie/i18n` with zh and en entries.

## Responsive behavior

The product is desktop-first, but the UI remains functional in narrow windows and the browser development mode. Use breakpoints for layout, width, visibility, and density; do not change a component's meaning across breakpoints or hide core workflows.

## ANSI output palette

ANSI output preserves color meaning through `ansi-*` theme tokens. Bright variants use `ansi-bright-*`; diffs use dedicated `diff-added-fg` / `diff-removed-fg` tokens for text and counts. Values are GitHub syntax palette derivatives, owned by the theme CSS.

| Token                   | Light     | Dark      |
| ----------------------- | --------- | --------- |
| `--ansi-black`          | `#24292f` | `#484f58` |
| `--ansi-red`            | `#cf222e` | `#ff7b72` |
| `--ansi-green`          | `#116329` | `#7ee787` |
| `--ansi-yellow`         | `#4d2d00` | `#d29922` |
| `--ansi-blue`           | `#0550ae` | `#79c0ff` |
| `--ansi-magenta`        | `#8250df` | `#d2a8ff` |
| `--ansi-cyan`           | `#1b7c83` | `#a5d6ff` |
| `--ansi-white`          | `#6e7781` | `#b1bac4` |
| `--ansi-bright-black`   | `#57606a` | `#6e7681` |
| `--ansi-bright-red`     | `#a40e26` | `#ffa198` |
| `--ansi-bright-green`   | `#1a7f37` | `#aff5b4` |
| `--ansi-bright-yellow`  | `#633c01` | `#e3b341` |
| `--ansi-bright-blue`    | `#0969da` | `#a5d6ff` |
| `--ansi-bright-magenta` | `#a475f9` | `#e2c5ff` |
| `--ansi-bright-cyan`    | `#3192aa` | `#b3f0ff` |
| `--ansi-bright-white`   | `#1f2328` | `#f0f6fc` |
| `--diff-added-fg`       | `#116329` | `#aff5b4` |
| `--diff-removed-fg`     | `#82071e` | `#ffdcd7` |

## Conversation scrolling

The conversation scrollbar occupies the full right edge of the chat panel, including the input or approval dock, and maps only the Transcript viewport's scroll range. Its thumb uses the muted foreground token, a 12px hit track, and a minimum 24px thumb. Native Transcript scrollbars are hidden to avoid duplicate controls. The scrollbar supports pointer dragging, track clicks, arrow and page keys, Home and End, with visible keyboard focus. This custom mapping is needed because a standard ScrollArea track is constrained to its scroll viewport and cannot include a separate fixed input dock.

Pending permissions replace the input dock with one beUI Approval Card at a time; remaining permissions stay queued by their Interaction identity. Resolved permissions remain chronological Tool Approval entries in the Trace.
