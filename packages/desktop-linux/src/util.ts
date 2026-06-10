import fs from "node:fs";
import path from "node:path";
import type { EnvLike } from "@pickforge/picklab-core";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findOnPath(
  name: string,
  env: EnvLike = process.env,
): string | null {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter((d) => d !== "");
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}
