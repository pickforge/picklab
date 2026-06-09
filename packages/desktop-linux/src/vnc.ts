import {
  isPidAlive,
  startDaemon,
  type EnvLike,
} from "@pickforge/picklab-core";
import { parseDisplayNumber } from "./display.js";
import { findOnPath, sleep } from "./util.js";

const VNC_BASE_PORT = 5900;
const STARTUP_GRACE_MS = 300;

export interface VncArgsOptions {
  display: string;
  port: number;
}

export interface StartVncOptions {
  display: string;
  port?: number;
  logDir: string;
}

export interface VncHandle {
  pid: number;
  port: number;
  logPath: string;
}

function assertValidPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port ${port}: expected an integer in 1-65535`);
  }
}

export function buildVncArgs(opts: VncArgsOptions): string[] {
  parseDisplayNumber(opts.display);
  assertValidPort(opts.port);
  return [
    "-display",
    opts.display,
    "-rfbport",
    String(opts.port),
    "-forever",
    "-shared",
    "-nopw",
    "-quiet",
  ];
}

export function detectVncBinary(env: EnvLike = process.env): string | null {
  return findOnPath("x11vnc", env);
}

export async function startVnc(opts: StartVncOptions): Promise<VncHandle> {
  const port = opts.port ?? VNC_BASE_PORT + parseDisplayNumber(opts.display);
  const args = buildVncArgs({ display: opts.display, port });
  const daemon = await startDaemon("x11vnc", args, {
    logDir: opts.logDir,
    name: "x11vnc",
  });
  await sleep(STARTUP_GRACE_MS);
  if (!isPidAlive(daemon.pid)) {
    throw new Error(
      `x11vnc exited immediately after start on ${opts.display}; ` +
        `check the log at ${daemon.logPath}`,
    );
  }
  return { pid: daemon.pid, port, logPath: daemon.logPath };
}
