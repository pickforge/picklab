# Unreleased

Working draft for PickLab v0.2.0. Use this to polish the generated GitHub
release description, then reset it after the release is published.

## User-facing changes

- **Default run storage changed.** Screenshots, logs, manifests, and evidence
  journals now default to `~/.pickforge/picklab/projects/<projectId>/runs/`
  (outside the project) instead of `<project>/.picklab/runs/`, so a default
  run no longer shows up in `git status`. `PICKLAB_HOME` now defaults to
  `~/.pickforge/picklab` (was `~/.picklab`); the old default is still read
  non-destructively as a fallback for existing global config, agent state,
  and sessions — nothing is moved or deleted. `project-local` (restores the
  previous layout) and `custom` (explicit absolute path) storage modes are
  available via `.picklab/config.json`'s `storage` field or the
  `PICKLAB_STORAGE_MODE` / `PICKLAB_STORAGE_PATH` env overrides. Existing
  project-local runs remain discoverable by `artifact_list` /
  `artifact_report` / MCP resources without migration. See the README's "Run
  storage" section.
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

- Added a single storage resolver (`resolveRunStorage`) covering home,
  project-local, and custom modes with stable per-project id derivation
  (sha256 of the canonical project path); routed run creation, the run
  catalog, and active-evidence-pointer resolution in core, CLI, and MCP
  through it. `openRunCatalog` now layers the resolved primary root with a
  read-only legacy project-local fallback root for non-destructive discovery.
  Added a legacy read-fallback (`resolveReadablePath`, per-entry) for global
  config, agent state, and sessions across the `~/.picklab` →
  `~/.pickforge/picklab` default-root change.
- Added a private browser lifecycle package with confined ephemeral profiles,
  loopback-only CDP discovery, verified process-group teardown, concurrent
  session safety, and conservative dead-session reaping.
- Centralized session lifecycle composition in core and routed dead-session
  reaping through typed desktop, Android, and browser teardown owners, removing
  duplicate CLI/MCP orchestration and core PID/profile stop implementations.
- Added one verified run catalog for deterministic discovery, directory-manifest
  identity binding, corrupt-entry handling, and symlink-safe root-file reads
  across core retention, CLI artifacts, and MCP tools/resources.
- Centralized CLI provisioning policy for plan classification, consent,
  dry-runs, ordered preflight failures/skips, adapter-owned sudo routing,
  cancellation, redacted presentation plans, and partial results.
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
- Focused run catalog, run, evidence, CLI artifact, and MCP resource/tool suites.
- New `storage.test.ts` (project id derivation, all three storage modes, env
  overrides) and `run-catalog.test.ts`'s "openRunCatalog storage modes" suite
  (home default, legacy project-local discovery, project isolation, custom
  mode), plus a `git status --porcelain` repo-cleanliness smoke test.
- `bun run test` — same pre-existing failure set as unmodified `main` on this
  (macOS) sandbox (Darwin lacks `/proc`, so PID-identity/Xvfb/x11vnc-driven
  tests fail there and on CI's Linux runners this class does not apply);
  verified test-by-test against `main` on this branch's dev sandbox.
- `bun run build`

### Not tested yet

- `bun run test:coverage` on a machine where the full suite runs clean (this
  dev sandbox can't produce a coverage summary because the pre-existing
  Darwin-only failures above stop the process before the v8 coverage
  provider flushes it — reproduced identically on unmodified `main`).
- Platform smoke checks outside Linux.
- Live remote SSH-tunnel smoke test.
- Tag-triggered npm publish and draft-release creation (runs only after merge and
  tag push).

### Release blockers

- None known.
