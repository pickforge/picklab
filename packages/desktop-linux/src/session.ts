import path from "node:path";
import {
  createSession,
  destroySessionRecord,
  getSession,
  isPidAlive,
  sessionsDir,
  stopPid,
  updateSession,
  type DesktopSessionInfo,
  type EnvLike,
  type SessionRecord,
} from "@pickforge/picklab-core";
import { isDisplayAlive, startXvfb, type XvfbHandle } from "./display.js";
import { detectVncBinary, startVnc, type VncHandle } from "./vnc.js";

export interface CreateDesktopSessionOptions {
  projectDir: string;
  registryEnv?: EnvLike;
  env?: EnvLike;
  width?: number;
  height?: number;
  vnc?: boolean;
}

export interface DesktopSessionHandle {
  id: string;
  display: string;
  xvfbPid: number;
  vncPid?: number;
  vncPort?: number;
  logDir: string;
}

export interface DesktopSessionStatus {
  record: SessionRecord;
  xvfbAlive: boolean;
  vncAlive: boolean;
  displayAlive: boolean;
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
  if (
    opts.vnc === true &&
    detectVncBinary({ ...process.env, ...opts.env }) === null
  ) {
    throw new Error(
      "VNC was requested but x11vnc was not found on PATH; install x11vnc to enable it",
    );
  }
  const record = await createSession(
    { type: "desktop", projectDir: opts.projectDir },
    registryEnv,
  );
  const logDir = desktopSessionLogDir(record.id, registryEnv);

  let xvfb: XvfbHandle | undefined;
  let vnc: VncHandle | undefined;
  try {
    xvfb = await startXvfb({
      width: opts.width,
      height: opts.height,
      logDir,
      env: opts.env,
    });
    if (opts.vnc === true) {
      vnc = await startVnc({ display: xvfb.display, logDir, env: opts.env });
    }

    const desktop: DesktopSessionInfo = {
      display: xvfb.display,
      xvfbPid: xvfb.pid,
    };
    if (vnc !== undefined) {
      desktop.vncPid = vnc.pid;
      desktop.vncPort = vnc.port;
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
    }
    return handle;
  } catch (error) {
    if (vnc !== undefined) {
      await stopPid(vnc.pid).catch(() => {});
    }
    if (xvfb !== undefined) {
      await stopPid(xvfb.pid).catch(() => {});
    }
    await updateSession(record.id, { status: "error" }, registryEnv).catch(
      () => {},
    );
    throw error;
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
  if (desktop?.xvfbPid !== undefined) {
    stops.push(["Xvfb", desktop.xvfbPid]);
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
  if (failures.length > 0) {
    await updateSession(id, { status: "error" }, registryEnv).catch(() => {});
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
    xvfbAlive: desktop?.xvfbPid !== undefined && isPidAlive(desktop.xvfbPid),
    vncAlive: desktop?.vncPid !== undefined && isPidAlive(desktop.vncPid),
    displayAlive: desktop !== undefined && isDisplayAlive(desktop.display),
  };
}
