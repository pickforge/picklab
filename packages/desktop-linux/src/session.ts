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

export function desktopSessionLogDir(id: string, env: EnvLike = process.env): string {
  return path.join(sessionsDir(env), id);
}

export async function createDesktopSession(
  opts: CreateDesktopSessionOptions,
): Promise<DesktopSessionHandle> {
  const env = opts.env ?? process.env;
  const record = await createSession(
    { type: "desktop", projectDir: opts.projectDir },
    env,
  );
  const logDir = desktopSessionLogDir(record.id, env);

  let xvfb: XvfbHandle | undefined;
  let vnc: VncHandle | undefined;
  try {
    xvfb = await startXvfb({
      width: opts.width,
      height: opts.height,
      logDir,
    });
    if (opts.vnc === true) {
      if (detectVncBinary(env) === null) {
        throw new Error(
          "VNC was requested but x11vnc was not found on PATH; install x11vnc to enable it",
        );
      }
      vnc = await startVnc({ display: xvfb.display, logDir });
    }

    const desktop: DesktopSessionInfo = {
      display: xvfb.display,
      xvfbPid: xvfb.pid,
    };
    if (vnc !== undefined) {
      desktop.vncPid = vnc.pid;
      desktop.vncPort = vnc.port;
    }
    await updateSession(record.id, { status: "running", desktop }, env);

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
    await updateSession(record.id, { status: "error" }, env).catch(() => {});
    throw error;
  }
}

export async function destroyDesktopSession(
  id: string,
  env: EnvLike = process.env,
): Promise<void> {
  const record = await getSession(id, env);
  if (record === undefined) {
    throw new Error(`Desktop session not found: ${id}`);
  }
  const desktop = record.desktop;
  if (desktop?.vncPid !== undefined) {
    await stopPid(desktop.vncPid);
  }
  if (desktop?.xvfbPid !== undefined) {
    await stopPid(desktop.xvfbPid);
  }
  await updateSession(id, { status: "stopped" }, env);
  await destroySessionRecord(id, env);
}

export async function getDesktopSessionStatus(
  id: string,
  env: EnvLike = process.env,
): Promise<DesktopSessionStatus> {
  const record = await getSession(id, env);
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
