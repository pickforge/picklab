import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, sessionsDir, type EnvLike } from "./paths.js";

export type SessionType = "desktop" | "android" | "desktop+android";
export type SessionStatus = "starting" | "running" | "stopped" | "error";

export interface DesktopSessionInfo {
  display: string;
  xvfbPid?: number;
  vncPid?: number;
  vncPort?: number;
}

export interface AndroidSessionInfo {
  avdName: string;
  serial?: string;
  emulatorPid?: number;
  consolePort?: number;
}

export interface SessionRecord {
  id: string;
  type: SessionType;
  createdAt: string;
  status: SessionStatus;
  projectDir: string;
  desktop?: DesktopSessionInfo;
  android?: AndroidSessionInfo;
  meta?: Record<string, unknown>;
}

export interface CreateSessionInput {
  type: SessionType;
  projectDir: string;
  status?: SessionStatus;
  desktop?: DesktopSessionInfo;
  android?: AndroidSessionInfo;
  meta?: Record<string, unknown>;
}

const ID_PREFIXES: Record<SessionType, string> = {
  desktop: "desk",
  android: "andr",
  "desktop+android": "duo",
};

function newSessionId(type: SessionType): string {
  return `${ID_PREFIXES[type]}-${randomBytes(3).toString("hex")}`;
}

function sessionPath(id: string, env: EnvLike): string {
  return path.join(sessionsDir(env), `${id}.json`);
}

async function writeSession(
  record: SessionRecord,
  env: EnvLike,
): Promise<void> {
  const dir = await ensureDir(sessionsDir(env));
  const target = path.join(dir, `${record.id}.json`);
  const tmp = path.join(dir, `.${record.id}.json.tmp-${process.pid}`);
  await fs.promises.writeFile(
    tmp,
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  await fs.promises.rename(tmp, target);
}

export async function createSession(
  input: CreateSessionInput,
  env: EnvLike = process.env,
): Promise<SessionRecord> {
  const record: SessionRecord = {
    id: newSessionId(input.type),
    type: input.type,
    createdAt: new Date().toISOString(),
    status: input.status ?? "starting",
    projectDir: input.projectDir,
  };
  if (input.desktop !== undefined) record.desktop = input.desktop;
  if (input.android !== undefined) record.android = input.android;
  if (input.meta !== undefined) record.meta = input.meta;
  await writeSession(record, env);
  return record;
}

export async function getSession(
  id: string,
  env: EnvLike = process.env,
): Promise<SessionRecord | undefined> {
  try {
    const raw = await fs.promises.readFile(sessionPath(id, env), "utf8");
    return JSON.parse(raw) as SessionRecord;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
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
    const record = await getSession(entry.slice(0, -".json".length), env);
    if (record !== undefined) records.push(record);
  }
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records;
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<SessionRecord, "id">>,
  env: EnvLike = process.env,
): Promise<SessionRecord> {
  const existing = await getSession(id, env);
  if (existing === undefined) {
    throw new Error(`Session not found: ${id}`);
  }
  const updated: SessionRecord = { ...existing, ...patch, id: existing.id };
  await writeSession(updated, env);
  return updated;
}

export async function destroySessionRecord(
  id: string,
  env: EnvLike = process.env,
): Promise<void> {
  await fs.promises.rm(sessionPath(id, env), { force: true });
}
