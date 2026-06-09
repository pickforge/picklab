import fs from "node:fs";
import {
  globalConfigPath,
  projectConfigPath,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
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

async function readJsonObject(
  filePath: string,
): Promise<Record<string, unknown>> {
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
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }
  return parsed;
}

export async function patchGlobalConfig(
  patch: PicklabConfig,
  env: EnvLike = process.env,
): Promise<void> {
  const existing = await readJsonObject(globalConfigPath(env));
  await saveGlobalConfig(deepMerge(existing, patch), env);
}

export async function patchProjectConfig(
  projectDir: string,
  patch: PicklabConfig,
): Promise<void> {
  const existing = await readJsonObject(projectConfigPath(projectDir));
  await saveProjectConfig(projectDir, deepMerge(existing, patch));
}

async function executeStep(
  step: ProvisioningStep,
  opts: ExecutePlanOptions,
): Promise<void> {
  switch (step.kind) {
    case "mkdir": {
      if (step.dir === undefined) {
        throw new Error("mkdir step is missing a target directory");
      }
      await fs.promises.mkdir(step.dir, { recursive: true });
      return;
    }
    case "command": {
      const command = step.command;
      if (command === undefined) {
        throw new Error("command step is missing its command");
      }
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
      await patchGlobalConfig(step.config ?? {}, opts.env);
      return;
    }
    case "write-project-config": {
      if (opts.projectDir === undefined) {
        throw new Error("write-project-config step requires a project directory");
      }
      await patchProjectConfig(opts.projectDir, step.config ?? {});
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
