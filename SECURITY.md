# Security

PickLab automates real software on your machine. It spawns and drives native
desktop apps and Android emulators, starts a local X display (Xvfb) and an
optional VNC server, and runs ADB. Treat it like any tool that can launch
processes and read screens: run it on hardware you control, against code you
trust.

This is the honest short version. The [README](README.md#security-model) has the
fuller model.

## Boundaries

- MCP tools never invoke sudo. Privileged provisioning happens only through the
  CLI, with explicit consent.
- User input is spawned as argument arrays, never interpolated into shell strings.
- Logcat and other artifacts are redacted by default. Only `android adb` is raw,
  and it says so.
- Agent config edits are atomic, with a backup of the previous config.

## VNC binds to loopback (SEC-01 — mitigated)

The desktop VNC server (`x11vnc`) is started with `-localhost`, so it listens on
`127.0.0.1` only and is not reachable from the network. It runs without a VNC
password (`-nopw`); that is safe precisely because the socket never leaves the
loopback interface. Normal `--vnc` and `picklab watch` observation is
server-enforced read-only (`-viewonly`): a connecting client cannot inject
keyboard or mouse input into the session, only watch it. `picklab watch`
starts this server lazily and closing its host-side viewer does not stop VNC,
Xvfb, or the session. `--vnc-control` is an explicit writable escape hatch for
entering a password, API key, or OTP directly into the lab app. Watch refuses
to reuse an active writable server rather than weakening its read-only
guarantee. Writable VNC does not yet pause or coordinate agent input, so stop
agent actions while using it. For remote viewing, forward the port over SSH:

```sh
# `session status` prints the VNC port (5900 + display number)
ssh -N -L <vncPort>:127.0.0.1:<vncPort> you@host
```

Do not strip `-localhost` to put VNC on a shared network. An unauthenticated,
all-interface VNC server is a remote-takeover risk.

## desktop_launch runs as you (SEC-02 — known limitation)

`desktop_launch` and the `desktop_*` input tools run the target app as the user
who started PickLab. There is no uid sandbox yet, so a launched app has your
filesystem and network access. PickLab provisions a dedicated locked
`picklab-lab` user and a dedicated `picklab-avd`, but session processes do not
yet run under that user — uid isolation is planned. Until then, launch only apps
you trust, and prefer a throwaway user or VM for untrusted binaries.

## Browser sessions run as you (SEC-03 — known limitation)

Browser sessions launch real headed Chrome/Chromium inside a private Xvfb
display. PickLab hardens the launch, but v1 is for authorized, trusted
development and QA — it is **not** a sandbox for hostile web pages.

What PickLab does do:

- Each session gets its own private Xvfb and its own **ephemeral** Chrome
  profile under the session directory. Profiles are never borrowed from your
  real browser and are deleted on destroy.
- Chrome starts from a **scrubbed environment** (`cleanEnv`): only the isolated
  display, isolated `HOME`/`XDG_*` paths, `PATH`, and locale reach it. Secrets
  in your shell environment are not inherited by the browser.
- The DevTools/CDP endpoint uses an OS-assigned port bound to loopback
  (`--remote-debugging-port=0` plus an explicit `127.0.0.1` address). It is not
  reachable off-host.
- The DevTools websocket path is a capability URL: whoever holds it controls the
  browser. PickLab reads only the port from `DevToolsActivePort` and **never**
  persists the websocket path/GUID in session records or diagnostics.
- On destroy or reap, the whole Chrome **process group** is terminated and
  verified dead (PID plus `/proc` start-time identity, so a reused PID is never
  signalled) **before** the profile is deleted — no orphaned renderers, no
  leftover profile data.

What it does not do, and you must account for:

- **Loopback is not isolation from local processes.** Chrome and the CDP
  endpoint run as the user who started PickLab. Any local process running as
  that user can reach the loopback CDP port and drive the browser. Loopback
  binding only keeps the network out, not other local processes.
- There is **no uid sandbox** for the browser yet (same limitation as SEC-02).
  Launch only content you trust; prefer a throwaway user or VM otherwise.

Planned hardening tracked separately: per-session uid isolation, and moving CDP
off a TCP port onto `--remote-debugging-pipe`.

## Reporting a vulnerability

Please report privately. Do not open a public issue for security bugs.

- GitHub: open a private advisory at
  <https://github.com/pickforge/picklab/security/advisories/new>
- Email: <security@pickforge.dev>

We aim to acknowledge within a few days, and we will credit reporters who want it.

---

<p align="center">
  <a href="https://pickforge.dev">
    <img src="assets/brand/pickforge-studio-footer.svg" alt="Pickforge Studio — local-first, open source, built for people who ship" width="560">
  </a>
</p>
