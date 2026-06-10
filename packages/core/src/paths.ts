import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EnvLike = Record<string, string | undefined>;

export function picklabHome(env: EnvLike = process.env): string {
  const fromEnv = env.PICKLAB_HOME;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return path.join(os.homedir(), ".picklab");
}

export function sessionsDir(env: EnvLike = process.env): string {
  return path.join(picklabHome(env), "sessions");
}

export function agentsDir(env: EnvLike = process.env): string {
  return path.join(picklabHome(env), "agents");
}

export function projectConfigPath(projectDir: string): string {
  return path.join(projectDir, ".picklab", "config.json");
}

export function globalConfigPath(env: EnvLike = process.env): string {
  return path.join(picklabHome(env), "config.json");
}

export function runsDir(projectDir: string): string {
  return path.join(projectDir, ".picklab", "runs");
}

export async function ensureDir(dir: string): Promise<string> {
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}
