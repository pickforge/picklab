# Unreleased

Working draft for the next PickLab release. Keep this current while PRs land.
At release time, use it to polish the generated GitHub release description,
then reset this file.

## User-facing changes

- Fatal errors from the `picklab` CLI and `picklab-mcp` server are now reported to Sentry (error message, stack trace, OS and app version only; breadcrumbs dropped, hostname stripped, messages run through `redactSecrets`). Opt out with `PICKLAB_TELEMETRY=0`; documented in README and INSTALL.

## Internal/release changes

- Added repo-local release tracking in `docs/releases/UNRELEASED.md`.
- CLI bundles now emit sourcemaps; the release workflow injects debug IDs and uploads sourcemaps to Sentry on tag builds (skips cleanly until `SENTRY_AUTH_TOKEN` secret exists).

## Validation

### Tested

- Reviewed the release tracking docs.
- `bun run typecheck`, `bun run test` (556 passed), `bun run build`.
- MCP stdio smoke: initialize handshake over the built `picklab-mcp` with telemetry enabled — stdout is pure JSON-RPC.

### Not tested yet

- Sentry event delivery end-to-end (needs a real fatal in a released build).
- npm publish flow with the new sourcemap upload step.

### Release blockers

- None known.
