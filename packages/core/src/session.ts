import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { finalizeActiveEvidenceRun } from "./evidence.js";
import { writeEvidenceReport } from "./evidence-render.js";
import {
  ensureDir,
  isProfileConfined,
  sessionsDir,
  runsDir,
  writeFileAtomic,
  type EnvLike,
} from "./paths.js";
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
  xvfbStartTimeTicks?: number;
  vncPid?: number;
  vncStartTimeTicks?: number;
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
  cdpPort?: number;
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
  await writeFileAtomic(target, serialize(record));
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
export function isDisplaySocketAlive(display: string): boolean {
  const match = /^:(\d+)$/.exec(display);
  if (match === null) return false;
  return fs.existsSync(`/tmp/.X11-unix/X${match[1]}`);
}


export function isSessionProcessAlive(record: SessionRecord): boolean {
  if (record.type === "desktop") {
    const desktop = record.desktop;
    if (desktop?.xvfbPid === undefined) return false;
    return desktop.xvfbStartTimeTicks === undefined
      ? isPidAlive(desktop.xvfbPid)
      : processIdentityMatches({
          pid: desktop.xvfbPid,
          startTicks: desktop.xvfbStartTimeTicks,
        });
  }
  if (record.type === "android") {
    return (
      record.android?.emulatorPid !== undefined &&
      isPidAlive(record.android.emulatorPid)
    );
  }
  if (record.type === "browser") {
    const browser = record.browser;
    const desktop = record.desktop;
    if (
      browser?.browserPid === undefined ||
      desktop?.xvfbPid === undefined ||
      desktop.xvfbStartTimeTicks === undefined
    ) {
      return false;
    }
    return (
      processIdentityMatches({
        pid: desktop.xvfbPid,
        startTicks: desktop.xvfbStartTimeTicks,
      }) &&
      isDisplaySocketAlive(desktop.display) &&
      processIdentityMatches({
        pid: browser.browserPid,
        startTicks: browser.browserStartTimeTicks,
      })
    );
  }


  const desktop = record.desktop;
  const desktopAlive =
    desktop?.xvfbPid === undefined
      ? false
      : desktop.xvfbStartTimeTicks === undefined
        ? isPidAlive(desktop.xvfbPid)
        : processIdentityMatches({
            pid: desktop.xvfbPid,
            startTicks: desktop.xvfbStartTimeTicks,
          });
  const alive = [
    desktopAlive,
    record.android?.emulatorPid === undefined
      ? false
      : isPidAlive(record.android.emulatorPid),
  ];
  return alive.some(Boolean);
}

export const REAPER_CLEANUP_PENDING_META_KEY = "reaperCleanupPending";

export async function reapDeadRunningSessions(
  env: EnvLike = process.env,
  isAlive: SessionLivenessCheck = isSessionProcessAlive,
): Promise<SessionRecord[]> {
  const reaped: SessionRecord[] = [];
  for (const record of await listSessions(env)) {
    const retryPending =
      record.status === "error" &&
      record.meta?.[REAPER_CLEANUP_PENDING_META_KEY] === true;
    if (record.status !== "running" && !retryPending) continue;
    if (!retryPending && (await isAlive(record))) continue;
    if (!(await stopRecordedPids(record, env))) {
      await updateSession(
        record.id,
        {
          status: "error",
          meta: {
            ...record.meta,
            [REAPER_CLEANUP_PENDING_META_KEY]: true,
          },
        },
        env,
      ).catch(() => {});
      continue;
    }
    try {
      await destroySessionRecord(record.id, env, "failed");
    } catch {
      await updateSession(
        record.id,
        {
          status: "error",
          meta: {
            ...record.meta,
            [REAPER_CLEANUP_PENDING_META_KEY]: true,
          },
        },
        env,
      ).catch(() => {});
      continue;
    }
    reaped.push(record);
  }
  return reaped;
}

async function stopRecordedGroup(
  pid: number,
  startTicks: number,
): Promise<boolean> {
  try {
    const result = await stopProcessGroupVerified({ pid, startTicks });
    return (
      result.outcome === "terminated" || result.outcome === "already-dead"
    );
  } catch {
    return false;
  }
}

async function stopRecordedPids(
  record: SessionRecord,
  env: EnvLike,
): Promise<boolean> {
  const browser = record.browser;
  if (
    browser !== undefined &&
    !(await stopRecordedGroup(
      browser.browserPid,
      browser.browserStartTimeTicks,
    ))
  ) {
    return false;
  }

  const desktop = record.desktop;
  const vncPid = desktop?.vncPid;
  const vncStartTimeTicks = desktop?.vncStartTimeTicks;
  if (vncPid !== undefined && isPidAlive(vncPid)) {
    if (
      vncStartTimeTicks === undefined ||
      !processIdentityMatches({
        pid: vncPid,
        startTicks: vncStartTimeTicks,
      })
    ) {
      return false;
    }
    try {
      if (!(await stopPid(vncPid))) return false;
    } catch {
      return false;
    }
  }

  const emulatorPid = record.android?.emulatorPid;
  if (emulatorPid !== undefined && isPidAlive(emulatorPid)) {
    try {
      if (!(await stopPid(emulatorPid))) return false;
    } catch {
      return false;
    }
  }

  if (desktop?.xvfbPid !== undefined) {
    if (desktop.xvfbStartTimeTicks === undefined) {
      if (isPidAlive(desktop.xvfbPid)) return false;
    } else if (
      !(await stopRecordedGroup(
        desktop.xvfbPid,
        desktop.xvfbStartTimeTicks,
      ))
    ) {
      return false;
    }
  }

  const pendingBrowserCleanup =
    record.type === "browser" &&
    record.meta?.[REAPER_CLEANUP_PENDING_META_KEY] === true;
  if (browser?.profileMode === "ephemeral" || pendingBrowserCleanup) {
    const sessionDir = path.join(sessionsDir(env), record.id);
    const profileDir = browser?.profileDir ?? path.join(sessionDir, "profile");
    if (!(await isProfileConfined(sessionDir, profileDir))) {
      return false;
    }
    try {
      await fs.promises.rm(sessionDir, { recursive: true, force: true });
    } catch {
      return false;
    }
  }
  return true;
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
  evidenceStatus: "completed" | "failed" = "completed",
): Promise<void> {
  if (!isValidSessionId(id)) {
    throw invalidSessionIdError(id);
  }
  const record = await getSession(id, env);
  if (record !== undefined) {
    const finalized = await finalizeActiveEvidenceRun(
      record.projectDir,
      record.id,
      evidenceStatus,
    ).catch(() => undefined);
    if (finalized !== undefined) {
      await writeEvidenceReport(
        path.join(runsDir(record.projectDir), finalized.runId),
        finalized,
      ).catch(() => {});
    }
  }
  await fs.promises.rm(sessionPath(id, env), { force: true });
}
