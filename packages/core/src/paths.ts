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
 * Confinement guard for an ephemeral browser profile. In addition to lexical
 * containment, every existing path from the sessions directory through the
 * profile is lstat'd and realpath-checked so a planted symlink can never turn
 * cleanup into an out-of-tree removal. Missing paths are safe: force-removal is
 * already a no-op once the first missing ancestor is reached.
 */
export async function isProfileConfined(
  sessionDir: string,
  profileDir: string,
): Promise<boolean> {
  const base = path.resolve(sessionDir);
  const target = path.resolve(profileDir);
  if (
    target !== path.join(base, "profile") &&
    !target.startsWith(base + path.sep)
  ) {
    return false;
  }

  const root = path.dirname(base);
  const relative = path.relative(root, target);
  const components = relative.split(path.sep);
  try {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    const rootReal = await fs.promises.realpath(root);

    let current = root;
    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]!);
      try {
        stat = await fs.promises.lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
      const currentReal = await fs.promises.realpath(current);
      const expectedReal = path.join(
        rootReal,
        ...components.slice(0, index + 1),
      );
      if (currentReal !== expectedReal) return false;
    }
    return true;
  } catch {
    return false;
  }
}
