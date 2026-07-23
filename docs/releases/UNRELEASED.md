# Unreleased

Working draft for PickLab v0.2.0. Use this to polish the generated GitHub
release description, then reset it after the release is published.

## User-facing changes

- **Privileged provisioning now runs through graphical `sudo` on Linux
  (`picklab setup lab-user`, `picklab init --create-lab-user`,
  `picklab doctor --fix`).** Instead of a plain terminal password prompt,
  PickLab detects a graphical session (`WAYLAND_DISPLAY`/`DISPLAY`) and a
  `SUDO_ASKPASS` helper (your own `SUDO_ASKPASS`, or the first of
  `ksshaskpass`/`ssh-askpass`/`lxqt-openssh-askpass`/the standard distro
  paths) before spawning anything privileged, then runs `sudo -A` with that
  helper — the only environment variable this feature injects. PickLab never
  ships or installs its own helper, and never captures, logs, or persists the
  password prompt. Headless sessions, a missing helper, or a non-Linux
  platform (macOS/Windows are out of scope this release) fail closed with an
  actionable error naming the manual `sudo ...` fallback — no automatic
  fallback to a plain interactive password prompt. A cancelled or denied
  graphical prompt surfaces as a distinct failure with no retry. See the
  README's "Security model" section. (pickforge/picklab#27)
- **Default run storage changed.** Screenshots, logs, manifests, and evidence
  journals now default to `~/.pickforge/picklab/projects/<projectId>/runs/`
  (outside the project) instead of `<project>/.picklab/runs/`, so a default
  run no longer shows up in `git status`. `PICKLAB_HOME` now defaults to
  `~/.pickforge/picklab` (was `~/.picklab`); the old default is still read
  non-destructively as a fallback for existing global config, agent state,
  and sessions — nothing is moved or deleted. `project-local` (restores the
  previous layout, selectable from project or global config) and `custom`
  (explicit absolute path outside the project directory) storage modes are
  available via the user-owned global config's `storage` field or the
  `PICKLAB_STORAGE_MODE` / `PICKLAB_STORAGE_PATH` env overrides — a
  project-committed `.picklab/config.json` cannot select `custom` (it
  travels with `git clone`; a cloned repo requesting it falls back to home
  with a `picklab doctor` warning, never a silent redirect of screenshots to
  an attacker-chosen path). Existing project-local runs remain discoverable
  by `artifact_list` / `artifact_report` / MCP resources without migration,
  and retention pruning never touches them — only the resolved primary
  storage root is ever pruned. See the README's "Run storage" section.
- Added isolated headed Chrome/Chromium sessions, including CLI and MCP session
  lifecycle support and a static `picklab-browser` DevTools MCP entry.
- Added `picklab watch` plus configurable manual/automatic VNC viewer attachment
  for running desktop-capable sessions. VNC remains loopback-only and read-only
  by default; writable access requires the explicit `--vnc-control` path.
- **Added supervised pause and human takeover (`picklab watch --control`).**
  Pauses PickLab-managed agent input for a session, atomically acquires a
  30-second-TTL / 5-second-heartbeat human lease, switches the session's VNC
  to a temporary writable server for the duration, and hands control back —
  reverting VNC to read-only, recording a fresh screenshot, and releasing the
  lease — on every exit path: normal viewer close, terminal cancellation
  (SIGINT/SIGTERM), a failed lease renewal, or a PickLab crash (recovered the
  next time the session's VNC is touched). While a lease is held, every
  desktop input call (CLI and MCP: click/move/scroll/drag/double-click/type/
  key) and every DevTools relay `tools/call` request fails closed with a
  stable busy error, checked immediately before delivery — never delivered
  concurrently with human input. New `takeover_status` MCP tool and
  `picklab takeover status` CLI command report lease state (agent-active,
  human-active, or a stale/recoverable lease) without side effects.
  `request_user_input`'s secret guidance now points at this flow instead of
  the persistent, uncoordinated `--vnc-control`. See the README's
  "Supervised pause and human takeover" section. (pickforge/picklab#21)
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
  The resolver applies a source allowlist so only the global config layer or
  an env override may select `custom` storage (project config may still
  select `project-local` or `home`), and rejects a custom path that equals
  or is nested inside the project directory. `pruneFinalizedEvidenceRuns`
  scopes its retention candidate set to the resolved primary root
  (`entry.rootDir`) so the read-only legacy fallback root is never a removal
  candidate.
  Added a legacy read-fallback (`resolveReadablePath`, per-entry) for global
  config, agent state, and sessions across the `~/.picklab` →
  `~/.pickforge/picklab` default-root change. `destroySessionRecord` now
  removes both the new-home and legacy copies of a session record
  unconditionally, so a record that exists at both locations cannot
  resurrect via the legacy read fallback after being destroyed.
- Added a private browser lifecycle package with confined ephemeral profiles,
  loopback-only CDP discovery, verified process-group teardown, concurrent
  session safety, and conservative dead-session reaping.
- Hardened the pre-identity browser daemon cleanup window: if the owned
  Chrome supervisor's `/proc` identity never resolves within the one-second
  startup window (a pathological read failure, a supervisor crash, or both),
  cleanup now signals the whole process group — not just the supervisor
  process — and confirms via a portable, non-`/proc` `kill(2)` probe
  (`isProcessGroupAlive`) that no group member survives before reporting the
  session cleaned up. Previously an already-exited or individually-killed
  supervisor could leave a same-group Chrome orphaned and alive while its
  session record was marked fully cleaned up. Defensive hardening only (issue
  #29, deferred from #28); no behavior change on the normal startup path, no
  feature flag. The already-exited branch is documented as an accepted,
  bounded pid-reuse residual (Node/libuv can reap before we observe the
  exit, so a verified identity is not obtainable there by the issue's own
  premise) and now pre-checks `isProcessGroupAlive` before signaling so a
  fully vacated group is never blindly signaled.
- Centralized session lifecycle composition in core and routed dead-session
  reaping through typed desktop, Android, and browser teardown owners, removing
  duplicate CLI/MCP orchestration and core PID/profile stop implementations.
- Added one verified run catalog for deterministic discovery, directory-manifest
  identity binding, corrupt-entry handling, and symlink-safe root-file reads
  across core retention, CLI artifacts, and MCP tools/resources.
- Centralized CLI provisioning policy for plan classification, consent,
  dry-runs, ordered preflight failures/skips, adapter-owned sudo routing,
  cancellation, redacted presentation plans, and partial results.
- Added `packages/cli/src/provision/askpass.ts`, a pure four-state capability
  detector (`available`/`no-helper`/`headless`/`unsupported-platform`)
  implementing the "Shared graphical sudo (askpass) security contract —
  locked v1" shared with pickforge/pickforge#215/#258
  (`crates/pickforge-core/src/process/askpass.rs`); wired it into the
  provisioning executor's privileged-step materialization (`sudo -A` +
  `SUDO_ASKPASS`, arg-array only) and into `setup lab-user`/`doctor
  --fix`/`init`. sudo-level denial/cancellation (detected from sudo's own
  `sudo:`-prefixed diagnostics, never prompt text) now surfaces as a distinct
  `cancelled` executor status instead of a generic failure.
- Added a framing-aware DevTools NDJSON relay with protocol validation,
  backpressure, bounded diagnostics, redacted failures, and evidence hooks.
- Added the human-lease/agent-permit storage primitives backing supervised
  takeover (`packages/core/src/takeover.ts`): an atomic (`wx`) `human.lease.json`
  per session directory, short-lived per-action agent permit files under
  `permits/`, and a fail-closed `withAgentPermit` (acquire permit → recheck
  lease → execute only if clear → release in `finally`). Lease acquisition
  publishes the lease before draining permits that predate it (sweeping ones
  owned by a dead process), so writable VNC is never granted while an agent
  action from before the lease could still be in flight. Staleness is
  identity-or-TTL based (`isHumanLeaseStale`); a second live acquisition
  attempt fails fast (`HumanLeaseHeldError`, one winner, no queueing). Desktop-
  linux's `takeover.ts` (`startHumanTakeover`/`endHumanTakeover`/
  `renewHumanTakeover`/`recoverStaleHumanLease`) layers VNC-mode switching,
  fresh-screenshot capture, and lifecycle evidence (`takeover_start`/
  `takeover_return`/`takeover_timeout`/`takeover_cancelled`/
  `takeover_recovered`) on top; `ensureSessionVnc` (plain `watch`) now
  self-heals a crash-orphaned writable VNC left by a stale lease instead of
  refusing outright, while still refusing while a live lease holds it. The
  DevTools relay gained a generic NDJSON `intercept` hook (answers a request
  directly on the response stream instead of forwarding it to the child) used
  for the same busy-error contract; its writes are funneled through a shared
  write queue (`createJsonRpcWriteQueue`) alongside the normal child-response
  pump so a busy rejection and an in-flight forwarded response can never
  interleave on the wire. A blocked relay request is not recorded as an
  evidence action, unlike a blocked MCP desktop-input tool call — the relay
  has no equivalent per-call evidence lifecycle to hook.
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
- New `askpass.test.ts` (capability detection: headless/graphical, user-set
  vs. probe-list priority, empty-value handling, Linux/non-Linux gating) and
  an extended `executor.test.ts` "privileged execution via graphical sudo"
  suite (materialization to `sudo -A` + `SUDO_ASKPASS`, env-propagation
  proving only that key is added, arg-array safety for hostile argv,
  preflight failure for each non-available capability state, sudo
  cancellation/denial via a stand-in `sudo` script surfacing a distinct
  `cancelled` status with no retry, and redaction of a planted secret in a
  sudo denial message). Extended `cli.test.ts` with real end-to-end coverage
  routing `setup lab-user`/`init --create-lab-user` through a fake graphical
  `sudo -A` + `SUDO_ASKPASS` helper, plus platform-appropriate manual-fallback
  assertions for the no-session/no-helper/non-Linux cases. The
  happy-path/cancellation `cli.test.ts` cases that need a real Linux
  graphical-session capability are `skipIf(process.platform !== "linux")`
  (this dev sandbox is macOS); they run in full on Linux CI.
  Real `sudo -A -v` hardware smoke (a live graphical prompt, not a stand-in)
  is not covered here and is deferred to a real Linux desktop.
- `bun run test` — same pre-existing failure set as unmodified `main`,
  verified test-by-test against `main` on this branch's (macOS) dev sandbox.
  These are platform-environment failures, not specific to this change; on
  CI's Linux runners this class does not apply. At least three distinct
  causes, none `/proc`-only as previously stated here:
  process-identity/Xvfb/x11vnc verification (Darwin has no `/proc`; most of
  the count), a macOS tmpdir realpath mismatch (`/var` vs `/private/var`,
  e.g. `run-catalog.test.ts`'s root-precedence test and
  `devtools-mcp.test.ts`'s package-root assertion), and inline-screenshot/CDP
  association mismatches in `devtools-evidence.test.ts`.
- New `proc.test.ts` `isProcessGroupAlive` coverage, including a real
  spawned-leader-killed-with-a-surviving-member regression case, and a new
  `packages/browser/test/pre-identity-cleanup.test.ts` with two integration
  regressions (mocked `readProcessIdentity`/`startXvfb`, real fake-Chrome
  subprocess): a live-supervisor case (identity read never resolves) and a
  missing-supervisor case (a stand-in supervisor exits immediately after
  spawning Chrome, exercising `stopOwnedBrowserDaemon`'s already-exited
  branch). Both prove a live Chrome left behind is actually killed, not just
  reported clean; verified both fail against the pre-fix code and pass
  against the fix. The missing-supervisor case captures Chrome's pid
  synchronously from its own `spawn()` return rather than waiting on Chrome's
  script to self-report, after the wait-based version proved flaky under a
  fully parallel `bun run test` on this dev sandbox; the live-supervisor case
  still depends on Chrome's own self-reported marker (unavoidable without
  changing production code) and can occasionally need extra wall-clock time
  under the same full-parallel load — a scheduling artifact, not a logic
  defect, and it stays within the pre-existing 43-45 Darwin noise band above.
- New `core/test/takeover.test.ts` (15 tests): atomic lease acquisition/
  staleness/renewal/release, permit drain (including sweeping a permit owned
  by a dead process), `withAgentPermit` fail-closed and mid-flight-
  invalidation behavior, `getTakeoverStatus`, and a real separate-process
  (`bun`-spawned) race proving two concurrent lease claims yield exactly one
  winner.
- New `desktop-linux/test/takeover.test.ts` (11 tests): end-to-end
  start/end-takeover VNC mode switching against real spawned fake-x11vnc
  processes and real port listening (only the two `/proc`-dependent identity
  functions are mocked, following `destroy.test.ts`'s existing pattern, so
  this runs on Darwin too) — asserts the exact `-viewonly` flag sequence,
  evidence transitions, lease renewal/expiry, crash recovery (stale lease +
  orphaned writable VNC), and `ensureSessionVnc`'s self-heal vs. still-refuse-
  while-live-lease branches. Real x11vnc/Xvfb hardware validation deferred.
- New `browser/test/ndjson.test.ts` and `devtools-mcp.test.ts` intercept
  coverage: diversion to `interceptDestination` without invoking `hook` or
  forwarding to the child, the `interceptDestination` requirement, an
  end-to-end relay test proving an intercepted `tools/call` never reaches the
  spawned child process, and `createTakeoverBusyIntercept` unit coverage
  (blocks only `tools/call` with an id while a live lease exists; passes
  through notifications, other methods, and once the lease clears).
- New `cli/test/watch-control.test.ts` (5, mocked desktop-linux takeover
  functions), `cli/test/takeover-status.test.ts` (3), and
  `cli/test/desktop-input-takeover.test.ts` (1, proves the CLI rejects
  desktop input without ever invoking `xdotool` while a lease is held) —
  cover `--control`'s reason selection (return/cancelled/timeout), the
  `--control` + `waitForViewerExit: false` guard, and the no-viewer-available
  path.
- New `mcp-server/test/takeover.test.ts` (3): `takeover_status` across
  agent-active/human-active/stale, and `desktop_click`/`desktop_type`/
  `desktop_key` failing closed with the busy error while a lease is held,
  using a synthetic session record (no real Xvfb/xdotool needed for the
  fail-closed path).
- `bun run build`

### Not tested yet

- `bun run test:coverage` on a machine where the full suite runs clean (this
  dev sandbox can't produce a coverage summary because the pre-existing
  Darwin-only failures above stop the process before the v8 coverage
  provider flushes it — reproduced identically on unmodified `main`).
- Platform smoke checks outside Linux.
- Real `sudo -A -v` graphical-prompt smoke on a live Linux desktop (approve
  and cancel) — the automated suite covers this with a stand-in `sudo`/
  askpass-path script per test, never a real graphical prompt; a real-desktop
  smoke is deferred.
- Live remote SSH-tunnel smoke test.
- Tag-triggered npm publish and draft-release creation (runs only after merge and
  tag push).
- Live supervised takeover proof on real hardware: a genuine `picklab watch
  --control` against real Xvfb/x11vnc, taking control in an actual VNC
  viewer, typing, and returning control, on a Linux desktop. All takeover
  logic is proven with real spawned processes and real port listening except
  the two `/proc`-only identity checks (mocked identically to the existing
  `destroy.test.ts` pattern); this is a hardware/CI gap, not a logic gap.
- A bare `kill -TERM <picklab-pid>` (not the whole foreground process group)
  arriving while a real interactive VNC viewer window is still open: the
  takeover's SIGTERM handler marks the session for a "cancelled" reason but
  cannot itself close the already-open viewer (`openVncViewer`'s API has no
  cancel handle), so cleanup only runs once the viewer exits on its own or a
  process-group-wide SIGINT (the normal terminal Ctrl+C path, which reaches
  the viewer child directly) closes both. Documented, not implemented;
  extending `openVncViewer` with a cancel handle is a reasonable follow-up.

### Release blockers

- None known.
