# Rukie Design System

Design rules for the React DOM interface of the desktop app and future Web frontend. The terminal renderer does not use this file.

This file is meant for coding agents. When generating or editing GUI code, follow this file before inventing new visual rules.

## Baseline

The visual reference is the ZCode Design System: calm surfaces, compact operational controls, repeated spacing, nested radius, restrained depth, and motion that explains state changes. Rukie retains its GitHub Light/Dark palette and its Session, Run, Transcript, and Interaction behavior. ZCode's desktop design rules apply through the semantic roles and conditional feature contracts below; Zai theme choices and mobile-specific behavior are outside this adoption.

The GUI is built from [beUI](https://beui.dev) first and [shadcn/ui](https://ui.shadcn.com) for roles beUI does not provide, installed through the shadcn CLI (sourcing rules: [AGENTS.md](AGENTS.md#ui-components)). Registry components supply structure, accessibility, and behavior. This document owns their final typography, geometry, surfaces, radius, elevation, and motion. A copied component's original defaults do not establish compliance.

These are binding rules for GUI surfaces. Shared primitives define their reusable geometry and state treatment; callers choose roles and preserve content layout. A component is accepted only after its applicable rules and rendered behavior are verified. Registry provenance or a documentation check does not establish runtime conformity.

When this file and a registry default disagree, this file wins. Use the existing semantic tokens and shared primitives; when a need is not covered, update this file before introducing an exception. Copy is localized through `@rukie/i18n` with zh and en entries.

## Layout preservation

Preserve the existing page's region hierarchy, order, position, dimensions, and scroll ownership unless the user explicitly authorizes a specific layout change. A style audit, design-reference adoption, token replacement, component replacement, or request for visual consistency does not authorize rearranging the page. Updating this document does not create that authorization. When a style requirement would change layout beyond the authorized scope, retain the existing geometry and resolve the scope with the user before making that change.

Changes to layout-related DOM or CSS, shared primitive geometry, or size tokens require the following gate, even when the intended result is unchanged layout:

1. **Establish the baseline before editing.** Identify all affected regions and shared consumers, the existing layout constraints, and any explicitly authorized differences. Use existing browser assertions and rendered measurements from the pre-change implementation at the same viewport, content, and UI state. Cover the window title bar, navigation, Session sidebar, conversation, and composer or approval dock when they are affected; a shared primitive or token change includes every affected region, not only the edited component.
2. **Add missing regression coverage first.** Layout cases run in a real browser and assert rendered positions, dimensions, alignment, clipping, overflow, and scroll ownership against the baseline and this document's applicable contracts. CSS-class assertions or screenshots alone do not establish unchanged layout. Cover wide and narrow widths, sidebar open and closed, and applicable resize, text scaling, long content, disclosure, approval, and top/middle/bottom scroll states. Allow at most 1 CSS px for rounding where appropriate; fluid dimensions follow their existing relationships rather than arbitrary new fixed values.
3. **Run the affected layout cases after the change.** Reuse [shell layout cases](packages/ui/tests/app/shell.browser.test.tsx), [Transcript and scrolling cases](packages/ui/tests/app/transcript.browser.test.tsx), [approval dock cases](packages/ui/tests/components/conversation-dock.browser.test.tsx), and [composer cases](packages/ui/tests/components/compact-composer.browser.test.tsx) where applicable, adding cases for uncovered consumers. Follow the repository's [GUI verification requirements](AGENTS.md#tests-and-verification) as well; static checks, component tests without geometry assertions, and successful packaging do not replace this gate.
4. **Repair differences before delivery.** Change only the layout the user authorized and keep other regions at their baseline. Update an expected geometry value only for a documented authorized change; never rewrite expectations, remove assertions, or widen tolerances merely to hide a regression. A failing layout case blocks packaging and delivery until the implementation is repaired. Record the baseline, authorized differences, cases actually run, and measured result in delivery evidence.

## Product Character

Rukie is a desktop-first, Web-compatible coding-agent workspace. The interface feels calm, dense, and operational. Design for long sessions, readable messages and tool output, keyboard workflows, variable translations, and macOS, Windows, and Linux rendering in Light and Dark.

Use hierarchy in text, surfaces, and spacing before adding borders or color. Avoid marketing-sized controls, loose repeated rows, playful gradients, bright full-surface brand fills, default glass blur, and ambiguous separation between content and overlays. Compact means smaller repeated furniture, not clipped actions or unreadable copy.

## Themes

User-facing theme choices are System, Light, and Dark. Light uses GitHub Light and Dark uses GitHub Dark. Values are copied from the functional themes of `@primer/primitives` 11.10.0; Rukie does not depend on the package at runtime.

The theme keeps beUI's token names (shadcn semantic tokens plus beUI extensions) and the `dark` class variant, so beUI and shadcn components share the same semantic palette; geometry and interaction styling still follow this file.

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

The existing shadcn tokens keep beUI's derivations: `--card-foreground`, `--popover-foreground`, and `--secondary-foreground` use `--foreground`; `--popover`, `--secondary`, and `--muted` use `--card`; `--accent-foreground` uses `--accent-fg`; `--destructive` uses `--danger`; `--input` uses `--border`. The `--diff-*` tokens are Rukie extensions exposed as `--color-diff-*` in `@theme inline`.

The semantic role extensions below preserve those GitHub foundations while providing separately named surface, text, border, Interaction, search, and feature feedback tokens. `input-surface` names field fill; `input` keeps its shadcn border meaning. Confirmation waiting foreground is `#116329` in Light and `#7ee787` in Dark, with surfaces `#dafbe1` and `#033a16`; these are dedicated values, not aliases of success.

Code blocks and diffs highlighted by shiki use the `github-light` and `github-dark` themes, replacing beUI's high-contrast default.

### Color rules

- Use theme tokens, not raw color values. Registry interaction and hierarchy alpha values on `foreground`, `background`, and semantic state tokens are allowed; do not introduce raw alpha fills such as `text-white/60`.
- Use semantic colors (`danger`, `success`, `warning`) only for real states, together with readable text.
- Diff UI uses the `diff-*` tokens, not `success` or `destructive`.
- Keep `primary` for the main action in a region; do not fill large surfaces with it.
- Verify every component in both Light and Dark.

### Semantic roles and token mapping

Classify each surface as structure, content, interaction, or state before choosing its tokens. The mappings below retain GitHub colors while separating independently adjustable structural, content, interaction, and feedback roles. A shared color value does not make its roles interchangeable. Tokens are owned by [theme.css](packages/ui/src/theme.css), exposed as matching `--color-*` utilities; components consume the role, not an incidental shared value.

| Role                             | Token contract                                                                                     | Boundary                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Page / workspace / Transcript    | `background` with `foreground`                                                                     | Structural base; no ordinary layout shadow or brand fill                 |
| Alternate / platform workspace   | `background-alt`, `background-win-alt`                                                             | Platform shell only; child surface roles stay independent                |
| Header / sidebar / panel         | `header`, `sidebar`, `panel`                                                                       | Structure, not reusable cards or menus                                   |
| Low-emphasis content / hover     | `surface`, `surface-hover`                                                                         | Quiet content above the base                                             |
| Ordinary / selected card         | `card`, `card-selected`, `card-border`                                                             | Content below interactive overlays                                       |
| Menu / option hover              | `menu`, `menu-hover`, `popover-border`                                                             | One action-list surface with overlay shadow                              |
| Dialog / standalone popover      | `popover`, `popover-foreground`, `popover-border`                                                  | Floating interaction; radius follows category                            |
| Editable field                   | `input-surface`, `input-focused`, `input-border`, `input-border-hover`, `input-border-focused`     | Fields, not cards; `input` remains the registry border token             |
| Generic hover / selection        | `hover`, `selected`                                                                                | Transient pointer state and durable selection are separate roles         |
| Primary / supporting / weak text | `foreground`, `foreground-subtle`, `foreground-subtlest`                                           | Weak copy still meets text contrast; opacity is for decorative furniture |
| Inverse text                     | `foreground-inverse` on deliberate inverse fills; matching primary/state foreground on their fills | Never borrow a white literal for all themes                              |
| Tooltip / tag / toast            | `tooltip`, `tooltip-foreground`, `tooltip-tag`, `tooltip-tag-foreground`, `tag`, `toast`           | Hints, tags, and notifications remain distinct from menus and cards      |
| Border / hover                   | `border`, `border-hover`                                                                           | Ordinary separators and stronger hovered boundaries                      |
| Brand / link icon                | `brand`, `icon-blue`                                                                               | Sparse emphasis; file-type icons keep descriptor colors                  |
| Waiting Interaction              | `interaction-confirmation-surface`, `interaction-confirmation-foreground`                          | Dedicated green waiting treatment, separate from success                 |
| Outcome                          | `success`, `warning`, `danger` with matching foreground pairs                                      | Actual semantic state only                                               |
| Diff / ANSI output               | Dedicated `diff-*` / `ansi-*`                                                                      | Preserve technical meaning                                               |

- Ordinary separators use `border`; stronger border treatment is for hover, focus, or overlay separation. Do not add a border around every metadata row to manufacture hierarchy.
- Use `accent` deliberately for links or current execution emphasis, `primary` for main actions, and descriptor-provided colors for specialized file-type icons. A link-colored icon does not make every technical icon an accent icon.
- Keep page, card, and overlay layers identifiable. Mixing `background`, `card`, and `muted` in one view requires a structural, content, or interaction reason, rather than alternating colors for decoration.
- Glass tokens are available but do not grant ordinary workspace surfaces blur or transparency. Use opaque functional surfaces by default so text, menus, and state colors remain predictable in both themes.

### Blocking Interactions and search

Waiting badges for questions, tool permission approval, and plan-exit confirmation use one green `interaction-confirmation-surface` / `interaction-confirmation-foreground` treatment. Waiting means user input is required, not successful execution. Never substitute `success`, use completed copy, or vary badge color by Interaction type. Success remains reserved for actual approval or completion; warning remains available for genuine attention and running workflow states. This presentation does not change Interaction ownership or permission decisions. Legacy Ask-specific color tokens are not introduced.

In-page and text search marks all matches with `find-highlight`; the currently selected match uses `find-highlight-active`. Keep both roles separate from generic selection, diff additions, and warnings. The active match remains identifiable when keyboard navigation changes it, with readable foreground in both themes.

### Workflow and task feedback

These feature-scoped contracts apply whenever workflow timeline, compilation feedback, or task scheduling surfaces are implemented. They specify appearance, not a new execution model or a claim that those surfaces are shipped.

- `workflow-rule` is weaker than an ordinary border and only marks repeated timeline furniture; do not use it as a general separator.
- `workflow-trace` marks a path not yet taken; `workflow-trace-strong` marks control that has passed. A currently marching segment overlays warning-colored dashes; do not invent a third rail or arc stroke color. Reduced-motion stops marching without hiding the running state.
- Station lamps and agent status pills use success for completed execution, warning for running, and danger for execution failure. Pair status with accessible text or shape, not color alone.
- Agent avatars use one shared fixed nine-color HEX palette, assigned by instance index; a stable name hash is the fallback when an index is unavailable. Identity colors never encode status. The workflow feature owner defines and validates the nine entries in the shared theme before rendering that feature, rather than inventing per-avatar colors or reusing state colors. The reference specifies the nine-color constraint but does not supply its HEX values; this contract does not claim that palette is installed.
- Compilation feedback for a draft that did not compile, so nothing executed, uses a hollow lamp: warning while it is the latest draft, `foreground-subtlest` after a newer draft exists. Do not show danger or imply execution failure for that state.
- Idle-time queue and paused tags use `idle-task` / `idle-task-surface`; scheduled tasks use their distinct green treatment. Ordinary Queued Input remains a Session input state and does not become an idle-time task merely because it is queued.

### Adoption scope

All desktop rules described here are adopted. Roles for absent search, workflow, terminal, Side Pane, scheduling, feedback, and CUA surfaces are conditional design contracts: use them when the corresponding feature exists, and record that feature as not applicable in acceptance until then. Their presence in this document does not imply new panels, execution capabilities, or OS compositor behavior are implemented.

Rukie keeps its existing System / GitHub Light / GitHub Dark choices. Zai theme values, mobile fixed-size input compatibility tokens, and mobile remote-control drawer rules are not adopted. Narrow desktop and Web windows still follow the existing responsive and accessibility requirements.

## Typography

### Font families

- **Sans**: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`, matching GitHub.
- **Mono**: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`. Use `font-mono` for paths, commands, code, identifiers, shortcuts, commit hashes, model IDs, and terminal-like output.

### UI font scale

All interface typography uses the `text-ui-*` scale, derived from `--ui-font-size` (default `14px`). Choose by role rather than isolated visual preference. The scale is defined in [theme.css](packages/ui/src/theme.css); the role table governs all consumers.

| Token             | Target formula         | Default | Target line height | Roles                                                               |
| ----------------- | ---------------------- | ------: | -----------------: | ------------------------------------------------------------------- |
| `text-ui-xl`      | `--ui-font-size + 4px` |    18px |               28px | Markdown h1 and first-level reading headings                        |
| `text-ui-lg`      | `--ui-font-size + 2px` |    16px |               24px | Markdown h2 and second-level reading headings                       |
| `text-ui-base`    | `--ui-font-size`       |    14px |               20px | Body, common buttons, section titles, Run and Trace labels          |
| `text-ui-caption` | `--ui-font-size - 1px` |    13px |               20px | Deliberate compact supporting captions                              |
| `text-ui-sm`      | `--ui-font-size - 2px` |    12px |               16px | Secondary copy, helper text, tooltips, Markdown inline code         |
| `text-ui-xs`      | `--ui-font-size - 4px` |    10px |               14px | Badges, counters, shortcuts, very weak metadata                     |
| `text-ui-2xs`     | `--ui-font-size - 5px` |     9px |               12px | Workflow timeline axis ticks, channel codes, and unit suffixes only |
| `text-ui-control` | `--ui-font-size - 1px` |    13px |               20px | Existing compact Trace and tool controls only                       |

`text-ui-2xs` is the only permitted exception below the 10px floor. It is restricted to workflow timeline axis furniture; never use it for content, field labels, status, counters, Run/Trace metadata, or ordinary supporting copy.

Line-height ratios follow the default pairs above as interface text scales. `text-ui-control` is a Rukie-specific retained role, not an alternative default for every button or body. Legacy 13px text without a deliberate caption or compact Trace role migrates to `text-ui-base`. Loader glyphs use `text-ui-loader`, whose `--loader-font-size` describes glyph geometry, not content typography.

- Do not use Tailwind's built-in `text-xs`, `text-sm`, `text-base`, `text-lg`, arbitrary sizes such as `text-[13px]`, or inline `font-size` for interface text.
- Interface font scaling changes only `--ui-font-size`; never change the root `html` font size. Icons, spacing, and radius do not scale with it.
- Code, Diff, and terminal-like content use the independent `text-code` content token (`--code-font-size`, default 14px), which does not change with `--ui-font-size`. Their headers, labels, and controls use `text-ui-*`. This content token is not an interface hierarchy role.
- Body and common controls use `font-normal`; section labels use `font-medium`. Markdown h3–h4 use `font-semibold`, h5 uses `font-medium`, and h6 uses `font-normal`.
- Supporting copy uses `foreground-subtle` (`muted-foreground` remains its registry alias); weak copy uses `foreground-subtlest`, and primary reading text uses `foreground`. Font size and color express different hierarchy decisions. Do not weaken operational labels by combining tiny text with low opacity.
- Tooltip copy uses `text-ui-sm`; shortcut labels use `text-ui-xs`. Rich Markdown in a tooltip retains reading hierarchy.

### Markdown type scale

| Content                                                | Typography                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| User/assistant message containers, body, links, tables | `text-ui-base`, normal weight                                     |
| h1 / h2                                                | `text-ui-xl` / `text-ui-lg`                                       |
| h3–h6                                                  | `text-ui-base`, weights defined above                             |
| Inline code                                            | `font-mono text-ui-sm`                                            |
| Code block body                                        | Monospace, default 14px; independent code setting where supported |
| Code block header                                      | `text-ui-base`                                                    |
| Command, path, identifier, shortcut, commit hash       | `font-mono`; role determines `text-ui-*` size                     |

## Spacing and sizing

All dimensions in this section are CSS pixels at the 14px interface setting. Use a 4px spacing grid: 4px for tight icon/text joins; 8px for inline gaps; 12px for compact rows and inset content; 16px for panels; 20px–24px for dialog interiors. The 2px menu-row gap and documented rail/scrollbar geometry are explicit exceptions. Do not inherit arbitrary registry spacing as a new exception.

### Compact geometry targets

These names describe reusable design roles, not CSS variables already shipped. Implement them in the shared owning primitive rather than repeating overrides at call sites.

| Role                                                 |                                      Height / minimum height |     Horizontal padding | Vertical padding | Icon / gap              |
| ---------------------------------------------------- | -----------------------------------------------------------: | ---------------------: | ---------------: | ----------------------- |
| Micro action                                         |                                                         24px |                    8px |              4px | 12px / 4px              |
| Dense toolbar action                                 |                                                         28px |                    8px |              4px | 14px / 4px              |
| Standard button / single-line input / Select trigger |                                                         32px |                   12px |              4px | 16px / 8px              |
| Emphasized action                                    |                                                         36px |                   16px |              8px | 16px / 8px              |
| Icon-only action                                     | 24px, 28px, 32px, or 36px square, matching adjacent controls |                      0 |                0 | 12px, 14px, or 16px     |
| Menu / option row                                    |                                                         28px |                    8px |              4px | 16px / 8px              |
| Session / navigation row                             |                                                         32px |                   12px |              4px | 16px / 8px              |
| Run / Trace group / tool summary row                 |                                                         28px |                      0 |              4px | 16px / 8px              |
| Multiline field                                      |                                                 64px minimum |                   12px |              8px | 8px between controls    |
| Card / approval content                              |                                               Content-driven |                   16px |             12px | 12px / 8px content gaps |
| Dialog content                                       |                                               Content-driven | 24px wide, 16px narrow |             20px | 12px section gaps       |

Control heights are compact baselines at the default font size, not clipping constraints. At larger text sizes or with wrapped labels, allow height to grow to fit the line box plus padding. Keep small icon-only controls' hit targets at least 24px square; larger targets must not overlap adjacent actions. Micro actions use `text-ui-sm` for sparse auxiliary controls, never primary approval actions or normal body text. Other text actions use `text-ui-base` unless an explicit role above applies.

- Default icon: 16px. Supported icon sizes: 12px, 14px, 16px, 20px, 24px. Larger icons are for explicit empty-state or brand artwork roles.
- Reuse existing Button size names: `sm` targets 28px, `md` targets 32px, `lg` targets 36px, `icon` targets 32px square. Additional micro sizes require a shared primitive API, not isolated inline overrides.
- Menu shells use 4px padding, 2px gaps between adjacent option rows, and a 4px trigger offset. Tooltips use 8px padding and 4px offset.
- Ordinary cards have 12px content gaps; repeated Trace rows have 4px gaps, Trace groups have 8px gaps, and separate messages have 16px gaps. Do not stack a row's vertical padding with an equivalent external spacer.
- In flex layouts with text, use `min-w-0`; in nested scroll or split panels, use `min-h-0`. Technical values wrap or scroll inside their own content region, never push action buttons beyond the shell.
- Prefer fluid widths with a maximum. Standard menus target 240px maximum width, supporting menus may use 320px; ordinary dialogs target 480px maximum, settings or rich-content dialogs may use 640px. All clamp to viewport width minus 32px. A documented content need can choose a different shared role before implementation.
- Dialog shells clamp to viewport height minus 32px. Scroll the body when needed; keep title and footer actions visible. Approval details may scroll internally, but the action footer must never be inside a clipped detail region.
- Use shared `h-6`, `h-7`, `h-8`, and `h-9` height roles and matching square sizes. Ordinary business controls must not introduce arbitrary `w-[...]` / `h-[...]`, inline numeric dimensions, or a separate height system at individual call sites.
- Fluid content uses `w-full` with a shared maximum where needed. Fixed widths are reserved for stable side panels and the documented menu, popover, dialog, rail, and scrollbar roles. Specialized content renderers may use dimensions required by their library; surrounding controls still follow this specification.

## Radius, elevation, and motion

### Radius

Radius follows actual visible rounded containers, not component importance or DOM nesting. Layout regions, ordinary wrappers, Trace groups, and separators do not add a level. At the default root geometry, use the shared scale: `rounded-sm` 4px, `rounded-md` 6px, `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px. Adapt the shared radius mapping where the current theme's `--radius` derivation disagrees; do not scatter numeric radius overrides.

- First rounded content container: `rounded-xl`. Nested containers step down through `rounded-lg` → `rounded-md` → `rounded-sm`; 4px is the minimum. Peers share a radius; count the nearest visible rounded ancestor through plain wrappers.
- Buttons, Input, Textarea, and Select triggers follow the control table below. Primary emphasis and height do not increase radius.
- Dialog shells use `rounded-2xl`. Their content hierarchy restarts at `rounded-xl`; the dialog shell does not force all inner controls down a level. Only chat attachment, feedback screenshot, and CUA screenshot preview dialogs use `rounded-xl` shells; this is not a generic exception for all image dialogs.
- Menus, context menus, Select option panels, and suggestion panels use `rounded-lg`; items use `rounded-md`, nested controls `rounded-sm`. Each submenu restarts this overlay hierarchy, independently of its trigger.
- Standalone ordinary popovers start at `rounded-xl` and follow content nesting.
- The actual main composer input shell, conversation status floating panel in both collapsed and expanded states, independent Toast shell, and deliberate brand-icon backplates may retain `rounded-2xl`. Their nested controls still follow the control table. Ordinary cards and tool blocks do not qualify.
- The composer region and its context-header wrappers are layout, not radius levels. A drag overlay covering the input shell matches that shell's radius; it does not create a deeper content container. A decorative wrapper radius does not force input controls down a level.
- `rounded-full` is reserved for deliberate pills or circles: a status badge, avatar, or rail tick can qualify by shape. A button, tag, counter, or icon button does not qualify merely by component type.
- Do not use arbitrary radius values or bare `rounded`. Remove joined-edge radius only when surfaces form a continuous shape.

| Nearest rounded control parent        | Control radius |
| ------------------------------------- | -------------- |
| None, or `rounded-xl` / `rounded-2xl` | `rounded-lg`   |
| `rounded-lg`                          | `rounded-md`   |
| `rounded-md` / `rounded-sm`           | `rounded-sm`   |

### Surfaces and elevation

Layer through background contrast and borders first. The workspace uses `background`; ordinary cards use `card` with `card-border`; menus use `menu`, and dialogs/popovers use `popover`, both with `popover-border`. Their independently named roles remain separate even when the theme gives them the same value; stronger borders and elevation distinguish overlays.

| Level     | Treatment                        | Uses                                          |
| --------- | -------------------------------- | --------------------------------------------- |
| Base      | No shadow                        | Workspace, Transcript, ordinary rows          |
| Surface   | Border-led separation, no shadow | Cards, tool blocks, approval shell            |
| Overlay   | `shadow-md`                      | Menus, popovers, dialogs                      |
| Attention | `shadow-lg` only                 | Toast or explicitly justified floating notice |

Default controls and content are opaque, neutral surfaces. Existing glass/neon compatibility tokens retain their theme values but do not authorize default blur, glow, gradients, metallic controls, or decorative attention fills. Do not clear an overlay's shadow while its root owns keyboard focus. Interactive overlays render above passive tooltips.

### Motion

- Color/focus transitions: 120ms. Overlay fade or small slide: 160ms; disclosure height change: at most 200ms. Use existing `--ease-out` / `--ease-in-out` tokens. Travel is at most 4px; avoid elastic or spring overshoot in ordinary workspace controls.
- Buttons do not scale on hover or press by default. Ripple, bounce, glow, and decorative marquee are not default interaction feedback. These rules override copied registry springs and `whileHover` scaling.
- Agent Loading States and Text Shimmer may indicate an actually running Run or active outer Trace header. They stop after settlement; no animation is required to understand the text.
- Under `prefers-reduced-motion`, remove translation, scale, height animation, shimmer, marquee, and spin. Preserve state copy and static glyphs; an opacity transition may last at most 120ms.
- Do not animate every streamed token or every row on scroll. Animation must not change layout geometry needed by virtualization or scrollbar mapping.

## Components and states

Component sourcing (existing → beUI → shadcn/ui → dedicated libraries → custom) remains defined in [AGENTS.md](AGENTS.md#ui-components). Every source follows the same compact geometry, semantic palette, typography, radius, and localization rules.

### Shared state language

| State               | Required treatment                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default             | Neutral surface, readable `foreground` labels; secondary copy `muted-foreground`; no implied hover or selection                                         |
| Hover               | Only pointed target changes: `hover` background or `border-hover`; label may become `foreground`; no geometry shift                                     |
| Pressed             | Same neutral family with stronger border or `muted` surface; no permanent active state after release                                                    |
| Selected / active   | Persisted selection uses neutral contrast (`selected`) and `foreground`, plus checkmark or explicit indicator; selection is distinct from pointer hover |
| Pending approval    | Dedicated green confirmation badge with readable waiting copy; neutral shell, never completed-success copy                                              |
| Running             | `accent` state copy/glyph where needed, optional loading feedback; no success styling before completion                                                 |
| Complete / approved | `success` only for actual completion or approval, paired with text                                                                                      |
| Error / denied      | `danger` paired with error or denial copy; ordinary unselected controls never use it                                                                    |
| Disabled            | Keep geometry and label, use `muted-foreground`, no hover/press response; expose native disabled or appropriate ARIA semantics                          |
| Keyboard focus      | Visible 2px `ring`, 2px offset where applicable; preserve outline space and overlay shadow, independently of hover and status                           |

Semantic alpha backgrounds (`warning/10`, `success/10`, `danger/10`) and dedicated confirmation surfaces are allowed for state badges, not whole conversation surfaces. Opacity-only weak furniture such as rail ticks is not a substitute for readable label contrast. Disabled labels must remain distinguishable; do not dim an entire panel and its still-enabled controls together.

### Buttons and fields

Use the installed shared Button variants and sizes first; visual roles below do not imply additional APIs already exist. Keep a clear action hierarchy, usually one primary action per region, and square icon-only controls with an accessible name.

| Variant role | Resting appearance                                        | Interaction                                                                   |
| ------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Primary      | `primary` with `primary-foreground`                       | Modest theme-derived emphasis, no extra resting focus border                  |
| Outline      | Neutral or transparent surface and `border`               | Subtle neutral hover and stronger border                                      |
| Secondary    | `secondary` with matching foreground                      | Neutral surface emphasis below primary                                        |
| Ghost        | Transparent, readable foreground                          | Neutral background only on hover or press                                     |
| Destructive  | Semantic destructive fill with matching contrasting text  | Only genuinely destructive operations, not routine denial                     |
| Link         | Text-only action or semantic link, no filled button shell | Underline on hover and visible keyboard focus; navigation uses a link element |

Tool Approval retains its registry's deliberate `foreground` / inverse primary approval action; it uses the same compact sizing and radius rules. The approval button's initial appearance has no blue decorative outline or ring. Programmatic focus when the card appears must not be interpreted as keyboard navigation or force the keyboard focus treatment to appear. Preserve the card's keyboard entry point, shortcuts, focus containment where required, and restoration; when the user navigates with the keyboard, show a visible, unclipped focus indicator. Do not solve a resting-style defect by removing focus feedback for keyboard users.

Inputs use `input-surface`, `foreground`, and `input-border`. Hover uses `input-border-hover`; focus uses `input-focused` and `input-border-focused`, without glow. Select triggers follow fields while their option panels follow menus. Normal fields are not cards. Multiline content grows or scrolls in an explicit field viewport.

- Error styling represents an actual validation error, paired with explanatory copy; it does not decorate an untouched field.
- Ordinary Input and Textarea follow the basic-control radius table. A composite field shell follows content-container nesting; only the actual main composer has the approved `2xl` exception.
- Keep placeholders weaker than entered values while maintaining readable contrast. Field labels, error messages, and descriptions remain available when a placeholder disappears.

### Menus, cards, and dialogs

Menus are dense action lists, not stacks of miniature cards: compact rows, weak separators, no ordinary per-row borders. Prefer checkmarks, radio indicators, or trailing state markers to full brand fills. Preserve the same action list across dropdown and context-menu entry points. Click menus with submenus use shadcn `dropdown-menu`, because beUI context menus require right-click/long-press and bloom menus lack menu keyboard semantics.

- Dropdown, context-menu, and Select option panels share `menu` surface, `popover-border`, `rounded-lg`, 4px shell padding, and overlay shadow. The shared option stack owns the 2px gap; individual items do not each add an equivalent margin.
- Rows use the compact option role, `rounded-md`, 8px horizontal padding, 8px icon/text gaps, and `text-ui-base`. Hover uses the subtle neutral `menu-hover` fill; default items remain transparent and disabled items keep their geometry with weaker copy.
- Group related actions through ordering, labels, and weak separators. Avoid stacked sub-cards, per-item borders, or a strong selected fill for ordinary options.
- A composite primary-action / chevron trigger uses a joined segmented shell: the main action and menu reveal remain distinct keyboard targets, with shared outer shape and continuous inner edge. A plain Select trigger remains one field control, not a split action.
- Menu shadow is visible from the first open frame and remains during pointer hover and keyboard focus. Focus-reset styles must not remove the content root's overlay shadow.

Menus normally align to the trigger's leading edge; trailing controls may align to the end to open toward content. Context menus anchor near the pointer; Select option panels preserve their trigger's width relationship. Keep overlay offsets consistent and clamp against viewport edges.

The standard 4px offset may increase only to resolve a measured border collision, shadow merging, or edge crowding; record that exception in the shared overlay role. Use end alignment for trailing controls when it opens back toward the main content area. Do not move a context menu to a remote button anchor or arbitrarily change a Select panel's width while opening it.

Cards use quieter surfaces than overlays and 16px horizontal padding. Dialogs keep title, body, and action footer as distinct layout regions; long content scrolls in the body. Header icons and controls do not inherit oversized artwork styling.

Ordinary cards use `card`, matching foreground, and `card-border` separation. Low-emphasis content may share that surface without adding another border; selected cards use `card-selected`. Avoid multiple unrelated card backgrounds on one screen. Toasts use compact padding and attention elevation; they do not turn ordinary content cards into attention panels.

### Tabs and selection

- Inactive tabs remain neutral. Active tabs use stronger neutral surface/text contrast and an explicit active indicator, not brand-filled blocks.
- Selected Session rows, tabs, and selectable cards use the shared selected role. Persistent selection and current keyboard focus remain separately observable when they coexist.
- Hover affects only the pointed target; moving the pointer away restores its selected or inactive state. A hover preview must not change durable selection before activation.
- Preserve tab and list semantics, keyboard navigation, selected state, and disabled behavior. Use a text label whenever practical; an icon alone must not carry otherwise invisible meaning.

### Workspace structure

Session navigation, the conversation header, Transcript viewport, and composer or approval dock have independent content responsibilities. Their wrappers do not add radius levels. Keep structural surfaces quiet, preserve the Transcript's reading position, and allocate scroll ownership to the content region instead of making every nested wrapper independently scrollable.

The current desktop shell has one full-width 44px window title bar above navigation, Session sidebar, and conversation. Reserve the native window-control area at the left; the sidebar toggle remains beside that area and does not move with sidebar visibility. Navigation remains 48px wide and the desktop Session sidebar 256px wide. Their content begins below the title bar; sidebar scrolling must not enlarge the window shell or displace conversation controls. Preserve these region positions when applying component styles.

Independent bottom terminal and Side Pane frames follow the adopted desktop workspace contract when introduced: each owns its header or tab bar, panel background, border, 12px corner radius, and 4px frame gaps/inset. A conversation-specific toolbar belongs to its frame; the native window title bar remains shared across the full shell. Frames do not count toward inner content radius levels. These conditional rules do not authorize moving the existing window title bar, navigation, or sidebar into a different region during a styling change.

Use stable side-panel widths and fluid main content. Resize handles use a transparent 4px hit area and show a 2px `foreground-subtlest/50` indicator on hover, keyboard focus, or drag. The line runs along the panel edge, inset by the panel radius at both ends, with rounded ends and no mask. Preserve pointer and keyboard resizing, accessible names, and a visible focus state without letting the decorative line determine the hit target.

The desktop window shell uses `background-alt` on macOS; Windows, Linux, and Web use `background-win-alt`. Child panel colors are independent. Linux has a 16px outer shell radius around 12px panels and the 4px outer inset; the native compositor clip path must match that shell. Maximized Linux windows use a 0px shell and matching clip path. Native-shell and compositor rules require validation on the corresponding platform before claiming that implementation conforms.

Interactive controls inside desktop title bars explicitly opt out of dragging; floating overlays receive pointer input without becoming drag regions. Changing panel geometry must preserve reading position, bottom following, and dock visibility.

### Chat, Run, Trace, and approval

- User and assistant text uses the Markdown reading scale. Assistant messages remain separate from Trace groups; technical values use monospace.
- Run titles are compact disclosures with elapsed-state copy and a divider below the title in both expanded and collapsed states. Expanded Run details have no fixed content-height cap.
- Trace groups open collapsed by default. Closed groups have no visible left rule or leaking detail body. Tool and reasoning rows align on the same left baseline and use 28px compact row targets; expanded hierarchy may use one 16px indentation per actual disclosure level.
- During execution, only the outer group header shows the latest tool or reasoning detail, on one truncated line with Text Shimmer. Its full content remains accessible through disclosure. Once grouped tools settle, use the summary group name; inner rows do not duplicate live previews.
- Pending approval replaces the composer with one Tool Approval at a time, preserving queue order and draft state. Details start collapsed; actions sit in a separate visible footer and wrap at narrow widths. Approved cards are absent from Trace; denial remains a chronological outcome. Presentation does not alter permission decisions.
- Never force buttons, status, code, or translated labels into a one-line shell that clips them. Collapse long detail content, not the actions needed to continue a Run.

## Accessibility and internationalization

- Every interactive element has an accessible name, keyboard navigation, and visible focus. Pointer hover is supplementary, never the only route to details or actions.
- Normal text contrast is at least 4.5:1; large text and essential UI boundaries/state indicators at least 3:1. Decorative ticks are exempt from text contrast but remain perceivable. Verify Light and Dark separately.
- Localize user-facing copy through `@rukie/i18n` with zh and en entries. Never rely solely on color for status.
- Preserve complete labels through wrapping, fluid width, or accessible disclosure. Truncation alone does not solve translation expansion.

## Responsive behavior

At wide widths, preserve calm repeated geometry. At narrow widths, reflow actions and header metadata, clamp overlays, and scroll long content in its own region. Breakpoints may change layout, visibility of secondary furniture, and density within documented roles; they must not change the meaning of a component or hide a core workflow.

A 420px-wide window must support Session navigation, Run/Trace disclosure, composer, approval queue, and scrollbar/Preview Rail interaction without horizontal page overflow. Reserve the documented rail gutter independently of text wrapping. Longer translations and enlarged interface text may increase row height; they do not shrink font sizes or remove primary actions.

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

The conversation Preview Rail sits 20px from the left edge and is vertically centered in the complete conversation detail panel, including its input or approval dock. Its navigation rows are 8px apart, with equal 6px resting tick lengths and 24px maximum lengths only while hovering, focusing, or tapping a preview, preserving the registry proximity animation at a compact scale. At rest, the current Run tick uses `foreground`; during preview, only the pointed or focused tick uses `foreground`. All other ticks use `foreground` at 25% opacity in both themes. A 40px left gutter in the Transcript keeps ticks clear of message content at narrow widths. The rail remains available at narrow widths; overflowing rows scroll within the panel height while previews escape through the existing tooltip portal.

## Acceptance matrix

The specification is accepted through document review; a migrated surface is accepted through rendered checks. Passing documentation checks does not establish runtime conformity. For each changed shared primitive, inspect all affected consumers; do not declare a whole screen compliant from one button screenshot.

Audit every application screen and shared primitive by role: structure/surface, type, spacing/size, radius, state/focus, overlay/layering, motion, responsive behavior, and localization. Record each applicable rule as conforming, changed and verified, or remaining deviation with its owning component. A rule that references an absent feature is not applicable with a stated reason, rather than silently dropped or claimed as implemented. Registry source alone is not acceptance evidence.

| Dimension            | Required scenario                                                                                                           | Observable pass condition                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme / width        | Light and Dark at 1280×900 and 420×900                                                                                      | Correct semantic tokens, no horizontal page overflow; geometry and overlays remain compact and consistent                                          |
| Geometry             | Default 14px interface text; measure rendered control, padding, gaps, icon, radius                                          | Values match target role tables within 1 CSS px rounding; deviations have a documented role, not a one-off override                                |
| States               | Default, pointer hover/press, selected, pending, running, complete, error, disabled                                         | Only intended target changes; no resting hover treatment, false success state, or disabled response                                                |
| Keyboard             | Tab/Shift+Tab, Enter/Space disclosure, menu arrows/Escape, scrollbar Home/End                                               | Reachable actions, visible unclipped focus, no focus loss or tooltip over active menu controls                                                     |
| Approval focus       | Card opens through pointer interaction; then keyboard navigation enters actions                                             | Resting default approval has no forced blue ring; keyboard-focused action shows its visible indicator and retains shortcuts/restoration            |
| Locale               | zh and en, plus a fixture with labels twice the normal English length                                                       | Primary labels and actions remain readable and actionable; wrapping does not overlap icons, status, or adjacent controls                           |
| Font scaling         | `--ui-font-size` 14px and 18px                                                                                              | Only text scale changes; row height grows as needed, icons/spacing/radii stay stable, action labels and focus rings remain fully visible           |
| Long content         | Long path/command, multiline Markdown/table/code, expanded Trace, sequential approvals                                      | Details wrap or scroll internally; action footer is visible; collapsed bodies contain no visible or focusable leaked content                       |
| Conversation mapping | Rail rest/hover/focus; transcript at top/middle/bottom; resize with approval dock                                           | Rail positions and unique preview color match its contract; right scrollbar maps to actual scroll range and reaches track bottom at content bottom |
| Motion / stability   | Streaming, completion, reduced-motion, resize and opening overlays                                                          | Loading ends on settlement; reduced-motion is static; no layout jumps, ResizeObserver errors, clipped transitions, or animated per-token geometry  |
| Conditional features | Search matches; workflow path and compile states; identity palette; idle/scheduled tags; optional panels and platform shell | Applicable feature uses its dedicated role; absent feature is recorded as not applicable, not implemented or omitted from the contract             |
| Panel resizing       | When implemented: pointer and keyboard resize; hover/focus/drag; platform maximize/restore                                  | 4px hit target, 2px indicator with radius inset; frame gaps/inset and shell/compositor clip remain synchronized                                    |
| Layering / contrast  | Open menu with tooltip; focus overlay; inspect text and essential controls                                                  | Interactive surface remains above tooltip, shadow survives focus, contrast meets stated ratios in each theme                                       |

Use isolated settings and fake model data for GUI browser checks, following [AGENTS.md](AGENTS.md#tests-and-verification). Capture Light, Dark, and narrow screenshots and record measured geometry, interactions, console/network errors, and remaining differences. Documentation-only edits do not require a runtime build, browser claim, or product test run.

## Model services settings

Pencil C03 and C10–C17 own the settings region geometry. At 1887 × 1210, keep the 52px app navigation and 44px title bar, put the 268px settings navigation at x52, and center the 880px workspace in the remaining content region with its top at 100px. Its title uses `text-ui-xl`, description and controls use `text-ui-base`; description begins 48px below the title, the 28px toolbar begins 44px below it, and the 560px provider panel begins 88px below it. The provider rail is 224px and details are 656px with 16px padding. Provider inputs are 30px high, field groups repeat every 64px, and model rows are 36px high in one bordered list. The model list label begins 6px below its 28px Add model action; the list begins 276px below the provider details origin. Only configured custom providers appear in the rail; provider creation has one custom entry and no preset suppliers.

Model dialogs use a 672px maximum width and 704px height, a separate 82px title region, 20px form padding, a fixed 60px footer, and a scrolling form. Basic information, reasoning and multimodal capabilities remain outside the advanced section, which defaults to collapsed. Two-column fields reflow at narrow widths; fields use 36px controls and 60px groups, and capability options use compact 28px chips with 16px marks. Unsupported catalog fields stay disabled with an availability explanation rather than pretending to persist. Settings scrolling uses shadcn ScrollArea with the Pencil A13 overlay: a transparent 8px track, centered 4px rounded thumb, minimum 24px length, and foreground at 30% opacity. Native scrollbars are hidden; only overflowing regions show the custom thumb. The delete confirmation uses 448px maximum width and 36px actions (112px cancel, 128px destructive action with #ff5c5c fill). API options overlay the field with 28px rows, 6px horizontal item padding, 16px checkmarks, and 2px gaps (P04/C14: 624 × 96px panel; its 4px item inset includes the 1px border); provider action menus are 136px wide with 44px rows. The settings navigation shows the reference category hierarchy; unavailable destinations are disabled and explain availability. Narrow windows collapse the settings rail and stack the provider rail without horizontal overflow. The settings frame keeps the reference 4px right/bottom inset and 12px corners. These roles apply only to settings, preserving the chat shell geometry. The user requested strict Pencil restoration: this settings region and its dialogs have scoped Pencil tokens, leaving the chat GitHub palette unchanged. Dark settings background is #161616, navigation #161616, panel/input/popover #2b2b2b, foreground #d4d4d4, subtle foreground #d4d4d499, border #ffffff1a, secondary controls #ffffff1a, primary controls white with #161616 foreground. Light settings use background #f8f8f8, navigation #f0f0f0, white panel/input/popover, foreground #262626, subtle foreground #26262699, border #0d0d0d1a, secondary controls #0d0d0d0d, and black primary controls with white text. Model ID placeholders use the foreground role. Settings use the self-hosted Noto Sans SC variable font with system fallback and semantic text-ui sizes at the Pencil 1.5 line-height; model IDs use the scoped self-hosted JetBrains Mono variable font.

The beUI Switch uses the compact 36 × 20px role with a 16px thumb; the model services provider row uses the 32 × 18px variant with a 14px thumb. The multiline parameter mapping uses the shadcn Textarea adapted to the same input surface, border, radius and focus tokens as Input.
