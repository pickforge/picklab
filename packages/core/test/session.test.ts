import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isPidAlive, readProcessIdentity, stopPid } from "../src/proc.js";
import {
  createSession,
  destroySessionRecord,
  getSession,
  isSessionProcessAlive,
  listSessions,
  reapDeadRunningSessions,
  updateSession,
} from "../src/session.js";

let home: string;
let env: { PICKLAB_HOME: string };

beforeEach(async () => {
  home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-sess-"));
  env = { PICKLAB_HOME: home };
});

afterEach(async () => {
  await fs.promises.rm(home, { recursive: true, force: true });
});

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

describe("session registry", () => {
  it("creates a session record on disk with a typed id", async () => {
    const session = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    expect(session.id).toMatch(/^desk-[0-9a-f]{8}$/);
    expect(session.status).toBe("starting");
    expect(session.projectDir).toBe("/proj");
    expect(
      fs.existsSync(path.join(home, "sessions", `${session.id}.json`)),
    ).toBe(true);
  });

  it("creates a browser session with the brow prefix and persists both legs", async () => {
    const created = await createSession(
      {
        type: "browser",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":120", xvfbPid: 4242, width: 1280, height: 800 },
        browser: {
          browserPid: 4243,
          browserStartTimeTicks: 987654,
          binaryPath: "/usr/bin/chromium",
          profileMode: "ephemeral",
          profileDir: "/tmp/picklab-profile",
          cdpPort: 45123,
        },
      },
      env,
    );
    expect(created.id).toMatch(/^brow-[0-9a-f]{8}$/);
    const loaded = await getSession(created.id, env);
    expect(loaded).toEqual(created);
    expect(loaded?.browser?.profileMode).toBe("ephemeral");
    expect(loaded?.browser?.cdpPort).toBe(45123);
    expect(loaded?.desktop?.width).toBe(1280);
    expect(loaded?.desktop?.height).toBe(800);
  });

  it("persists desktop width and height while staying compatible without them", async () => {
    const withGeometry = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":99", xvfbPid: 1, width: 1600, height: 900 },
      },
      env,
    );
    const loadedGeometry = await getSession(withGeometry.id, env);
    expect(loadedGeometry?.desktop?.width).toBe(1600);
    expect(loadedGeometry?.desktop?.height).toBe(900);

    const legacy = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":98", xvfbPid: 2 },
      },
      env,
    );
    const loadedLegacy = await getSession(legacy.id, env);
    expect(loadedLegacy?.desktop?.width).toBeUndefined();
    expect(loadedLegacy?.desktop?.height).toBeUndefined();
  });

  it("round-trips through getSession", async () => {
    const created = await createSession(
      {
        type: "android",
        projectDir: "/proj",
        android: { avdName: "picklab-avd", consolePort: 5554 },
      },
      env,
    );
    const loaded = await getSession(created.id, env);
    expect(loaded).toEqual(created);
  });

  it("lists all sessions", async () => {
    const a = await createSession({ type: "desktop", projectDir: "/a" }, env);
    const b = await createSession(
      { type: "desktop+android", projectDir: "/b" },
      env,
    );
    const sessions = await listSessions(env);
    expect(sessions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("updates a session with a patch", async () => {
    const created = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    const updated = await updateSession(
      created.id,
      { status: "running", desktop: { display: ":99", xvfbPid: 1234 } },
      env,
    );
    expect(updated.status).toBe("running");
    expect(updated.desktop?.display).toBe(":99");
    const reloaded = await getSession(created.id, env);
    expect(reloaded?.status).toBe("running");
  });

  it("destroys session records", async () => {
    const created = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    await destroySessionRecord(created.id, env);
    expect(await getSession(created.id, env)).toBeUndefined();
    expect(await listSessions(env)).toEqual([]);
  });

  it("returns undefined for unknown sessions", async () => {
    expect(await getSession("desk-ffffff", env)).toBeUndefined();
  });

  it("rejects path-traversal session ids", async () => {
    const victim = path.join(home, "victim.json");
    await fs.promises.writeFile(victim, "{}", "utf8");

    expect(await getSession("../victim", env)).toBeUndefined();
    expect(await getSession("../runs/x/manifest", env)).toBeUndefined();
    await expect(destroySessionRecord("../victim", env)).rejects.toThrow(
      /session id/i,
    );
    await expect(
      updateSession("../victim", { status: "stopped" }, env),
    ).rejects.toThrow(/session id/i);

    expect(fs.existsSync(victim)).toBe(true);
  });

  it("skips corrupt session files in listSessions", async () => {
    const good = await createSession({ type: "desktop", projectDir: "/p" }, env);
    await fs.promises.writeFile(
      path.join(home, "sessions", "andr-deadbeef.json"),
      "{ not json",
      "utf8",
    );
    const sessions = await listSessions(env);
    expect(sessions.map((s) => s.id)).toEqual([good.id]);
  });

  it("getSession throws with the file path for corrupt records", async () => {
    const file = path.join(home, "sessions", "andr-deadbeef.json");
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, "{ not json", "utf8");
    await expect(getSession("andr-deadbeef", env)).rejects.toThrow(file);
  });

  it("updateSession cannot change id, type, or createdAt", async () => {
    const created = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    const updated = await updateSession(
      created.id,
      {
        status: "running",
        ...({ id: "desk-ffffffff", type: "android", createdAt: "1999" } as object),
      },
      env,
    );
    expect(updated.id).toBe(created.id);
    expect(updated.type).toBe("desktop");
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it("reaps running records whose process is dead", async () => {
    const stale = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":90", xvfbPid: 4_194_304 },
      },
      env,
    );
    const stopped = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "stopped",
        desktop: { display: ":91", xvfbPid: 4_194_305 },
      },
      env,
    );

    const reaped = await reapDeadRunningSessions(env);

    expect(reaped.map((record) => record.id)).toEqual([stale.id]);
    expect(await getSession(stale.id, env)).toBeUndefined();
    expect(await getSession(stopped.id, env)).toBeDefined();
  });

  it("stops recorded helper pids before deleting dead running records", async () => {
    const helper = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const vncPid = helper.pid;
    if (vncPid === undefined) {
      throw new Error("child process did not expose a pid");
    }
    const stale = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":90", xvfbPid: 4_194_304, vncPid },
      },
      env,
    );

    try {
      expect(isPidAlive(vncPid)).toBe(true);

      const reaped = await reapDeadRunningSessions(env);

      expect(reaped.map((record) => record.id)).toEqual([stale.id]);
      expect(await getSession(stale.id, env)).toBeUndefined();
      await waitForExit(helper);
      expect(isPidAlive(vncPid)).toBe(false);
    } finally {
      if (isPidAlive(vncPid)) {
        await stopPid(vncPid, { timeoutMs: 1000 });
        await waitForExit(helper);
      }
    }
  });

  it("keeps an errored record when stopping a helper throws", async () => {
    const helperPid = 4_194_304;
    const stale = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":90", xvfbPid: helperPid },
      },
      env,
    );
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation(((_pid: number, signal?: string | number) => {
        if (signal === 0) return true;
        throw Object.assign(new Error("not permitted"), { code: "EPERM" });
      }) as typeof process.kill);
    try {
      const reaped = await reapDeadRunningSessions(env, () => false);

      expect(reaped).toEqual([]);
      expect((await getSession(stale.id, env))?.status).toBe("error");
    } finally {
      kill.mockRestore();
    }
  });

  it("keeps an errored record when a helper refuses to stop", async () => {
    const helperPid = 4_194_304;
    const stale = await createSession(
      {
        type: "desktop",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":90", xvfbPid: helperPid },
      },
      env,
    );
    let resolveTerm!: () => void;
    const termSignaled = new Promise<void>((resolve) => {
      resolveTerm = resolve;
    });
    const kill = vi.spyOn(process, "kill").mockImplementation((() => {
      resolveTerm();
      return true;
    }) as typeof process.kill);
    vi.useFakeTimers();
    try {
      const pending = reapDeadRunningSessions(env, () => false);
      await termSignaled;
      await vi.advanceTimersByTimeAsync(6_100);
      const reaped = await pending;

      expect(reaped).toEqual([]);
      expect((await getSession(stale.id, env))?.status).toBe("error");
      expect(kill).toHaveBeenCalledWith(helperPid, "SIGKILL");
    } finally {
      vi.useRealTimers();
      kill.mockRestore();
    }
  });

  it("treats a browser session as alive only when the recorded start identity matches", async () => {
    const helper = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const pid = helper.pid;
    if (pid === undefined) {
      throw new Error("child process did not expose a pid");
    }
    try {
      const identity = readProcessIdentity(pid);
      if (identity === undefined) {
        throw new Error("could not read child identity");
      }
      const makeBrowser = (
        browserStartTimeTicks: number,
        xvfbPid: number = pid,
      ) =>
        createSession(
          {
            type: "browser",
            projectDir: "/proj",
            status: "running",
            desktop: { display: ":120", xvfbPid },
            browser: {
              browserPid: pid,
              browserStartTimeTicks,
              binaryPath: "/usr/bin/chromium",
              profileMode: "ephemeral",
              profileDir: "/tmp/picklab-profile",
              cdpPort: 1,
            },
          },
          env,
        );

      const alive = await makeBrowser(identity.startTicks);
      expect(isSessionProcessAlive(alive)).toBe(true);

      // A recorded pid whose start time no longer matches is a reused pid.
      const stale = await makeBrowser(identity.startTicks + 1);
      expect(isSessionProcessAlive(stale)).toBe(false);

      const deadDisplay = await makeBrowser(identity.startTicks, 4_194_307);
      expect(isSessionProcessAlive(deadDisplay)).toBe(false);
    } finally {
      if (isPidAlive(pid)) {
        await stopPid(pid, { timeoutMs: 1000 });
        await waitForExit(helper);
      }
    }
  });

  it("reaps a dead browser session and stops its recorded desktop helper", async () => {
    const helper = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const xvfbPid = helper.pid;
    if (xvfbPid === undefined) {
      throw new Error("child process did not expose a pid");
    }
    const stale = await createSession(
      {
        type: "browser",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":121", xvfbPid },
        browser: {
          browserPid: 4_194_306,
          browserStartTimeTicks: 1,
          binaryPath: "/usr/bin/chromium",
          profileMode: "ephemeral",
          profileDir: path.join(home, "sessions", "placeholder", "profile"),
          cdpPort: 1,
        },
      },
      env,
    );
    const profileDir = path.join(home, "sessions", stale.id, "profile");
    await fs.promises.mkdir(profileDir, { recursive: true });
    await updateSession(
      stale.id,
      {
        browser: {
          ...stale.browser!,
          profileDir,
        },
      },
      env,
    );

    try {
      expect(isPidAlive(xvfbPid)).toBe(true);

      const reaped = await reapDeadRunningSessions(env);

      expect(reaped.map((record) => record.id)).toEqual([stale.id]);
      expect(await getSession(stale.id, env)).toBeUndefined();
      await waitForExit(helper);
      expect(isPidAlive(xvfbPid)).toBe(false);
    } finally {
      if (isPidAlive(xvfbPid)) {
        await stopPid(xvfbPid, { timeoutMs: 1000 });
        await waitForExit(helper);
      }
    }
  });

  it("deletes the ephemeral profile under the session dir when reaping", async () => {
    const stale = await createSession(
      {
        type: "browser",
        projectDir: "/proj",
        status: "running",
        desktop: { display: ":122", xvfbPid: 4_194_308 },
        browser: {
          browserPid: 4_194_309,
          browserStartTimeTicks: 1,
          binaryPath: "/usr/bin/chromium",
          profileMode: "ephemeral",
          profileDir: path.join(home, "sessions", "placeholder", "profile"),
          cdpPort: 1,
        },
      },
      env,
    );
    // Point the profile at the real per-session directory and plant data in it.
    const profileDir = path.join(home, "sessions", stale.id, "profile");
    await fs.promises.mkdir(profileDir, { recursive: true });
    await fs.promises.writeFile(path.join(profileDir, "Cookies"), "secret");
    await updateSession(
      stale.id,
      {
        browser: {
          browserPid: 4_194_309,
          browserStartTimeTicks: 1,
          binaryPath: "/usr/bin/chromium",
          profileMode: "ephemeral",
          profileDir,
          cdpPort: 1,
        },
      },
      env,
    );

    const reaped = await reapDeadRunningSessions(env);

    expect(reaped.map((record) => record.id)).toEqual([stale.id]);
    expect(await getSession(stale.id, env)).toBeUndefined();
    expect(fs.existsSync(profileDir)).toBe(false);
  });

  it("does not delete a profile that escapes the session dir when reaping", async () => {
    const outside = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "picklab-outside-"),
    );
    try {
      const stale = await createSession(
        {
          type: "browser",
          projectDir: "/proj",
          status: "running",
          desktop: { display: ":123", xvfbPid: 4_194_310 },
          browser: {
            browserPid: 4_194_311,
            browserStartTimeTicks: 1,
            binaryPath: "/usr/bin/chromium",
            profileMode: "ephemeral",
            profileDir: outside,
            cdpPort: 1,
          },
        },
        env,
      );

      await reapDeadRunningSessions(env);

      expect((await getSession(stale.id, env))?.status).toBe("error");
      // The confinement guard must leave the record for inspection and the
      // out-of-tree path untouched.
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true });
    }
  });

  it("stops the browser group before VNC and Xvfb when reaping", async () => {
    const orderFile = path.join(home, "stop-order.txt");
    const stopLogger = (label: string) =>
      `const fs=require("node:fs");process.on("SIGTERM",()=>{fs.appendFileSync(${JSON.stringify(orderFile)},${JSON.stringify(`${label}\n`)});process.exit(0)});setInterval(()=>{},1000)`;
    const browser = spawn(process.execPath, ["-e", stopLogger("browser")], {
      detached: true,
      stdio: "ignore",
    });
    const vnc = spawn(process.execPath, ["-e", stopLogger("vnc")], {
      stdio: "ignore",
    });
    const xvfb = spawn(process.execPath, ["-e", stopLogger("xvfb")], {
      stdio: "ignore",
    });
    if (
      browser.pid === undefined ||
      vnc.pid === undefined ||
      xvfb.pid === undefined
    ) {
      throw new Error("child process did not expose a pid");
    }
    try {
      await delay(100);
      const identity = readProcessIdentity(browser.pid);
      if (identity === undefined) {
        throw new Error("could not read browser identity");
      }
      const stale = await createSession(
        {
          type: "browser",
          projectDir: "/proj",
          status: "running",
          desktop: {
            display: ":124",
            vncPid: vnc.pid,
            xvfbPid: xvfb.pid,
          },
          browser: {
            browserPid: identity.pid,
            browserStartTimeTicks: identity.startTicks,
            binaryPath: "/usr/bin/chromium",
            profileMode: "ephemeral",
            profileDir: path.join(home, "sessions", "placeholder", "profile"),
            cdpPort: 1,
          },
        },
        env,
      );
      const profileDir = path.join(home, "sessions", stale.id, "profile");
      await fs.promises.mkdir(profileDir, { recursive: true });
      await updateSession(
        stale.id,
        {
          browser: {
            ...stale.browser!,
            profileDir,
          },
        },
        env,
      );

      const reaped = await reapDeadRunningSessions(env, () => false);

      expect(reaped.map((record) => record.id)).toEqual([stale.id]);
      expect(fs.readFileSync(orderFile, "utf8").trim().split("\n")).toEqual([
        "browser",
        "vnc",
        "xvfb",
      ]);
    } finally {
      for (const child of [browser, vnc, xvfb]) {
        if (child.pid !== undefined && isPidAlive(child.pid)) {
          try {
            process.kill(child === browser ? -child.pid : child.pid, "SIGKILL");
          } catch {
            // already gone
          }
        }
      }
    }
  });

  it("leaves helpers and profile intact for an unconfirmed browser group", async () => {
    const browser = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const vnc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const xvfb = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    if (
      browser.pid === undefined ||
      vnc.pid === undefined ||
      xvfb.pid === undefined
    ) {
      throw new Error("child process did not expose a pid");
    }
    const profileDir = path.join(home, "reused-profile");
    await fs.promises.mkdir(profileDir, { recursive: true });
    await fs.promises.writeFile(path.join(profileDir, "Cookies"), "secret");
    try {
      const identity = readProcessIdentity(browser.pid);
      if (identity === undefined) {
        throw new Error("could not read browser identity");
      }
      // The numeric PID is live but the start identity is not ours. Reaping
      // must fail closed before touching any dependent desktop process.
      const stale = await createSession(
        {
          type: "browser",
          projectDir: "/proj",
          status: "running",
          desktop: {
            display: ":125",
            vncPid: vnc.pid,
            xvfbPid: xvfb.pid,
          },
          browser: {
            browserPid: browser.pid,
            browserStartTimeTicks: identity.startTicks + 1,
            binaryPath: "/usr/bin/chromium",
            profileMode: "ephemeral",
            profileDir,
            cdpPort: 1,
          },
        },
        env,
      );

      const reaped = await reapDeadRunningSessions(env);

      expect(reaped).toEqual([]);
      expect((await getSession(stale.id, env))?.status).toBe("error");
      expect(isPidAlive(browser.pid)).toBe(true);
      expect(isPidAlive(vnc.pid)).toBe(true);
      expect(isPidAlive(xvfb.pid)).toBe(true);
      expect(fs.existsSync(path.join(profileDir, "Cookies"))).toBe(true);
    } finally {
      for (const child of [browser, vnc, xvfb]) {
        if (child.pid !== undefined && isPidAlive(child.pid)) {
          await stopPid(child.pid, { timeoutMs: 1000 });
          await waitForExit(child);
        }
      }
    }
  });
});
