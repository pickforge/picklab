import { createRequire } from "node:module";
import { Command, Option } from "commander";
import type { PicklabProfile } from "@pickforge/picklab-core";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runSetupAndroid } from "./commands/setup-android.js";
import { runSetupLabUser } from "./commands/setup-lab-user.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const PROFILES: PicklabProfile[] = [
  "flutter-desktop",
  "android",
  "desktop+android",
  "generic",
];

export function buildProgram(): Command {
  const program = new Command()
    .name("picklab")
    .description(
      "Native app and Android emulator automation for AI coding agents",
    )
    .version(version);

  program
    .command("doctor")
    .description("Check dependencies and dedicated lab resources")
    .option("--json", "machine-readable output")
    .option("--fix", "apply repairs (privileged ones need --yes or a prompt)")
    .option("--yes", "consent to privileged repairs without prompting")
    .option("--dry-run", "print planned repairs without executing them")
    .option("--project-dir <dir>", "project directory for config resolution")
    .action(async (opts) => {
      process.exitCode = await runDoctor(opts);
    });

  program
    .command("init")
    .description("Initialize a PickLab project and provision lab resources")
    .addOption(
      new Option("--profile <profile>", "project profile").choices(PROFILES),
    )
    .option("--yes", "non-interactive mode; fails closed when provisioning is impossible")
    .option("--create-lab-user", "provision the dedicated lab user")
    .option("--create-avd", "provision the dedicated Android AVD")
    .option("--dry-run", "print the provisioning plan without executing it")
    .option("--json", "machine-readable output")
    .option("--project-dir <dir>", "project directory (defaults to cwd)")
    .action(async (opts) => {
      process.exitCode = await runInit(opts);
    });

  const setup = program
    .command("setup")
    .description("Provision dedicated PickLab lab resources");

  setup
    .command("lab-user")
    .description("Create the dedicated locked lab user (uses sudo)")
    .option("--name <name>", "lab user name")
    .option("--home <dir>", "lab user home directory")
    .option("--yes", "do not prompt for confirmation")
    .option("--dry-run", "print the provisioning plan without executing it")
    .option("--json", "machine-readable output")
    .action(async (opts) => {
      process.exitCode = await runSetupLabUser(opts);
    });

  setup
    .command("android")
    .description("Detect the Android toolchain and create the dedicated AVD")
    .option("--create-avd", "create the dedicated AVD")
    .option("--avd-name <name>", "AVD name")
    .option("--system-image <id>", 'system image id, e.g. "system-images;android-35;google_apis;x86_64"')
    .option("--yes", "do not prompt for confirmation")
    .option("--dry-run", "print the provisioning plan without executing it")
    .option("--json", "machine-readable output")
    .action(async (opts) => {
      process.exitCode = await runSetupAndroid(opts);
    });

  return program;
}
