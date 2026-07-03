<p align="center">
  <img src="https://raw.githubusercontent.com/pickforge/picklab/main/assets/brand/picklab-lockup-horizontal.svg" alt="PickLab" width="560">
</p>

# PickLab

Playwright for native apps and Android emulators. PickLab gives AI coding agents eyes, hands, and a reproducible lab: desktop sessions on Xvfb, Android emulators on a dedicated AVD, screenshots, input, logs, and run artifacts — over a CLI and an MCP server.

PickForge builds the app. PickLab lets agents see, run, and test it. PickArena measures the results.

Local-first. Open source. Built for people who ship.

## Install

Let your coding agent do the whole setup — paste this into its prompt:

```text
Install and configure PickLab by following https://raw.githubusercontent.com/pickforge/picklab/main/INSTALL.md
```

Or install by hand:

```sh
curl -fsSL https://pickforge.dev/picklab/install.sh | sh
```

Or without installing:

```sh
npx -y @pickforge/picklab doctor
bunx @pickforge/picklab doctor
```

Or globally:

```sh
npm install -g @pickforge/picklab
bun add -g @pickforge/picklab
```

This ships two binaries: `picklab` (CLI) and `picklab-mcp` (MCP stdio server). The installer never uses sudo.

## Quickstart

```sh
cd your-app
picklab init --profile desktop+android   # provision lab user + AVD, write project config
picklab doctor                           # verify dependencies; --fix repairs what it can
picklab session create --type desktop+android
picklab desktop launch ./build/your-app
picklab desktop screenshot
picklab android install-apk build/app-release.apk
picklab android launch-app com.example.app
picklab android screenshot
picklab artifacts report                 # render the latest run
picklab session destroy
```

Every screenshot, log, and action lands in `.picklab/runs/<runId>/` with a manifest, so a run is inspectable and reproducible after the fact.

### Concurrent sessions

Each session gets its own isolated display or emulator, so several agents and projects can run labs side by side. When a command or tool is called without an explicit session id, the default resolves per project: only running sessions created for the same project directory are considered. Pass `session` ids (CLI: `--session <id>`) to target a specific lab, including one belonging to another project.

<p align="center">
  <img src="https://raw.githubusercontent.com/pickforge/picklab/main/assets/brand/picklab-run-lab-mock.svg" alt="PICKLAB · RUN LAB — desktop session, Android emulator, live screenshots, logs, and agent terminal" width="900">
</p>

## MCP setup for agents

Register the MCP server with your coding agent:

```sh
picklab agents install claude-code   # also: codex, cursor
picklab agents list
picklab agents doctor
```

For any other agent, add the stdio server yourself:

```json
{
  "mcpServers": {
    "picklab": {
      "command": "picklab",
      "args": ["mcp", "serve"]
    }
  }
}
```

Custom agents can be stored under `~/.picklab/agents`:

```sh
picklab agents add --name my-agent --mcp-command "picklab mcp serve"
```

## CLI reference

| Group | Commands |
| --- | --- |
| Setup | `doctor`, `init`, `setup lab-user`, `setup android` |
| Sessions | `session create`, `session status [id]`, `session destroy [id]` |
| Desktop | `desktop launch <cmd>`, `desktop screenshot`, `desktop click <x> <y>`, `desktop type <text>`, `desktop key <keys>` |
| Android | `android start`, `android install-apk <apk>`, `android launch-app <pkg>`, `android screenshot`, `android tap <x> <y>`, `android type <text>`, `android back`, `android home`, `android ui-tree`, `android logcat`, `android adb [args...]` |
| Artifacts | `artifacts list`, `artifacts open <runId>`, `artifacts report [runId]` |
| Agents | `agents list`, `agents install <agent>`, `agents link <agent>`, `agents unlink <agent>`, `agents doctor`, `agents add` |
| MCP | `mcp serve` |

Session types: `desktop` (Xvfb, optional VNC), `android` (emulator on the dedicated AVD), `desktop+android`. Most commands accept `--json` for machine-readable output and `--project-dir` to target another project.

## MCP surface

`picklab mcp serve` exposes 22 tools over stdio:

- Sessions: `session_create`, `session_status`, `session_destroy`
- Desktop: `desktop_launch`, `desktop_screenshot`, `desktop_click`, `desktop_type`, `desktop_key`
- Android: `android_start`, `android_install_apk`, `android_launch_app`, `android_screenshot`, `android_tap`, `android_type`, `android_back`, `android_home`, `android_get_ui_tree`, `android_logcat`, `android_run_adb`
- Artifacts: `artifact_list`, `artifact_report`
- User: `request_user_input` — ask the human a question (via MCP elicitation when the client supports it) and wait for the answer; never used for secrets

Resources, addressable as `picklab://` URIs:

- `picklab://runs` — recorded runs
- `picklab://runs/{runId}/manifest` — run manifest
- `picklab://runs/{runId}/screenshots/{name}` — screenshots
- `picklab://runs/{runId}/logs/{name}` — logs
- `picklab://sessions/{sessionId}/status` — session liveness

Prompts: `test-flutter-desktop-visually`, `debug-android-apk`, `run-visual-regression-check`.

## Architecture

A TypeScript monorepo. `@pickforge/picklab` is the published package; the rest are internal and bundled into it.

| Package | Role |
| --- | --- |
| `packages/core` | Config, sessions, artifacts, manifests, process supervision |
| `packages/desktop-linux` | Xvfb, VNC, window, input, and screenshot automation |
| `packages/android` | AVD, emulator, ADB, UIAutomator, and logcat orchestration |
| `packages/mcp-server` | MCP tools, resources, and prompts |
| `packages/agent-installers` | Codex, Claude Code, Cursor, and custom agent registration |
| `packages/cli` | The `picklab` and `picklab-mcp` binaries |

## Security model

- MCP tools never invoke sudo. Privileged provisioning happens only through the CLI (`picklab setup lab-user`), with explicit consent (`--yes` or a prompt).
- All user inputs are spawned as argument arrays — never interpolated into shell strings.
- VNC binds to loopback only by default: `x11vnc` is started with `-localhost`, so the server listens on `127.0.0.1` and is not reachable from the network. Tunnel over SSH for remote access.
- Artifacts are redacted by default: logcat output strips tokens and secrets before it is stored or returned. Only `android adb` is raw, and it says so.
- PickLab provisions a dedicated locked lab user (`picklab-lab`) and a dedicated AVD (`picklab-avd`) so lab workloads do not borrow your personal resources. Running session processes under the lab user is planned post-MVP.
- Agent config edits are atomic, with backups of the previous config.

## Development

```sh
bun install
npm run build       # bundle all packages
npm run typecheck
npx vitest run
```

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <a href="https://pickforge.dev">
    <img src="https://raw.githubusercontent.com/pickforge/picklab/main/assets/brand/pickforge-studio-footer.svg" alt="Pickforge Studio — local-first, open source, built for people who ship" width="560">
  </a>
</p>
