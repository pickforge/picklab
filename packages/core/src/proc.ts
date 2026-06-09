import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;
const POLL_INTERVAL_MS = 50;

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
  check?: boolean;
  input?: string;
}

export interface RunCommandResult {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class CommandError extends Error {
  readonly result: RunCommandResult;

  constructor(cmd: string, args: readonly string[], result: RunCommandResult) {
    super(
      `Command failed (exit ${result.code ?? `signal ${result.signal}`}` +
        `${result.timedOut ? ", timed out" : ""}): ${cmd} ${args.join(" ")}`,
    );
    this.name = "CommandError";
    this.result = result;
  }
}

export function runCommand(
  cmd: string,
  args: readonly string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let termTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const collect = (
      chunks: Buffer[],
      counted: number,
      chunk: Buffer,
    ): number => {
      if (counted >= maxBytes) return counted;
      const remaining = maxBytes - counted;
      chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
      return counted + chunk.length;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = collect(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = collect(stderrChunks, stderrBytes, chunk);
    });

    if (opts.timeoutMs !== undefined) {
      termTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
      }, opts.timeoutMs);
    }

    child.on("error", (error) => {
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      const result: RunCommandResult = {
        ok: code === 0 && !timedOut,
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
      };
      if (opts.check && !result.ok) {
        reject(new CommandError(cmd, args, result));
        return;
      }
      resolve(result);
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

export interface StartDaemonOptions {
  logDir: string;
  name?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface DaemonHandle {
  pid: number;
  logPath: string;
}

export function startDaemon(
  cmd: string,
  args: readonly string[],
  opts: StartDaemonOptions,
): DaemonHandle {
  fs.mkdirSync(opts.logDir, { recursive: true });
  const name = opts.name ?? path.basename(cmd);
  const logPath = path.join(opts.logDir, `${name}.log`);
  const fd = fs.openSync(logPath, "a");
  try {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      shell: false,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    if (child.pid === undefined) {
      throw new Error(`Failed to start daemon: ${cmd}`);
    }
    child.unref();
    return { pid: child.pid, logPath };
  } finally {
    fs.closeSync(fd);
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

export async function stopPid(
  pid: number,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  if (!isPidAlive(pid)) return true;

  signalPid(pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(POLL_INTERVAL_MS);
  }

  signalPid(pid, "SIGKILL");
  const killDeadline = Date.now() + 1_000;
  while (Date.now() < killDeadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return !isPidAlive(pid);
}
