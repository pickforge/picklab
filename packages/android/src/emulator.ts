import {
  isPidAlive,
  runCommand,
  startDaemon,
  stopPid,
  type EnvLike,
} from "@pickforge/picklab-core";
import { assertSerial, listDevices, resolveAdb } from "./adb.js";
import { assertAvdName, DEFAULT_AVD_NAME } from "./avd.js";
import { findSdkTool } from "./sdk.js";
import { sleep } from "./util.js";

export const MIN_CONSOLE_PORT = 5554;
export const MAX_CONSOLE_PORT = 5682;

const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_BOOT_POLL_INTERVAL_MS = 2_000;
const GETPROP_TIMEOUT_MS = 10_000;
const EMU_KILL_TIMEOUT_MS = 10_000;
const EMU_KILL_POLL_INTERVAL_MS = 200;

export interface EmulatorArgsOptions {
  avdName: string;
  headless?: boolean;
  port?: number;
}

export interface StartEmulatorOptions {
  avdName?: string;
  sdk?: string | null;
  headless?: boolean;
  port?: number;
  logDir: string;
  env?: EnvLike;
  bootTimeoutMs?: number;
  bootPollIntervalMs?: number;
}

export interface EmulatorHandle {
  pid: number;
  serial: string;
  consolePort: number;
  logPath: string;
}

export interface WaitForBootOptions {
  serial: string;
  adbPath: string;
  env?: EnvLike;
  timeoutMs?: number;
  pollIntervalMs?: number;
  isEmulatorAlive?: () => boolean;
  logPath?: string;
}

export interface StopEmulatorOptions {
  serial?: string;
  pid?: number;
  sdk?: string | null;
  env?: EnvLike;
  timeoutMs?: number;
}

export function assertConsolePort(port: number): void {
  if (
    !Number.isInteger(port) ||
    port < MIN_CONSOLE_PORT ||
    port > MAX_CONSOLE_PORT ||
    port % 2 !== 0
  ) {
    throw new Error(
      `Invalid console port ${port}: expected an even integer between ` +
        `${MIN_CONSOLE_PORT} and ${MAX_CONSOLE_PORT}`,
    );
  }
}

export function emulatorSerial(consolePort: number): string {
  assertConsolePort(consolePort);
  return `emulator-${consolePort}`;
}

export function buildEmulatorArgs(opts: EmulatorArgsOptions): string[] {
  assertAvdName(opts.avdName);
  const port = opts.port ?? MIN_CONSOLE_PORT;
  assertConsolePort(port);
  const args = ["-avd", opts.avdName];
  if (opts.headless !== false) {
    args.push("-no-window");
  }
  args.push("-no-audio", "-no-boot-anim", "-port", String(port));
  return args;
}

export function pickConsolePort(usedSerials: readonly string[]): number {
  const used = new Set<number>();
  for (const serial of usedSerials) {
    const match = /^emulator-(\d+)$/.exec(serial);
    if (match !== null) {
      used.add(Number(match[1]));
    }
  }
  for (let port = MIN_CONSOLE_PORT; port <= MAX_CONSOLE_PORT; port += 2) {
    if (!used.has(port)) {
      return port;
    }
  }
  throw new Error(
    `No free emulator console port between ${MIN_CONSOLE_PORT} and ${MAX_CONSOLE_PORT}`,
  );
}

export async function waitForBoot(opts: WaitForBootOptions): Promise<void> {
  assertSerial(opts.serial);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_BOOT_POLL_INTERVAL_MS;
  const logHint =
    opts.logPath !== undefined ? `; check the log at ${opts.logPath}` : "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (opts.isEmulatorAlive !== undefined && !opts.isEmulatorAlive()) {
      throw new Error(
        `Emulator for ${opts.serial} exited before finishing boot${logHint}`,
      );
    }
    const result = await runCommand(
      opts.adbPath,
      ["-s", opts.serial, "shell", "getprop", "sys.boot_completed"],
      { env: opts.env, timeoutMs: GETPROP_TIMEOUT_MS },
    );
    if (result.ok && result.stdout.trim() === "1") {
      return;
    }
    if (Date.now() + pollIntervalMs > deadline) {
      throw new Error(
        `Emulator ${opts.serial} did not finish booting within ${timeoutMs}ms${logHint}`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

async function allocateConsolePort(opts: {
  sdk?: string | null;
  env?: EnvLike;
}): Promise<number> {
  try {
    const devices = await listDevices(opts);
    return pickConsolePort(devices.map((device) => device.serial));
  } catch {
    return MIN_CONSOLE_PORT;
  }
}

export async function startEmulator(
  opts: StartEmulatorOptions,
): Promise<EmulatorHandle> {
  const avdName = opts.avdName ?? DEFAULT_AVD_NAME;
  const env = opts.env ?? process.env;
  const emulator = findSdkTool(opts.sdk, "emulator", env);
  if (emulator === null) {
    throw new Error(
      "Android emulator binary not found (<sdk>/emulator/emulator or PATH); " +
        'install it with: sdkmanager "emulator", or set ANDROID_HOME',
    );
  }
  const adbPath = resolveAdb(opts);

  const port = opts.port ?? (await allocateConsolePort(opts));
  const args = buildEmulatorArgs({
    avdName,
    headless: opts.headless,
    port,
  });
  const serial = emulatorSerial(port);

  const sdkEnv: EnvLike =
    opts.sdk !== null && opts.sdk !== undefined
      ? { ANDROID_HOME: opts.sdk, ANDROID_SDK_ROOT: opts.sdk }
      : {};
  const daemon = await startDaemon(emulator, args, {
    logDir: opts.logDir,
    name: "emulator",
    env: { ...sdkEnv, ...opts.env },
  });

  try {
    await waitForBoot({
      serial,
      adbPath,
      env: opts.env,
      timeoutMs: opts.bootTimeoutMs,
      pollIntervalMs: opts.bootPollIntervalMs,
      isEmulatorAlive: () => isPidAlive(daemon.pid),
      logPath: daemon.logPath,
    });
  } catch (error) {
    await stopPid(daemon.pid).catch(() => {});
    throw error;
  }

  return { pid: daemon.pid, serial, consolePort: port, logPath: daemon.logPath };
}

export async function stopEmulator(
  opts: StopEmulatorOptions,
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? EMU_KILL_TIMEOUT_MS;
  let adbPath: string | null = null;
  try {
    adbPath = resolveAdb(opts);
  } catch {
    adbPath = null;
  }

  let sentEmuKill = false;
  if (opts.serial !== undefined && adbPath !== null) {
    assertSerial(opts.serial);
    const killResult = await runCommand(
      adbPath,
      ["-s", opts.serial, "emu", "kill"],
      { env: opts.env, timeoutMs: 5_000 },
    ).catch(() => null);
    sentEmuKill = killResult !== null && killResult.ok;
  }

  if (opts.pid !== undefined) {
    if (sentEmuKill) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && isPidAlive(opts.pid)) {
        await sleep(EMU_KILL_POLL_INTERVAL_MS);
      }
    }
    if (isPidAlive(opts.pid)) {
      return stopPid(opts.pid);
    }
    return true;
  }

  if (opts.serial !== undefined && adbPath !== null) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const devices = await listDevices(opts);
        if (!devices.some((device) => device.serial === opts.serial)) {
          return true;
        }
      } catch {
        return true;
      }
      await sleep(EMU_KILL_POLL_INTERVAL_MS);
    }
    return false;
  }

  return true;
}
