import fs from "node:fs";
import path from "node:path";
import { sleep } from "./util.js";

const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * Parse the CDP port from a `DevToolsActivePort` file. Chrome writes the port
 * on the first line and the browser websocket path (a per-launch GUID) on the
 * second. We read only the port; the GUID is a capability URL and must never be
 * persisted, so this function never returns or exposes the second line.
 */
export function parseDevToolsActivePort(content: string): number | undefined {
  const firstLine = content.split("\n", 1)[0]?.trim();
  if (firstLine === undefined || firstLine === "") {
    return undefined;
  }
  const port = Number(firstLine);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return undefined;
  }
  return port;
}

/** Read the CDP port from `<profileDir>/DevToolsActivePort`, if present. */
export function readDevToolsActivePort(profileDir: string): number | undefined {
  let content: string;
  try {
    content = fs.readFileSync(
      path.join(profileDir, "DevToolsActivePort"),
      "utf8",
    );
  } catch {
    return undefined;
  }
  return parseDevToolsActivePort(content);
}

export type DevToolsPortResult =
  | { ok: true; port: number }
  | { ok: false; reason: "aborted" | "exited" | "timeout" };

export interface WaitForDevToolsPortOptions {
  profileDir: string;
  timeoutMs: number;
  /** Liveness probe for the Chrome process; a dead process ends the wait. */
  isAlive: () => boolean;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}

/**
 * Poll for the CDP port to appear. Resolves as soon as the port is readable,
 * fails fast if Chrome exits during startup, and fails with `timeout` if the
 * deadline passes while Chrome is still alive but has not published a port.
 */
export async function waitForDevToolsPort(
  opts: WaitForDevToolsPortOptions,
): Promise<DevToolsPortResult> {
  const poll = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    if (opts.signal?.aborted === true) {
      return { ok: false, reason: "aborted" };
    }
    const port = readDevToolsActivePort(opts.profileDir);
    if (port !== undefined) {
      return { ok: true, port };
    }
    if (!opts.isAlive()) {
      // One last read closes the race where Chrome wrote the port and exited
      // (or was reaped) between our port read and the liveness probe.
      const last = readDevToolsActivePort(opts.profileDir);
      return last !== undefined
        ? { ok: true, port: last }
        : { ok: false, reason: "exited" };
    }
    if (Date.now() >= deadline) {
      return { ok: false, reason: "timeout" };
    }
    await sleep(poll);
  }
}
