import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, type StorageConfig, type StorageMode } from "./config.js";
import { picklabHome, runsDir, type EnvLike } from "./paths.js";

export type { StorageConfig, StorageMode } from "./config.js";

const PROJECT_ID_HASH_LENGTH = 16;

function sanitizeSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug === "" ? "project" : slug).slice(0, 40);
}

/**
 * Canonical form of a project path used for stable project-id derivation.
 * Resolves symlinks (so a project reached through different paths still gets
 * one id); falls back to the lexically resolved path when the directory does
 * not exist yet (e.g. a not-yet-created target), so id derivation never
 * throws and stays stable once the directory does appear.
 */
export async function canonicalProjectPath(projectDir: string): Promise<string> {
  const resolved = path.resolve(projectDir);
  try {
    return await fs.promises.realpath(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Stable per-project id derived from a canonical project path: a sha256
 * digest (load-bearing for uniqueness) prefixed with a human-readable slug of
 * the directory's basename purely for debuggability (`ls
 * ~/.pickforge/picklab/projects` stays legible). The same canonical path
 * always yields the same id; different paths practically never collide.
 */
export function deriveProjectId(canonicalPath: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(canonicalPath)
    .digest("hex")
    .slice(0, PROJECT_ID_HASH_LENGTH);
  return `${sanitizeSlug(path.basename(canonicalPath))}-${hash}`;
}

export async function projectId(projectDir: string): Promise<string> {
  return deriveProjectId(await canonicalProjectPath(projectDir));
}

export class StorageConfigError extends Error {}

export interface ResolvedRunStorage {
  mode: StorageMode;
  /** Where new runs are written, e.g. `.../runs/<runId>/`. */
  runsDir: string;
  /** Present only for `mode: "home"`. */
  projectId?: string;
}

function envStorageMode(env: EnvLike): StorageMode | undefined {
  const value = env.PICKLAB_STORAGE_MODE;
  if (value === "home" || value === "project-local" || value === "custom") {
    return value;
  }
  return undefined;
}

/**
 * Resolve where new run artifacts should be written for a project. Reads
 * `storage` from project/global config (`.picklab/config.json` /
 * `<PICKLAB_HOME>/config.json`), then an explicit `PICKLAB_STORAGE_MODE` /
 * `PICKLAB_STORAGE_PATH` environment override for automation and tests. Env
 * wins over config so a CI job or test harness can force a mode without
 * touching project files.
 *
 * - `home` (default): `<picklabHome>/projects/<projectId>/runs`, isolated per
 *   project and outside every target repository.
 * - `project-local`: the pre-#34 `<project>/.picklab/runs` layout.
 * - `custom`: `<storage.path>/runs` under an explicit absolute path.
 *
 * This is the single resolver every run-creation and artifact-lookup path
 * (core, CLI, MCP) goes through, so they always agree on where runs live.
 */
export async function resolveRunStorage(
  projectDir: string,
  env: EnvLike = process.env,
): Promise<ResolvedRunStorage> {
  const config = await loadConfig(projectDir, env);
  const storage: StorageConfig = config.storage ?? {};
  const mode = envStorageMode(env) ?? storage.mode ?? "home";
  const customPath = env.PICKLAB_STORAGE_PATH ?? storage.path;

  if (mode === "project-local") {
    return { mode, runsDir: runsDir(projectDir) };
  }

  if (mode === "custom") {
    if (customPath === undefined || customPath === "") {
      throw new StorageConfigError(
        'storage mode "custom" requires a storage path ' +
          "(storage.path in config, or PICKLAB_STORAGE_PATH)",
      );
    }
    if (!path.isAbsolute(customPath)) {
      throw new StorageConfigError(
        `storage path must be an absolute path, got "${customPath}"`,
      );
    }
    return { mode, runsDir: path.join(path.resolve(customPath), "runs") };
  }

  const id = await projectId(projectDir);
  return {
    mode: "home",
    runsDir: path.join(picklabHome(env), "projects", id, "runs"),
    projectId: id,
  };
}
