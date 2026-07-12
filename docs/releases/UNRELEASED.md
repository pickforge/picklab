# Unreleased

Working draft for the next PickLab release. Keep this current while PRs land.
At release time, use it to polish the generated GitHub release description,
then reset this file.

## User-facing changes

- `desktop_launch` now points `WAYLAND_DISPLAY` at a non-existent socket (and
  strips `WAYLAND_SOCKET`), so GTK/Qt/Electron/Flutter apps always fall back
  to X11 and render inside the isolated lab display instead of opening on the
  user's real Wayland desktop (where driving them moved the real cursor).
- `x11vnc` now always launches with `-viewonly`, so normal VNC observation of
  a desktop session is server-enforced read-only. Loopback binding
  (`-localhost`), `-shared`, `-forever`, and no-password (`-nopw`) behavior is
  unchanged.

## Internal/release changes

- Hosted CI now installs `x11vnc` alongside the other desktop test
  dependencies, and the desktop-linux integration suite asserts `x11vnc` is
  present when `CI=true` so VNC tests fail loudly instead of silently
  skipping on a misconfigured runner.

## Validation

### Tested

- Regression test asserting launched apps get `DISPLAY=<lab display>` with
  Wayland variables unset; full desktop-linux integration suite (Xvfb +
  xdotool + xterm) passes.
- `buildVncArgs` exact-argv test updated to require `-viewonly`; hosted-CI
  prerequisite assertion verified to fail loudly (not skip) when `CI=true`
  and `x11vnc` is absent, and to pass once `x11vnc` is on `PATH`.
- `bun run typecheck`, `bun run test` (49 files, 563 passed / 1 skipped
  locally without `x11vnc` installed), `bun run test:coverage` (all
  thresholds met), and `bun run build` all pass.

### Not tested yet

- App build.
- Installer or updater flow.
- Platform smoke checks.
- Live hosted CI run with `x11vnc` actually installed (validated locally via
  fake binaries and a `CI=true` dry run only).

### Release blockers

- None known.
