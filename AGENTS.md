# AGENTS

Repo-local guide for agents working in PickLab.

## Commands

- Install: `bun install --frozen-lockfile`
- Typecheck: `bun run typecheck`
- Test (all): `bun run test`
- Test (one file): `bun run test <path/to/file.test.ts>`
- Build bundles: `bun run build`

## Layout

- `packages/core` — sessions, runs, config, redaction, screenshot target resolution.
- `packages/desktop-linux` — Xvfb, VNC, window, input, screenshot builders.
- `packages/android` — adb, emulator/AVD, session lifecycle.
- `packages/cli` — `picklab` CLI commands.
- `packages/mcp-server` — MCP tools and resources over stdio.
- `packages/agent-installers` — agent config installers.

## Invariants

- Never interpolate user input into shell strings; spawn argument arrays.
- Redact secrets (`redactSecrets`) before returning or persisting logs/ui-trees/logcat.
- VNC binds loopback-only (`x11vnc -localhost`) by default.
- MCP resources stay inside run dirs: lexical safe-name checks plus realpath/lstat symlink protection.
- MCP screenshot `out` is confined under the project dir; the CLI `--out` stays unrestricted.
- `android adb` only falls back to a raw, untargeted call when there is no running android session; ambiguous sessions fail closed (exit 1).
- MCP tools never invoke sudo.

## Testing notes

- Tests use `vitest`; CLI tests build the CLI once and spawn it with fake `adb`/SDK scripts on `PATH`.
- Prefer asserting exact argv passed to adb and that planted tokens never leak.
