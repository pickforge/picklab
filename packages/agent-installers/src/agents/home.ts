import os from "node:os";
import type { EnvLike } from "@pickforge/picklab-core";

export function homeDir(env: EnvLike): string {
  const fromEnv = env.HOME;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return os.homedir();
}
