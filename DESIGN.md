# Rukie Design System

This is the authoritative design specification for Rukie's React DOM desktop and Web interfaces. It governs components, page composition, themes and interaction states. The terminal renderer has its own design system and does not consume these rules.

The visual foundation comes from the inspected Chengxiaobang 1.9.2 interface: neutral surfaces, monochrome primary actions, compact controls, restrained elevation and clear reading hierarchy. Rukie adopts those reusable rules while retaining its own identity, accessible color pairs, established workspace geometry and Agent Core semantics. The source application's mascot, personal configuration, business data and product-specific permission colors are not Rukie defaults.

This is a normative specification, not a statement that every installed component already conforms. [theme.css](packages/ui/src/theme.css) owns the implemented tokens; installed component source owns its props and behavior. A document change does not migrate those implementations or authorize a page redesign. Record and verify each actual migration separately.

## Authority and implementation boundaries

Use the following order when a source, registry preview or mockup disagrees:

1. Explicit user instructions define the authorized change and its limits.
2. This document defines shared visual and interaction rules, including named Rukie exceptions.
3. Existing page geometry and scoped `rukie.pen` feature layouts remain protected by [Layout preservation](#layout-preservation). A shared design change does not authorize moving those layouts.
4. Installed repository components supply the implementation. Registry examples are candidates, not a competing design system.

Source observations and Rukie adaptations have different meanings. The reference palette and control measurements below describe observed visual rules. Accessibility corrections, font preferences, 12px glyphs, static control feedback, shell geometry and specialized feature dimensions are explicit Rukie adaptations. Do not present an adaptation as an exact source measurement or claim whole-product pixel parity from a few matched containers.

Design changes belong here before implementation; dependency choices and exact installed versions belong in [the technology stack](docs/tech-stack.md). Domain behavior belongs in [CONTEXT.md](CONTEXT.md) and the owning package documentation. Changing presentation must not change Session, Run, Transcript, Interaction, permission or persistence semantics.

## Product character

Design for a desktop coding workspace used for long reading and execution sessions. Prefer readable text, compact repeated furniture, keyboard access and stable scroll positions. Establish hierarchy through typography, spacing and neutral surfaces before adding borders or color.

Keep the interface quiet: no decorative gradients, default glass blur, glowing controls, marketing-sized buttons, per-row cards or ornamental animation. Product illustrations and brand assets require their own approved source; do not introduce the reference application's branding. A missing feature does not acquire a placeholder control merely because a registry example includes it.

## Component sourcing

The source order is existing repository component → beUI → shadcn/ui fallback → specialized library → custom composition. The engineering requirements are owned by [AGENTS.md](AGENTS.md#ui-components); this section specifies how those choices fit one visual system.

| Role                                            | Source and use                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing working role                           | Reuse its repository implementation and variants. Do not reinstall or replace it for stylistic preference.                                                                                                             |
| Basic controls and overlays                     | Prefer beUI Button, Input, Select, Checkbox, Radio, Switch, Tooltip, Popover and modal primitives when they cover the behavior.                                                                                        |
| AI and Agent surfaces                           | Prefer beUI Message, Message Bubble, Prompt Input, Agent Activity, Streaming Response, Tool Result, Tool Approval, Approval Card, Todo List and Citations as applicable. Compose existing repository adapters first.   |
| Missing behavior                                | Discover shadcn/ui candidates only after checking beUI's actual capability. Preserve the installed dropdown-menu and ScrollArea roles; a marketing category or similar appearance is not proof of equivalent behavior. |
| Code, terminal, diff and virtualization engines | Use the maintained specialized dependencies selected in the technology stack. A beUI presentation wrapper may compose them; it does not replace their parsing, rendering or virtualization engines.                    |
| New product-specific composition                | Compose installed primitives only when no existing component or suitable library covers the need. Explain the gap and ownership.                                                                                       |

Discover current beUI install names through its MCP or live registry using the repository [beUI skill](.agents/skills/beui/SKILL.md). Use the [shadcn skill](.agents/skills/shadcn/SKILL.md) for its registry and CLI. Documentation page names, export names and install slugs can differ; inspect the actual item before installing. Available roles change, so do not assume that tables, navigation or forms are categorically absent from beUI.

Registry files are copied repository source, not an opaque `beui` runtime dependency. Before accepting an installation:

- Inspect added files, helper imports and dependencies; preserve existing local modifications and aliases. Follow the registry configuration in [components.json](packages/ui/components.json).
- Adapt the complete component at its shared owner: semantic colors, `text-ui-*` typography, dimensions, radius, motion, focus and cursor behavior. Map hardcoded state colors and English strings too; a theme-variable change alone is insufficient.
- Reuse the installed primitive for each role. A shadcn composite that needs Button or Dialog imports the repository's existing beUI role rather than installing a second implementation.
- Expose reusable variants instead of page-specific CSS overrides. Pages choose a variant and arrange content; they do not restyle a primitive's private elements.
- Localize visible copy and accessible names through `@rukie/i18n` in zh and en. Pin new dependencies exactly and update the technology stack and lockfile in the same change.
- Treat streaming, approval, cancellation, error and completion as controlled product state. Do not copy demo timers, fake progress, invented tool results or automatic permission approval into the application.
- Validate props, accessible names, keyboard behavior and focus against the installed source. Registry provenance and an attractive preview do not establish acceptance.

Agent-generated pages import the approved repository components. They must not fetch a fresh registry component or introduce a new component library for each page. New shared variants and tokens are added once, documented and verified with their affected consumers.

## Themes and semantic colors

Offer System, Light and Dark. The `.dark` variant and the System preference must resolve to the same semantic roles. Keep reference values, accessible operating values and structural shell values distinguishable.

### Reference palette

These values are the reusable source baseline. They are CSS colors, not a new library's default preset.

| Visual role                | Light     | Dark      |
| -------------------------- | --------- | --------- |
| Canvas                     | `#ffffff` | `#212121` |
| Primary reading text       | `#171717` | `#fafafa` |
| Body copy                  | `#4d4d4d` | `#d1d1d1` |
| Soft canvas                | `#fafafa` | `#1a1a1a` |
| Muted surface              | `#f5f5f5` | `#2f2f2f` |
| Popover                    | `#ffffff` | `#2f2f2f` |
| Quiet border               | `#ebebeb` | `#3a3a3a` |
| Primary action             | `#171717` | `#fafafa` |
| Primary action text        | `#ffffff` | `#0a0a0a` |
| Brand / sampled focus blue | `#339cff` | `#339cff` |
| Sampled weak text          | `#888888` | `#888888` |
| Sampled error              | `#ee0000` | `#ff4d4f` |

### Rukie token contract

Map semantic roles at the theme owner; do not copy raw palette colors into pages. The existing implementation can lag these design targets. In particular, adopting the canvas target must not overwrite the independent `layout-*` shell contract or scoped feature surfaces.

| Token or role                                                                                      | Contract                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`, `foreground`                                                                         | Canvas and primary reading text from the reference palette; structural and named feature surfaces follow the explicit surface-ownership table.                                                                   |
| `card`, `card-foreground`                                                                          | Neutral content surface and readable foreground; no automatic card border around every content group.                                                                                                            |
| `popover`, `popover-foreground`, `menu`                                                            | Overlay surfaces; the menu and popover roles remain separately named even when their colors match.                                                                                                               |
| `primary`, `primary-foreground`                                                                    | Monochrome inverse action pair. Do not alias primary to brand or execution blue.                                                                                                                                 |
| `secondary`, `secondary-foreground`, `surface`, `surface-hover`, `selected`, `hover`, `menu-hover` | Separate neutral interaction and selection roles, with readable text on the actual surface.                                                                                                                      |
| `muted-foreground`, `foreground-subtle`                                                            | Readable supporting text. Retain the installed accessible pair `#666666` / `#aaaaaa` until a replacement pair is measured.                                                                                       |
| `foreground-subtlest`                                                                              | Weak text and placeholders, currently `#6b6b6b` / `#a8a8a8`; never use the source's weak-text swatch unchanged where it fails contrast.                                                                          |
| `border`, `card-border`, `popover-border`                                                          | Quiet visual separation; these do not establish the boundary of an editable control on their own.                                                                                                                |
| `input-surface`, `input-focused`                                                                   | Field fills, independent of `input` and `input-border`, which describe control boundaries.                                                                                                                       |
| `input-border`, `input-border-hover`                                                               | Maintain a perceivable boundary; installed accessible values are `#808080` / `#888888` and hover `#6b6b6b` / `#aaaaaa`.                                                                                          |
| `ring`, `input-border-focused`                                                                     | A visible 2px keyboard indicator without a geometry shift. The installed opaque neutral ring remains an approved Rukie adaptation; a blue replacement must meet contrast on its actual surfaces before adoption. |
| `accent`, `accent-fg`, brand and link roles                                                        | Sparse link/execution emphasis. Keep the installed accessible link pair; sampled brand blue does not automatically qualify as normal-size text.                                                                  |
| `danger`, `destructive`, `destructive-foreground`                                                  | Actual errors and destructive actions; preserve separate text and filled-control roles and verified foreground pairs.                                                                                            |
| `success`, `warning`                                                                               | Actual completion and attention states. Keep Rukie's accessible state pairs; the source's blue `success` alias is not adopted as completed-success semantics.                                                    |
| `interaction-confirmation-surface`, `interaction-confirmation-foreground`                          | Dedicated waiting-for-input treatment, independent of completed success.                                                                                                                                         |
| `diff-*`, `ansi-*`, `find-highlight`, `find-highlight-active`                                      | Technical output and search roles, independent of brand and generic status.                                                                                                                                      |

The shared neutral target resolves as follows. Structural shell colors remain independent; named feature surfaces consume the roles in [Surface ownership](#surface-ownership).

| Shared token                                                                  | Light                 | Dark                  |
| ----------------------------------------------------------------------------- | --------------------- | --------------------- |
| `background`, `card`, `input-surface`, `input-focused`                        | `#ffffff`             | `#212121`             |
| `foreground`, `card-foreground`, `popover-foreground`, `secondary-foreground` | `#171717`             | `#fafafa`             |
| `popover`, `menu`                                                             | `#ffffff`             | `#2f2f2f`             |
| `secondary`                                                                   | `#ffffff`             | `#282828`             |
| `muted`                                                                       | `#f5f5f5`             | `#2f2f2f`             |
| `surface`                                                                     | `#f5f5f5`             | `#282828`             |
| `surface-hover`, `hover`                                                      | `#ececec`             | `#343434`             |
| `selected`, `menu-hover`                                                      | `#f1f1f1`             | `#3a3a3a`             |
| `border`, `card-border`, `popover-border`                                     | `#ebebeb`             | `#3a3a3a`             |
| `primary`, `primary-foreground`                                               | `#171717` / `#ffffff` | `#fafafa` / `#0a0a0a` |

Dark `accent` is `#70b0ff` and Dark `danger` is `#ff7a7a`: these accessible adaptations meet 4.5:1 even on the shared `selected` background. The destructive menu action uses Dark `destructive-soft-foreground` `#ff9595` over its translucent `destructive-soft` highlight on popover; this preserves 4.5:1 during hover and keyboard focus. Light retains `accent` `#0969da` and `danger` `#d1242f`.

The base colors and source surface-hover are sampled values; the shared hover/selection aliases above are Rukie mappings for reusable roles, not recovered original component APIs. Hover is transient and selection is durable even when values coincide. A joined role listing in this table shares a value, not ownership or semantics.

The source's weak text, placeholders and some warning pairs do not satisfy Rukie's contrast requirements. Preserve those observations as reference evidence, not as exemptions. Existing accessible corrections remain at the shared owner; future changes must measure the rendered pairs in both themes. Never lower contrast to obtain visual similarity or silently claim that the source palette was already AA-compliant.

Code and diff surfaces retain the installed GitHub Light/Dark Shiki themes. Keep addition/removal lines, word highlights and their text/count colors separate. ANSI output preserves the installed normal and bright `ansi-*` meanings. Do not recolor technical output to match neutral control styling. Charts, identity colors and file-type colors retain separately named roles and never imply permission or execution state.

### Settings surface roles

Settings consume named `settings-*` roles defined only in `theme.css`; page and portal roots do not redefine shared tokens. These roles are independent of `layout-*`, including when settings occupies the same workspace frame. Preserve the settings geometry specified in [Model services settings](#model-services-settings).

| Settings token        | Palette/shared role     | Light     | Dark      |
| --------------------- | ----------------------- | --------- | --------- |
| `settings-canvas`     | Soft canvas             | `#fafafa` | `#1a1a1a` |
| `settings-navigation` | Canvas / `background`   | `#ffffff` | `#212121` |
| `settings-card`       | Canvas / `card`         | `#ffffff` | `#212121` |
| `settings-popover`    | Popover / `popover`     | `#ffffff` | `#2f2f2f` |
| `settings-menu`       | Popover / `menu`        | `#ffffff` | `#2f2f2f` |
| `settings-surface`    | Muted surface / `muted` | `#f5f5f5` | `#2f2f2f` |
| `settings-border`     | Quiet border / `border` | `#ebebeb` | `#3a3a3a` |

Settings navigation includes the settings category column and provider rail. Form cards use `settings-card`; nested grouped content uses `settings-surface`. Portalled settings Dialogs and menus use their named settings overlay roles. Text, field fills/boundaries, hover, selection, focus, danger and disabled states use their shared semantic roles directly; no settings-specific foreground or status palette is introduced.

## Typography

### Font families

Use shared font tokens, with locally available fonts and platform fallback. Do not bundle or fetch a font during a component adaptation unless separately authorized.

- Sans: `"Noto Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. This is Rukie's retained font preference for ordinary UI.
- Mono: `"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`. Use it for code, commands, paths, identifiers, hashes and model IDs where the role calls for it.
- Source home display: `"Songti SC", STSong, "Noto Serif CJK SC", ui-serif, serif`. This is an optional home-greeting role from the source, not a replacement for ordinary UI text or authorization to redesign Rukie's home page.

### Type roles

Use `text-ui-*` for interface text. `--ui-font-size` defaults to 14px and owns user interface scaling; do not change the root `html` font size. The table defines target roles, not a claim that new utility names already exist.

| Role              | Default size / line height | Use                                                                      |
| ----------------- | -------------------------- | ------------------------------------------------------------------------ |
| Home display      | 32px / 40px                | Approved home greeting only.                                             |
| Page title        | 24px / 32px                | New standalone page titles; preserve established feature title geometry. |
| Section heading   | 20px / 28px                | Larger content sections where required.                                  |
| `text-ui-xl`      | 18px / 28px                | Markdown h1 and established reading headings.                            |
| `text-ui-lg`      | 16px / 24px                | Markdown h2 and Interaction titles.                                      |
| `text-ui-base`    | 14px / 20px                | Body, ordinary buttons, navigation and Run/Trace labels.                 |
| `text-ui-caption` | 13px / 18px                | Compact secondary text and compact menu labels.                          |
| `text-ui-sm`      | 12px / 16px                | Field hints, tooltips, compact button labels and metadata.               |
| `text-ui-xs`      | 10px / 14px                | Restricted counters and secondary furniture; not ordinary labels.        |
| `text-ui-2xs`     | 9px / 12px                 | Existing workflow timeline axis ticks and unit suffixes only.            |
| `text-ui-control` | 13px / 20px                | Retained compact Trace/tool controls only.                               |

Relative to `--ui-font-size`, xl is +4px, lg +2px, base unchanged, caption/control −1px, sm −2px, xs −4px and 2xs −5px. New page/home display roles require a named shared typography role rather than arbitrary per-page font sizes. Caption uses the table’s 18px line height at the default scale; remove the legacy 1.5 line-height override during migration. Independently documented feature typography remains scoped to its named role.

Use normal weight for body and most labels, medium for action/section emphasis and semibold for reading headings where required. Define size, line height, weight and tracking together. Preserve platform-specific CJK rendering and wrapping; do not transplant a sampled negative tracking value to every locale.

Markdown body, tables and links use the base reading scale; inline code uses mono with the small interface role. Code blocks, diffs and terminal-like output use the independent `text-code` setting, default 14px in Rukie. The reference's 13px/20px base code style does not reset this user preference. Their headers and controls still use interface roles.

Do not use Tailwind's generic `text-xs`/`text-sm` or arbitrary `text-[…]` for operational interface text. Scaling to 18px interface text must preserve labels, focus indicators and primary actions; allow content-driven height instead of clipping or reducing the user's font size.

## Spacing and dimensions

Document spacing in **px**. Treat every number below as CSS pixels, independent of device pixel ratio. The source uses rem for some declarations; their reference conversion is 1rem = 16px. This is provenance, not a reason to display rem in the design catalogue or change the root font size.

The reusable spacing scale is 0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80 and 96px. Prefer 4px multiples for major rhythm; 2px, 6px, 10px and 14px support compact joins and existing feature geometry. Use named shared roles instead of promoting every measured width into a token.

| Relationship                  | Typical spacing                                |
| ----------------------------- | ---------------------------------------------- |
| Tight icon/text join          | 4–6px                                          |
| Inline controls               | 8px                                            |
| Compact group / field content | 12px                                           |
| Panel and form sections       | 16px                                           |
| Dialog interior               | 24px; 16px horizontal in narrow windows        |
| Overlay trigger gap           | 4px, unless a documented role states otherwise |

### Shared control targets

These are the shared targets for components and their consumers. The [design-system migration](.scratch/design-system-migration/spec.md#decisions) explicitly authorizes replacing legacy generic control geometry with these targets, including 32px fields, menu shells/rows and Dialog padding. Independently named feature roles below retain their specified sizes. Each implementation ticket records its authorized differences and verifies its affected consumers under the layout-preservation gate.

| Role                       | Height / shape          | Insets and type                                                                   |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| Standard text Button       | 36px minimum            | 16px horizontal; 14px/20px label.                                                 |
| Compact text Button        | 32px minimum            | 12px horizontal; 12px/16px label.                                                 |
| Small contextual Button    | 28px minimum            | 8px horizontal; MD/8px corners; explicit toolbar/context variant.                 |
| Auxiliary micro action     | 24px minimum            | SM/6px corners; sparse auxiliary roles only; not a normal approval action.        |
| Icon-only action           | 24px square             | 12px glyph; 6px corners, retained Rukie role.                                     |
| Input                      | 36px minimum            | 4px vertical / 12px horizontal; 12px/16px text.                                   |
| Select trigger             | 36px minimum            | 8px vertical / 12px horizontal; allow line-box growth.                            |
| Textarea                   | Content-driven          | 8px vertical / 12px horizontal; declare growth limit and scroll owner.            |
| Switch                     | 36px × 20px             | 2px inset, 16px thumb; existing provider variant 32px × 18px with 14px thumb.     |
| Checkbox / Radio           | 16px visible mark       | Existing Rukie mark; activating control/label meets the 24px interaction minimum. |
| Standard menu / Select row | 32px minimum            | MD/8px corners; 14px/20px; 8px horizontal inset and icon/text gap.                |
| Compact Session menu row   | 26px minimum            | MD/8px corners; 13px/18px; explicit Session variant.                              |
| Navigation row             | 32px minimum            | Preserve existing navigation insets and trailing actions.                         |
| Trace summary row          | 28px minimum            | Preserve existing disclosure hierarchy and baseline.                              |
| Small rename Dialog        | 384px reference maximum | 24px padding, 16px section gaps, 18px/18px medium title; height follows content.  |
| Ordinary Dialog            | 480px maximum           | 24px interior; rich or scoped dialogs can use a separately documented maximum.    |

Keep installed Button size names `sm`/`md`/`lg` at 28px/32px/36px. Expose explicit semantic variants `standard` (36px), `compact` (32px), `contextual` (28px), `micro` (24px) and `icon` (24px square); each product call site selects its role. Generic Input and Select triggers use the 36px target; Session menus use the explicit 26px variant. Named 32px Project/settings fields remain scoped exceptions. These migrations are authorized by the linked spec and require the recorded regression evidence.

Ordinary menus use 4px shell padding and viewport-bounded internal scrolling. Keep existing 2px row gaps for installed Rukie menu roles. Tooltip uses the MD/8px radius role, 8px insets and a 4px anchor gap. Dialogs and popovers clamp to viewport width and height minus 32px; title and footer remain visible while the body scrolls. Never turn a sample dialog's observed height into a global fixed height.

Use `min-w-0` for text in flex layouts and `min-h-0` for nested scrolling panels. Prefer fluid widths plus a shared maximum. Long paths, code, translated labels and pending status must wrap or scroll within their owner instead of displacing actions.

## Radius, depth and layers

Use named radius roles with px values. Source design names and Tailwind class names are not interchangeable.

| Design role   | Radius          | Existing Tailwind mapping                             |
| ------------- | --------------- | ----------------------------------------------------- |
| XS            | 4px             | `rounded-sm`                                          |
| SM            | 6px             | `rounded-md`                                          |
| MD            | 8px             | `rounded-lg`                                          |
| LG            | 12px            | `rounded-xl`                                          |
| XL            | 16px            | `rounded-2xl`                                         |
| Pill / circle | Shape-dependent | `rounded-full`, only for a deliberate pill or circle. |

Standard and compact text Buttons, generic fields, menu/Select shells and ordinary popovers use LG/12px; Dialogs use XL/16px. Contextual Buttons, standard menu/Select rows, compact Session menu rows and Tooltip use MD/8px. Auxiliary micro actions and icon-only actions use SM/6px. These named roles replace legacy generic 8px basic controls, 6px small text controls and 8px menu shells during the authorized migration. Independently named feature geometry remains as specified below. Do not globally redefine Tailwind's radius mapping or use bare `rounded` to approximate a target.

Count visible rounded containers, not plain DOM wrappers. A nested content surface steps down one role; peers share a radius. Standard, compact Session and Select rows therefore use MD/8px inside LG/12px menu shells. Preserve a control's documented role inside composites rather than applying automatic radius subtraction to every descendant. A dialog shell does not force all inner content into smaller controls. Decorative wrappers must not change actual composer or approval geometry.

Use restrained functional depth. `theme.css` owns the following shared elevation roles. Light retains the source reference recipes; Dark is an explicit Rukie adaptation. Consume the named role instead of copying the recipe into a page, and verify both themes on their actual surfaces during implementation.

| Elevation token     | Light                                                                                          | Dark                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--shadow-overlay`  | `0 1px 2px rgb(0 0 0 / 3%), 0 4px 10px -2px rgb(0 0 0 / 4%), 0 10px 24px -8px rgb(0 0 0 / 6%)` | `0 1px 2px rgb(0 0 0 / 20%), 0 4px 10px -2px rgb(0 0 0 / 28%), 0 10px 24px -8px rgb(0 0 0 / 40%)` |
| `--shadow-composer` | `0 3px 16px rgb(0 0 0 / 8%)`                                                                   | `0 3px 16px rgb(0 0 0 / 32%)`                                                                     |

Menus, Select panels, popovers, Tooltip and Dialogs consume `--shadow-overlay`; the composer consumes `--shadow-composer`. These roles replace legacy generic overlay/composer shadows. The separately specified workspace perimeter shadows remain structural roles and do not inherit either recipe.

Ordinary rows and technical groups have no shadow. Cards use border-led separation. Menus, popovers and dialogs use shared overlay elevation; Toast may use the attention role. Do not remove an overlay's shadow on focus or stack independent card shadows around every tool result. Keep source/platform hairlines distinct: ordinary control borders are 1px; .5px is allowed only for a named high-DPI structural role.

Layer ownership is structural content → passive hint → modal → interactive menu. A modal-owned hint can sit above its modal while remaining below interactive menus. Preserve the installed layer tokens; do not scatter arbitrary z-index values or let sidebar scroll clipping cut off a portalled overlay.

## Iconography

Use **Lucide through `lucide-react`** for generic navigation, actions, status, tools, files and empty-state glyphs. Use named imports from the installed dependency and `currentColor`; do not introduce another generic icon family, emoji glyphs or hand-drawn substitutes for an available Lucide role.

Rukie retains one glyph size: 12px, including generic, status, menu and provider marks. Slots and hit targets are separate dimensions; a 16px slot, 24px button or 40px catalogue tile still centers a 12px glyph. Use Lucide's consistent 2px stroke unless a verified specialized mark has its own source treatment. Never resize a container to accommodate a library default icon size.

Brand marks are the explicit exception: ProviderIcon uses the existing `@lobehub/icons` Mono or Color asset for the catalog's explicit icon key. Unknown providers use the existing generic Box fallback, not a guessed logo based on name. Product branding and illustrations remain separate approved assets. Preserve their paths/fills and accessibility; the generic Lucide rule does not turn a brand into a replacement line icon.

An icon beside a text label is decorative. An icon-only action has a localized accessible name and visible keyboard focus. Color alone never conveys status; do not place meaningful text inside an inaccessible SVG.

## State and interaction language

| State               | Required presentation                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default             | Neutral surface, readable label, no implied hover or selection.                                                                                                   |
| Hover               | Only the pointed target changes; neutral fill or stronger boundary, no geometry shift.                                                                            |
| Pressed             | No added visual treatment. Preserve the pre-press hover or keyboard-focus appearance.                                                                             |
| Selected            | Persistent neutral emphasis plus a check, indicator or current semantics where applicable; distinct from hover and focus.                                         |
| Waiting Interaction | Dedicated waiting badge and request copy; never report completion.                                                                                                |
| Running             | Actual in-progress feedback, with appropriate execution emphasis.                                                                                                 |
| Complete / approved | Success only after the authoritative state settles successfully.                                                                                                  |
| Error / denied      | Readable error/denial copy and the appropriate state role.                                                                                                        |
| Disabled            | Preserve geometry, block pointer and keyboard activation, no hover or press response. Default shared opacity is 50%; documented feature exceptions remain scoped. |
| Keyboard focus      | Visible 2px indicator, unclipped and independent of hover, selection and status.                                                                                  |

Validation errors describe the problem and recovery, remain associated with their field and do not decorate untouched inputs. Loading disables only the actions that must not repeat; unrelated controls remain available. Include empty, no-results, unavailable, cancelled and failed states where the feature needs them.

### Web PC interaction

Shared interactive roots own cursor and interaction styling; nested icons and labels inherit it. Apply this to every GUI screen and every portalled overlay.

| Target                                                                             | Cursor and behavior                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Enabled action, link, tab, option, trigger, activating checkbox/radio/switch label | `pointer`; correct semantic control and keyboard activation.                       |
| Editable field or editor                                                           | `text`; embedded actions retain their separate action role.                        |
| Disabled action                                                                    | `not-allowed`; native disabled or ARIA semantics plus actual blocked activation.   |
| Read-only/passive content                                                          | Appropriate text/default cursor; preserve selection and do not imply clickability. |
| Resize handle                                                                      | `col-resize` / `row-resize`; retain accessible keyboard resizing.                  |
| Implemented drag handle                                                            | `grab` / `grabbing`; do not advertise dragging on passive content.                 |

Hover is limited to hover-capable pointers and updates immediately. Enter/Space, menu arrows, Escape, focus containment and restoration follow the owning primitive. A clickable generic container does not supply keyboard semantics. Avoid blanket pointer, selection or SVG overrides; a disabled wrapper owns the hit-area cursor when its child uses `pointer-events: none`.

In rows with nested icon-only actions, the row's hover fill gives way to the pointed action's fill while that action is hovered. Revealed trailing controls remain present on row hover or focus within without shifting content. Preserve durable selection independently; use the existing shared row-hover behavior.

Do not display shortcut hints, keycaps or key-combination suffixes anywhere in the GUI. Preserve actual bindings, accessible names and keyboard behavior. A Shortcuts settings destination is a category label, not a shortcut hint.

## Motion

beUI provides reusable motion capabilities; its default springs and effects are not authorization to use them. Rukie's static control and menu rules take precedence.

- Menus, submenus, Select panels, action popovers and Project hover details appear and disappear immediately at final geometry, without an animated exit. Preserve hover-intent timing and pointer corridors separately.
- Pointer/keyboard activation adds no scaling, ripple, bounce, spring, animated checkmark, travelling radio dot or sliding switch thumb. Hover, focus, selection and disabled changes are static and immediate.
- Independently specified non-menu dialog/search entrances may retain existing opacity/small-scale motion, normally 160ms. Content disclosures may use at most 200ms and 4px travel where already authorized.
- Running feedback can use Agent Loading States or Text Shimmer only while the underlying Run or active Trace is actually running. Stop it on completion, failure or cancellation.
- Do not animate each streamed token, every newly mounted row or layout properties used by virtualization. Preserve reading position and stable measurements.
- Under `prefers-reduced-motion`, remove movement, height animation, shimmer and spin; retain meaningful static text/glyphs. Any independently allowed non-menu opacity transition is at most 120ms. Search's scoped reduced-motion rule is fully immediate.

## Layout preservation

Preserve region hierarchy, order, position, dimensions and scroll ownership unless the user explicitly authorizes that specific layout change. Replacing this design document, adopting the source reference or replacing a primitive does not supply that authorization. Retain existing geometry when a new shared target would otherwise rearrange the page.

Before changing layout-related DOM/CSS, shared primitive geometry or size tokens:

1. Identify all affected consumers and baseline regions, including shell, title bar, navigation, Transcript and composer/approval dock. Record authorized differences separately.
2. Reuse or add real-browser layout assertions before editing. Measure positions, dimensions, alignment, clipping, overflow and scroll ownership at matched viewports/content/states. Cover narrow/wide, sidebar open/closed and relevant scaling, long content, disclosure, approval and scroll positions.
3. Run the affected cases after implementation. Allow at most 1 CSS px for rounding where appropriate; preserve fluid relationships instead of inventing fixed widths. CSS-class assertions and screenshots alone do not prove unchanged geometry.
4. Repair unauthorized differences before packaging or delivery. Do not weaken tolerances, remove assertions or rewrite expected measurements to hide regressions. Record baseline, differences and actual checks under the repository verification rules.

Relevant suites include [shell](packages/ui/tests/app/shell.browser.test.tsx), [Transcript](packages/ui/tests/app/transcript.browser.test.tsx), [conversation dock](packages/ui/tests/components/conversation-dock.browser.test.tsx) and [composer](packages/ui/tests/components/compact-composer.browser.test.tsx). A component migration includes all affected regions, not only its catalogue example.

## Workspace and page composition

### Workspace structure

The established Rukie shell remains a product-specific contract, independent of the source application's configured 282px sidebar. Keep the 52px rail, 44px shared title bar, 268px middle navigation, 12px inner workspace corners and 4px right/bottom inset. The inner workspace begins at (52px, 44px). Keep the rail/middle seam borderless and the middle/main divider at 1px.

| Structural token                 | Light     | Dark      |
| -------------------------------- | --------- | --------- |
| `layout-rail`, `layout-titlebar` | `#f7f7f7` | `#0e0e0e` |
| `layout-sidebar`                 | `#fcfcfc` | `#050505` |
| `layout-content`                 | `#ffffff` | `#000000` |

Apply workspace depth once around the combined middle/main perimeter, behind opaque column fills. Near shadow is (0px, 2px), blur 8px, Light `#0000000a` / Dark `#00000040`; far shadow is (0px, 8px), blur 24px, Light `#0000000f` / Dark `#00000073`. Do not apply these structural shadows to cards or controls.

Keep the existing title-bar action centers, native control exclusion zones, Session title divider and platform shell clipping. Interactive title-bar controls are outside drag regions. Native compositor/material claims require platform acceptance; browser styling does not reproduce macOS vibrancy. Linux retains the established 16px outer radius, 12px inner frames and 4px inset, with 0px outer radius when maximized.

Navigation order, Session membership, pinning, row reveal and category expansion retain their implemented behavior. Session rows remain transparent at rest, including the current Session; retain current semantics and keyboard focus without adding a persistent fill. The new-chat/search header stays outside the scrolling categories; its divider appears only below scroll top when content overflows, without moving the viewport.

Use the installed navigation ScrollArea: transparent 8px track, centered 4px thumb, minimum 24px, with no consumed content width. Preserve trailing action space, title fading and focus access. Resizers retain a transparent 4px hit area and a 2px radius-inset indicator. Frame, panel and conversation scroll ownership must not move as a styling side effect.

### Surface ownership

The following bindings are normative in both themes. `layout-content` remains `#ffffff` / `#000000`; changing shared Dark `background` to `#212121` does not recolor the structural conversation canvas. Transparent descendants reveal their owning surface rather than acquiring an implicit card fill.

| Surface                                                 | Owning token                      | Light / Dark fill                                 |
| ------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| Main conversation frame and Transcript background       | `layout-content`                  | `#ffffff` / `#000000`                             |
| Plan Side Pane body/header                              | Shared `background`               | `#ffffff` / `#212121`                             |
| Plan tab strip and gap between conversation/Plan frames | Structural `layout-rail`          | `#f7f7f7` / `#0e0e0e`                             |
| Conversation summary cards                              | Shared `card`                     | `#ffffff` / `#212121`                             |
| Plan-preview cards                                      | Shared `input-surface`            | `#ffffff` / `#212121`                             |
| User message bubble (soft/tint)                         | Shared `muted`                    | `#f5f5f5` / `#2f2f2f`                             |
| Assistant message body and Trace                        | Transparent over `layout-content` | `#ffffff` / `#000000`                             |
| Composer                                                | Shared `background`               | `#ffffff` / `#212121`                             |
| Permission Tool Approval Interaction card               | Shared `card`                     | `#ffffff` / `#212121`                             |
| Question / plan-review Approval Card Interaction        | Shared `muted`                    | `#f5f5f5` / `#2f2f2f`                             |
| Generic menu / Select / popover / Dialog                | Shared `menu` / `popover`         | `#ffffff` / `#2f2f2f`                             |
| Settings surfaces, including portalled overlays         | Named `settings-*` roles          | [Settings surface roles](#settings-surface-roles) |

Interaction content retains its actual request-specific presentation; the waiting badge's `interaction-confirmation-*` pair does not fill the whole card. Summary borders use `card-border`; plan-preview and ordinary panel separation use `border`. The composer receives its named elevation without changing the dock geometry.

### Conversation and Agent surfaces

Use beUI-based presentation composed around actual Session/Run/Transcript state. Preserve the existing 736px desktop Transcript width and 752px composer width; the composer starts at 100px height with 16px corners. These Rukie dimensions override the source home's 768px/97px/18px sample and the generic field role.

Keep assistant content, tool/reasoning Trace and user messages distinguishable. Their grouping, disclosure, lifecycle and reading-position contract is defined in [Run and Trace presentation](#run-and-trace-presentation).

A pending Interaction replaces only the composer dock with one card at a time, preserving queue order, draft and focus restoration. Permission requests use Tool Approval; questions and plan review use the installed Approval Card adaptation. Keep neutral primary actions, visible wrapped footer actions and collapsed permission details. Programmatic initial focus must not paint a keyboard-only blue ring; actual keyboard navigation must show focus. UI approval never substitutes for Core authorization.

Code, diff, tool-result and citation surfaces expose actual available data. Copy handles failure; code supports unknown-language fallback; file paths and outputs wrap or scroll internally. Streaming follows the live edge only while the reader is following; user scrolling releases that control. Completion or cancellation must not snap a reader back to the bottom.

The right conversation scrollbar maps the Transcript scroll range while spanning the complete detail panel, including the dock; preserve its 12px track and 24px minimum thumb. Preview Rail remains 20px from the left edge and centered in the complete panel, with 8px row gaps, 6px resting ticks and 24px maximum active previews. Preserve its 40px text gutter, keyboard behavior and narrow-window availability. A tick click changes navigation immediately without decorative feedback.

### Run and Trace presentation

This contract governs the visible execution process, not the execution model. [CONTEXT.md](CONTEXT.md) owns Run, Turn, Transcript, Run Outcome and Interaction meanings; [conversation rendering](packages/ui/README.md#对话呈现) owns the current projection and rendering implementation. The existing `PromptGroup` is a user-input presentation group and must not be redefined as a new domain Run or assumed to map one-to-one to every Core Run.

#### Structure and chronology

Keep the existing group header, user input, assistant content and process regions. A group may contain multiple Turns and multiple Trace activity segments. Consecutive reasoning and tool entries form an activity segment; each assistant text message separates the preceding and following segments. Render intermediate and final assistant bodies in their actual chronological positions with beUI Streaming Response, without an artificial “message” step heading. Do not move all assistant content to the end or merge activity across those bodies.

The group header is the process disclosure control and carries its execution status and elapsed-time label. Its divider stays immediately below it in both open and closed states. Collapsing the outer process hides only Trace segments; user input, every assistant body, provider warnings and actionable pending Interactions remain available. Do not add a separate steps button or a card around every entry.

Use beUI Agent Activity for the outer process and each activity segment, the installed reasoning disclosure for thinking, Tool Result for tool detail presentation, and the selected code/diff/ANSI renderers for their content. An ordinary tool call has one type icon supplied by its tool card; wrappers do not add a second identical icon. Rendering components consume actual projected data rather than generating execution facts from their visual state.

#### Disclosure and reader control

Defaults apply only while the reader has not made an explicit disclosure choice for that presentation identity.

| Target / lifecycle              | Default presentation                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Active outer process            | Open; the reader may collapse it while execution continues.                                                    |
| Normally settled outer process  | Closed, without changing assistant body visibility or implying that the task succeeded.                        |
| Failed or aborted outer process | Open with the actual outcome visible; an explicit reader choice still wins.                                    |
| Restored history                | Derive the initial default from its known outcome; do not replay running animation or infer a missing outcome. |
| Trace activity segment          | Closed when the outer process is opened; segment headers toggle independently.                                 |
| Reasoning entry                 | Closed; no leaked inline preview or duplicate badge beside its collapsed title.                                |
| Tool parameters and result      | Closed by default; a failed tool opens its detail by default unless the reader already chose otherwise.        |
| Pending permission parameters   | Closed in the active Tool Approval card; its action footer is always visible.                                  |

A failed tool keeps its failure indication even when the Run stops normally; an untouched outer process uses the failed default. This does not change the Core Run Outcome.

Retain reader choices across streamed deltas, tool completion, outer-process settlement and virtualized remounts in the current keyed Session view. Do not reopen or close an explicitly controlled region when a new token, another tool result or an error arrives. Keep an error/outcome indication visible on the collapsed summary instead. A full view reset or application reload uses history defaults unless an existing separately documented preference restores a choice; this contract adds no persisted preference or Core state.

Title and chevron activate the same disclosure via pointer, Enter or Space, expose expanded state and identify the controlled region. Closed details are absent from keyboard navigation and the accessibility tree. Collapsing a region containing focus returns focus to its disclosure before hiding the controls; streaming and settlement never steal focus.

#### Running summary and reasoning

Only the active segment's outer summary shows its latest available command, path or reasoning detail as one truncated line with beUI Text Shimmer. Preserve the full label through an accessible name and hover/focus disclosure. Nested rows show stable titles and actual per-entry status rather than repeating that live preview or animating every row.

After every tool in a segment has settled, replace the live preview with a localized factual category summary such as reading, executing or searching. A reasoning-only settled segment may say analysis finished. Do not summarize an unfinished segment as complete, fabricate a tool count or percentage, or label ordinary Run termination as task success. Run Outcome and per-tool outcomes remain independent.

The outer group uses the actual elapsed-time presentation: running copy equivalent to “Processed” and settled copy equivalent to “Elapsed”, localized through `@rukie/i18n`. Duration is a fact or a supported live duration estimate, never a countdown or simulated progress. Missing history timing stays unavailable rather than starting a new timer.

Expanded reasoning shows the actual received text and preserves its order, selectable content and existing Markdown/text rendering. Append updates to the same projected entry; do not create an entry for every token or regenerate a fictional explanation when content is missing. Streaming updates do not reset disclosure or text selection. Loading feedback stops on success, failure, cancellation or loss of confirmed running state, with a static reduced-motion alternative.

#### Tool calls, parallel work and outcomes

A collapsed tool row identifies the action, a concise target when available and its real status. Expanded detail separates parameters from returned output; commands, paths and identifiers use the shared mono role. File edits use the installed diff presentation, command output uses the installed ANSI presentation, and ordinary structured results use their typed presentation or readable text fallback. Missing output, truncated source output and rendering failure are distinct visible conditions; never silently replace them with an invented result.

Preserve call initiation order and stable row identity as results arrive. Parallel calls remain independent rows with independent states; completion order does not reorder them. Use the existing [projection identity](packages/ui/src/lib/transcript.ts) and event association; a reused provider call ID must not overwrite a prior call, reopen a different row or move an approval result. A user retry is a distinct recorded attempt, not an unrecorded reset of the failed call.

| Visible state               | Required information                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Queued / waiting to execute | Show only when the underlying state provides it; distinguish it from running and from waiting for permission.    |
| Running                     | Actual pending activity and any available partial output; no completed checkmark.                                |
| Completed                   | Settled tool result; a successful tool does not certify the whole Run or task.                                   |
| Failed                      | Readable failure summary, available error detail and recovery action only where a real capability exists.        |
| Denied                      | Explicit denial treatment, distinct from execution failure and cancellation.                                     |
| Cancelled / interrupted     | Preserve available partial content and the actual end reason; do not relabel it as success or erase the attempt. |
| Unknown / unavailable       | State uncertainty explicitly; do not infer execution, duration or success from absent events.                    |

Failure, cancellation and denial remain discoverable when enclosing regions are collapsed. Use semantic status copy and glyphs with the shared colors, not color alone. Never expose raw credentials through parameter previews, copied summaries or accessible titles; use the existing safe presentation values and masking behavior.

#### Approval placement

Pending permissions remain in the composer dock, one actionable request at a time, preserving queue order, draft, attachments and focus restoration. Do not duplicate active approval buttons inside Trace or hide the only approval action in a collapsed process. Questions and plan review use their own installed Interaction presentation.

After settlement, the process shows the existing projected outcome in its original activity position. Keep denied results associated with their tool; do not append them to the latest segment or duplicate approved permission cards. On reconnect or history restore, use the current request and committed facts supplied by the owning layer. [Permission rules](docs/permission-rules.md) and the UI projection own decision, identity and reply semantics; this section does not create a frontend authorization path.

#### Geometry, overflow and reading position

Use the existing 28px Trace summary row role, 12px Lucide glyphs and 8px inline joins. Outer execution headings use the base type role; inner reasoning/tool titles use the existing secondary `text-ui-control` role and `muted-foreground`. Real nested disclosures may indent 16px per level; do not invent hierarchy from visual grouping. Keep 4px between repeated entries, 8px between process sections and 16px between independent messages where those shared roles apply. Rows grow for enlarged text and wrapping instead of clipping status or actions.

Expanded process content follows the Transcript's vertical scroll owner without an arbitrary height cap, nested vertical scroll viewport or sliding window. Long commands and paths wrap; code/diff horizontal scrolling stays inside its content renderer. Do not introduce a new output truncation limit in a styling change. Explicit show-more or full-output affordances must reflect available source content and preserve their local disclosure state.

Disclosure and row-height changes preserve the reader's visual anchor. Follow appended output only while the reader is already following the live edge; scrolling upward releases follow mode. Expanding a result, receiving parallel output, changing width or settling a Run must not force a jump to the bottom. Virtualization measures real expanded heights and preserves group identity. Keep actions and outcomes usable at 420px width without page overflow. Streamed detail is selectable content, not a per-token live announcement; status announcements are concise and do not reread the entire result.

#### Required presentation scenarios

These are acceptance obligations for implementation changes, not claims that the current renderer has passed every case.

| Scenario                                                                  | Observable requirement                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Reasoning → tool → assistant text → more reasoning/tools → assistant text | Activity segments split at actual assistant bodies; chronological order survives outer collapse.           |
| Active, normal stop, failure, abort and unknown historical outcome        | Defaults follow the lifecycle table without a fabricated success state; warnings remain visible.           |
| Reader expands/collapses before a streamed update or settlement           | Explicit choices survive updates and virtualized remounts; no focus or selection reset.                    |
| Parallel calls, out-of-order results and reused provider IDs              | Rows retain position/identity, output and outcome stay with the correct attempt.                           |
| Long parameters, code, diff, ANSI, empty/missing/truncated output         | Correct content presentation, readable fallback, discoverable errors and no lost actions.                  |
| Pending permission, denial, disconnect and restoration                    | One active dock request; correct historical placement, preserved draft and no duplicate authorization.     |
| Reader at top/middle/live edge; expand, resize and complete               | Stable visual anchor, deliberate following and accurate shared scrollbar/Preview Rail mapping.             |
| Light/Dark, narrow/low height, enlarged text, zh/en and reduced motion    | Readable hierarchy, accessible controls, static alternatives and no process-internal vertical scroll trap. |

### Conversation model controls

Keep the established model trigger and independent list/detail panels. The trigger is 28px high; model and reasoning labels remain separate. The list is 332px wide, with 4px inset, 32px rows and a 312px scrolling maximum; it attaches 4px above the trigger at its right edge. The 280px detail panel sits independently 4px beside the list and flips/clamps with 16px viewport clearance, without repositioning the list.

Below 672px, the detail matches the list width and sits 4px above it. Preserve reserved provider/check slots, independent hover preview, keyboard entry/return and focus restoration. Opening/reopening clears preview; hover does not change saved model selection. Provider marks use the explicit catalog key. Existing fixed reasoning labels remain the scoped localization exception; all other copy stays localized.

Permission and context panels retain their 376px and 348px scoped widths and actual data categories. The named settings/conversation surfaces and their specified field dimensions remain scoped roles; do not apply the reference's permission orange, 280px menu or sampled context values globally.

### Search overlay

Keep the existing CommandPalette composition: 520px maximum width, 20px shell radius, viewport clearance 16px, fixed search/action regions and a bounded result ScrollArea. Results target 31px minimum height, preserving status and Project slots, keyboard movement and focus restoration. Do not add shortcut hints.

Its existing entrance is scale 0.98→1 plus opacity over 160ms, without translation. Reduced motion switches panel/backdrop/highlight immediately. Exit releases interaction and transfers or restores focus through the existing presence behavior; these scoped rules do not enable motion on ordinary menus.

### Project directories and trust

Project hover detail anchors to the visible row hover-background rectangle: left edge = rectangle right edge + 4px, top edges aligned, excluding shadow. It may overlap middle navigation, escape sidebar scroll clipping and clamp only to the application viewport. Preserve the 4px pointer corridor and keyboard access; do not anchor it to the sidebar's outer edge.

Retain the established 320px detail shell, 12px radius, 6px internal row margins/gaps and full-width separators. Project dialogs preserve their separate dimensions: create 480px, trust 416px, edit 520px and remove 448px maximum, with 16px shell radius and viewport clamps. Their named local 32px fields, 36px primary actions and draft/focus flow remain scoped exceptions to generic control targets.

Keep names/paths readable, action footers visible and trust explanations explicit. Cancellation preserves editable drafts. Removal states name what is removed and what is retained, and busy/error states remain observable. Session/Project menus continue deriving one action list across their existing entry points; keep flyout, pointer corridor, disabled and focus-restoration behavior.

### New-chat worktree selection

The pre-Session selector retains its 40px height, composer width, 4px padding and 12px top corners, with its existing 16px extension behind the composer. It disappears after Session creation. Keep Project and branch selection separate, with cancellation preserving the prompt and Git errors inside the active overlay.

Project and branch menus retain their 288px/320px widths, 32px search/rows, fixed trailing actions and internal scrolling. Preserve keyboard search/typeahead separation, selection marks and non-Git visibility. Do not add this selector to existing Sessions or change the meaning of an independent worktree through styling.

### Worktree settings

Preserve the existing settings layout, 32px refresh action and rows with 12px radius, 12px vertical/16px horizontal padding and a 12px content gap. Branch/path information wraps while Delete remains reachable. The removal dialog retains its 448px maximum, 16px radius, 32px Cancel and 36px destructive action, initial Cancel focus and visible busy/error states.

### Model services settings

Detailed settings content is outside this design-system generation scope. Preserve the established settings navigation, provider rail, model list/dialogs, auto-save and confirmation behavior; this document does not recreate the source application's settings or authorize changes to model configuration.

Existing settings geometry remains a scoped exception: 880px workspace with 224px provider rail and 656px detail region, 32px fields and 8px field corners; model dialogs retain their 672px maximum, 704px bounded height, separate 82px title region, 60px footer and internal scroll owner. Provider catalogue cards retain their 68px height, 10px gaps and narrow single-column reflow. Existing accessible shared controls, brand-icon slots and overlay scrollbar remain in use.

Keep password masking/reveal, numeric-field stepping, localized alerts and pending-save behavior. Never imply that a disabled destination or a missing host capability is available. Scoped settings surface roles remain separate from the structural columns and new generic control targets.

<a id="m03-c-目标模式"></a>

### Goal Mode

Preserve the existing 28px toolbar role and 40px status bar above the unchanged composer. The bar retains 12px left/8px right padding, 8px information/action gaps, truncated objective and nonshrinking time/actions. States come from authoritative Goal state; round-limit/unarmed takes precedence over Resume availability. Complete/removed state leaves no bar. Closing a draft mode preserves input.

Goal removal uses a 448px confirmation modal, 16px radius, 20px vertical/24px horizontal body padding, separate footer and initial Cancel focus. These local values do not modify the shared modal. Trash opens this confirmation before sending the removal command; cancellation before confirmation preserves the Goal. Cancel, Escape and backdrop dismissal remain available while a confirmed removal is pending: dismissal closes only that presentation and does not cancel the already sent command. Its late response cannot close a newer confirmation or claim its focus; authoritative Goal state still determines the bar. The enable-mode confirmation remains a separate action.

### Plan and Interaction surfaces

Keep plan-preview cards, review Interactions, Session summary and Plan Side Pane in their established regions. The preview remains a 44px header plus 248px Markdown body. The Interaction card remains fluid up to 752px with 16px corners, readable wrapped choices and visible submit/skip actions. Use installed Checkbox for multiple selection; focus movement and selection remain distinct.

Summary remains a 300px bounded card stack without an extra frame, using the existing toggle/Escape and actual Transcript-derived content. The Plan Side Pane retains its main-only frame, 44px title/tab regions, 4px gap and internal ScrollArea. At main width ≥960px it shares available width; below that it overlays only main while preserving the mounted conversation's geometry and reading position. Keep tab identity, close actions, Summary coexistence and focus behavior; do not invent a new panel or resizer.

## Accessibility, localization and responsive behavior

Normal text requires at least 4.5:1 contrast; large text and essential control boundaries/state indicators require at least 3:1. Verify actual composite backgrounds in Light and Dark. Decorative marks do not excuse inaccessible operational text. Status always includes text, shape or an explicit accessible description.

Every action has a localized accessible name, keyboard route and visible focus. Labels and validation descriptions remain associated with their fields. Keep native input semantics, IME composition behavior and control-specific keys; shortcuts must not steal editable input or operate through an active modal/menu. Avoid scroll-locked or aria-hidden error messages outside the active Interaction.

At 420px window width, navigation, Run/Trace, composer, pending Interaction and response navigation remain usable without horizontal page overflow. Clamp overlays, wrap actions and let long content scroll internally. Preserve primary actions and meaningful labels rather than shrinking text or hiding the workflow. Support zh/en and doubled-length label fixtures, 14px/18px interface scales, and low-height windows.

Narrow browser adaptations are Rukie layout rules, not evidence that the reference application behaves identically. Real macOS/Windows/Linux material, drag regions and shell clipping require the appropriate native acceptance; ordinary style work uses the isolated Chromium workflow from [the testing strategy](docs/testing.md).

## Delivery and verification

A design document is reviewed as a specification. An implemented surface is accepted through rendered behavior. Documentation checks, registry installation and successful compilation do not establish visual conformity or exhaustive state coverage.

For each changed shared role, identify affected screens and check the smallest sufficient set of consumers. Reuse valid evidence under [the verification rules](docs/testing.md#验证记录与增量复验); do not rerun full acceptance solely because ownership or documentation changed.

| Area                 | Required evidence for an implementation change                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens and units     | Shared semantic roles, px dimensions, contrast on actual Light/Dark surfaces; no accidental raw registry colors.                                      |
| Geometry             | Baseline and authorized differences; rendered size, padding, gap, radius, clipping and scroll-owner assertions, within applicable rounding tolerance. |
| States               | Default, hover, static press, selected, disabled, loading, empty, error, cancellation and actual settled result where applicable.                     |
| Pointer and keyboard | Computed cursors on roots/nested labels/icons; real pointer/keyboard activation; disabled targets reject both; visible focus and correct restoration. |
| Overlay composition  | Escape, focus containment/transfer, portal clipping, trigger attachment, viewport bounds, submenu corridors and hint layering.                        |
| AI / Agent lifecycle | Partial streaming, user-scrolled reading position, stop, failure/retry, pending approval and restoration without invented execution state.            |
| Responsive text      | Wide/narrow/low height, zh/en/long labels, 14px/18px scaling; no lost primary actions or page overflow.                                               |
| Motion               | Immediate menus/control states, settled loading, static reduced-motion alternative, no per-token layout animation.                                    |

Implementation work follows the repository's affected tests/static checks and one final isolated browser verification using the [agent-browser skill](.agents/skills/agent-browser/SKILL.md). Inspect Light/Dark and narrow captures plus console/network errors. Do not launch native Electron outside its separate authorization boundary. Record actual failures, remaining deviations and absent-feature exclusions; never turn an unexecuted path into a pass.

For documentation-only edits, run the documentation and formatting checks required by [the documentation workflow](docs/agents/documentation.md). Do not run product tests, browser acceptance or native packaging and describe them as necessary evidence for a document change.

### Named feature implementation roles

Structural layers retain their established levels in `lib/overlay.ts`: navigation scrim and Preview Rail10, navigation and Summary20, settings and Transcript scrollbar30. Local isolated backgrounds/roots/foregrounds retain -10/0/10; these local levels are not global overlays. Passive hints40, modals50, modal hints55 and interactive menus60 remain above structure.

Search shell radius is the local20px role. Border-inset model/context scrolling corners derive11px from the12px shell minus its1px border. Alpha masks use opaque black solely as coverage, not a palette color.

Preserve named local clearances: sidebar trailing actions reserve60px; Summary reserves332px including its300px card and surrounding space; composer outer frame800px contains its752px content plus horizontal padding. Search retains a108px Project slot and279px/206px normal/low result viewport; empty Project directory selection104px and custom Interaction option52px remain local geometry.
