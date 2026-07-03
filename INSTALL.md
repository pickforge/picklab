# PickLab agent install guide

You are an AI coding agent, and your user asked you to install and configure PickLab: a CLI + MCP server that gives you a reproducible lab for native desktop apps (Xvfb) and Android emulators — screenshots, input, logs, and run artifacts. Linux only for now.

Follow the steps in order. Verify each one before moving on. Rules:

- Never run sudo without telling the user first what the command does.
- Install globally, not into the project. The MCP entry runs `picklab` from PATH.
- If a step fails, stop and show the user the real error — do not improvise workarounds.

## 1. Install the CLI globally

```sh
curl -fsSL https://pickforge.dev/picklab/install.sh | sh
```

Or directly: `npm install -g @pickforge/picklab` (needs Node >= 20) or `bun add -g @pickforge/picklab`. Never with sudo.

Verify:

```sh
command -v picklab && picklab --version
```

If `picklab` is not on PATH, the global bin dir (`npm prefix -g`/bin or `~/.bun/bin`) is missing from PATH — fix the user's shell profile or tell them, don't fall back to a local install.

## 2. Register the MCP server with the agent the user uses

That is probably you. Built-in support:

```sh
picklab agents install codex          # ~/.codex/config.toml
picklab agents install claude-code    # Claude Code
picklab agents install cursor         # Cursor
```

Any other agent gets a stdio server with `command: picklab`, `args: ["mcp", "serve"]`:

```json
{ "mcpServers": { "picklab": { "command": "picklab", "args": ["mcp", "serve"] } } }
```

Verify with `picklab agents list` — the agent must show `registered`.

Important: a running agent session only picks up new MCP servers after a restart. Tell the user the `picklab` tools appear in the *next* session; don't report failure when they are absent from the current one.

## 3. Install system packages (desktop profiles)

Check what is missing:

```sh
picklab doctor
```

For desktop sessions PickLab needs `Xvfb`, `xdotool`, and a screenshot tool (`import` from ImageMagick, or `scrot`). `x11vnc` is optional but recommended — it lets the user watch lab sessions live. These come from the distro package manager and need sudo, so show the user the command and ask before running it:

| Distro | Command |
| --- | --- |
| Debian/Ubuntu | `sudo apt install xvfb xdotool imagemagick x11vnc` |
| Arch | `sudo pacman -S --needed xorg-server-xvfb xdotool imagemagick x11vnc` |
| Fedora | `sudo dnf install xorg-x11-server-Xvfb xdotool ImageMagick x11vnc` |

For Android profiles the user needs an Android SDK with `cmdline-tools`, `platform-tools`, `emulator`, and a system image. `picklab doctor` prints the exact `sdkmanager` command for anything missing.

## 4. Initialize the project

Ask the user which profile fits the app, then run inside the project:

```sh
picklab init --profile <flutter-desktop|android|desktop+android|generic>
```

This writes the project config and plans the provisioning for that profile. It prompts before anything privileged.

## 5. Provision lab resources

Two dedicated resources keep lab workloads off the user's personal account:

- **Lab user** (`picklab-lab`, desktop profiles) — locked system user, created with sudo. Ask the user, then: `picklab setup lab-user`
- **AVD** (`picklab-avd`, Android profiles) — dedicated emulator image, no sudo: `picklab setup android --create-avd`

Both are also offered by `picklab init` for the matching profile and by `picklab doctor --fix`.

## 6. Verify everything

```sh
picklab doctor
```

Every check for the chosen profile must be `[ok]` (`[warn]` is acceptable for optional items like x11vnc and KVM). Then smoke-test a session:

```sh
picklab session create --type desktop   # or android / desktop+android
picklab session status
picklab desktop screenshot
picklab session destroy
```

Finally, remind the user to restart the agent so the `picklab` MCP tools load, and that `session_status` over MCP is the quickest end-to-end check.

## Report back

Tell the user: install location and version, which agent config was updated, which system packages were installed or are still missing, whether the lab user and AVD exist, and the doctor result. Keep it short and honest — unresolved `[missing]` checks are not "non-blockers", they are setup the user still has to approve.
