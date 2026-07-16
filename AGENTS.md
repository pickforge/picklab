# AGENTS

Repo-local guide for agents working in PickLab.

## Commands

- Install: `bun install --frozen-lockfile`
- Typecheck: `bun run typecheck`
- Test (deterministic): `bun run test`
- Test coverage: `bun run test:coverage`
- Test live Android/emulator: `bun run test:live:android`
- Test (one file): `bun run test <path/to/file.test.ts>`
- Build bundles: `bun run build`
- Write tests in the same PR as behavior changes. For bugs, start with a
  failing regression test when practical. For risky refactors, add
  characterization tests first.
- Do not lower coverage thresholds without explicit maintainer approval.

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
- Keep durable business/domain behavior in existing core/lib packages, not UI
  command wrappers. Do not add DDD ceremony.

## Releasing

- Keep [`docs/releases/UNRELEASED.md`](docs/releases/UNRELEASED.md) current on
  PRs with user-facing or release-relevant changes. Track user-facing changes,
  internal/release changes, what was tested, what was not tested yet, and known
  blockers. At release time, use it to polish the generated GitHub release
  description, then reset the draft.
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
## Workspace policy

For substantial work, read `../AGENTS.md` (workspace root) and use the `plan-issue` workflow — GitHub Issues are the canonical plan/progress tracker.
