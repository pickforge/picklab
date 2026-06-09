import type { EnvLike } from "@pickforge/picklab-core";
import { collectSnapshot } from "../provision/detect.js";
import { executePlan, type StepResult } from "../provision/executor.js";
import {
  planHasCommandSteps,
  type ProvisioningStep,
} from "../provision/plan.js";
import { planLabUser } from "../provision/planner.js";
import { confirm } from "../provision/prompts.js";

export interface SetupLabUserCliOptions {
  name?: string;
  home?: string;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface SetupLabUserReport {
  ok: boolean;
  name: string;
  home: string;
  userExists: boolean;
  dryRun: boolean;
  plan: ProvisioningStep[];
  results: StepResult[];
  errors: string[];
}

function emit(report: SetupLabUserReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const error of report.errors) {
    console.error(`error: ${error}`);
  }
}

export async function runSetupLabUser(
  opts: SetupLabUserCliOptions,
  env: EnvLike = process.env,
): Promise<number> {
  const snapshot = await collectSnapshot({
    env,
    labUserName: opts.name,
    labUserHome: opts.home,
  });
  const report: SetupLabUserReport = {
    ok: false,
    name: snapshot.labUser.name,
    home: snapshot.labUser.home,
    userExists: snapshot.labUser.exists,
    dryRun: opts.dryRun === true,
    plan: [],
    results: [],
    errors: [],
  };

  const result = planLabUser({
    name: snapshot.labUser.name,
    home: snapshot.labUser.home,
    userExists: snapshot.labUser.exists,
    homeExists: snapshot.labUser.homeExists,
    kvmPresent: snapshot.android.kvm.exists,
    sudoPath: snapshot.sudo,
    nonInteractive: process.stdin.isTTY !== true,
  });
  if (!result.ok) {
    report.errors.push(result.error);
    emit(report, opts.json === true);
    return 1;
  }
  report.plan = result.plan.steps;

  if (planHasCommandSteps(result.plan) && opts.dryRun !== true) {
    const answer = await confirm(
      `Create system user "${snapshot.labUser.name}" with home ` +
        `${snapshot.labUser.home} (privileged, runs sudo)?`,
      { yes: opts.yes },
    );
    if (answer === "non-interactive") {
      report.errors.push(
        "Refusing to provision the lab user without consent in a " +
          "non-interactive session. Re-run with --yes.",
      );
      emit(report, opts.json === true);
      return 1;
    }
    if (answer === "no") {
      report.errors.push("Aborted: lab user provisioning was declined.");
      emit(report, opts.json === true);
      return 1;
    }
  }

  const log =
    opts.json === true ? () => {} : (line: string) => console.log(line);
  if (opts.json !== true && snapshot.labUser.exists) {
    console.log(`User "${snapshot.labUser.name}" already exists.`);
  }
  const execution = await executePlan(result.plan, {
    dryRun: opts.dryRun,
    env,
    log,
  });
  report.results = execution.results;
  report.ok = execution.ok;
  if (!execution.ok) {
    report.errors.push(execution.error ?? "provisioning failed");
  }
  emit(report, opts.json === true);
  if (opts.json !== true && execution.ok && opts.dryRun !== true) {
    console.log(
      `Lab user "${report.name}" is ready (home: ${report.home}).`,
    );
  }
  return execution.ok ? 0 : 1;
}
