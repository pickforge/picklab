import net from "node:net";
import {
  isPidAlive,
  startDaemon,
  stopPid,
  type EnvLike,
} from "@pickforge/picklab-core";
import { parseDisplayNumber } from "./display.js";
import { findOnPath, sleep } from "./util.js";

const VNC_BASE_PORT = 5900;
const STARTUP_TIMEOUT_MS = 5_000;
const STARTUP_POLL_INTERVAL_MS = 100;

export interface VncArgsOptions {
  display: string;
  port: number;
}

export interface StartVncOptions {
  display: string;
  port?: number;
  logDir: string;
  env?: EnvLike;
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

export async function startVnc(opts: StartVncOptions): Promise<VncHandle> {
  const port = opts.port ?? VNC_BASE_PORT + parseDisplayNumber(opts.display);
  const args = buildVncArgs({ display: opts.display, port });
  const binary = detectVncBinary({ ...process.env, ...opts.env });
  if (binary === null) {
    throw new Error(
      "x11vnc was not found on PATH; install x11vnc to enable VNC",
    );
  }
  const daemon = await startDaemon(binary, args, {
    logDir: opts.logDir,
    name: "x11vnc",
    env: opts.env,
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isPidAlive(daemon.pid)) {
      throw new Error(
        `x11vnc exited during startup on ${opts.display}; ` +
          `check the log at ${daemon.logPath}`,
      );
    }
    if (await isPortListening(port)) {
      return { pid: daemon.pid, port, logPath: daemon.logPath };
    }
    await sleep(STARTUP_POLL_INTERVAL_MS);
  }

  await stopPid(daemon.pid);
  throw new Error(
    `x11vnc did not start listening on 127.0.0.1:${port} ` +
      `within ${STARTUP_TIMEOUT_MS}ms; check the log at ${daemon.logPath}`,
  );
}
