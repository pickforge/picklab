import fs from "node:fs";
import {
  deepMerge,
  globalConfigPath,
  projectConfigPath,
  readConfigFile,
  runCommand,
  saveGlobalConfig,
  saveProjectConfig,
  type EnvLike,
  type PicklabConfig,
} from "@pickforge/picklab-core";
import { formatStep, type ProvisioningPlan, type ProvisioningStep } from "./plan.js";

const DEFAULT_STEP_TIMEOUT_MS = 180_000;

export interface ExecutePlanOptions {
  dryRun?: boolean;
  env?: EnvLike;
  projectDir?: string;
  log?: (line: string) => void;
  timeoutMs?: number;
}

export interface StepResult {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ExecutePlanResult {
  ok: boolean;
  results: StepResult[];
  error?: string;
}

export async function patchGlobalConfig(
  patch: PicklabConfig,
  env: EnvLike = process.env,
): Promise<void> {
  const existing = await readConfigFile(globalConfigPath(env));
  await saveGlobalConfig(deepMerge(existing, patch) as PicklabConfig, env);
}

export async function patchProjectConfig(
  projectDir: string,
  patch: PicklabConfig,
): Promise<void> {
  const existing = await readConfigFile(projectConfigPath(projectDir));
  await saveProjectConfig(
    projectDir,
    deepMerge(existing, patch) as PicklabConfig,
  );
}

async function executeStep(
  step: ProvisioningStep,
  opts: ExecutePlanOptions,
): Promise<void> {
  switch (step.kind) {
    case "mkdir": {
      await fs.promises.mkdir(step.dir, { recursive: true });
      return;
    }
    case "command": {
      const command = step.command;
      const result = await runCommand(command.cmd, command.args, {
        env: { ...opts.env, ...command.env },
        input: command.input,
        timeoutMs: opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
      });
      if (!result.ok) {
        const detail =
          result.stderr.trim() ||
          result.stdout.trim() ||
          (result.timedOut ? "timed out" : `exit code ${result.code}`);
        throw new Error(
          `${command.cmd} ${command.args.join(" ")} failed: ${detail}`,
        );
      }
      return;
    }
    case "write-global-config": {
      await patchGlobalConfig(step.config, opts.env);
      return;
    }
    case "write-project-config": {
      if (opts.projectDir === undefined) {
        throw new Error("write-project-config step requires a project directory");
      }
      await patchProjectConfig(opts.projectDir, step.config);
      return;
    }
  }
}

export async function executePlan(
  plan: ProvisioningPlan,
  opts: ExecutePlanOptions = {},
): Promise<ExecutePlanResult> {
  const log = opts.log ?? (() => {});
  const results: StepResult[] = [];
  for (const step of plan.steps) {
    if (opts.dryRun === true) {
      log(`[dry-run] ${step.title}: ${formatStep(step)}`);
      results.push({ id: step.id, ok: true, detail: "dry-run" });
      continue;
    }
    try {
      await executeStep(step, opts);
      log(`[done] ${step.title}`);
      results.push({ id: step.id, ok: true, detail: formatStep(step) });
    } catch (error) {
      const message = `Step "${step.id}" failed: ${(error as Error).message}`;
      log(`[failed] ${step.title}: ${(error as Error).message}`);
      results.push({ id: step.id, ok: false, detail: message });
      return { ok: false, results, error: message };
    }
  }
  return { ok: true, results };
}
