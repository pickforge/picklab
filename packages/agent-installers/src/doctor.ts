import fs from "node:fs";
import path from "node:path";
import { agentsDir, type EnvLike } from "@pickforge/picklab-core";
import { BUILTIN_AGENTS } from "./agents/builtin.js";
import { isBackupPath } from "./backup.js";
import { jsonFileHasMcpServer } from "./jsonConfig.js";
import { inspectTomlFile } from "./tomlConfig.js";
import type { AgentKind } from "./types.js";

export type AgentsDoctorStatus = "ok" | "warn" | "problem";

export interface AgentsDoctorCheck {
  id: string;
  status: AgentsDoctorStatus;
  detail: string;
}

export interface AgentsDoctorReport {
  ok: boolean;
  checks: AgentsDoctorCheck[];
}

export interface AgentsDoctorOptions {
  env?: EnvLike;
  configPaths?: Partial<Record<AgentKind, string>>;
}

const BACKUP_CLUTTER_THRESHOLD = 3;

async function checkAgentsDir(
  env: EnvLike,
  checks: AgentsDoctorCheck[],
): Promise<void> {
  const dir = agentsDir(env);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      checks.push({
        id: "agents-dir",
        status: "ok",
        detail: `${dir} does not exist yet (created on first link)`,
      });
      return;
    }
    throw error;
  }
  const broken: string[] = [];
  for (const basename of entries.sort()) {
    const entryPath = path.join(dir, basename);
    const stat = await fs.promises.lstat(entryPath);
    if (!stat.isSymbolicLink()) {
      continue;
    }
    try {
      await fs.promises.stat(entryPath);
    } catch {
      broken.push(entryPath);
    }
  }
  if (broken.length > 0) {
    checks.push({
      id: "agents-dir",
      status: "problem",
      detail: `broken symlink(s): ${broken.join(", ")}`,
    });
    return;
  }
  checks.push({ id: "agents-dir", status: "ok", detail: dir });
}

async function countBackups(configPath: string): Promise<number> {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  return entries.filter(
    (entry) => entry.startsWith(`${base}.picklab-backup-`) && isBackupPath(entry),
  ).length;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkBuiltinAgent(
  name: AgentKind,
  configPath: string,
  checks: AgentsDoctorCheck[],
): Promise<void> {
  const id = `agent-${name}`;
  const exists = await fileExists(configPath);
  const backups = await countBackups(configPath);
  if (!exists) {
    checks.push({
      id,
      status: "ok",
      detail: `not registered (${configPath} does not exist)`,
    });
    return;
  }
  if (name === "codex") {
    const inspection = await inspectTomlFile(configPath);
    if (inspection.markersPresent && !inspection.markersHaveSection) {
      checks.push({
        id,
        status: "problem",
        detail:
          `stale: ${configPath} has picklab markers without an ` +
          `[mcp_servers.picklab] section (re-run: picklab agents link codex)`,
      });
      return;
    }
    if (inspection.foreignSection && !inspection.markersPresent) {
      checks.push({
        id,
        status: "warn",
        detail:
          `${configPath} has an [mcp_servers.picklab] section that PickLab ` +
          `does not manage`,
      });
      return;
    }
    pushRegistrationCheck(
      checks,
      id,
      configPath,
      inspection.markersHaveSection,
      backups,
    );
    return;
  }
  const registered = await jsonFileHasMcpServer(configPath);
  pushRegistrationCheck(checks, id, configPath, registered, backups);
}

function pushRegistrationCheck(
  checks: AgentsDoctorCheck[],
  id: string,
  configPath: string,
  registered: boolean,
  backups: number,
): void {
  if (!registered && backups > 0) {
    checks.push({
      id,
      status: "problem",
      detail:
        `stale: ${configPath} was modified by PickLab before ` +
        `(${backups} backup(s) found) but no longer contains the picklab ` +
        `entry (re-run: picklab agents link)`,
    });
    return;
  }
  if (backups > BACKUP_CLUTTER_THRESHOLD) {
    checks.push({
      id,
      status: "warn",
      detail: `${backups} picklab backups next to ${configPath}; consider pruning`,
    });
    return;
  }
  checks.push({
    id,
    status: "ok",
    detail: registered
      ? `registered in ${configPath}`
      : `not registered in ${configPath}`,
  });
}

function checkPicklabOnPath(env: EnvLike, checks: AgentsDoctorCheck[]): void {
  const pathValue = env.PATH ?? "";
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === "") {
      continue;
    }
    const candidate = path.join(dir, "picklab");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) {
        checks.push({ id: "picklab-bin", status: "ok", detail: candidate });
        return;
      }
    } catch {
      continue;
    }
  }
  checks.push({
    id: "picklab-bin",
    status: "warn",
    detail:
      "picklab is not on PATH; registered agents will fail to start the MCP " +
      "server (install globally or adjust PATH)",
  });
}

export async function runAgentsDoctor(
  opts: AgentsDoctorOptions = {},
): Promise<AgentsDoctorReport> {
  const env = opts.env ?? process.env;
  const checks: AgentsDoctorCheck[] = [];
  await checkAgentsDir(env, checks);
  for (const agent of Object.values(BUILTIN_AGENTS)) {
    const configPath =
      opts.configPaths?.[agent.name] ?? agent.defaultConfigPath(env);
    await checkBuiltinAgent(agent.name, configPath, checks);
  }
  checkPicklabOnPath(env, checks);
  return {
    ok: !checks.some((check) => check.status === "problem"),
    checks,
  };
}
