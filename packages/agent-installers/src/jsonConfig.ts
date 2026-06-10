import fs from "node:fs";
import path from "node:path";
import { backupFile } from "./backup.js";
import { MCP_SERVER_NAME, mcpServerEntry } from "./snippet.js";
import type { ChangeResult, McpServerEntry } from "./types.js";

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
}

async function readJsonObject(
  filePath: string,
): Promise<JsonObject | undefined> {
  const raw = await readTextIfExists(filePath);
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Refusing to edit ${filePath}: invalid JSON ` +
        `(${(error as Error).message}). Fix the file and retry.`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Refusing to edit ${filePath}: expected a top-level JSON object`,
    );
  }
  return parsed;
}

async function writeJsonObject(
  filePath: string,
  value: JsonObject,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function entryMatches(current: unknown, entry: McpServerEntry): boolean {
  if (!isPlainObject(current)) {
    return false;
  }
  return (
    current.command === entry.command &&
    JSON.stringify(current.args) === JSON.stringify(entry.args)
  );
}

export interface JsonMergeOptions {
  createIfMissing: boolean;
  entry?: McpServerEntry;
}

export async function mergeMcpServerIntoJsonFile(
  filePath: string,
  opts: JsonMergeOptions,
): Promise<ChangeResult> {
  const entry = opts.entry ?? mcpServerEntry();
  const existing = await readJsonObject(filePath);
  if (existing === undefined && !opts.createIfMissing) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const config = existing ?? {};
  const servers = isPlainObject(config.mcpServers) ? config.mcpServers : {};
  if (entryMatches(servers[MCP_SERVER_NAME], entry)) {
    return { configPath: filePath, changed: false };
  }
  const backupPath =
    existing === undefined ? undefined : await backupFile(filePath);
  const next: JsonObject = {
    ...config,
    mcpServers: {
      ...servers,
      [MCP_SERVER_NAME]: { command: entry.command, args: entry.args },
    },
  };
  await writeJsonObject(filePath, next);
  return { configPath: filePath, changed: true, backupPath };
}

export async function removeMcpServerFromJsonFile(
  filePath: string,
): Promise<ChangeResult> {
  const existing = await readJsonObject(filePath);
  if (
    existing === undefined ||
    !isPlainObject(existing.mcpServers) ||
    !(MCP_SERVER_NAME in existing.mcpServers)
  ) {
    return { configPath: filePath, changed: false };
  }
  const backupPath = await backupFile(filePath);
  const servers = { ...existing.mcpServers };
  delete servers[MCP_SERVER_NAME];
  await writeJsonObject(filePath, { ...existing, mcpServers: servers });
  return { configPath: filePath, changed: true, backupPath };
}

export async function jsonFileHasMcpServer(
  filePath: string,
): Promise<boolean> {
  let config: JsonObject | undefined;
  try {
    config = await readJsonObject(filePath);
  } catch {
    return false;
  }
  if (config === undefined || !isPlainObject(config.mcpServers)) {
    return false;
  }
  return isPlainObject(config.mcpServers[MCP_SERVER_NAME]);
}
