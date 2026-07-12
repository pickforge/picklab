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

/**
 * Confinement guard for a session's ephemeral browser profile. Returns true only
 * when `profileDir` resolves to the session's own `profile` directory (or a path
 * beneath the session directory), so profile cleanup never follows a tampered
 * record out of the sessions tree. Shared by the reaper (core) and the browser
 * destroy path so the rule lives in exactly one place.
 */
export function isProfileConfined(
  sessionDir: string,
  profileDir: string,
): boolean {
  const resolved = path.resolve(profileDir);
  return (
    resolved === path.join(sessionDir, "profile") ||
    resolved.startsWith(sessionDir + path.sep)
  );
}
