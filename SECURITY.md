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
loopback interface. Normal observation is also server-enforced read-only
(`-viewonly`): a connecting client cannot inject keyboard or mouse input into
the session, only watch it. For remote viewing, forward the port over SSH:

```sh
# `session status` prints the VNC port (5900 + display number)
ssh -L 5900:127.0.0.1:<vncPort> you@host
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
