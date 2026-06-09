import { runCommand, startDaemon } from "@pickforge/picklab-core";
import { parseDisplayNumber } from "./display.js";
import { sleep } from "./util.js";

const XDOTOOL_TIMEOUT_MS = 5_000;
const WINDOW_POLL_INTERVAL_MS = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

export interface LaunchAppOptions {
  display: string;
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  logDir: string;
  cwd?: string;
}

export interface AppHandle {
  pid: number;
  logPath: string;
}

export interface WindowInfo {
  id: string;
  name: string;
}

export async function launchApp(opts: LaunchAppOptions): Promise<AppHandle> {
  parseDisplayNumber(opts.display);
  const daemon = await startDaemon(opts.command, opts.args ?? [], {
    logDir: opts.logDir,
    cwd: opts.cwd,
    env: { ...opts.env, DISPLAY: opts.display },
  });
  return { pid: daemon.pid, logPath: daemon.logPath };
}

export async function listWindows(display: string): Promise<WindowInfo[]> {
  parseDisplayNumber(display);
  const search = await runCommand(
    "xdotool",
    ["search", "--onlyvisible", "--name", "."],
    { env: { DISPLAY: display }, timeoutMs: XDOTOOL_TIMEOUT_MS },
  );
  if (!search.ok) {
    return [];
  }
  const ids = search.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));

  const windows: WindowInfo[] = [];
  for (const id of ids) {
    const nameResult = await runCommand("xdotool", ["getwindowname", id], {
      env: { DISPLAY: display },
      timeoutMs: XDOTOOL_TIMEOUT_MS,
    });
    windows.push({
      id,
      name: nameResult.ok ? nameResult.stdout.replace(/\n$/, "") : "",
    });
  }
  return windows;
}

export async function waitForWindow(
  display: string,
  namePattern: string | RegExp,
  timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
): Promise<WindowInfo> {
  const pattern =
    typeof namePattern === "string" ? new RegExp(namePattern) : namePattern;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: WindowInfo[] = [];
  for (;;) {
    lastSeen = await listWindows(display);
    const match = lastSeen.find((win) => pattern.test(win.name));
    if (match !== undefined) {
      return match;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleep(WINDOW_POLL_INTERVAL_MS);
  }
  const seen = lastSeen.map((win) => JSON.stringify(win.name)).join(", ");
  throw new Error(
    `No window matching ${pattern} appeared on ${display} within ${timeoutMs}ms` +
      (seen === "" ? "" : `; visible windows: ${seen}`),
  );
}
