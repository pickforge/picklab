import { createRequire } from "node:module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export function buildProgram(): Command {
  return new Command()
    .name("picklab")
    .description(
      "Native app and Android emulator automation for AI coding agents",
    )
    .version(version);
}
