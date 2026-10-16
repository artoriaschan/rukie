# Design specification verification

## Scope

Completely rewrite root DESIGN.md around the inspected Chengxiaobang-derived visual foundation and explicit Rukie adaptations. Include beUI-first sourcing, shadcn fallback, Lucide, px spacing, source/implementation distinction, interaction/accessibility and layout preservation. No application code, dependencies, assets, Pencil files or runtime configuration are changed.

## Source and baseline

- Branch base: latest fetched origin/main, dd14149ccaaa4e3ef514051bb0451354047f1e0d.
- Source reference: local Chengxiaobang1.9.2 design-system deliverable from this conversation. Source observations are not a claim of complete source-product parity.
- Existing Rukie DESIGN, theme owner, package manifest, component registry config, documentation workflow and public documentation backlinks inspected.
- Source artifact SHA-256:
  - `docs/SOURCE_SPEC.md`: `b310c1967a477b0df87688c310b48979653d9fdc6d11f7649edfc9d0eed76b18`.
  - `tokens/foundations.json`: `12967fde9ab0e2695aa1b77ec5061341ead15a91ec2ecd0d7df53e78e43112fa`.
  - `tokens/source-tokens.css`: `92d7dc6c2d353cba60615242e65d1d7cf2abbd194c3d325fce00828e180bc5a2`.
  - `docs/SOURCE_CONTRAST.md`: `db29920c9f16301833ed9446747c042263198b6f7db1f74bcbb913949703ba6c`.
  - `verification/finish-review.md`: `e0ff3d76ed6c4705b7441285800771c659d6d620d0183f7c5618fec9619c3305`.

## Decisions and ADR coverage

- Preserve product shell/feature geometry and existing text/icon preferences as named Rukie adaptations; new shared source-derived targets require an authorized, regression-tested implementation migration.
- Keep existing accessible supporting text, control boundaries and focus rings instead of copying known low-contrast source pairs.
- No new ADR: component source order, dedicated rendering engines and UI ownership are existing repository decisions; this task rewrites their visual specification without changing architecture, protocol, runtime or dependencies.
- Existing authoritative documentation backlinks keep working, including layout-preservation, web-pc-interaction, font-families and Goal Mode.

## Verification

- Passed: `bun run docs:update` and `bun run check:docs` (155 Markdown files); changed-Markdown formatting with repository-installed oxfmt 0.71.0; `git diff --check`.
- `bunx --no -- oxfmt` initially attempted registry resolution and failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; reused the existing exact-version formatter binary without modifying dependency or certificate configuration.
- Reviewed the complete replacement, authority order, source/Rukie adaptations, installed-component constraints, surviving documentation anchors and protected layout obligations. No application source or generated ADR index changed.
- Product tests/browser/native acceptance: not applicable to this documentation-only change.
