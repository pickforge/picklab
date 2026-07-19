import fs from "node:fs";
import {
  deepMerge,
  globalConfigPath,
  projectConfigPath,
  readConfigFile,
  redactSecrets,
  runCommand,
  saveGlobalConfig,
  saveProjectConfig,
  type EnvLike,
  type PicklabConfig,
} from "@pickforge/picklab-core";
import { formatStep, type ProvisioningPlan, type ProvisioningStep } from "./plan.js";

const DEFAULT_STEP_TIMEOUT_MS = 180_000;

export type PlanClassification =
  | "empty"
  | "automatic"
  | "unprivileged"
  | "privileged"
  | "mixed";

export type ConsentDecision =
  | { kind: "approved" }
  | { kind: "declined"; reason: string }
  | { kind: "cancelled"; reason: string };

interface DenialPolicy {
  onDenied?: "cancel" | "skip";
  retainPlanOnDenied?: boolean;
}

export interface ProvisioningPlanSection {
  kind: "plan";
  plan: ProvisioningPlan;
  satisfies?: string;
  consent?: DenialPolicy & {
    decide: (classification: PlanClassification) => Promise<ConsentDecision>;
  };
  privilegeUnavailable?: {
    action?: "error" | "skip";
    reason: string;
  };
}

export interface BlockedProvisioningSection {
  kind: "blocked";
  action?: "error" | "skip";
  reason: string;
  unlessSatisfied?: string;
}

export type ProvisioningSection =
  | ProvisioningPlanSection
  | BlockedProvisioningSection;

export interface ProvisioningExecutionAdapter {
  materialize(step: ProvisioningStep): ProvisioningStep;
  execute(step: ProvisioningStep): Promise<void>;
  executePrivileged(step: ProvisioningStep): Promise<void>;
}

export interface ExecuteProvisioningOptions {
  dryRun?: boolean;
  env?: EnvLike;
  projectDir?: string;
  log?: (line: string) => void;
  timeoutMs?: number;
  adapter?: ProvisioningExecutionAdapter;
  privilege?: {
    sudoPath: string | null;
    nonInteractive?: boolean;
  };
  beforeExecute?: (plan: ProvisioningPlan) => void | Promise<void>;
}

export interface StepResult {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ExecuteProvisioningResult {
  ok: boolean;
  status: "completed" | "declined" | "cancelled" | "failed";
  plan: ProvisioningPlan;
  skipped: string[];
  results: StepResult[];
  errors: string[];
  error?: string;
}

interface PreparedStep {
  materialized: ProvisioningStep;
}

type PreparedSection =
  | {
      kind: "plan";
      classification: PlanClassification;
      section: ProvisioningPlanSection;
      steps: PreparedStep[];
    }
  | {
      kind: "unavailable";
      section: ProvisioningPlanSection;
      reason: string;
    }
  | {
      kind: "blocked";
      section: BlockedProvisioningSection;
    };

class PrivilegeUnavailableError extends Error {}

export function classifyPlan(plan: ProvisioningPlan): PlanClassification {
  if (plan.steps.length === 0) return "empty";
  const consentSteps = plan.steps.filter(
    (step) => step.kind === "command" || step.privileged,
  );
  if (consentSteps.length === 0) return "automatic";
  const hasPrivileged = consentSteps.some((step) => step.privileged);
  const hasUnprivileged = consentSteps.some((step) => !step.privileged);
  if (hasPrivileged && hasUnprivileged) return "mixed";
  return hasPrivileged ? "privileged" : "unprivileged";
}

async function patchGlobalConfig(
  patch: PicklabConfig,
  env: EnvLike = process.env,
): Promise<void> {
  const existing = await readConfigFile(globalConfigPath(env));
  await saveGlobalConfig(deepMerge(existing, patch) as PicklabConfig, env);
}

async function patchProjectConfig(
  projectDir: string,
  patch: PicklabConfig,
): Promise<void> {
  const existing = await readConfigFile(projectConfigPath(projectDir));
  await saveProjectConfig(
    projectDir,
    deepMerge(existing, patch) as PicklabConfig,
  );
}

async function executeLocalStep(
  step: ProvisioningStep,
  opts: ExecuteProvisioningOptions,
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

function materializePrivilegedStep(
  step: ProvisioningStep,
  opts: ExecuteProvisioningOptions,
): ProvisioningStep {
  const sudoPath = opts.privilege?.sudoPath;
  if (sudoPath === undefined || sudoPath === null) {
    throw new PrivilegeUnavailableError("sudo not found on PATH");
  }
  if (step.kind !== "command") {
    throw new Error(`Unsupported privileged provisioning step: ${step.kind}`);
  }
  return {
    ...step,
    command: {
      ...step.command,
      cmd: sudoPath,
      args: [
        ...(opts.privilege?.nonInteractive === true ? ["-n"] : []),
        step.command.cmd,
        ...step.command.args,
      ],
    },
  };
}

export function createLocalExecutionAdapter(
  opts: ExecuteProvisioningOptions = {},
): ProvisioningExecutionAdapter {
  return {
    materialize: (step) =>
      step.privileged ? materializePrivilegedStep(step, opts) : step,
    execute: async (step) => executeLocalStep(step, opts),
    executePrivileged: async (step) => executeLocalStep(step, opts),
  };
}

function publicPlan(steps: readonly PreparedStep[]): ProvisioningPlan {
  return JSON.parse(
    redactSecrets(
      JSON.stringify({ steps: steps.map((step) => step.materialized) }),
    ),
  ) as ProvisioningPlan;
}

function executionResult(
  status: ExecuteProvisioningResult["status"],
  steps: readonly PreparedStep[],
  skipped: string[],
  results: StepResult[],
  errors: string[],
): ExecuteProvisioningResult {
  const redactedErrors = errors.map((error) => redactSecrets(error));
  return {
    ok: status === "completed",
    status,
    plan: publicPlan(steps),
    skipped: skipped.map((entry) => redactSecrets(entry)),
    results,
    errors: redactedErrors,
    ...(redactedErrors.length === 0 ? {} : { error: redactedErrors[0] }),
  };
}

function prepareSections(
  sections: readonly ProvisioningSection[],
  adapter: ProvisioningExecutionAdapter,
): PreparedSection[] {
  return sections.map((section): PreparedSection => {
    if (section.kind === "blocked") {
      return { kind: "blocked", section };
    }
    try {
      return {
        kind: "plan",
        classification: classifyPlan(section.plan),
        section,
        steps: section.plan.steps.map((step) => ({
          materialized: adapter.materialize(step),
        })),
      };
    } catch (error) {
      if (error instanceof PrivilegeUnavailableError) {
        return {
          kind: "unavailable",
          section,
          reason: section.privilegeUnavailable?.reason ?? error.message,
        };
      }
      return {
        kind: "blocked",
        section: {
          kind: "blocked",
          reason: `Provisioning preflight failed: ${(error as Error).message}`,
        },
      };
    }
  });
}

export async function executeProvisioning(
  sections: readonly ProvisioningSection[],
  opts: ExecuteProvisioningOptions = {},
): Promise<ExecuteProvisioningResult> {
  const adapter = opts.adapter ?? createLocalExecutionAdapter(opts);
  const prepared = prepareSections(sections, adapter);
  const selected: PreparedStep[] = [];
  const satisfied = new Set<string>();
  const skipped: string[] = [];
  const errors: string[] = [];
  let errorStatus: "declined" | "cancelled" | "failed" = "failed";

  const addError = (
    reason: string,
    status: "declined" | "cancelled" | "failed" = "failed",
  ): void => {
    if (errors.length === 0) errorStatus = status;
    errors.push(reason);
  };

  for (const entry of prepared) {
    if (entry.kind === "blocked") {
      if (
        entry.section.unlessSatisfied !== undefined &&
        satisfied.has(entry.section.unlessSatisfied)
      ) {
        continue;
      }
      if (entry.section.action === "skip") {
        skipped.push(entry.section.reason);
      } else {
        addError(entry.section.reason);
      }
      continue;
    }
    if (entry.kind === "unavailable") {
      if (entry.section.privilegeUnavailable?.action === "skip") {
        skipped.push(entry.reason);
      } else {
        addError(entry.reason);
      }
      continue;
    }

    const { classification, section } = entry;
    if (
      opts.dryRun !== true &&
      classification !== "empty" &&
      classification !== "automatic"
    ) {
      if (section.consent === undefined) {
        addError(
          "Refusing to execute provisioning commands without a consent decision.",
          "cancelled",
        );
        continue;
      }
      let decision: ConsentDecision;
      try {
        decision = await section.consent.decide(classification);
      } catch (error) {
        addError(`Provisioning consent failed: ${(error as Error).message}`);
        continue;
      }
      if (decision.kind !== "approved") {
        if (section.consent.onDenied === "skip") {
          skipped.push(decision.reason);
        } else {
          addError(decision.reason, decision.kind);
          if (section.consent.retainPlanOnDenied === true) {
            selected.push(...entry.steps);
          }
        }
        continue;
      }
    }

    selected.push(...entry.steps);
    if (section.satisfies !== undefined) {
      satisfied.add(section.satisfies);
    }
  }

  if (errors.length > 0) {
    return executionResult(errorStatus, selected, skipped, [], errors);
  }

  const plan = publicPlan(selected);
  if (opts.beforeExecute !== undefined) {
    try {
      await opts.beforeExecute(plan);
    } catch (error) {
      return executionResult(
        "failed",
        selected,
        skipped,
        [],
        [`Provisioning pre-execution hook failed: ${(error as Error).message}`],
      );
    }
  }

  const log = opts.log ?? (() => {});
  const results: StepResult[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const preparedStep = selected[index]!;
    const presentation = plan.steps[index]!;
    const formatted = formatStep(presentation);
    const title = presentation.title;
    if (opts.dryRun === true) {
      log(`[dry-run] ${title}: ${formatted}`);
      results.push({ id: presentation.id, ok: true, detail: "dry-run" });
      continue;
    }
    try {
      if (preparedStep.materialized.privileged) {
        await adapter.executePrivileged(preparedStep.materialized);
      } else {
        await adapter.execute(preparedStep.materialized);
      }
      log(`[done] ${title}`);
      results.push({ id: presentation.id, ok: true, detail: formatted });
    } catch (error) {
      const detail = redactSecrets((error as Error).message);
      const message = `Step "${presentation.id}" failed: ${detail}`;
      log(`[failed] ${title}: ${detail}`);
      results.push({ id: presentation.id, ok: false, detail: message });
      return executionResult("failed", selected, skipped, results, [message]);
    }
  }
  return executionResult("completed", selected, skipped, results, []);
}
