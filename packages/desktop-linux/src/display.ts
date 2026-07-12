import fs from "node:fs";
import {
  isPidAlive,
  startDaemon,
  stopPid,
  type EnvLike,
} from "@pickforge/picklab-core";
import { sleep } from "./util.js";

const DISPLAY_PATTERN = /^:\d+$/;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const DEFAULT_DEPTH = 24;
const DEFAULT_START_DISPLAY = 90;
const DEFAULT_MAX_ATTEMPTS = 200;
const SOCKET_POLL_INTERVAL_MS = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const ALLOCATION_RETRY_LIMIT = 5;

export interface XvfbArgsOptions {
  display: string;
  width?: number;
  height?: number;
  depth?: number;
}

export interface StartXvfbOptions extends Partial<XvfbArgsOptions> {
  logDir: string;
  waitTimeoutMs?: number;
  env?: EnvLike;
}

export interface XvfbHandle {
  display: string;
  pid: number;
  logPath: string;
  width: number;
  height: number;
}

export function parseDisplayNumber(display: string): number {
  if (!DISPLAY_PATTERN.test(display)) {
    throw new Error(
      `Invalid display "${display}": expected the form ":<number>"`,
    );
  }
  return Number.parseInt(display.slice(1), 10);
}

function displaySocketPath(displayNumber: number): string {
  return `/tmp/.X11-unix/X${displayNumber}`;
}

function displayLockPath(displayNumber: number): string {
  return `/tmp/.X${displayNumber}-lock`;
}

function readLockPid(displayNumber: number): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(displayLockPath(displayNumber), "utf8");
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label} ${value}: expected a positive integer`);
  }
}

export function buildXvfbArgs(opts: XvfbArgsOptions): string[] {
  parseDisplayNumber(opts.display);
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const depth = opts.depth ?? DEFAULT_DEPTH;
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  assertPositiveInteger(depth, "depth");
  return [
    opts.display,
    "-screen",
    "0",
    `${width}x${height}x${depth}`,
    "-nolisten",
    "tcp",
  ];
}

export interface AllocateDisplayOptions {
  start?: number;
  maxAttempts?: number;
}

export function allocateDisplay(opts: AllocateDisplayOptions = {}): string {
  const start = opts.start ?? DEFAULT_START_DISPLAY;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let n = start; n < start + maxAttempts; n += 1) {
    if (
      !fs.existsSync(displayLockPath(n)) &&
      !fs.existsSync(displaySocketPath(n))
    ) {
      return `:${n}`;
    }
  }
  throw new Error(
    `No free X display found between :${start} and :${start + maxAttempts - 1}`,
  );
}

export function isDisplayAlive(display: string): boolean {
  return fs.existsSync(displaySocketPath(parseDisplayNumber(display)));
}

type XvfbAttempt =
  | { outcome: "ready"; handle: XvfbHandle }
  | { outcome: "exited" | "lost-race" | "timeout"; logPath: string };

async function attemptStartXvfb(
  display: string,
  opts: StartXvfbOptions,
): Promise<XvfbAttempt> {
  const displayNumber = parseDisplayNumber(display);
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const args = buildXvfbArgs({
    display,
    width: opts.width,
    height: opts.height,
    depth: opts.depth,
  });
  const daemon = await startDaemon("Xvfb", args, {
    logDir: opts.logDir,
    name: "xvfb",
    env: opts.env,
  });

  const timeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = isPidAlive(daemon.pid);
    if (fs.existsSync(displaySocketPath(displayNumber))) {
      const lockPid = readLockPid(displayNumber);
      if (
        lockPid !== null &&
        lockPid !== daemon.pid &&
        isPidAlive(lockPid)
      ) {
        await stopPid(daemon.pid);
        return { outcome: "lost-race", logPath: daemon.logPath };
      }
      if (alive && (lockPid === null || lockPid === daemon.pid)) {
        return {
          outcome: "ready",
          handle: { display, pid: daemon.pid, logPath: daemon.logPath, width, height },
        };
      }
    }
    if (!alive) {
      return { outcome: "exited", logPath: daemon.logPath };
    }
    await sleep(SOCKET_POLL_INTERVAL_MS);
  }

  await stopPid(daemon.pid);
  return { outcome: "timeout", logPath: daemon.logPath };
}

function describeXvfbFailure(
  attempt: Exclude<XvfbAttempt, { outcome: "ready" }>,
  display: string,
  timeoutMs: number,
): string {
  switch (attempt.outcome) {
    case "exited":
      return (
        `Xvfb exited during startup on ${display}; ` +
        `check the log at ${attempt.logPath}`
      );
    case "lost-race":
      return (
        `Xvfb could not claim ${display}: another X server owns it; ` +
        `check the log at ${attempt.logPath}`
      );
    case "timeout":
      return (
        `Xvfb did not come up on ${display} within ${timeoutMs}ms; ` +
        `check the log at ${attempt.logPath}`
      );
  }
}

export async function startXvfb(opts: StartXvfbOptions): Promise<XvfbHandle> {
  const timeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (opts.display !== undefined) {
    const attempt = await attemptStartXvfb(opts.display, opts);
    if (attempt.outcome === "ready") {
      return attempt.handle;
    }
    throw new Error(describeXvfbFailure(attempt, opts.display, timeoutMs));
  }

  let searchFrom = DEFAULT_START_DISPLAY;
  let lastFailureMessage = "";
  for (let retry = 0; retry < ALLOCATION_RETRY_LIMIT; retry += 1) {
    const display = allocateDisplay({ start: searchFrom });
    const attempt = await attemptStartXvfb(display, opts);
    if (attempt.outcome === "ready") {
      return attempt.handle;
    }
    lastFailureMessage = describeXvfbFailure(attempt, display, timeoutMs);
    if (attempt.outcome === "timeout") {
      throw new Error(lastFailureMessage);
    }
    searchFrom = parseDisplayNumber(display) + 1;
  }
  throw new Error(
    `Xvfb failed to claim a free display after ${ALLOCATION_RETRY_LIMIT} attempts; ` +
      `last failure: ${lastFailureMessage}`,
  );
}

export async function stopXvfb(pid: number): Promise<boolean> {
  return stopPid(pid);
}
