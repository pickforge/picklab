import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { scheduler } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  getSession,
  isPidAlive,
  listProcessGroupMembers,
  reapDeadRunningSessions,
  readProcessIdentity,
  stopPid,
  updateSession,
  type CreateSessionInput,
  type EnvLike,
} from "@pickforge/picklab-core";
import {
  findOnPath,
  startXvfb,
} from "@pickforge/picklab-desktop-linux";
import {
  browserSessionLogDir,
  browserRuntimeLayout,
  createBrowserSession,
  destroyBrowserSession,
  getBrowserSessionStatus,
  type BrowserSessionHandle,
} from "../src/index.js";
import { fakePath, writeFakeChrome } from "./fakes.js";
import type { FakeChromeMode } from "./fakes.js";

// The browser package owns Chrome; Xvfb is the production display server (a
// light, concurrency-tested dependency), so these tests fake only Chrome and
// drive a real private Xvfb. Skip when no X server binary is installed.
const hasXvfb = findOnPath("Xvfb") !== null;

const TEST_TIMEOUT_MS = 30_000;

let tmp: string;
let home: string;
let projectDir: string;
let registryEnv: EnvLike;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-browser-sess-"));
  home = path.join(tmp, "home");
  projectDir = path.join(tmp, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  registryEnv = { PICKLAB_HOME: home };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function spawnEnvFor(
  mode: FakeChromeMode,
  extra: EnvLike = {},
): EnvLike {
  const binDir = path.join(
    tmp,
    `bin-${mode}-${Math.random().toString(36).slice(2)}`,
  );
  writeFakeChrome(binDir, mode);
  return { PATH: fakePath(binDir), ...extra };
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForEntry(
  dir: string,
  matches: (name: string) => boolean,
): Promise<string> {
  const existing = fs.readdirSync(dir).find(matches);
  if (existing !== undefined) return existing;

  const controller = new AbortController();
  const events = fs.promises.watch(dir, { signal: controller.signal });
  try {
    const raced = fs.readdirSync(dir).find(matches);
    if (raced !== undefined) return raced;
    for await (const _event of events) {
      const entry = fs.readdirSync(dir).find(matches);
      if (entry !== undefined) return entry;
    }
    throw new Error(`Stopped watching ${dir} before the expected entry appeared`);
  } finally {
    controller.abort();
  }
}

function processGroupId(pid: number): number {
  const content = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const close = content.lastIndexOf(")");
  const fields = content.slice(close + 1).trim().split(/\s+/);
  const pgrp = Number(fields[2]);
  if (!Number.isSafeInteger(pgrp) || pgrp <= 0) {
    throw new Error(`Could not read process group for pid ${pid}`);
  }
  return pgrp;
}

describe.skipIf(!hasXvfb)("createBrowserSession (fake binaries)", () => {
  it("brings up both legs, persists the contract, and never persists the GUID", async () => {
    const env = spawnEnvFor("ready", { SECRET_TOKEN: "leak-me-please" });
    let session: BrowserSessionHandle;
    const previousUmask = process.umask(0);
    try {
      session = await createBrowserSession({
        projectDir,
        registryEnv,
        env,
        width: 1024,
        height: 768,
        cdpTimeoutMs: 5000,
        xvfbWaitTimeoutMs: 20_000,
      });
    } finally {
      process.umask(previousUmask);
    }
    try {
      expect(session.id).toMatch(/^brow-[0-9a-f]+$/);
      expect(isPidAlive(session.xvfbPid)).toBe(true);
      expect(isPidAlive(session.browserPid)).toBe(true);
      expect(session.cdpPort).toBeGreaterThan(0);
      expect(await isPortListening(session.cdpPort)).toBe(true);

      // The record carries both legs and the ephemeral profile contract.
      const record = await getSession(session.id, registryEnv);
      expect(record?.type).toBe("browser");
      expect(record?.status).toBe("running");
      expect(record?.desktop?.display).toBe(session.display);
      expect(record?.desktop?.width).toBe(1024);
      expect(record?.browser?.profileMode).toBe("ephemeral");
      expect(record?.browser?.cdpPort).toBe(session.cdpPort);
      expect(record?.browser?.profileDir).toBe(session.profileDir);

      // The DevTools websocket path/GUID must never be persisted.
      const raw = fs.readFileSync(
        path.join(home, "sessions", `${session.id}.json`),
        "utf8",
      );
      expect(raw).not.toContain("/devtools/browser/");
      expect(raw).not.toContain("webSocketDebuggerUrl");
      expect(raw).not.toContain("fake-guid");

      // The profile lives under the session directory.
      expect(session.profileDir).toBe(
        path.join(browserSessionLogDir(session.id, registryEnv), "profile"),
      );
      expect(fs.existsSync(session.profileDir)).toBe(true);

      const layout = browserRuntimeLayout(session.logDir);
      for (const dir of [
        session.logDir,
        layout.profileDir,
        layout.homeDir,
        layout.xdgConfigHome,
        layout.xdgCacheHome,
        path.join(layout.homeDir, ".local"),
        layout.xdgDataHome,
        layout.xdgStateHome,
        layout.tmpDir,
        layout.xdgRuntimeDir,
      ]) {
        expect(fs.statSync(dir).mode & 0o777, dir).toBe(0o700);
      }
    } finally {
      await destroyBrowserSession(session.id, registryEnv).catch(() => {});
    }
  }, TEST_TIMEOUT_MS);

  it("keeps a stable group leader when a browser launcher exits", async () => {
    const session = await createBrowserSession({
      projectDir,
      registryEnv,
      env: spawnEnvFor("launcher"),
      cdpTimeoutMs: 5000,
    });
    const childPid = Number(
      fs.readFileSync(path.join(session.logDir, "chrome.pid"), "utf8").trim(),
    );
    try {
      expect(childPid).not.toBe(session.browserPid);
      expect(isPidAlive(session.browserPid)).toBe(true);
      expect(isPidAlive(childPid)).toBe(true);
      expect((await getBrowserSessionStatus(session.id, registryEnv)).alive).toBe(
        true,
      );
    } finally {
      await destroyBrowserSession(session.id, registryEnv);
    }
    expect(isPidAlive(session.browserPid)).toBe(false);
    expect(isPidAlive(childPid)).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("hands Chrome a scrubbed environment with no inherited secrets", async () => {
    const env = spawnEnvFor("ready", {
      SECRET_TOKEN: "top-secret",
      AWS_SECRET_ACCESS_KEY: "should-not-appear",
    });
    const session = await createBrowserSession({
      projectDir,
      registryEnv,
      env,
      cdpTimeoutMs: 5000,
    });
    try {
      const dump = JSON.parse(
        fs.readFileSync(
          path.join(session.profileDir, "fake-chrome-env.json"),
          "utf8",
        ),
      ) as Record<string, string>;
      expect(dump.SECRET_TOKEN).toBeUndefined();
      expect(dump.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(dump.DISPLAY).toBe(session.display);
      expect(dump.HOME).toBe(path.join(session.logDir, "home"));
      expect(dump.WAYLAND_DISPLAY).toBe("picklab-no-wayland");
    } finally {
      await destroyBrowserSession(session.id, registryEnv).catch(() => {});
    }
  }, TEST_TIMEOUT_MS);

  it("fails closed with actionable errors when no browser binary exists", async () => {
    await expect(
      createBrowserSession({
        projectDir,
        registryEnv,
        env: { PATH: path.join(tmp, "empty") },
      }),
    ).rejects.toThrow(/No Chrome or Chromium binary found/);
  });
});

describe.skipIf(!hasXvfb)("getBrowserSessionStatus (fake binaries)", () => {
  it("reports both legs live and overall alive", async () => {
    const session = await createBrowserSession({
      projectDir,
      registryEnv,
      env: spawnEnvFor("ready"),
      cdpTimeoutMs: 5000,
    });
    try {
      const status = await getBrowserSessionStatus(session.id, registryEnv);
      expect(status.xvfbAlive).toBe(true);
      expect(status.displayAlive).toBe(true);
      expect(status.browserAlive).toBe(true);
      expect(status.alive).toBe(true);
      expect(status.cdpPort).toBe(session.cdpPort);
    } finally {
      await destroyBrowserSession(session.id, registryEnv).catch(() => {});
    }
  }, TEST_TIMEOUT_MS);

  it("treats a missing display socket as dead and reaps it before the next create", async () => {
    const first = await createBrowserSession({
      projectDir,
      registryEnv,
      env: spawnEnvFor("ready"),
      cdpTimeoutMs: 5000,
    });
    let second: BrowserSessionHandle | undefined;
    try {
      const displayNumber = Number(first.display.slice(1));
      fs.rmSync(`/tmp/.X11-unix/X${displayNumber}`, { force: true });

      const status = await getBrowserSessionStatus(first.id, registryEnv);
      expect(status.xvfbAlive).toBe(true);
      expect(status.browserAlive).toBe(true);
      expect(status.displayAlive).toBe(false);
      expect(status.alive).toBe(false);

      second = await createBrowserSession({
        projectDir,
        registryEnv,
        env: spawnEnvFor("ready"),
        cdpTimeoutMs: 5000,
      });
      expect(await getSession(first.id, registryEnv)).toBeUndefined();
      expect(isPidAlive(first.xvfbPid)).toBe(false);
      expect(isPidAlive(first.browserPid)).toBe(false);
    } finally {
      await destroyBrowserSession(first.id, registryEnv).catch(() => {});
      if (second !== undefined) {
        await destroyBrowserSession(second.id, registryEnv).catch(() => {});
      }
    }
  }, TEST_TIMEOUT_MS);

  it("throws for an unknown session", async () => {
    await expect(
      getBrowserSessionStatus("brow-ffffffff", registryEnv),
    ).rejects.toThrow(/not found/);
  });
});

describe.skipIf(!hasXvfb)("destroyBrowserSession (fake binaries)", () => {
  it("kills the process group, removes the profile, and deletes the record", async () => {
    const session = await createBrowserSession({
      projectDir,
      registryEnv,
      env: spawnEnvFor("ready"),
      cdpTimeoutMs: 5000,
    });
    const { browserPid, xvfbPid, profileDir, logDir } = session;
    expect(isPidAlive(browserPid)).toBe(true);

    await destroyBrowserSession(session.id, registryEnv);

    expect(listProcessGroupMembers(browserPid)).toEqual([]);
    expect(isPidAlive(browserPid)).toBe(false);
    expect(isPidAlive(xvfbPid)).toBe(false);
    expect(fs.existsSync(profileDir)).toBe(false);
    expect(fs.existsSync(path.join(logDir, "home"))).toBe(false);
    expect(await getSession(session.id, registryEnv)).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("leaves the display alive when the browser group is unverifiable", async () => {
    const session = await createBrowserSession({
      projectDir,
      registryEnv,
      env: spawnEnvFor("ready"),
      cdpTimeoutMs: 5000,
    });
    const record = await getSession(session.id, registryEnv);
    if (record?.browser === undefined) {
      throw new Error("browser record missing");
    }
    await updateSession(
      session.id,
      {
        browser: {
          ...record.browser,
          browserStartTimeTicks: record.browser.browserStartTimeTicks + 1,
        },
      },
      registryEnv,
    );

    try {
      await expect(destroyBrowserSession(session.id, registryEnv)).rejects.toThrow(
        /Failed to fully destroy browser session/,
      );
      expect(isPidAlive(session.browserPid)).toBe(true);
      expect(isPidAlive(session.xvfbPid)).toBe(true);
      expect(fs.existsSync(session.profileDir)).toBe(true);
      expect((await getSession(session.id, registryEnv))?.status).toBe("error");
    } finally {
      try {
        process.kill(-session.browserPid, "SIGKILL");
      } catch {
        // group already gone
      }
      await stopPid(session.xvfbPid, { timeoutMs: 1000 });
    }
  }, TEST_TIMEOUT_MS);

  it("stops a known Xvfb helper and removes confined runtime for a partial record without a browser leg", async () => {
    const record = await createSession(
      { type: "browser", projectDir, status: "error" },
      registryEnv,
    );
    const sessionDir = browserSessionLogDir(record.id, registryEnv);
    const layout = browserRuntimeLayout(sessionDir);
    for (const dir of [
      layout.profileDir,
      layout.homeDir,
      layout.xdgRuntimeDir,
      layout.tmpDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const xvfb = await startXvfb({
      logDir: sessionDir,
      env: { PATH: "/usr/bin:/bin" },
      displayStart: 300,
    });
    const xvfbIdentity = readProcessIdentity(xvfb.pid);
    if (xvfbIdentity === undefined) {
      throw new Error("Xvfb identity was unavailable");
    }
    await updateSession(
      record.id,
      {
        desktop: {
          display: xvfb.display,
          xvfbPid: xvfb.pid,
          xvfbStartTimeTicks: xvfbIdentity.startTicks,
          width: xvfb.width,
          height: xvfb.height,
        },
      },
      registryEnv,
    );

    await destroyBrowserSession(record.id, registryEnv);

    expect(isPidAlive(xvfb.pid)).toBe(false);
    expect(fs.existsSync(layout.profileDir)).toBe(false);
    expect(fs.existsSync(layout.homeDir)).toBe(false);
    expect(await getSession(record.id, registryEnv)).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("rejects destroying a non-browser session", async () => {
    // A desktop-only record has no browser leg.
    const desktop = await createSession(
      { type: "desktop", projectDir, desktop: { display: ":90", xvfbPid: 1 } },
      registryEnv,
    );
    await expect(
      destroyBrowserSession(desktop.id, registryEnv),
    ).rejects.toThrow(/not a browser session/);
  });
});

describe.skipIf(!hasXvfb)("partial-failure cleanup (fake binaries)", () => {
  it("cleans up when Chrome crashes during startup", async () => {
    const env = spawnEnvFor("crash");
    await expect(
      createBrowserSession({ projectDir, registryEnv, env, cdpTimeoutMs: 3000 }),
    ).rejects.toThrow(/exited during startup/);

    // Exactly one record exists (status error), its profile is gone, and its
    // Xvfb leg was stopped.
    const sessions = fs
      .readdirSync(path.join(home, "sessions"))
      .filter((f) => f.endsWith(".json"));
    expect(sessions).toHaveLength(1);
    const id = sessions[0]!.slice(0, -".json".length);
    const record = await getSession(id, registryEnv);
    expect(record?.status).toBe("error");
    expect(fs.existsSync(path.join(browserSessionLogDir(id, registryEnv), "profile"))).toBe(
      false,
    );
    const xvfbPid = record?.desktop?.xvfbPid;
    if (xvfbPid !== undefined) {
      expect(isPidAlive(xvfbPid)).toBe(false);
    }

    await destroyBrowserSession(id, registryEnv);
    expect(await getSession(id, registryEnv)).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("rejects Chrome that exits after publishing a DevTools port", async () => {
    const env = spawnEnvFor("crash-after-port");
    await expect(
      createBrowserSession({ projectDir, registryEnv, env, cdpTimeoutMs: 3000 }),
    ).rejects.toThrow(/exited during startup/);

    const recordFile = fs
      .readdirSync(path.join(home, "sessions"))
      .find((name) => name.endsWith(".json"));
    if (recordFile === undefined) {
      throw new Error("Failed create did not preserve its error record");
    }
    const id = recordFile.slice(0, -".json".length);
    const sessionDir = browserSessionLogDir(id, registryEnv);
    expect(fs.existsSync(path.join(sessionDir, "cdp-published"))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, "profile"))).toBe(false);
    expect((await getSession(id, registryEnv))?.status).toBe("error");
  }, TEST_TIMEOUT_MS);

  it("cancels startup and cleans up the browser group", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      createBrowserSession({
        projectDir,
        registryEnv,
        env: spawnEnvFor("stall"),
        cdpTimeoutMs: 5000,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);

    const sessions = fs
      .readdirSync(path.join(home, "sessions"))
      .filter((f) => f.endsWith(".json"));
    expect(sessions).toHaveLength(1);
    const id = sessions[0]!.slice(0, -".json".length);
    expect(
      fs.existsSync(path.join(browserSessionLogDir(id, registryEnv), "profile")),
    ).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("persists partial identities when startup cleanup is unverifiable and supports retry", async () => {
    const sessionsPath = path.join(home, "sessions");
    fs.mkdirSync(sessionsPath, { recursive: true });
    const recordReady = waitForEntry(
      sessionsPath,
      (name) => name.endsWith(".json"),
    );
    const creating = createBrowserSession({
      projectDir,
      registryEnv,
      env: spawnEnvFor("stubborn-stall"),
      cdpTimeoutMs: 5000,
    });

    const recordFile = await recordReady;
    const id = recordFile.slice(0, -".json".length);
    const sessionDir = browserSessionLogDir(id, registryEnv);
    await waitForEntry(sessionsPath, (name) => name === id);
    const readyFile = await waitForEntry(
      sessionDir,
      (name) => name === "chrome.ready",
    );
    const childPid = Number(
      fs.readFileSync(path.join(sessionDir, readyFile), "utf8").trim(),
    );
    const leaderPid = processGroupId(childPid);
    expect(leaderPid).not.toBe(childPid);

    process.kill(leaderPid, "SIGKILL");
    while (fs.existsSync(`/proc/${leaderPid}`)) {
      await scheduler.yield();
    }
    await expect(creating).rejects.toThrow(/exited during startup/);

    const failed = await getSession(id, registryEnv);
    expect(failed?.status).toBe("error");
    expect(failed?.meta?.reaperCleanupPending).toBe(true);
    const failedXvfbPid = failed?.desktop?.xvfbPid;
    if (failedXvfbPid === undefined) {
      throw new Error("Failed create did not persist the Xvfb pid");
    }
    expect(failed?.browser).toMatchObject({
      browserPid: leaderPid,
      profileMode: "ephemeral",
      profileDir: path.join(sessionDir, "profile"),
    });
    expect(failed?.browser?.cdpPort).toBeUndefined();
    expect(fs.existsSync(path.join(sessionDir, "profile"))).toBe(true);

    await expect(destroyBrowserSession(id, registryEnv)).rejects.toThrow(
      /Failed to fully destroy browser session/,
    );
    expect(isPidAlive(failedXvfbPid)).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, "profile"))).toBe(true);

    await stopPid(childPid, { timeoutMs: 1000 });
    expect(
      (await reapDeadRunningSessions(registryEnv)).map((record) => record.id),
    ).toEqual([id]);
    expect(await getSession(id, registryEnv)).toBeUndefined();
    expect(isPidAlive(failedXvfbPid)).toBe(false);
    expect(fs.existsSync(path.join(sessionDir, "profile"))).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("kills the process group and removes the profile when Chrome stalls", async () => {
    const env = spawnEnvFor("stall");
    await expect(
      createBrowserSession({ projectDir, registryEnv, env, cdpTimeoutMs: 500 }),
    ).rejects.toThrow(/did not expose a DevTools port/);

    const sessions = fs
      .readdirSync(path.join(home, "sessions"))
      .filter((f) => f.endsWith(".json"));
    expect(sessions).toHaveLength(1);
    const id = sessions[0]!.slice(0, -".json".length);
    const sessionDir = browserSessionLogDir(id, registryEnv);

    // The stall fake recorded its pid next to the session; the reaper/cleanup
    // must have killed that whole group.
    const pidFile = path.join(sessionDir, "chrome.pid");
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      expect(isPidAlive(pid)).toBe(false);
      expect(listProcessGroupMembers(pid)).toEqual([]);
    }
    expect(fs.existsSync(path.join(sessionDir, "profile"))).toBe(false);
  }, TEST_TIMEOUT_MS);
});

describe.skipIf(!hasXvfb)("concurrent browser sessions (fake binaries)", () => {
  it("gives two sessions distinct displays, ports, and profiles", async () => {
    const settled = await Promise.allSettled([
      createBrowserSession({
        projectDir,
        registryEnv,
        env: spawnEnvFor("ready"),
        cdpTimeoutMs: 5000,
      }),
      createBrowserSession({
        projectDir,
        registryEnv,
        env: spawnEnvFor("ready"),
        cdpTimeoutMs: 5000,
      }),
    ]);
    const sessions = settled
      .filter(
        (r): r is PromiseFulfilledResult<BrowserSessionHandle> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);
    try {
      const rejections = settled
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String(r.reason));
      expect(rejections).toEqual([]);
      const [a, b] = sessions as [BrowserSessionHandle, BrowserSessionHandle];
      expect(a.display).not.toBe(b.display);
      expect(a.cdpPort).not.toBe(b.cdpPort);
      expect(a.profileDir).not.toBe(b.profileDir);

      // Destroying one leaves the other fully intact.
      await destroyBrowserSession(a.id, registryEnv);
      expect(isPidAlive(a.browserPid)).toBe(false);
      expect(isPidAlive(b.browserPid)).toBe(true);
      expect(isPidAlive(b.xvfbPid)).toBe(true);
    } finally {
      for (const s of sessions) {
        await destroyBrowserSession(s.id, registryEnv).catch(() => {});
      }
    }
  }, TEST_TIMEOUT_MS);
});

// These exercise status/destroy logic against crafted records without spawning
// anything, so they run everywhere (no Xvfb needed).
describe("browser record inspection (no live processes)", () => {
  function craftBrowserRecord(overrides: CreateSessionInput) {
    return createSession(overrides, registryEnv);
  }

  it("reports every leg dead for a stale record and echoes the cdp port", async () => {
    const rec = await craftBrowserRecord({
      type: "browser",
      projectDir,
      status: "running",
      desktop: { display: ":250", xvfbPid: 4_194_300 },
      browser: {
        browserPid: 4_194_301,
        browserStartTimeTicks: 1,
        binaryPath: "/usr/bin/chromium",
        profileMode: "ephemeral",
        profileDir: "/tmp/picklab-stale",
        cdpPort: 9222,
      },
    });
    const status = await getBrowserSessionStatus(rec.id, registryEnv);
    expect(status.xvfbAlive).toBe(false);
    expect(status.displayAlive).toBe(false);
    expect(status.browserAlive).toBe(false);
    expect(status.alive).toBe(false);
    expect(status.cdpPort).toBe(9222);
  });

  it("handles a record with no legs at all", async () => {
    const rec = await craftBrowserRecord({
      type: "browser",
      projectDir,
      status: "running",
    });
    const status = await getBrowserSessionStatus(rec.id, registryEnv);
    expect(status.xvfbAlive).toBe(false);
    expect(status.displayAlive).toBe(false);
    expect(status.browserAlive).toBe(false);
    expect(status.cdpPort).toBeUndefined();
  });

  it("refuses to delete a profile that escapes the session directory", async () => {
    const outside = path.join(tmp, "evil-profile");
    fs.mkdirSync(outside, { recursive: true });
    const rec = await craftBrowserRecord({
      type: "browser",
      projectDir,
      status: "running",
      desktop: { display: ":251", xvfbPid: 4_194_302 },
      browser: {
        browserPid: 4_194_303,
        browserStartTimeTicks: 1,
        binaryPath: "/usr/bin/chromium",
        profileMode: "ephemeral",
        profileDir: outside,
        cdpPort: 1,
      },
    });
    const error = await destroyBrowserSession(rec.id, registryEnv).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AggregateError);
    const messages = (error as AggregateError).errors.map((e) =>
      String((e as Error).message),
    );
    expect(messages.some((m) => /outside the session directory/.test(m))).toBe(
      true,
    );
    // The confinement guard must not have deleted the out-of-tree directory.
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("refuses a symlinked profile and never removes its outside target", async () => {
    const outside = path.join(tmp, "outside-profile");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "Cookies"), "keep");
    const rec = await craftBrowserRecord({
      type: "browser",
      projectDir,
      status: "error",
      browser: {
        browserPid: 4_194_304,
        browserStartTimeTicks: 1,
        binaryPath: "/usr/bin/chromium",
        profileMode: "ephemeral",
        profileDir: path.join(
          home,
          "sessions",
          "placeholder",
          "profile",
        ),
      },
    });
    if (rec.browser === undefined) {
      throw new Error("Crafted browser record lost its browser leg");
    }
    const sessionDir = browserSessionLogDir(rec.id, registryEnv);
    fs.mkdirSync(sessionDir, { recursive: true });
    const profileDir = path.join(sessionDir, "profile");
    fs.symlinkSync(outside, profileDir);
    await updateSession(
      rec.id,
      {
        browser: {
          ...rec.browser,
          profileDir,
        },
      },
      registryEnv,
    );

    await expect(destroyBrowserSession(rec.id, registryEnv)).rejects.toThrow(
      /Failed to fully destroy browser session/,
    );
    expect(fs.readFileSync(path.join(outside, "Cookies"), "utf8")).toBe("keep");
    expect(fs.lstatSync(profileDir).isSymbolicLink()).toBe(true);
    expect((await getSession(rec.id, registryEnv))?.status).toBe("error");
  });
});
