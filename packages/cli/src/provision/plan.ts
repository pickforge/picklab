import type { PicklabConfig } from "@pickforge/picklab-core";

export type StepKind =
  | "command"
  | "mkdir"
  | "write-global-config"
  | "write-project-config";

export interface StepCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  input?: string;
}

export interface ProvisioningStep {
  id: string;
  title: string;
  kind: StepKind;
  privileged: boolean;
  command?: StepCommand;
  dir?: string;
  config?: PicklabConfig;
}

export interface ProvisioningPlan {
  steps: ProvisioningStep[];
}

export type PlanResult =
  | { ok: true; plan: ProvisioningPlan }
  | { ok: false; error: string };

export function planHasPrivilegedSteps(plan: ProvisioningPlan): boolean {
  return plan.steps.some((step) => step.privileged);
}

export function planHasCommandSteps(plan: ProvisioningPlan): boolean {
  return plan.steps.some((step) => step.kind === "command");
}

export function formatStep(step: ProvisioningStep): string {
  switch (step.kind) {
    case "command": {
      const command = step.command;
      if (command === undefined) {
        return step.title;
      }
      return `$ ${command.cmd} ${command.args.join(" ")}`;
    }
    case "mkdir":
      return `mkdir -p ${step.dir ?? ""}`;
    case "write-global-config":
      return `update global config: ${JSON.stringify(step.config ?? {})}`;
    case "write-project-config":
      return `write project config: ${JSON.stringify(step.config ?? {})}`;
  }
}
