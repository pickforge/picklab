import fs from "node:fs";
import path from "node:path";
import type { EnvLike } from "@pickforge/picklab-core";
import {
  jsonFileHasMcpServer,
  mergeMcpServerIntoJsonFile,
  removeMcpServerFromJsonFile,
} from "../jsonConfig.js";
import type { ChangeResult } from "../types.js";
import { homeDir } from "./home.js";

export const CLAUDE_CODE_MANUAL_COMMAND =
  "claude mcp add --scope user picklab -- picklab mcp serve";

export function claudeCodeConfigPath(env: EnvLike = process.env): string {
  return path.join(homeDir(env), ".claude.json");
}

export async function claudeCodeIsRegistered(
  configPath: string,
): Promise<boolean> {
  return jsonFileHasMcpServer(configPath);
}

export async function linkClaudeCode(
  configPath: string,
): Promise<ChangeResult> {
  let exists = false;
  try {
    await fs.promises.access(configPath, fs.constants.F_OK);
    exists = true;
  } catch {
    exists = false;
  }
  if (!exists) {
    return {
      configPath,
      changed: false,
      instructions:
        `Claude Code config not found at ${configPath}; register manually ` +
        `with: ${CLAUDE_CODE_MANUAL_COMMAND}`,
    };
  }
  return mergeMcpServerIntoJsonFile(configPath, { createIfMissing: false });
}

export async function unlinkClaudeCode(
  configPath: string,
): Promise<ChangeResult> {
  return removeMcpServerFromJsonFile(configPath);
}
