# Unreleased

Working draft for the next PickLab release. Keep this current while PRs land.
At release time, use it to polish the generated GitHub release description,
then reset this file.

## User-facing changes

- `desktop_launch` now points `WAYLAND_DISPLAY` at a non-existent socket (and
  strips `WAYLAND_SOCKET`), so GTK/Qt/Electron/Flutter apps always fall back
  to X11 and render inside the isolated lab display instead of opening on the
  user's real Wayland desktop (where driving them moved the real cursor).
- Normal `--vnc` sessions now launch x11vnc with `-viewonly`, so observation is
  server-enforced read-only. `--vnc-control` provides an explicit writable path
  when a human must enter a password, API key, or OTP directly into the lab app;
  it does not yet coordinate with agent input. Loopback binding (`-localhost`),
  `-shared`, `-forever`, and no-password (`-nopw`) behavior is unchanged.
- New desktop input primitives on both the CLI and the MCP server
  (pickforge/picklab#22): mouse move/hover (`desktop move <x> <y>` /
  `desktop_move`), wheel scroll (`desktop scroll <deltaX> <deltaY>` /
  `desktop_scroll`, integer wheel steps, positive Y down / negative Y up,
  positive X right / negative X left, optional pointer position first),
  drag (`desktop drag <fromX> <fromY> <toX> <toY>` / `desktop_drag` with
  optional button and duration), and double click
  (`desktop double-click <x> <y>` / `desktop_double_click` with optional
  button and click interval). All are argv-array xdotool calls with
  validated coordinates, buttons, deltas, and timings — no shell.
- `picklab session create --type browser` and the MCP `session_create` tool can
  now create isolated headed Chrome/Chromium sessions. CLI and MCP status,
  single-session destroy, and destroy-all include browser sessions.

## Internal/release changes

- Hosted CI now installs `x11vnc` alongside the other desktop test
  dependencies, and the desktop-linux integration suite asserts `x11vnc` is
  present when `CI=true` so VNC tests fail loudly instead of silently
  skipping on a misconfigured runner.
- Added internal browser session contracts to `@pickforge/picklab-core`
  (private, unpublished): a `browser` session type with `BrowserSessionInfo`,
  capability-based session resolution (`SessionCapability`,
  `sessionHasCapability`), and verified process-group stop primitives
  (`stopProcessGroupVerified`, `processIdentityMatches`, and friends) now
  wired into the session reaper. No CLI/MCP-visible behavior yet; the browser
  lifecycle wiring lands in a later PR.
- Browser reaping now confirms the recorded browser process group is gone
  before stopping VNC/Xvfb helpers or deleting the session record. Reused or
  otherwise unconfirmed groups leave dependent helpers and profile data intact
  and mark the record as errored for inspection.
- `startXvfb` gained an additive `displayStart` option so browser sessions use
  displays from `:200` without contending with desktop sessions from `:90`.
- Added internal `@pickforge/picklab-browser`, owning Chrome/Chromium detection,
  a private Xvfb, ephemeral profile, dynamic loopback CDP discovery, scrubbed
  environment, PID-identity process-group teardown, status, retryable
  partial-failure cleanup, and concurrent-session safety. The DevTools websocket
  path/GUID is never persisted.
- CI installs a supported browser and requires the real headed-Chrome integration
  suite to execute rather than silently skip.
- SECURITY.md documents the residual same-UID and local-process risks.

## Validation

### Tested

- Regression test asserting launched apps get `DISPLAY=<lab display>` with
  Wayland variables unset; full desktop-linux integration suite (Xvfb +
  xdotool + xterm) passes.
- `buildVncArgs` exact-argv test updated to require `-viewonly`; hosted-CI
  prerequisite assertion verified to fail loudly (not skip) when `CI=true`
  and `x11vnc` is absent, and to pass once `x11vnc` is on `PATH`.
- `bun run typecheck`, `bun run test` (49 files, 564 passed / 2 skipped
  locally without real `x11vnc` installed), `bun run test:coverage` (all
  thresholds met), and `bun run build` all pass.
- Exact xdotool argv unit tests for move, scroll (direction/ordering/repeat),
  drag (button/duration), and double click (button/interval); CLI and MCP
  validation tests for out-of-range buttons, deltas, durations, and
  intervals; live Xvfb smoke driving move, scroll, drag, and double-click and
  asserting the pointer position via `xdotool getmouselocation`.
- Process-group regression tests cover reused PID refusal, stubborn children,
  and zombie-only groups.
- `bun run test packages/core` (8 files, 107 passed) and
  `bun run typecheck` pass. Core session regressions verify browser-group-first
  teardown and fail-closed handling for an unconfirmed browser identity.
- `bun run typecheck`
- `bun run build` for all packages.
- Focused browser/core/desktop/CLI/MCP/security tests: 208 passed / 2 skipped.
- Fake-Chrome lifecycle tests cover private runtime modes, verified CDP HTTP
  readiness, create/status/destroy, centralized display-socket liveness,
  concurrent displays, crash-after-port, cancellation during Xvfb startup and
  record commit, crash/stall cleanup, automatic reaper retry after failed create
  or destroy, conservative legacy desktop liveness, symlink-safe profile
  confinement, retryable removal failures, capability-URL log redaction with
  preserved diagnostics, verified Xvfb PID identity and reuse refusal,
  post-SIGTERM group escalation, GUID exclusion, and environment scrubbing.
- Built `picklab` and `picklab-mcp` tests cover browser create, status, individual
  destroy, destroy-all, profile removal, and environment scrubbing.

### Not tested yet

- Installer or updater flow.
- Platform smoke checks outside Linux.
- Live hosted CI run with `x11vnc` actually installed (validated locally via
  fake binaries and a `CI=true` dry run only).
- Full-suite and coverage runs after the resumed lifecycle edits.
- Live real-Chrome integration after the resumed lifecycle edits (CI remains
  configured to require it on Linux).

### Release blockers

- None known for this internal lifecycle slice.
