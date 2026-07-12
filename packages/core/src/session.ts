import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, sessionsDir, type EnvLike } from "./paths.js";
import {
  isPidAlive,
  processIdentityMatches,
  stopPid,
  stopProcessGroupVerified,
} from "./proc.js";

export type SessionType = "desktop" | "android" | "desktop+android" | "browser";
export type SessionStatus = "starting" | "running" | "stopped" | "error";

export interface DesktopSessionInfo {
  display: string;
  xvfbPid?: number;
  vncPid?: number;
  vncPort?: number;
  vncViewOnly?: boolean;
  width?: number;
  height?: number;
}

export interface AndroidSessionInfo {
  avdName: string;
  serial?: string;
  emulatorPid?: number;
  consolePort?: number;
}

export interface BrowserSessionInfo {
  browserPid: number;
  browserStartTimeTicks: number;
  binaryPath: string;
  profileMode: "ephemeral";
  profileDir: string;
  cdpPort: number;
}

export interface SessionRecord {
  id: string;
  type: SessionType;
  createdAt: string;
  status: SessionStatus;
  projectDir: string;
  desktop?: DesktopSessionInfo;
  android?: AndroidSessionInfo;
  browser?: BrowserSessionInfo;
  meta?: Record<string, unknown>;
}

export interface CreateSessionInput {
  type: SessionType;
  projectDir: string;
  status?: SessionStatus;
  desktop?: DesktopSessionInfo;
  android?: AndroidSessionInfo;
  browser?: BrowserSessionInfo;
  meta?: Record<string, unknown>;
}

export type SessionLivenessCheck = (
  record: SessionRecord,
) => boolean | Promise<boolean>;

const ID_PREFIXES: Record<SessionType, string> = {
  desktop: "desk",
  android: "andr",
  "desktop+android": "duo",
  browser: "brow",
};

const SESSION_ID_PATTERN = /^(desk|andr|duo|brow)-[0-9a-f]{6,}$/;
const MAX_ID_ATTEMPTS = 5;

let tmpCounter = 0;

function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

function invalidSessionIdError(id: string): Error {
  return new Error(
    `Invalid session id "${id}": must match ${SESSION_ID_PATTERN}`,
  );
}

function newSessionId(type: SessionType): string {
  return `${ID_PREFIXES[type]}-${randomBytes(4).toString("hex")}`;
}

function sessionPath(id: string, env: EnvLike): string {
  return path.join(sessionsDir(env), `${id}.json`);
}

function serialize(record: SessionRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

async function writeSession(
  record: SessionRecord,
  env: EnvLike,
): Promise<void> {
  const dir = await ensureDir(sessionsDir(env));
  const target = path.join(dir, `${record.id}.json`);
  tmpCounter += 1;
  const tmp = path.join(
    dir,
    `.${record.id}.json.tmp-${process.pid}-${tmpCounter}`,
  );
  await fs.promises.writeFile(tmp, serialize(record), "utf8");
  await fs.promises.rename(tmp, target);
}

export async function createSession(
  input: CreateSessionInput,
  env: EnvLike = process.env,
): Promise<SessionRecord> {
  await ensureDir(sessionsDir(env));
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const record: SessionRecord = {
      id: newSessionId(input.type),
      type: input.type,
      createdAt: new Date().toISOString(),
      status: input.status ?? "starting",
      projectDir: input.projectDir,
    };
    if (input.desktop !== undefined) record.desktop = input.desktop;
    if (input.android !== undefined) record.android = input.android;
    if (input.browser !== undefined) record.browser = input.browser;
    if (input.meta !== undefined) record.meta = input.meta;
    try {
      await fs.promises.writeFile(sessionPath(record.id, env), serialize(record), {
        encoding: "utf8",
        flag: "wx",
      });
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error(
    `Failed to allocate a unique session id after ${MAX_ID_ATTEMPTS} attempts`,
  );
}

export async function getSession(
  id: string,
  env: EnvLike = process.env,
): Promise<SessionRecord | undefined> {
  if (!isValidSessionId(id)) {
    return undefined;
  }
  const filePath = sessionPath(id, env);
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch (error) {
    throw new Error(
      `Invalid session record at ${filePath}: ${(error as Error).message}`,
    );
  }
}

export async function listSessions(
  env: EnvLike = process.env,
): Promise<SessionRecord[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(sessionsDir(env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records: SessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.startsWith(".")) continue;
    let record: SessionRecord | undefined;
    try {
      record = await getSession(entry.slice(0, -".json".length), env);
    } catch {
      continue;
    }
    if (record !== undefined) records.push(record);
  }
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records;
}

export function isSessionProcessAlive(record: SessionRecord): boolean {
  if (record.type === "desktop") {
    return (
      record.desktop?.xvfbPid !== undefined &&
      isPidAlive(record.desktop.xvfbPid)
    );
  }
  if (record.type === "android") {
    return (
      record.android?.emulatorPid !== undefined &&
      isPidAlive(record.android.emulatorPid)
    );
  }
  if (record.type === "browser") {
    const browser = record.browser;
    const xvfbPid = record.desktop?.xvfbPid;
    if (browser?.browserPid === undefined || xvfbPid === undefined) return false;
    return (
      isPidAlive(xvfbPid) &&
      processIdentityMatches({
        pid: browser.browserPid,
        startTicks: browser.browserStartTimeTicks,
      })
    );
  }

  const alive = [
    record.desktop?.xvfbPid === undefined
      ? false
      : isPidAlive(record.desktop.xvfbPid),
    record.android?.emulatorPid === undefined
      ? false
      : isPidAlive(record.android.emulatorPid),
  ];
  return alive.some(Boolean);
}

export async function reapDeadRunningSessions(
  env: EnvLike = process.env,
  isAlive: SessionLivenessCheck = isSessionProcessAlive,
): Promise<SessionRecord[]> {
  const reaped: SessionRecord[] = [];
  for (const record of await listSessions(env)) {
    if (record.status !== "running") continue;
    if (await isAlive(record)) continue;
    await stopRecordedPids(record);
    await destroySessionRecord(record.id, env);
    reaped.push(record);
  }
  return reaped;
}

async function stopRecordedPids(record: SessionRecord): Promise<void> {
  const pids = new Set(
    [
      record.desktop?.xvfbPid,
      record.desktop?.vncPid,
      record.android?.emulatorPid,
    ].filter((pid): pid is number => pid !== undefined),
  );
  for (const pid of pids) {
    if (!isPidAlive(pid)) {
      continue;
    }
    try {
      await stopPid(pid);
    } catch {
      continue;
    }
  }
  const browser = record.browser;
  if (browser?.browserPid !== undefined) {
    try {
      await stopProcessGroupVerified({
        pid: browser.browserPid,
        startTicks: browser.browserStartTimeTicks,
      });
    } catch {
      // Best-effort cleanup: never let a stubborn browser leg block reaping.
    }
  }
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<SessionRecord, "id" | "type" | "createdAt">>,
  env: EnvLike = process.env,
): Promise<SessionRecord> {
  if (!isValidSessionId(id)) {
    throw invalidSessionIdError(id);
  }
  const existing = await getSession(id, env);
  if (existing === undefined) {
    throw new Error(`Session not found: ${id}`);
  }
  const updated: SessionRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    type: existing.type,
    createdAt: existing.createdAt,
  };
  await writeSession(updated, env);
  return updated;
}

export async function destroySessionRecord(
  id: string,
  env: EnvLike = process.env,
): Promise<void> {
  if (!isValidSessionId(id)) {
    throw invalidSessionIdError(id);
  }
  await fs.promises.rm(sessionPath(id, env), { force: true });
}
