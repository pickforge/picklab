# Unreleased

Working draft for the next PickLab release. Keep this current while PRs land.
At release time, use it to polish the generated GitHub release description,
then reset this file.

## User-facing changes

- `desktop_launch` now strips `WAYLAND_DISPLAY`/`WAYLAND_SOCKET` from the app
  environment, so GTK/Qt/Electron/Flutter apps always render inside the
  isolated lab display instead of opening on the user's real Wayland desktop
  (where driving them moved the real cursor).

## Internal/release changes

- None yet.

## Validation

### Tested

- Regression test asserting launched apps get `DISPLAY=<lab display>` with
  Wayland variables unset; full desktop-linux integration suite (Xvfb +
  xdotool + xterm) passes.

### Not tested yet

- App build.
- Installer or updater flow.
- Platform smoke checks.

### Release blockers

- None known.
