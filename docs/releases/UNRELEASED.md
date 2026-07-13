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
- `picklab watch [--session <id>]` now lazily attaches a supported host VNC
  client to any running desktop-capable session. The server remains
  loopback-only and read-only; closing the viewer leaves VNC, Xvfb, and the
  session running. Zero/ambiguous session selection fails with actionable
  guidance, and headless/missing-client hosts receive the endpoint plus
  install and SSH-tunnel instructions without opening a window.
- Viewer launch defaults to `viewer.mode: "manual"` and can be set to `"auto"`
  in global/project config. `session create --viewer` and `--no-viewer` are
  one-shot overrides. Creation returns after the client starts instead of
  waiting for its window to close, reports attach failures alongside the
  created session, rejects explicit viewer plus writable VNC, and suppresses
  auto-viewing for writable VNC. MCP status and session resources report
  viewer endpoint/readiness but never launch a host GUI.
- New static `picklab-browser` agent entry runs `picklab browser devtools-mcp`.
  It discovers exactly one live browser session for the current project on
  every connection, so browser recreation needs no endpoint config changes.
  The command does not accept a browser URL or websocket endpoint.

## Internal/release changes

- Stabilized the browser Xvfb cancellation regression test by waiting for the
  fake process's complete PID/display marker instead of treating file creation
  as publication. This removes the full-suite/coverage race that could abandon
  the in-flight create and cascade into a misleading ownership-handoff failure.
- Strengthened `redactSecrets` (pickforge/picklab#20): Cookie/Set-Cookie
  values pair by pair, including balanced double/single-quoted values and
  apostrophes in unquoted values, while cookie attributes like
  `Path`/`SameSite` and XML/JSON embedding delimiters survive; complete
  `Authorization:` header credentials for any scheme (Basic, Bearer, and
  Digest with quoted parameters); bare JWTs; credential-bearing URL query
  values (`token`/`session`/`code`/`auth`-like names); semicolon path
  parameters such as `;jsessionid=...`; bare `session`/`sessionId`
  assignments and JSON fields (session-adjacent metadata like `sessionCount`
  untouched); OTP/CSRF assignments; and Chrome DevTools websocket capability
  URLs/GUID paths. Existing consumers (logcat, ui-tree, MCP resources, relay
  diagnostics, telemetry) pick this up automatically.
- Added fail-closed structured evidence sanitizers to
  `@pickforge/picklab-core` (`evidence-sanitize.ts`) for the upcoming
  computer-use evidence journal: `sanitizeUrlForEvidence` (origin + path
  only, semicolon path parameters stripped, `blob:` URLs reduced to
  `blob:` + inner origin), `sanitizeErrorText` (redacted then bounded), `sanitizeTypedValue`
  (length + allowlisted input type only), `sanitizeActionTarget` (per-field
  allowlist; unknown fields dropped), and `sanitizeNetworkFailure`
  (method/origin-path/status/resource type/timing/sanitized error only —
  never headers, bodies, or query). No runtime consumers yet beyond the
  strengthened redaction.
- Added a dormant computer-use evidence storage foundation to
  `@pickforge/picklab-core` (no producers wired yet). New `evidence.ts` provides
  a session-scoped active-run pointer claimed with an atomic `wx` protocol. The
  winner stamps a claim carrying its verifiable owner identity (PID +
  `/proc` start ticks) at creation time, then creates the run and atomically
  publishes (temp + rename) the full pointer over its own claim, confirming it is
  the published owner before returning; racing peers adopt the single winner's
  run and never steal a claim from a live owner (only a provably dead owner, or
  an owner-unknown empty claim past a short grace, is reclaimed), so no orphan
  run dirs result. If run creation succeeds but publication/verification fails,
  the just-created run is finalized (`failed`) so no permanent running orphan is
  left. Pointer resolution classifies a `running` run whose recorded owner is
  dead or PID-reused as stale/recoverable rather than active. The append-only
  `actions.jsonl` journal uses a recoverable owner-stamped cross-process lock to
  serialize torn-tail repair, cap accounting, and one verified `O_APPEND` write
  per bounded record (never rewriting the manifest); reads are deterministic and
  tolerate only a torn final line, which the next append removes before writing.
  A 100 MiB per-run cap is enforced cumulatively
  from the run's real on-disk bytes (journal + artifacts, symlinks never
  followed), so it holds across many appends and processes; it emits exactly one
  truncation marker after which bounded metadata-only actions continue. That
  marker uses the same recoverable-claim protocol as the pointer: the atomic
  `wx` sentinel winner stamps its owner identity, appends the marker, then
  atomically commits the sentinel (temp + rename). A crash or append failure
  between claim and commit no longer blocks truncation forever — a provably dead
  or owner-unknown claim is re-raced (checking the journal first so a marker a
  prior writer already committed is never duplicated), and an append error clears
  its own claim; a committed sentinel stays idempotent. A retention primitive
  keeps the latest 20
  finalized evidence runs, binding every removal to the directory a manifest
  physically lives in and re-verifying that manifest immediately before `rm`, so
  a spoofed or corrupt `runId` can never redirect a deletion at a running or
  another run's directory; running/active and legacy runs are never pruned.
  `RunManifest` gained optional, backward-compatible `evidenceVersion`,
  `actionLog`, and `evidenceTruncated` fields; `createRun({ evidence: true })`
  stamps them and seeds the empty journal, so plain screenshot runs are
  unaffected. Config resolution gained `evidence.enabled` (product
  configuration, default true) via `isEvidenceEnabled`. No MCP or DevTools relay
  instrumentation is included.
- Hosted CI now installs `x11vnc` alongside the other desktop test
  dependencies, and the desktop-linux integration suite asserts `x11vnc` is
  present when `CI=true` so VNC tests fail loudly instead of silently
  skipping on a misconfigured runner.
- Added browser session contracts to `@pickforge/picklab-core`: a `browser`
  session type with `BrowserSessionInfo`, capability-based session resolution
  (`SessionCapability`, `sessionHasCapability`), and verified process-group stop
  primitives (`stopProcessGroupVerified`, `processIdentityMatches`, and friends)
  wired into the session reaper and the CLI/MCP browser lifecycle.
- Browser reaping now confirms the recorded browser process group is gone
  before stopping VNC/Xvfb helpers or deleting the session record. Reused or
  otherwise unconfirmed groups leave dependent helpers and profile data intact
  and mark the record as errored for inspection.
- Lazy VNC now persists process-start identity and shares a per-session mutation
  lock with desktop/browser destruction. Reuse, status, teardown, and reaping
  fail closed for missing or reused identities without signaling unrelated
  processes.
- `startXvfb` gained an additive `displayStart` option so browser sessions use
  displays from `:200` without contending with desktop sessions from `:90`.
- Added internal `@pickforge/picklab-browser`, owning Chrome/Chromium detection,
  a private Xvfb, ephemeral profile, dynamic loopback CDP discovery, scrubbed
  environment, PID-identity process-group teardown, status, retryable
  partial-failure cleanup, and concurrent-session safety. The DevTools websocket
  path/GUID is never persisted.
- Added an exact direct dependency on `chrome-devtools-mcp@1.5.0`. PickLab
  validates its installed manifest name, version, declared bin, and confined
  real path, then starts that bin directly with Node and a derived loopback
  `--browser-url`; runtime `npx`, upstream update checks, and usage statistics
  are disabled.
- Added a framing-aware bidirectional NDJSON relay with protocol validation,
  arbitrary chunk buffering, exact raw-byte preservation when hooks do not
  transform a message, request/response hooks for follow-up coordination,
  backpressure, EOF/signal forwarding, bounded hung-child cleanup, exit
  propagation, and redacted stderr-only diagnostics. Pending JSON-RPC records
  are capped at 16 MiB and diagnostic lines at 64 KiB. The implementation uses
  a local typed deferred helper rather than newer runtime Promise APIs, keeping
  the upstream-compatible Node 20.19 floor.
- CI and release workflows pin Node `20.19.0`, the advertised minimum that
  exercises the relay and upstream package contract.
- The canonical installer enforces the same supported Node branches:
  `^20.19`, `^22.12`, or `>=23`.
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
  destroy, destroy-all, complete session-directory removal, profile removal, and
  environment scrubbing.
- Final full coverage suite: 63 files, 705 passed / 2 skipped, all thresholds met.
- Real built-CLI Chrome proof covered create, running status, visible typing and
  navigation, screenshot inspection, and destroy; Chrome, Xvfb, the ephemeral
  profile, session logs, and the session record were removed. Persisted Chrome
  logs contained no DevTools websocket capability URL.
- `bun run typecheck` and `bun run build` pass after rebasing watch onto the
  browser lifecycle. The full suite passes 65 files / 737 tests with 2 skipped.
- Focused browser/core/desktop/CLI/MCP/security validation passes 232 tests in
  18 files. Coverage includes browser create/status/destroy, lazy VNC teardown
  after verified Chrome-group termination, deterministic ensure/destroy race
  ordering, stale-lock breakers, VNC process-identity reuse refusal, profile
  confinement, environment scrubbing, manual/auto viewer config,
  zero/ambiguous/headless watch behavior, process-safe VNC reuse and endpoint
  ownership, asynchronous viewer launch, explicit nonzero/signal failure,
  attach-failure reporting, JSON stdout isolation, browser viewer/status
  integration, MCP status-only behavior, and secret redaction.
- Real x11vnc + TigerVNC proof attached a host viewer to the isolated display,
  confirmed server-enforced `-viewonly`, and verified that closing the viewer
  left the PickLab session, VNC server, and Xvfb running.
- Relay slice: `bun run typecheck` and `bun run build` pass. The final focused
  browser relay, CLI, and installer command passed 17 files / 161 tests. After
  rebasing onto live watch and applying the final review fix, the integrated
  full suite passes 70 files / 780 tests with 2 skipped.
  Coverage includes exact package/bin/spawn validation, bounded NDJSON and
  diagnostic fragmentation, transformations, protocol fail-closed behavior,
  IDs/order/cancellation, backpressure, clean/forced exit races, stubborn
  child-process errors with held stdin and verified SIGKILL cleanup, genuine
  spawn failures with no `exit` event, EOF/signals/hung cleanup, real open-stdin
  CLI exit 137 after escalation,
  stderr purity, session scoping, static agent entries, installer Node-version
  boundaries, required-browser CI prerequisite enforcement, and operation
  without native `Promise.withResolvers`.
- A real headed-Chrome + exact upstream `chrome-devtools-mcp@1.5.0` smoke
  navigated a local page and verified accessibility snapshot, console, and
  network metadata through the built `picklab browser devtools-mcp` command.
  The existing real-Chrome lifecycle integration also passed (3 tests).
- Xvfb cancellation regression: 60 focused iterations and 12 parallel
  browser + desktop-linux suite iterations pass with a deliberately split
  fake startup-marker publication; the browser session suite (25 tests) and
  `bun run typecheck` pass.

- Evidence storage foundation: `bun run typecheck`, `bun run build`, and the
  full suite pass (73 files, 895 passed / 2 skipped). New core coverage
  (`evidence.ts` 90.97% lines / 83.03% branches / 97.43%
  functions) includes real separate-process concurrent appenders losing zero
  actions, a real separate-process begin race resolving to one run with no orphan
  dirs, an in-process pointer race, a deliberately slow live-winner race proving
  a live claimer is never stolen, stale/corrupt/dead-owner pointer recovery,
  empty- and dead-claim reclaim, injected pointer-publication failure finalizing
  the just-created run, bounded-line rejection, verified full-write behavior,
  dead-owner journal-lock recovery, and torn-tail repair before the next append,
  cumulative on-disk cap/truncation determinism with injected limits (no 100 MiB
  allocation), and — for the durable truncation marker — injected marker-append
  failure preserving the committed action without inviting a duplicate retry,
  then clearing its claim and recovering; dead-owner and owner-unknown
  (empty) sentinel reclaim, no-duplicate recovery when a prior claim already
  committed the marker, sentinel-commit failure keeping the marker durable,
  committed-sentinel idempotency, a live marker-claim never stolen by a racing
  peer, and separate-process coverage proving exactly one marker across four
  contending processes plus recovery after a process crashes mid-claim.
  Retention of 20 finalized runs while preserving running/active/legacy and
  resisting spoofed-`runId`/fake-inflation manifests, and old-manifest list/read
  compatibility, are also covered. `bun run test:coverage` passes global
  thresholds.

### Not tested yet

- Platform smoke checks outside Linux.
- Live hosted CI run with `x11vnc` actually installed (validated locally via
  fake binaries and a `CI=true` dry run only).
- Live remote SSH-tunnel smoke test.

### Release blockers

- None known for the DevTools relay slice.
