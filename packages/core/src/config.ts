import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  globalConfigPath,
  legacyGlobalConfigPath,
  projectConfigPath,
  resolveReadablePath,
  writeFileAtomic,
  type EnvLike,
} from "./paths.js";

export type PicklabProfile =
  | "flutter-desktop"
  | "android"
  | "desktop+android"
  | "generic";

export type ViewerMode = "manual" | "auto";

/**
 * Where new run artifacts (screenshots, manifests, evidence journals) are
 * written. `home` (default) keeps them under the shared Pickforge company
 * root, isolated per project; `project-local` restores the pre-#34 layout
 * under `<project>/.picklab/runs`; `custom` targets an explicit absolute
 * path. See `resolveRunStorage` in `storage.ts`.
 */
export type StorageMode = "home" | "project-local" | "custom";

export interface StorageConfig {
  mode?: StorageMode;
  /** Required (and must be absolute) when `mode` is `"custom"`. */
  path?: string;
  [key: string]: unknown;
}

export interface PicklabConfig {
  profile?: PicklabProfile;
  android?: { avdName?: string; [key: string]: unknown };
  labUser?: { name?: string; home?: string; [key: string]: unknown };
  viewer?: { mode?: ViewerMode; [key: string]: unknown };
  evidence?: { enabled?: boolean; [key: string]: unknown };
  storage?: StorageConfig;
  [key: string]: unknown;
}

export const resolvedDefaults = {
  android: { avdName: "picklab-avd" },
  labUser: { name: "picklab-lab", home: "/var/lib/picklab/lab-home" },
  viewer: { mode: "manual" },
  evidence: { enabled: true },
  storage: { mode: "home" },
} as const satisfies PicklabConfig;

/**
 * Whether computer-use evidence capture is enabled. This is product
 * configuration (default on), not a feature flag: it stays a documented knob so
 * a user can turn off evidence recording (e.g. because screenshot pixels cannot
 * be redacted). Only an explicit `false` disables it.
 */
export function isEvidenceEnabled(config: PicklabConfig): boolean {
  return config.evidence?.enabled !== false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = isPlainObject(value) ? deepMerge({}, value) : value;
    }
  }
  return result;
}

export async function readConfigFile(filePath: string): Promise<PicklabConfig> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return {};
    }
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed as PicklabConfig;
  } catch (error) {
    throw new Error(
      `Invalid PickLab config at ${filePath}: ${(error as Error).message}`,
    );
  }
}

export async function loadConfig(
  projectDir: string,
  env: EnvLike = process.env,
): Promise<PicklabConfig> {
  const globalPath = await resolveReadablePath(
    globalConfigPath(env),
    legacyGlobalConfigPath(env),
  );
  const global = await readConfigFile(globalPath);
  const project = await readConfigFile(projectConfigPath(projectDir));
  return deepMerge(
    deepMerge(deepMerge({}, resolvedDefaults), global),
    project,
  ) as PicklabConfig;
}

async function writeConfigFile(
  filePath: string,
  config: PicklabConfig,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFileAtomic(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function saveProjectConfig(
  projectDir: string,
  config: PicklabConfig,
): Promise<void> {
  await writeConfigFile(projectConfigPath(projectDir), config);
}

export async function saveGlobalConfig(
  config: PicklabConfig,
  env: EnvLike = process.env,
): Promise<void> {
  await writeConfigFile(globalConfigPath(env), config);
}
