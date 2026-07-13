import { redactSecrets } from "@pickforge/picklab-core";
import { runProjectDevtoolsMcp } from "@pickforge/picklab-browser";
import { resolveProjectDir } from "./shared.js";

export interface BrowserDevtoolsMcpOptions {
  projectDir?: string;
}

export async function runBrowserDevtoolsMcp(
  opts: BrowserDevtoolsMcpOptions,
): Promise<number> {
  try {
    const exit = await runProjectDevtoolsMcp({
      projectDir: resolveProjectDir(opts),
    });
    if (exit.signal !== null) {
      process.kill(process.pid, exit.signal);
      return 128;
    }
    return exit.code ?? 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${redactSecrets(message)}\n`);
    return 1;
  }
}
