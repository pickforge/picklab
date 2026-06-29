# Progress

## Status
Complete

## Tasks
- Read audit playbook and repository context.
- Ran read-only checks: `npm run typecheck`, `npm test`, `bun audit --audit-level high`.
- Wrote audit report to `/tmp/picklab-audits/gpt-55-audit.md`.

## Files Changed
- `/tmp/picklab-audits/gpt-55-audit.md`
- `progress.md`

## Notes
- Typecheck passed.
- Tests passed: 47 files, 496 passed, 2 skipped.
- Audit found 1 high dependency advisory in the build/test toolchain.

---

## opus-48 audit (read-only)

Status: Complete. Report at `/tmp/picklab-audits/opus-48-audit.md`.

Checks run: `tsc --noEmit` (clean), core unit tests (63/63 pass), `bun audit` (esbuild dev-only advisories).

Top findings:
- SEC-01 (HIGH): x11vnc started with `-nopw` and no `-localhost` — unauthenticated, all-interface VNC when `--vnc` used.
- SEC-02 (HIGH): `desktop_launch` runs arbitrary executables as the invoking user (lab-user isolation still deferred).
- BUG-01: launched desktop-app PIDs not tracked → orphaned processes on `session destroy`.
- PERF-01: `listRuns` scans/parses every manifest per artifact/resource call.
- TEST-01: no CI; no one-command fast verification loop.
- Plus redaction breadth, util/atomic-write duplication, console-port lock race, session-record validation gap.

Direction: ship the deferred `picklab-lab` uid-switch (keystone of the security story); add visual-diff/baseline tooling; Wayland path (low priority).

Only file modified: progress.md (this section). No source changes.
