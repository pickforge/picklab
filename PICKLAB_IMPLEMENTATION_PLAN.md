# PickLab Implementation Plan

## Summary

PickLab gives AI coding agents eyes, hands, and a reproducible lab for native apps.

Positioning:

- Product name: PickLab
- Tagline: Playwright for native apps and Android emulators.
- Strategic line: PickForge builds the app. PickLab lets agents see, run, and test it. PickArena measures the results.
- MVP scope: Linux desktop sessions plus Android emulator automation.
- Primary stack: TypeScript monorepo with Node-compatible CLI/MCP packages and Bun-friendly development.

## Architecture

- [x] Create a TypeScript monorepo in the PickLab repo.
- [x] Add `packages/cli` for the `picklab` command.
- [x] Add `packages/mcp-server` for `picklab-mcp` and `picklab mcp serve`.
- [x] Add `packages/core` for config, sessions, artifacts, manifests, and process supervision.
- [x] Add `packages/desktop-linux` for Xvfb/VNC/window/input/screenshot automation.
- [x] Add `packages/android` for AVD, emulator, ADB, UIAutomator, screenshot, and logcat orchestration.
- [x] Add `packages/agent-installers` for Codex, Claude Code, Cursor, and custom agent registration.
- [x] Publish package as `@pickforge/picklab`, exposing `picklab` and `picklab-mcp` binaries.
- [x] Use `$PICKLAB_HOME` when set, otherwise default to `~/.picklab`.
- [x] Store project config in `.picklab/config.json`.
- [x] Store run artifacts in `.picklab/runs/<timestamp>-<slug>/`.

## Provisioning Model

PickLab should own stable, isolated lab identities instead of borrowing random local resources.

- [x] During `picklab init`, prompt to create missing dedicated resources.
- [x] During `picklab doctor`, detect and repair missing dedicated resources.
- [x] Ensure MCP tools never create privileged system resources implicitly.
- [x] Add non-interactive mode with `--yes --create-lab-user --create-avd`.
- [x] Make non-interactive provisioning fail closed when required permissions or dependencies are missing.

### Dedicated Android Emulator

- Default AVD name: `picklab-avd`

- [x] Add `picklab setup android --create-avd picklab-avd`.
- [x] Detect Android SDK location.
- [x] Detect `sdkmanager`, `avdmanager`, `emulator`, and `adb`.
- [x] Detect available Android system images.
- [x] Detect hardware acceleration support.
- [x] Create `picklab-avd` when dependencies are available and the user approves.
- [x] If a system image is missing, print the exact `sdkmanager` command required.
- [x] Persist the selected AVD name in PickLab config.
- [x] Use `picklab-avd` by default for Android sessions.

### Dedicated Linux Lab User

- Default user: `picklab-lab`
- Default home: `/var/lib/picklab/lab-home`
- User type: locked service user, no password, no login shell, no sudo.

- [x] Add `picklab setup lab-user --name picklab-lab`.
- [x] Detect whether `picklab-lab` already exists.
- [x] Create the user only after explicit prompt or `--yes`.
- [x] Create `/var/lib/picklab/lab-home` with restrictive ownership and permissions.
- [x] Assign only required runtime groups after detection, such as `kvm`.
- [ ] Run desktop lab processes as `picklab-lab`. (Deferred post-MVP: requires a privileged runtime path. MCP tools must never invoke sudo, and CLI-side uid switching needs a consented privileged design. Provisioning of the user is implemented.)
- [x] Prevent MCP tools from invoking sudo or creating users.
- [x] Persist the selected lab username and home path in PickLab config.

## CLI Interface

- [x] Implement `picklab doctor`.
- [x] Implement `picklab init --profile flutter-desktop|android|desktop+android|generic`.
- [x] Implement `picklab setup lab-user --name picklab-lab`.
- [x] Implement `picklab setup android --create-avd picklab-avd`.
- [x] Implement `picklab session create --type desktop|android|desktop+android`.
- [x] Implement `picklab session status`.
- [x] Implement `picklab session destroy`.
- [x] Implement `picklab desktop launch`.
- [x] Implement `picklab desktop screenshot`.
- [x] Implement `picklab desktop click`.
- [x] Implement `picklab desktop type`.
- [x] Implement `picklab desktop key`.
- [x] Implement `picklab android start`.
- [x] Implement `picklab android install-apk`.
- [x] Implement `picklab android launch-app`.
- [x] Implement `picklab android screenshot`.
- [x] Implement `picklab android tap`.
- [x] Implement `picklab android type`.
- [x] Implement `picklab android back`.
- [x] Implement `picklab android home`.
- [x] Implement `picklab android ui-tree`.
- [x] Implement `picklab android logcat`.
- [x] Implement `picklab android adb`.
- [x] Implement `picklab artifacts list`.
- [x] Implement `picklab artifacts open`.
- [x] Implement `picklab artifacts report`.
- [x] Implement `picklab mcp serve`.
- [x] Implement `picklab agents list`.
- [x] Implement `picklab agents install`.
- [x] Implement `picklab agents link`.
- [x] Implement `picklab agents unlink`.
- [x] Implement `picklab agents doctor`.

## MCP Interface

MCP is the primary agent interface. Skills and prompts help the agent use PickLab well, but they do not replace the execution engine.

- [x] Expose MCP tools with JSON schemas matching the CLI behavior.
- [x] Add `session_create`.
- [x] Add `session_status`.
- [x] Add `session_destroy`.
- [x] Add `desktop_launch`.
- [x] Add `desktop_screenshot`.
- [x] Add `desktop_click`.
- [x] Add `desktop_type`.
- [x] Add `desktop_key`.
- [x] Add `android_start`.
- [x] Add `android_install_apk`.
- [x] Add `android_launch_app`.
- [x] Add `android_screenshot`.
- [x] Add `android_tap`.
- [x] Add `android_type`.
- [x] Add `android_back`.
- [x] Add `android_home`.
- [x] Add `android_get_ui_tree`.
- [x] Add `android_logcat`.
- [x] Add `android_run_adb`.
- [x] Add `artifact_list`.
- [x] Add `artifact_report`.
- [x] Expose `picklab://runs`.
- [x] Expose `picklab://runs/{runId}/manifest`.
- [x] Expose `picklab://runs/{runId}/screenshots/{name}.png`.
- [x] Expose `picklab://runs/{runId}/logs/{name}`.
- [x] Expose `picklab://sessions/{sessionId}/status`.
- [x] Add prompt `test-flutter-desktop-visually`.
- [x] Add prompt `debug-android-apk`.
- [x] Add prompt `run-visual-regression-check`.

## Installer + Agent Integration

- [x] Support `curl -fsSL https://pickforge.dev/picklab/install.sh | sh`.
- [x] Support `npx -y @pickforge/picklab init`.
- [x] Support `bunx @pickforge/picklab init`.
- [x] Create shared agent config under `~/.picklab/agents/`.
- [x] Generate MCP config snippets using `picklab mcp serve`.
- [x] Symlink or register Codex config when possible.
- [x] Symlink or register Claude Code config when possible.
- [x] Symlink or register Cursor config when possible.
- [x] Support custom agents with `picklab agents add --name <name> --mcp-command "picklab mcp serve"`.
- [x] Back up existing agent config before modifying it.
- [x] Add `picklab agents doctor` checks for broken symlinks and stale config.

## Branding

Brand source of truth: `/home/dev/Projects/Pickforge/branding-visual/`.

- [x] Follow the Pickforge dark/ember visual system.
- [x] Create a PickLab mark: 128x128 rounded square, dark surface, off-white brackets, one ember dot, restrained lab/viewport glyph.
- [x] Create `picklab-mark-128.svg`.
- [x] Create `picklab-app-icon.svg`.
- [x] Create `picklab-favicon.svg`.
- [x] Create `picklab-lockup-horizontal.svg`.
- [x] Create `picklab-og-image.svg`.
- [x] Export required PNG and ICO variants.
- [x] Add README header visual using PickLab assets.
- [x] Write README with install and usage first.
- [x] Avoid README badges and emojis.
- [x] Add a visual mock titled `PICKLAB · RUN LAB`.
- [x] Show desktop session, Android emulator, live screenshots, logs, and agent terminal in the mock.

## Testing

- [x] Add unit tests for config loading and precedence.
- [x] Add unit tests for provisioning plans.
- [x] Add unit tests for command argument building.
- [x] Add unit tests for run manifest writing.
- [x] Add unit tests for MCP schemas.
- [x] Add dry-run tests for `picklab init`.
- [x] Add dry-run tests for `picklab doctor`.
- [x] Add dry-run tests for `picklab setup lab-user`.
- [x] Add dry-run tests for `picklab setup android`.
- [x] Add Linux integration test that runs an Xvfb desktop session.
- [x] Add Linux integration test that launches a tiny GUI app.
- [x] Add Linux integration test for click, type, screenshot, and report output.
- [x] Add Android integration test that creates or reuses `picklab-avd`.
- [x] Add Android integration test for boot, screenshot, tap, UI tree, and logcat.
- [x] Add installer tests for `npx`.
- [x] Add installer tests for `bunx`.
- [x] Add installer tests for global home creation.
- [x] Add installer tests for symlink behavior.
- [x] Add installer tests for non-interactive fail-closed behavior.
- [x] Add security tests proving MCP tools do not invoke sudo.
- [x] Add security tests proving user inputs are spawned as argument arrays, not shell strings.
- [x] Add security tests proving artifacts do not contain secrets by default.

## Assumptions

- [x] MVP remains Linux + Android only.
- [x] Desktop MVP targets X11/Xvfb first.
- [x] Wayland-native support is post-MVP.
- [x] macOS support is post-MVP.
- [x] Windows support is post-MVP.
- [x] PickLab orchestrates installed Android SDK/emulator tools and does not bundle them.
- [x] Dedicated resources use `picklab-lab` and `picklab-avd` by default.
- [x] The installer may prompt for privileged setup, but MCP tools must not perform privileged setup.

