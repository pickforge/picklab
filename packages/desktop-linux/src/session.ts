import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import {
  REAPER_CLEANUP_PENDING_META_KEY,
  createSession,
  destroySessionRecord,
  getSession,
  isPidAlive,
  processIdentityMatches,
  reapDeadRunningSessions,
  sessionsDir,
  stopPid,
  stopProcessGroupVerified,
  updateSession,
  type DesktopSessionInfo,
  type EnvLike,
  type SessionRecord,
} from "@pickforge/picklab-core";
import {
  XvfbStartError,
  isDisplayAlive,
  startXvfb,
  type XvfbHandle,
  type XvfbPartialStart,
} from "./display.js";
import { detectVncBinary, startVnc, type VncHandle } from "./vnc.js";

export interface CreateDesktopSessionOptions {
  projectDir: string;
  registryEnv?: EnvLike;
  env?: EnvLike;
  width?: number;
  height?: number;
  vnc?: boolean;
  vncControl?: boolean;
}

export interface DesktopSessionHandle {
  id: string;
  display: string;
  xvfbPid: number;
  vncPid?: number;
  vncPort?: number;
  vncViewOnly?: boolean;
  logDir: string;
}

export interface DesktopSessionStatus {
  record: SessionRecord;
  xvfbAlive: boolean;
  vncAlive: boolean;
  displayAlive: boolean;
}

export interface EnsureSessionVncOptions {
  registryEnv?: EnvLike;
  env?: EnvLike;
}

export interface EnsuredSessionVnc {
  pid: number;
  port: number;
  reused: boolean;
}

export function desktopSessionLogDir(
  id: string,
  registryEnv: EnvLike = process.env,
): string {
  return path.join(sessionsDir(registryEnv), id);
}

export async function createDesktopSession(
  opts: CreateDesktopSessionOptions,
): Promise<DesktopSessionHandle> {
  const registryEnv = opts.registryEnv ?? process.env;
  const wantsVnc = opts.vnc === true || opts.vncControl === true;
  if (
    wantsVnc &&
    detectVncBinary({ ...process.env, ...opts.env }) === null
  ) {
    throw new Error(
      "VNC was requested but x11vnc was not found on PATH; install x11vnc to enable it",
    );
  }
  await reapDeadRunningSessions(registryEnv);
  const record = await createSession(
    { type: "desktop", projectDir: opts.projectDir },
    registryEnv,
  );
  const logDir = desktopSessionLogDir(record.id, registryEnv);

  let xvfb: XvfbHandle | undefined;
  let xvfbPartial: XvfbPartialStart | undefined;
  let xvfbStartTimeTicks: number | undefined;
  let vnc: VncHandle | undefined;
  try {
    try {
      xvfb = await startXvfb({
        width: opts.width,
        height: opts.height,
        logDir,
        env: opts.env,
        onSpawn: async (partial) => {
          xvfbPartial = partial;
          await updateSession(
            record.id,
            {
              desktop: {
                display: partial.display,
                xvfbPid: partial.pid,
                xvfbStartTimeTicks: partial.startTimeTicks,
                width: partial.width,
                height: partial.height,
              },
            },
            registryEnv,
          );
        },
      });
    } catch (error) {
      if (error instanceof XvfbStartError && error.partial !== undefined) {
        xvfbPartial = error.partial;
      }
      throw error;
    }
    xvfbStartTimeTicks = xvfb.startTimeTicks;
    if (wantsVnc) {
      vnc = await startVnc({
        display: xvfb.display,
        logDir,
        env: opts.env,
        viewOnly: opts.vncControl !== true,
      });
    }

    const desktop: DesktopSessionInfo = {
      display: xvfb.display,
      xvfbPid: xvfb.pid,
      xvfbStartTimeTicks,
      width: xvfb.width,
      height: xvfb.height,
    };
    if (vnc !== undefined) {
      desktop.vncPid = vnc.pid;
      desktop.vncPort = vnc.port;
      desktop.vncViewOnly = opts.vncControl !== true;
    }
    await updateSession(record.id, { status: "running", desktop }, registryEnv);

    const handle: DesktopSessionHandle = {
      id: record.id,
      display: xvfb.display,
      xvfbPid: xvfb.pid,
      logDir,
    };
    if (vnc !== undefined) {
      handle.vncPid = vnc.pid;
      handle.vncPort = vnc.port;
      handle.vncViewOnly = opts.vncControl !== true;
    }
    return handle;
  } catch (error) {
    let vncGone = vnc === undefined;
    if (vnc !== undefined) {
      vncGone = await stopPid(vnc.pid).catch(() => false);
    }
    let xvfbGone =
      xvfb === undefined
        ? (xvfbPartial?.cleanupConfirmed ?? true)
        : false;
    if (xvfb !== undefined && xvfbStartTimeTicks !== undefined) {
      try {
        const result = await stopProcessGroupVerified({
          pid: xvfb.pid,
          startTicks: xvfbStartTimeTicks,
        });
        xvfbGone =
          result.outcome === "terminated" || result.outcome === "already-dead";
      } catch {
        xvfbGone = false;
      }
    }
    const cleanupComplete = vncGone && xvfbGone;
    const knownXvfb = xvfb ?? xvfbPartial;
    const knownXvfbStartTimeTicks =
      knownXvfb !== undefined && xvfbPartial?.pid === knownXvfb.pid
        ? xvfbPartial.startTimeTicks
        : xvfbStartTimeTicks;
    const clearedMeta = { ...record.meta };
    delete clearedMeta[REAPER_CLEANUP_PENDING_META_KEY];
    await updateSession(
      record.id,
      cleanupComplete
        ? { status: "error", desktop: undefined, meta: clearedMeta }
        : {
            status: "error",
            meta: {
              ...record.meta,
              [REAPER_CLEANUP_PENDING_META_KEY]: true,
            },
            ...(knownXvfb === undefined
              ? {}
              : {
                  desktop: {
                    display: knownXvfb.display,
                    xvfbPid: knownXvfb.pid,
                    ...(knownXvfbStartTimeTicks === undefined
                      ? {}
                      : { xvfbStartTimeTicks: knownXvfbStartTimeTicks }),
                    ...(vnc === undefined ? {} : { vncPid: vnc.pid }),
                    width: knownXvfb.width,
                    height: knownXvfb.height,
                  },
                }),
          },
      registryEnv,
    ).catch(() => {});
    throw error;
  }
}

const VNC_LOCK_TIMEOUT_MS = 10_000;
const VNC_LOCK_POLL_MS = 25;

interface VncLockOwner {
  pid: number;
  token: string;
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function readVncLockOwner(lockPath: string): Promise<VncLockOwner | null> {
  try {
    const value: unknown = JSON.parse(
      await fs.promises.readFile(lockPath, "utf8"),
    );
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      typeof value.pid === "number" &&
      Number.isInteger(value.pid) &&
      "token" in value &&
      typeof value.token === "string"
    ) {
      return { pid: value.pid, token: value.token };
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
  }
  return null;
}

async function acquireSessionVncLock(
  id: string,
  registryEnv: EnvLike,
): Promise<() => Promise<void>> {
  const logDir = desktopSessionLogDir(id, registryEnv);
  await fs.promises.mkdir(logDir, { recursive: true });
  const lockPath = path.join(logDir, "ensure-vnc.lock");
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + VNC_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const handle = await fs.promises.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(owner), "utf8");
      } finally {
        await handle.close();
      }
      return async () => {
        const current = await readVncLockOwner(lockPath);
        if (current?.token === owner.token) {
          await fs.promises.unlink(lockPath).catch(() => {});
        }
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const current = await readVncLockOwner(lockPath);
    if (current !== null && !isPidAlive(current.pid)) {
      await fs.promises.unlink(lockPath).catch(() => {});
      continue;
    }
    if (current === null) {
      try {
        const stat = await fs.promises.stat(lockPath);
        if (Date.now() - stat.mtimeMs >= VNC_LOCK_TIMEOUT_MS) {
          await fs.promises.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting to ensure VNC for session ${id}`);
    }
    await sleep(VNC_LOCK_POLL_MS);
  }
}

export async function ensureSessionVnc(
  id: string,
  opts: EnsureSessionVncOptions = {},
): Promise<EnsuredSessionVnc> {
  const registryEnv = opts.registryEnv ?? process.env;
  if ((await getSession(id, registryEnv)) === undefined) {
    throw new Error(`Session not found: ${id}`);
  }
  const releaseLock = await acquireSessionVncLock(id, registryEnv);
  try {
    const record = await getSession(id, registryEnv);
    if (record === undefined) {
      throw new Error(`Session not found: ${id}`);
    }
    const desktop = record.desktop;
    if (desktop?.display === undefined) {
      throw new Error(`Session ${id} is not desktop-capable`);
    }
    if (record.status !== "running") {
      throw new Error(`Session ${id} is not running`);
    }
    if (desktop.vncPid !== undefined && isPidAlive(desktop.vncPid)) {
      if (desktop.vncViewOnly !== true) {
        throw new Error(
          `Session ${id} has an active writable VNC server; watch requires server-enforced read-only VNC`,
        );
      }
      if (desktop.vncPort === undefined) {
        throw new Error(
          `Session ${id} has an active VNC server with no port recorded`,
        );
      }
      return { pid: desktop.vncPid, port: desktop.vncPort, reused: true };
    }

    const vnc = await startVnc({
      display: desktop.display,
      port: desktop.vncPort,
      logDir: desktopSessionLogDir(id, registryEnv),
      env: opts.env,
      viewOnly: true,
    });
    try {
      await updateSession(
        id,
        {
          desktop: {
            ...desktop,
            vncPid: vnc.pid,
            vncPort: vnc.port,
            vncViewOnly: true,
          },
        },
        registryEnv,
      );
    } catch (error) {
      await stopPid(vnc.pid).catch(() => {});
      throw error;
    }
    return { pid: vnc.pid, port: vnc.port, reused: false };
  } finally {
    await releaseLock();
  }
}

export async function destroyDesktopSession(
  id: string,
  registryEnv: EnvLike = process.env,
): Promise<void> {
  const record = await getSession(id, registryEnv);
  if (record === undefined) {
    throw new Error(`Desktop session not found: ${id}`);
  }
  const desktop = record.desktop;
  const failures: Error[] = [];
  const stops: Array<[string, number]> = [];
  if (desktop?.vncPid !== undefined) {
    stops.push(["x11vnc", desktop.vncPid]);
  }
  for (const [label, pid] of stops) {
    try {
      const stopped = await stopPid(pid);
      if (!stopped) {
        failures.push(
          new Error(`${label} (pid ${pid}) survived SIGTERM and SIGKILL`),
        );
      }
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error(`Failed to stop ${label} (pid ${pid}): ${String(error)}`),
      );
    }
  }
  const xvfbPid = desktop?.xvfbPid;
  const xvfbStartTimeTicks = desktop?.xvfbStartTimeTicks;
  if (xvfbPid !== undefined) {
    if (xvfbStartTimeTicks === undefined) {
      if (isPidAlive(xvfbPid)) {
        failures.push(
          new Error(
            `Refusing to stop Xvfb (pid ${xvfbPid}): process identity is unavailable`,
          ),
        );
      }
    } else {
      try {
        const result = await stopProcessGroupVerified({
          pid: xvfbPid,
          startTicks: xvfbStartTimeTicks,
        });
        if (
          result.outcome !== "terminated" &&
          result.outcome !== "already-dead"
        ) {
          failures.push(
            new Error(
              `Xvfb process group (pid ${xvfbPid}) could not be verified as gone`,
            ),
          );
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }
  if (failures.length > 0) {
    await updateSession(
      id,
      {
        status: "error",
        meta: {
          ...record.meta,
          [REAPER_CLEANUP_PENDING_META_KEY]: true,
        },
      },
      registryEnv,
    ).catch(() => {});
    throw new AggregateError(
      failures,
      `Failed to stop ${failures.length} process(es) of desktop session ${id}`,
    );
  }
  await destroySessionRecord(id, registryEnv);
}

export async function getDesktopSessionStatus(
  id: string,
  registryEnv: EnvLike = process.env,
): Promise<DesktopSessionStatus> {
  const record = await getSession(id, registryEnv);
  if (record === undefined) {
    throw new Error(`Desktop session not found: ${id}`);
  }
  const desktop = record.desktop;
  return {
    record,
    xvfbAlive:
      desktop?.xvfbPid !== undefined &&
      (desktop.xvfbStartTimeTicks === undefined
        ? isPidAlive(desktop.xvfbPid)
        : processIdentityMatches({
            pid: desktop.xvfbPid,
            startTicks: desktop.xvfbStartTimeTicks,
          })),
    vncAlive: desktop?.vncPid !== undefined && isPidAlive(desktop.vncPid),
    displayAlive: desktop !== undefined && isDisplayAlive(desktop.display),
  };
}
