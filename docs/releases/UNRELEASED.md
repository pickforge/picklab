# Unreleased

Working draft for PickLab v0.2.0. Use this to polish the generated GitHub
release description, then reset it after the release is published.

## User-facing changes

- Added isolated headed Chrome/Chromium sessions, including CLI and MCP session
  lifecycle support and a static `picklab-browser` DevTools MCP entry.
- Added `picklab watch` plus configurable manual/automatic VNC viewer attachment
  for running desktop-capable sessions. VNC remains loopback-only and read-only
  by default; writable access requires the explicit `--vnc-control` path.
- Added desktop mouse move, scroll, drag, and double-click controls to both the
  CLI and MCP server.
- Added end-to-end computer-use evidence recording for desktop, Android, and
  browser actions. Reports include a sanitized action timeline and optional
  screenshot filmstrip, with bounded storage, retention, and MCP resources.
- Strengthened secret redaction across logs, browser diagnostics, telemetry,
  UI trees, logcat, and evidence, including cookies, authorization credentials,
  JWTs, credential-bearing URLs, session identifiers, OTP/CSRF values, and
  Chrome DevTools capability URLs.
- Fixed desktop app launches on Wayland hosts so applications reliably render
  inside the isolated X11 lab display.
- Improved Linux screenshot capture by preferring `maim` when available and
  suppressing noisy ImageMagick `import` stderr.

## Internal/release changes

- Added a private browser lifecycle package with confined ephemeral profiles,
  loopback-only CDP discovery, verified process-group teardown, concurrent
  session safety, and conservative dead-session reaping.
- Centralized session lifecycle composition in core and routed dead-session
  reaping through typed desktop, Android, and browser teardown owners, removing
  duplicate CLI/MCP orchestration and core PID/profile stop implementations.
- Added a framing-aware DevTools NDJSON relay with protocol validation,
  backpressure, bounded diagnostics, redacted failures, and evidence hooks.
- Added atomic, crash-recoverable evidence journals, active-run ownership,
  truncation markers, report publication, and symlink-safe resource access.
- Hardened Android and evidence cleanup around process identity, atomic writes,
  metadata keys, directory traversal cost, and stale ownership recovery.
- Pinned Bun 1.3.12 and Node 20.19.0 in CI/release workflows, moved npm publish
  to trusted publishing with npm 11.5.1, added tag/version and retry-safety
  guards, and made headed-browser and VNC dependencies explicit in hosted
  validation. Tag pushes now create a draft GitHub release for human review.
- Stabilized Xvfb startup cancellation coverage to avoid abandoned browser
  creation during full-suite runs.
- Replaced the duplicated repository workspace policy with a pointer to the
  canonical workspace instructions.

## Validation

### Tested

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun run test` (79 files, 958 passed / 2 skipped)
- `bun run test:coverage` (79 files, 958 passed / 2 skipped; all thresholds met)
- `bun run build`

### Not tested yet

- Platform smoke checks outside Linux.
- Live remote SSH-tunnel smoke test.
- Tag-triggered npm publish and draft-release creation (runs only after merge and
  tag push).

### Release blockers

- None known.
