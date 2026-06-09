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

- [ ] Create a TypeScript monorepo in the PickLab repo.
- [ ] Add `packages/cli` for the `picklab` command.
- [ ] Add `packages/mcp-server` for `picklab-mcp` and `picklab mcp serve`.
- [ ] Add `packages/core` for config, sessions, artifacts, manifests, and process supervision.
- [ ] Add `packages/desktop-linux` for Xvfb/VNC/window/input/screenshot automation.
- [ ] Add `packages/android` for AVD, emulator, ADB, UIAutomator, screenshot, and logcat orchestration.
- [ ] Add `packages/agent-installers` for Codex, Claude Code, Cursor, and custom agent registration.
- [ ] Publish package as `@pickforge/picklab`, exposing `picklab` and `picklab-mcp` binaries.
- [ ] Use `$PICKLAB_HOME` when set, otherwise default to `~/.picklab`.
- [ ] Store project config in `.picklab/config.json`.
- [ ] Store run artifacts in `.picklab/runs/<timestamp>-<slug>/`.

## Provisioning Model

PickLab should own stable, isolated lab identities instead of borrowing random local resources.

- [ ] During `picklab init`, prompt to create missing dedicated resources.
- [ ] During `picklab doctor`, detect and repair missing dedicated resources.
- [ ] Ensure MCP tools never create privileged system resources implicitly.
- [ ] Add non-interactive mode with `--yes --create-lab-user --create-avd`.
- [ ] Make non-interactive provisioning fail closed when required permissions or dependencies are missing.

### Dedicated Android Emulator

- Default AVD name: `picklab-avd`

- [ ] Add `picklab setup android --create-avd picklab-avd`.
- [ ] Detect Android SDK location.
- [ ] Detect `sdkmanager`, `avdmanager`, `emulator`, and `adb`.
- [ ] Detect available Android system images.
- [ ] Detect hardware acceleration support.
- [ ] Create `picklab-avd` when dependencies are available and the user approves.
- [ ] If a system image is missing, print the exact `sdkmanager` command required.
- [ ] Persist the selected AVD name in PickLab config.
- [ ] Use `picklab-avd` by default for Android sessions.

### Dedicated Linux Lab User

- Default user: `picklab-lab`
- Default home: `/var/lib/picklab/lab-home`
- User type: locked service user, no password, no login shell, no sudo.

- [ ] Add `picklab setup lab-user --name picklab-lab`.
- [ ] Detect whether `picklab-lab` already exists.
- [ ] Create the user only after explicit prompt or `--yes`.
- [ ] Create `/var/lib/picklab/lab-home` with restrictive ownership and permissions.
- [ ] Assign only required runtime groups after detection, such as `kvm`.
- [ ] Run desktop lab processes as `picklab-lab`.
- [ ] Prevent MCP tools from invoking sudo or creating users.
- [ ] Persist the selected lab username and home path in PickLab config.

## CLI Interface

- [ ] Implement `picklab doctor`.
- [ ] Implement `picklab init --profile flutter-desktop|android|desktop+android|generic`.
- [ ] Implement `picklab setup lab-user --name picklab-lab`.
- [ ] Implement `picklab setup android --create-avd picklab-avd`.
- [ ] Implement `picklab session create --type desktop|android|desktop+android`.
- [ ] Implement `picklab session status`.
- [ ] Implement `picklab session destroy`.
- [ ] Implement `picklab desktop launch`.
- [ ] Implement `picklab desktop screenshot`.
- [ ] Implement `picklab desktop click`.
- [ ] Implement `picklab desktop type`.
- [ ] Implement `picklab desktop key`.
- [ ] Implement `picklab android start`.
- [ ] Implement `picklab android install-apk`.
- [ ] Implement `picklab android launch-app`.
- [ ] Implement `picklab android screenshot`.
- [ ] Implement `picklab android tap`.
- [ ] Implement `picklab android type`.
- [ ] Implement `picklab android back`.
- [ ] Implement `picklab android home`.
- [ ] Implement `picklab android ui-tree`.
- [ ] Implement `picklab android logcat`.
- [ ] Implement `picklab android adb`.
- [ ] Implement `picklab artifacts list`.
- [ ] Implement `picklab artifacts open`.
- [ ] Implement `picklab artifacts report`.
- [ ] Implement `picklab mcp serve`.
- [ ] Implement `picklab agents list`.
- [ ] Implement `picklab agents install`.
- [ ] Implement `picklab agents link`.
- [ ] Implement `picklab agents unlink`.
- [ ] Implement `picklab agents doctor`.

## MCP Interface

MCP is the primary agent interface. Skills and prompts help the agent use PickLab well, but they do not replace the execution engine.

- [ ] Expose MCP tools with JSON schemas matching the CLI behavior.
- [ ] Add `session_create`.
- [ ] Add `session_status`.
- [ ] Add `session_destroy`.
- [ ] Add `desktop_launch`.
- [ ] Add `desktop_screenshot`.
- [ ] Add `desktop_click`.
- [ ] Add `desktop_type`.
- [ ] Add `desktop_key`.
- [ ] Add `android_start`.
- [ ] Add `android_install_apk`.
- [ ] Add `android_launch_app`.
- [ ] Add `android_screenshot`.
- [ ] Add `android_tap`.
- [ ] Add `android_type`.
- [ ] Add `android_back`.
- [ ] Add `android_home`.
- [ ] Add `android_get_ui_tree`.
- [ ] Add `android_logcat`.
- [ ] Add `android_run_adb`.
- [ ] Add `artifact_list`.
- [ ] Add `artifact_report`.
- [ ] Expose `picklab://runs`.
- [ ] Expose `picklab://runs/{runId}/manifest`.
- [ ] Expose `picklab://runs/{runId}/screenshots/{name}.png`.
- [ ] Expose `picklab://runs/{runId}/logs/{name}`.
- [ ] Expose `picklab://sessions/{sessionId}/status`.
- [ ] Add prompt `test-flutter-desktop-visually`.
- [ ] Add prompt `debug-android-apk`.
- [ ] Add prompt `run-visual-regression-check`.

## Installer + Agent Integration

- [ ] Support `curl -fsSL https://pickforge.dev/picklab/install.sh | sh`.
- [ ] Support `npx -y @pickforge/picklab init`.
- [ ] Support `bunx @pickforge/picklab init`.
- [ ] Create shared agent config under `~/.picklab/agents/`.
- [ ] Generate MCP config snippets using `picklab mcp serve`.
- [ ] Symlink or register Codex config when possible.
- [ ] Symlink or register Claude Code config when possible.
- [ ] Symlink or register Cursor config when possible.
- [ ] Support custom agents with `picklab agents add --name <name> --mcp-command "picklab mcp serve"`.
- [ ] Back up existing agent config before modifying it.
- [ ] Add `picklab agents doctor` checks for broken symlinks and stale config.

## Branding

Brand source of truth: `/home/dev/Projects/Pickforge/branding-visual/`.

- [ ] Follow the Pickforge dark/ember visual system.
- [ ] Create a PickLab mark: 128x128 rounded square, dark surface, off-white brackets, one ember dot, restrained lab/viewport glyph.
- [ ] Create `picklab-mark-128.svg`.
- [ ] Create `picklab-app-icon.svg`.
- [ ] Create `picklab-favicon.svg`.
- [ ] Create `picklab-lockup-horizontal.svg`.
- [ ] Create `picklab-og-image.svg`.
- [ ] Export required PNG and ICO variants.
- [ ] Add README header visual using PickLab assets.
- [ ] Write README with install and usage first.
- [ ] Avoid README badges and emojis.
- [ ] Add a visual mock titled `PICKLAB · RUN LAB`.
- [ ] Show desktop session, Android emulator, live screenshots, logs, and agent terminal in the mock.

## Testing

- [ ] Add unit tests for config loading and precedence.
- [ ] Add unit tests for provisioning plans.
- [ ] Add unit tests for command argument building.
- [ ] Add unit tests for run manifest writing.
- [ ] Add unit tests for MCP schemas.
- [ ] Add dry-run tests for `picklab init`.
- [ ] Add dry-run tests for `picklab doctor`.
- [ ] Add dry-run tests for `picklab setup lab-user`.
- [ ] Add dry-run tests for `picklab setup android`.
- [ ] Add Linux integration test that runs an Xvfb desktop session.
- [ ] Add Linux integration test that launches a tiny GUI app.
- [ ] Add Linux integration test for click, type, screenshot, and report output.
- [ ] Add Android integration test that creates or reuses `picklab-avd`.
- [ ] Add Android integration test for boot, screenshot, tap, UI tree, and logcat.
- [ ] Add installer tests for `npx`.
- [ ] Add installer tests for `bunx`.
- [ ] Add installer tests for global home creation.
- [ ] Add installer tests for symlink behavior.
- [ ] Add installer tests for non-interactive fail-closed behavior.
- [ ] Add security tests proving MCP tools do not invoke sudo.
- [ ] Add security tests proving user inputs are spawned as argument arrays, not shell strings.
- [ ] Add security tests proving artifacts do not contain secrets by default.

## Assumptions

- [ ] MVP remains Linux + Android only.
- [ ] Desktop MVP targets X11/Xvfb first.
- [ ] Wayland-native support is post-MVP.
- [ ] macOS support is post-MVP.
- [ ] Windows support is post-MVP.
- [ ] PickLab orchestrates installed Android SDK/emulator tools and does not bundle them.
- [ ] Dedicated resources use `picklab-lab` and `picklab-avd` by default.
- [ ] The installer may prompt for privileged setup, but MCP tools must not perform privileged setup.

