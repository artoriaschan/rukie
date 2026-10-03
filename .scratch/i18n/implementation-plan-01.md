# Ticket 01 implementation plan

Scope: `.scratch/i18n/issues/01-i18n-package-and-locale-tracer.md`; the accepted spec and ADR-0008 define the design. Implement directly on the current branch as requested.

- [x] Add runtime-independent `packages/i18n` and test its public exports in red/green slices: locale candidates, common/app translation and interpolation, compile-time key/parameter/collision checks, duration formatting and placeholder parity.
- [x] Test and implement user locale preservation and project locale warnings through `loadSettings()`.
- [x] Test en/zh/settings/C behavior through the existing virtual-terminal `start()` → `main()` seam. Resolve locale once per startup and pass it as props to the permission UI; keep independent app instances isolated and component defaults Chinese for existing standalone tests.
- [x] Provide the shared duration formatter, preserving current zh output; English uses spaced, padded compound durations. Ticket 03 owns switching activity callers and deleting the old implementation.
- [x] Update workspace wiring and documentation; run focused checks regularly and full `bun run check` at the end.
- [x] Review standards and ticket/spec in independent code-review agents against baseline `eb1d6c98c2ec039bfa4c10d85d148eba85290c72`, resolve findings, update ticket and commit on the current branch.
