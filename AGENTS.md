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

## Releasing

- Bump `packages/cli/package.json` to the new version, land on `main`, tag
  `vX.Y.Z`, push the tag. CI runs the full suite, publishes
  `@pickforge/picklab` to npm, and creates the GitHub release — both go live
  without manual steps, so make sure `main` is truly ready before tagging.
- The GitHub release description is the single source of release notes
  (`--generate-notes` drafts it; edit it after if the generated list reads
  poorly). pickforge.dev/picklab shows the latest release via the GitHub API —
  no website change needed for a normal release.
- Only touch `landing-page` (`src/pages/products.ts`) when the install story
  or positioning changes.
