import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;
const POLL_INTERVAL_MS = 50;

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  cleanEnv?: boolean;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
  check?: boolean;
  input?: string;
  binary?: boolean;
}

export interface RunCommandResult {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stdoutBuffer?: Buffer;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export class CommandError extends Error {
  readonly result: RunCommandResult;

  constructor(cmd: string, args: readonly string[], result: RunCommandResult) {
    const reason =
      result.code !== null
        ? `exited with code ${result.code}`
        : `killed with signal ${result.signal ?? "unknown"}`;
    super(
      `Command failed (${reason}${result.timedOut ? ", timed out" : ""}): ` +
        `${cmd} ${args.join(" ")}`,
    );
    this.name = "CommandError";
    this.result = result;
  }
}

function resolveEnv(opts: {
  env?: Record<string, string | undefined>;
  cleanEnv?: boolean;
}): NodeJS.ProcessEnv {
  if (opts.cleanEnv) {
    return (opts.env ?? {}) as NodeJS.ProcessEnv;
  }
  return { ...process.env, ...opts.env } as NodeJS.ProcessEnv;
}

export function runCommand(
  cmd: string,
  args: readonly string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: resolveEnv(opts),
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const timers: NodeJS.Timeout[] = [];

    const collect = (
      chunks: Buffer[],
      counted: number,
      chunk: Buffer,
    ): number => {
      if (counted >= maxBytes) return counted + chunk.length;
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

    const buildResult = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): RunCommandResult => {
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const result: RunCommandResult = {
        ok: code === 0 && !timedOut,
        code,
        signal,
        stdout: stdoutBuffer.toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        stdoutTruncated: stdoutBytes > maxBytes,
        stderrTruncated: stderrBytes > maxBytes,
      };
      if (opts.binary) {
        result.stdoutBuffer = stdoutBuffer;
      }
      return result;
    };

    const settle = (result: RunCommandResult): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      if (opts.check && !result.ok) {
        reject(new CommandError(cmd, args, result));
        return;
      }
      resolve(result);
    };

    const killTree = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // fall through to direct kill
        }
      }
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    };

    if (opts.timeoutMs !== undefined) {
      timers.push(
        setTimeout(() => {
          timedOut = true;
          killTree("SIGTERM");
          timers.push(
            setTimeout(() => {
              killTree("SIGKILL");
              timers.push(
                setTimeout(() => {
                  child.stdout.destroy();
                  child.stderr.destroy();
                  child.stdin.destroy();
                  settle(
                    buildResult(exitCode, exited ? exitSignal : "SIGKILL"),
                  );
                }, killGraceMs),
              );
            }, killGraceMs),
          );
        }, opts.timeoutMs),
      );
    }

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
    });

    child.on("close", (code, signal) => {
      settle(buildResult(code, signal));
    });

    child.stdin.on("error", () => {
      // child exited before consuming stdin (EPIPE); output collection continues
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
  cleanEnv?: boolean;
}

export interface DaemonHandle {
  pid: number;
  logPath: string;
}

export async function startDaemon(
  cmd: string,
  args: readonly string[],
  opts: StartDaemonOptions,
): Promise<DaemonHandle> {
  await fs.promises.mkdir(opts.logDir, { recursive: true });
  const name = opts.name ?? path.basename(cmd);
  const logPath = path.join(opts.logDir, `${name}.log`);
  const fd = fs.openSync(logPath, "a");

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: resolveEnv(opts),
      shell: false,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }

  return new Promise<DaemonHandle>((resolve, reject) => {
    const onSpawn = (): void => {
      cleanup();
      if (child.pid === undefined) {
        reject(new Error(`Failed to start daemon: ${cmd}`));
        return;
      }
      child.unref();
      resolve({ pid: child.pid, logPath });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
      fs.closeSync(fd);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
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
