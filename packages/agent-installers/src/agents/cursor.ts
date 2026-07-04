import path from "node:path";
import type { EnvLike } from "@pickforge/picklab-core";
import {
  jsonFileMcpServerState,
  mergeMcpServerIntoJsonFile,
  removeMcpServerFromJsonFile,
} from "../jsonConfig.js";
import { mcpServerEntry } from "../snippet.js";
import type { ChangeResult, RegistrationState } from "../types.js";
import { homeDir } from "./home.js";

export function cursorConfigPath(env: EnvLike = process.env): string {
  return path.join(homeDir(env), ".cursor", "mcp.json");
}

export async function cursorIsRegistered(
  configPath: string,
): Promise<RegistrationState> {
  return jsonFileMcpServerState(configPath, { expected: mcpServerEntry() });
}

export async function linkCursor(configPath: string): Promise<ChangeResult> {
  return mergeMcpServerIntoJsonFile(configPath, { createIfMissing: true });
}

export async function unlinkCursor(configPath: string): Promise<ChangeResult> {
  return removeMcpServerFromJsonFile(configPath);
}
