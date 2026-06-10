import type { EnvLike } from "@pickforge/picklab-core";
import {
  evaluateChecks,
  formatCheckLine,
  type DoctorCheck,
} from "../provision/checks.js";
import { collectSnapshot, type DetectionSnapshot } from "../provision/detect.js";
import { executePlan, type StepResult } from "../provision/executor.js";
import {
  planHasCommandSteps,
  type ProvisioningStep,
} from "../provision/plan.js";
import {
  planCreateAvd,
  planLabUser,
  planPicklabHome,
} from "../provision/planner.js";
import { confirm } from "../provision/prompts.js";

export interface DoctorCliOptions {
  json?: boolean;
  fix?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  projectDir?: string;
}

export interface DoctorFixReport {
  dryRun: boolean;
  steps: ProvisioningStep[];
  skipped: string[];
  results: StepResult[];
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  errors: string[];
  fix?: DoctorFixReport;
}

async function consentToRepair(
  question: string,
  opts: DoctorCliOptions,
): Promise<boolean> {
  if (opts.dryRun === true) {
    return true;
  }
  const answer = await confirm(question, { yes: opts.yes });
  return answer === "yes";
}

async function buildFixPlan(
  snapshot: DetectionSnapshot,
  opts: DoctorCliOptions,
): Promise<{ steps: ProvisioningStep[]; skipped: string[] }> {
  const steps: ProvisioningStep[] = [];
  const skipped: string[] = [];
  const consentHint =
    "skipped (requires consent; re-run with --yes or confirm interactively)";

  steps.push(
    ...planPicklabHome({
      path: snapshot.picklabHome.path,
      exists: snapshot.picklabHome.exists,
    }).steps,
  );

  if (!snapshot.android.avdExists) {
    const result = planCreateAvd({
      avdName: snapshot.android.avdName,
      sdkRoot: snapshot.android.sdkRoot,
      avdmanagerPath: snapshot.android.tools.avdmanager,
      installedImages: snapshot.android.systemImages,
      existingAvds: snapshot.android.avds,
    });
    if (!result.ok) {
      skipped.push(`avd: ${result.error}`);
    } else if (
      !planHasCommandSteps(result.plan) ||
      (await consentToRepair(
        `Create AVD "${snapshot.android.avdName}" (runs avdmanager)?`,
        opts,
      ))
    ) {
      steps.push(...result.plan.steps);
    } else {
      skipped.push(`avd: ${consentHint}`);
    }
  }

  if (!snapshot.labUser.exists) {
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
      skipped.push(`lab-user: ${result.error}`);
    } else if (
      !planHasCommandSteps(result.plan) ||
      (await consentToRepair(
        `Create lab user "${snapshot.labUser.name}" (privileged, runs sudo)?`,
        opts,
      ))
    ) {
      steps.push(...result.plan.steps);
    } else {
      skipped.push(`lab-user: ${consentHint}`);
    }
  }

  return { steps, skipped };
}

export async function runDoctor(
  opts: DoctorCliOptions,
  env: EnvLike = process.env,
): Promise<number> {
  const projectDir = opts.projectDir ?? process.cwd();
  const snapshot = await collectSnapshot({ env, projectDir });
  const checks = evaluateChecks(snapshot);
  const report: DoctorReport = {
    ok: !checks.some((check) => check.status === "missing"),
    checks,
    errors: [],
  };

  if (opts.json !== true) {
    for (const check of checks) {
      console.log(formatCheckLine(check));
    }
  }

  let exitCode = 0;
  if (opts.fix === true) {
    const { steps, skipped } = await buildFixPlan(snapshot, opts);
    const log =
      opts.json === true ? () => {} : (line: string) => console.log(line);
    const execution = await executePlan(
      { steps },
      { dryRun: opts.dryRun, env, projectDir, log },
    );
    report.fix = {
      dryRun: opts.dryRun === true,
      steps,
      skipped,
      results: execution.results,
    };
    if (!execution.ok) {
      report.errors.push(execution.error ?? "repairs failed");
      exitCode = 1;
    }
  }

  if (opts.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.fix !== undefined) {
      for (const entry of report.fix.skipped) {
        console.log(`[skipped] ${entry}`);
      }
    }
    for (const error of report.errors) {
      console.error(`error: ${error}`);
    }
  }
  return exitCode;
}
