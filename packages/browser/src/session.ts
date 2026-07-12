import fs from "node:fs";
import path from "node:path";
import {
  createSession,
  destroySessionRecord,
  getSession,
  isPidAlive,
  isProfileConfined,
  processIdentityMatches,
  reapDeadRunningSessions,
  readProcessIdentity,
  sessionsDir,
  startDaemon,
  stopProcessGroupVerified,
  updateSession,
  type BrowserSessionInfo,
  type DesktopSessionInfo,
  type EnvLike,
  type ProcessIdentity,
  type SessionRecord,
} from "@pickforge/picklab-core";
import {
  isDisplayAlive,
  startXvfb,
  stopXvfb,
  type XvfbHandle,
} from "@pickforge/picklab-desktop-linux";
import { buildChromeArgs } from "./args.js";
import { requireChromeBinary } from "./detect.js";
import {
  browserRuntimeLayout,
  buildBrowserEnv,
  type BrowserRuntimeLayout,
} from "./env.js";
import { waitForDevToolsPort } from "./devtools.js";
import { buildSupervisedBrowserCommand } from "./supervisor.js";
import { asError } from "./util.js";

const DEFAULT_CDP_TIMEOUT_MS = 20_000;
// A browser session also launches a heavy real Chrome, so its private Xvfb can
// be scheduled slowly on a busy host. Give the display generous headroom rather
// than the display supervisor's default so a loaded machine does not fail the
// whole create.
const DEFAULT_XVFB_WAIT_TIMEOUT_MS = 30_000;
// Allocate browser displays from a range separate from desktop sessions (which
// start at :90) so the two kinds never contend for the same display number.
const BROWSER_DISPLAY_START = 200;

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Browser session creation aborted by the client");
  }
}

export interface CreateBrowserSessionOptions {
  projectDir: string;
  /** Registry env (PICKLAB_HOME) for session records. */
  registryEnv?: EnvLike;
  /** Spawn env: source for PATH, locale, and Chrome binary detection. */
  env?: EnvLike;
  width?: number;
  height?: number;
  binaryPath?: string;
  noSandbox?: boolean;
  extraArgs?: string[];
  startUrl?: string;
  cdpTimeoutMs?: number;
  xvfbWaitTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserSessionHandle {
  id: string;
  display: string;
  xvfbPid: number;
  browserPid: number;
  cdpPort: number;
  profileDir: string;
  binaryPath: string;
  logDir: string;
}

export interface BrowserSessionStatus {
  record: SessionRecord;
  xvfbAlive: boolean;
  displayAlive: boolean;
  browserAlive: boolean;
  /** True only when both legs (Xvfb display and Chrome identity) are live. */
  alive: boolean;
  cdpPort?: number;
}

export function browserSessionDir(
  id: string,
  registryEnv: EnvLike = process.env,
): string {
  return path.join(sessionsDir(registryEnv), id);
}

async function makeRuntimeDirs(layout: BrowserRuntimeLayout): Promise<void> {
  await fs.promises.mkdir(layout.profileDir, { recursive: true });
  await fs.promises.mkdir(layout.xdgConfigHome, { recursive: true });
  await fs.promises.mkdir(layout.xdgCacheHome, { recursive: true });
  await fs.promises.mkdir(layout.xdgDataHome, { recursive: true });
  await fs.promises.mkdir(layout.xdgStateHome, { recursive: true });
  await fs.promises.mkdir(layout.tmpDir, { recursive: true });
  await fs.promises.mkdir(layout.xdgRuntimeDir, { recursive: true });
  // XDG_RUNTIME_DIR must be private per the spec, and Chrome complains loudly
  // otherwise.
  await fs.promises.chmod(layout.xdgRuntimeDir, 0o700).catch(() => {});
}

async function removeRuntimeData(layout: BrowserRuntimeLayout): Promise<void> {
  for (const dir of [
    layout.profileDir,
    layout.homeDir,
    layout.xdgRuntimeDir,
    layout.tmpDir,
  ]) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stop a browser's process group, re-verifying the group-leader identity before
 * every signal so a reused PID is never killed. Returns whether the group is
 * confirmed gone; the caller must not delete the profile until it is.
 */
async function stopBrowserGroup(
  identity: ProcessIdentity | undefined,
): Promise<{ gone: boolean; error?: Error }> {
  if (identity === undefined) {
    return { gone: true };
  }
  try {
    const result = await stopProcessGroupVerified(identity);
    return {
      gone:
        result.outcome === "terminated" || result.outcome === "already-dead",
    };
  } catch (error) {
    return { gone: false, error: asError(error) };
  }
}

/**
 * Create an isolated headed-Chrome session: a private Xvfb display plus a headed
 * Chrome on an ephemeral profile with a loopback CDP endpoint. Any partial
 * failure tears down every process and deletes the profile before rethrowing,
 * so a failed create leaves no orphaned process group and no profile data.
 */
export async function createBrowserSession(
  opts: CreateBrowserSessionOptions,
): Promise<BrowserSessionHandle> {
  const registryEnv = opts.registryEnv ?? process.env;
  const spawnEnv = opts.env ?? process.env;
  assertNotAborted(opts.signal);
  const binaryPath = requireChromeBinary({
    env: spawnEnv,
    ...(opts.binaryPath !== undefined ? { binaryPath: opts.binaryPath } : {}),
  });

  await reapDeadRunningSessions(registryEnv);
  const record = await createSession(
    { type: "browser", projectDir: opts.projectDir },
    registryEnv,
  );
  const logDir = browserSessionDir(record.id, registryEnv);
  const layout = browserRuntimeLayout(logDir);

  let xvfb: XvfbHandle | undefined;
  let browserIdentity: ProcessIdentity | undefined;
  try {
    await makeRuntimeDirs(layout);

    xvfb = await startXvfb({
      ...(opts.width !== undefined ? { width: opts.width } : {}),
      ...(opts.height !== undefined ? { height: opts.height } : {}),
      logDir,
      env: spawnEnv,
      waitTimeoutMs: opts.xvfbWaitTimeoutMs ?? DEFAULT_XVFB_WAIT_TIMEOUT_MS,
      displayStart: BROWSER_DISPLAY_START,
    });

    const args = buildChromeArgs({
      profileDir: layout.profileDir,
      width: xvfb.width,
      height: xvfb.height,
      noSandbox: opts.noSandbox ?? spawnEnv.PICKLAB_CHROME_NO_SANDBOX === "1",
      ...(opts.extraArgs !== undefined ? { extraArgs: opts.extraArgs } : {}),
      ...(opts.startUrl !== undefined ? { startUrl: opts.startUrl } : {}),
    });
    const childEnv = buildBrowserEnv({
      display: xvfb.display,
      layout,
      sourceEnv: spawnEnv,
    });
    assertNotAborted(opts.signal);
    const supervised = buildSupervisedBrowserCommand(
      process.execPath,
      binaryPath,
      args,
    );
    const daemon = await startDaemon(supervised.command, supervised.args, {
      logDir,
      name: "chrome",
      env: childEnv,
      cleanEnv: true,
    });
    // Snapshot identity immediately so cleanup can target the exact process
    // group even if Chrome dies before it publishes a port.
    browserIdentity = readProcessIdentity(daemon.pid);

    const waited = await waitForDevToolsPort({
      profileDir: layout.profileDir,
      timeoutMs: opts.cdpTimeoutMs ?? DEFAULT_CDP_TIMEOUT_MS,
      isAlive: () =>
        browserIdentity !== undefined && processIdentityMatches(browserIdentity),
      signal: opts.signal,
    });
    if (!waited.ok) {
      if (waited.reason === "aborted") {
        throw new Error("Browser session creation aborted by the client");
      }
      throw new Error(
        waited.reason === "exited"
          ? `Chrome exited during startup before exposing a DevTools port; ` +
            `check the log at ${daemon.logPath}`
          : `Chrome did not expose a DevTools port within ` +
            `${opts.cdpTimeoutMs ?? DEFAULT_CDP_TIMEOUT_MS}ms; ` +
            `check the log at ${daemon.logPath}`,
      );
    }

    const identity = readProcessIdentity(daemon.pid);
    if (identity === undefined) {
      throw new Error(
        `Chrome process ${daemon.pid} vanished right after startup; ` +
          `check the log at ${daemon.logPath}`,
      );
    }
    browserIdentity = identity;

    const desktop: DesktopSessionInfo = {
      display: xvfb.display,
      xvfbPid: xvfb.pid,
      width: xvfb.width,
      height: xvfb.height,
    };
    const browser: BrowserSessionInfo = {
      browserPid: identity.pid,
      browserStartTimeTicks: identity.startTicks,
      binaryPath,
      profileMode: "ephemeral",
      profileDir: layout.profileDir,
      cdpPort: waited.port,
    };
    await updateSession(
      record.id,
      { status: "running", desktop, browser },
      registryEnv,
    );

    return {
      id: record.id,
      display: xvfb.display,
      xvfbPid: xvfb.pid,
      browserPid: identity.pid,
      cdpPort: waited.port,
      profileDir: layout.profileDir,
      binaryPath,
      logDir,
    };
  } catch (error) {
    const { gone } = await stopBrowserGroup(browserIdentity);
    if (gone && xvfb !== undefined) {
      await stopXvfb(xvfb.pid).catch(() => {});
    }
    if (gone) {
      await removeRuntimeData(layout);
    }
    await updateSession(record.id, { status: "error" }, registryEnv).catch(
      () => {},
    );
    throw error;
  }
}

export async function getBrowserSessionStatus(
  id: string,
  registryEnv: EnvLike = process.env,
): Promise<BrowserSessionStatus> {
  const record = await getSession(id, registryEnv);
  if (record === undefined) {
    throw new Error(`Browser session not found: ${id}`);
  }
  const desktop = record.desktop;
  const browser = record.browser;
  const xvfbAlive =
    desktop?.xvfbPid !== undefined && isPidAlive(desktop.xvfbPid);
  const displayAlive =
    desktop !== undefined && isDisplayAlive(desktop.display);
  const browserAlive =
    browser !== undefined &&
    processIdentityMatches({
      pid: browser.browserPid,
      startTicks: browser.browserStartTimeTicks,
    });
  return {
    record,
    xvfbAlive,
    displayAlive,
    browserAlive,
    alive: xvfbAlive && browserAlive,
    ...(browser?.cdpPort !== undefined ? { cdpPort: browser.cdpPort } : {}),
  };
}

/**
 * Destroy a browser session: kill the verified Chrome process group and confirm
 * it is dead, stop the private Xvfb, then delete the ephemeral profile. The
 * profile is removed only after the group is confirmed gone, so no live Chrome
 * can recreate files after deletion. Cleanup failures aggregate into one error
 * and leave the record in `error` state for inspection.
 */
export async function destroyBrowserSession(
  id: string,
  registryEnv: EnvLike = process.env,
): Promise<void> {
  const record = await getSession(id, registryEnv);
  if (record === undefined) {
    throw new Error(`Browser session not found: ${id}`);
  }
  const browser = record.browser;
  if (browser === undefined) {
    throw new Error(`Session ${id} is not a browser session`);
  }

  const failures: Error[] = [];

  const { gone, error: groupError } = await stopBrowserGroup({
    pid: browser.browserPid,
    startTicks: browser.browserStartTimeTicks,
  });
  if (groupError !== undefined) {
    failures.push(groupError);
  } else if (!gone) {
    failures.push(
      new Error(
        `Chrome process group (pid ${browser.browserPid}) survived SIGTERM and SIGKILL`,
      ),
    );
  }

  const xvfbPid = record.desktop?.xvfbPid;
  if (xvfbPid !== undefined && gone) {
    try {
      const stopped = await stopXvfb(xvfbPid);
      if (!stopped) {
        failures.push(
          new Error(`Xvfb (pid ${xvfbPid}) survived SIGTERM and SIGKILL`),
        );
      }
    } catch (error) {
      failures.push(asError(error));
    }
  } else if (xvfbPid !== undefined) {
    failures.push(
      new Error(
        `Refusing to stop Xvfb for ${id}: Chrome process group is not confirmed gone`,
      ),
    );
  }

  const sessionDir = browserSessionDir(id, registryEnv);
  const layout = browserRuntimeLayout(sessionDir);
  // Confinement guard: never delete a profile path a tampered record points
  // outside the session directory.
  const confined = isProfileConfined(sessionDir, browser.profileDir);
  if (!confined) {
    failures.push(
      new Error(
        `Refusing to delete profile outside the session directory: ${browser.profileDir}`,
      ),
    );
  } else if (gone) {
    await removeRuntimeData(layout);
  } else {
    failures.push(
      new Error(
        `Refusing to delete profile for ${id}: Chrome process group is still alive`,
      ),
    );
  }

  if (failures.length > 0) {
    await updateSession(id, { status: "error" }, registryEnv).catch(() => {});
    throw new AggregateError(
      failures,
      `Failed to fully destroy browser session ${id}`,
    );
  }
  await destroySessionRecord(id, registryEnv);
}
