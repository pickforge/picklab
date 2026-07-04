import fs from "node:fs";
import path from "node:path";
import { runCommand, type EnvLike } from "@pickforge/picklab-core";
import {
  jsonFileMcpServerState,
  mergeMcpServerIntoJsonFile,
  removeMcpServerFromJsonFile,
} from "../jsonConfig.js";
import { mcpServerEntry } from "../snippet.js";
import type { ChangeResult, RegistrationState } from "../types.js";
import { homeDir } from "./home.js";

export const CLAUDE_CODE_MANUAL_COMMAND =
  "claude mcp add --scope user picklab -- picklab mcp serve";

const DIRECT_EDIT_WARNING =
  "the claude binary was not found on PATH, so the config file was edited " +
  "directly; close Claude Code while linking, or it may overwrite the change";

export function claudeCodeConfigPath(env: EnvLike = process.env): string {
  return path.join(homeDir(env), ".claude.json");
}

export function findClaudeBinary(
  env: EnvLike = process.env,
): string | undefined {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") {
      continue;
    }
    const candidate = path.join(dir, "claude");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function commandFailure(
  action: string,
  result: { code: number | null; stdout: string; stderr: string },
): Error {
  const output = result.stderr.trim() || result.stdout.trim();
  return new Error(
    `"claude mcp ${action}" failed (exit code ${result.code ?? "unknown"})` +
      (output === "" ? "" : `: ${output}`),
  );
}

function isAlreadyRegisteredAddFailure(result: {
  stdout: string;
  stderr: string;
}): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    output.includes("mcp") &&
    output.includes("picklab") &&
    output.includes("already exists")
  );
}

function isNotFoundRemoveFailure(result: {
  stdout: string;
  stderr: string;
}): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return output.includes("not found") || output.includes("no mcp server");
}

async function removeClaudeMcpServer(
  claudeBin: string,
  env: EnvLike,
): Promise<boolean> {
  const result = await runCommand(
    claudeBin,
    ["mcp", "remove", "--scope", "user", "picklab"],
    { env: { ...env }, cleanEnv: true },
  );
  if (result.ok) {
    return true;
  }
  if (isNotFoundRemoveFailure(result)) {
    return false;
  }
  throw commandFailure("remove", result);
}

async function addClaudeMcpServer(
  claudeBin: string,
  env: EnvLike,
): Promise<{ code: number | null; ok: boolean; stdout: string; stderr: string }> {
  return runCommand(
    claudeBin,
    [
      "mcp",
      "add",
      "--scope",
      "user",
      "picklab",
      "--",
      "picklab",
      "mcp",
      "serve",
    ],
    { env: { ...env }, cleanEnv: true },
  );
}

async function addClaudeMcpServerOrRepair(
  claudeBin: string,
  configPath: string,
  env: EnvLike,
): Promise<ChangeResult> {
  const result = await addClaudeMcpServer(claudeBin, env);
  if (result.ok) {
    return { configPath, changed: true };
  }
  if (!isAlreadyRegisteredAddFailure(result)) {
    throw commandFailure("add", result);
  }
  if ((await claudeCodeIsRegistered(configPath)) === true) {
    return { configPath, changed: false };
  }
  await removeClaudeMcpServer(claudeBin, env);
  const retry = await addClaudeMcpServer(claudeBin, env);
  if (retry.ok) {
    return { configPath, changed: true };
  }
  if (
    isAlreadyRegisteredAddFailure(retry) &&
    (await claudeCodeIsRegistered(configPath)) === true
  ) {
    return { configPath, changed: false };
  }
  throw commandFailure("add", retry);
}

export async function claudeCodeIsRegistered(
  configPath: string,
): Promise<RegistrationState> {
  return jsonFileMcpServerState(configPath, { expected: mcpServerEntry() });
}

export async function linkClaudeCode(
  configPath: string,
  env: EnvLike = process.env,
): Promise<ChangeResult> {
  const claudeBin = findClaudeBinary(env);
  if (claudeBin !== undefined) {
    if ((await claudeCodeIsRegistered(configPath)) === true) {
      return { configPath, changed: false };
    }
    if ((await jsonFileMcpServerState(configPath)) === true) {
      await removeClaudeMcpServer(claudeBin, env);
    }
    return addClaudeMcpServerOrRepair(claudeBin, configPath, env);
  }
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
  const result = await mergeMcpServerIntoJsonFile(configPath, {
    createIfMissing: false,
  });
  return result.changed ? { ...result, warning: DIRECT_EDIT_WARNING } : result;
}

export async function unlinkClaudeCode(
  configPath: string,
  env: EnvLike = process.env,
): Promise<ChangeResult> {
  const claudeBin = findClaudeBinary(env);
  if (claudeBin !== undefined) {
    return { configPath, changed: await removeClaudeMcpServer(claudeBin, env) };
  }
  const result = await removeMcpServerFromJsonFile(configPath);
  return result.changed ? { ...result, warning: DIRECT_EDIT_WARNING } : result;
}
