# Unreleased

Working draft for the next PickLab release. Keep this current while PRs land.
At release time, use it to polish the generated GitHub release description,
then reset this file.

## User-facing changes

- `desktop_launch` now points `WAYLAND_DISPLAY` at a non-existent socket (and
  strips `WAYLAND_SOCKET`), so GTK/Qt/Electron/Flutter apps always fall back
  to X11 and render inside the isolated lab display instead of opening on the
  user's real Wayland desktop (where driving them moved the real cursor).

## Internal/release changes

- Added internal browser session contracts to `@pickforge/picklab-core`
  (private, unpublished): a `browser` session type with `BrowserSessionInfo`,
  capability-based session resolution (`SessionCapability`,
  `sessionHasCapability`), and verified process-group stop primitives
  (`stopProcessGroupVerified`, `processIdentityMatches`, and friends) now
  wired into the session reaper. No CLI/MCP-visible behavior yet; the browser
  lifecycle wiring lands in a later PR.

## Validation

### Tested

- Regression test asserting launched apps get `DISPLAY=<lab display>` with
  Wayland variables unset; full desktop-linux integration suite (Xvfb +
  xdotool + xterm) passes.
- `bun run typecheck`, `bun run test` (49 files, 580 passed / 1 skipped),
  `bun run test:coverage` (all thresholds met), and `bun run build` all pass.
- Process-group regression tests cover reused PID refusal, stubborn children,
  and zombie-only groups.

### Not tested yet

- Installer or updater flow.
- Platform smoke checks.

### Release blockers

- None known.
