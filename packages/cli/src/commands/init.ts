import path from "node:path";
import type { EnvLike, PicklabProfile } from "@pickforge/picklab-core";
import {
  evaluateChecks,
  formatCheckLine,
  requiredChecksForProfile,
  type DoctorCheck,
} from "../provision/checks.js";
import { collectSnapshot, type DetectionSnapshot } from "../provision/detect.js";
import { executePlan, type StepResult } from "../provision/executor.js";
import type { ProvisioningStep } from "../provision/plan.js";
import {
  planCreateAvd,
  planLabUser,
  planPicklabHome,
} from "../provision/planner.js";
import { confirm } from "../provision/prompts.js";

export interface InitCliOptions {
  profile?: PicklabProfile;
  yes?: boolean;
  createLabUser?: boolean;
  createAvd?: boolean;
  dryRun?: boolean;
  json?: boolean;
  projectDir?: string;
}

export interface InitReport {
  ok: boolean;
  profile: PicklabProfile;
  projectDir: string;
  dryRun: boolean;
  checks: DoctorCheck[];
  plan: ProvisioningStep[];
  results: StepResult[];
  errors: string[];
}

async function consentTo(
  what: string,
  explicit: boolean,
  opts: InitCliOptions,
  remediation: string,
): Promise<{ granted: boolean; error?: string }> {
  if (explicit || opts.yes === true || opts.dryRun === true) {
    return { granted: true };
  }
  const answer = await confirm(`Provision ${what}?`, {});
  if (answer === "yes") {
    return { granted: true };
  }
  if (answer === "no") {
    return { granted: false, error: `Required ${what} was declined. ${remediation}` };
  }
  return {
    granted: false,
    error: `Required ${what} is missing and cannot be provisioned without consent. ${remediation}`,
  };
}

async function planAvdProvisioning(
  snapshot: DetectionSnapshot,
  opts: InitCliOptions,
  steps: ProvisioningStep[],
  errors: string[],
): Promise<void> {
  const result = planCreateAvd({
    avdName: snapshot.android.avdName,
    sdkRoot: snapshot.android.sdkRoot,
    avdmanagerPath: snapshot.android.tools.avdmanager,
    installedImages: snapshot.android.systemImages,
    existingAvds: snapshot.android.avds,
  });
  if (!result.ok) {
    errors.push(result.error);
    return;
  }
  const consent = await consentTo(
    `dedicated AVD "${snapshot.android.avdName}"`,
    opts.createAvd === true,
    opts,
    "Re-run with --yes --create-avd or run: picklab setup android --create-avd",
  );
  if (!consent.granted) {
    errors.push(consent.error ?? "AVD provisioning was not approved");
    return;
  }
  steps.push(...result.plan.steps);
}

async function planLabUserProvisioning(
  snapshot: DetectionSnapshot,
  opts: InitCliOptions,
  steps: ProvisioningStep[],
  errors: string[],
): Promise<void> {
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
    errors.push(result.error);
    return;
  }
  const consent = await consentTo(
    `lab user "${snapshot.labUser.name}" (privileged, runs sudo)`,
    opts.createLabUser === true,
    opts,
    "Re-run with --yes --create-lab-user or run: picklab setup lab-user",
  );
  if (!consent.granted) {
    errors.push(consent.error ?? "Lab user provisioning was not approved");
    return;
  }
  steps.push(...result.plan.steps);
}

export async function runInit(
  opts: InitCliOptions,
  env: EnvLike = process.env,
): Promise<number> {
  const profile = opts.profile ?? "generic";
  const projectDir = path.resolve(opts.projectDir ?? process.cwd());
  const snapshot = await collectSnapshot({ env, projectDir });
  const allChecks = evaluateChecks(snapshot);
  const requiredIds = requiredChecksForProfile(profile);
  const checks = allChecks.filter((check) => requiredIds.includes(check.id));

  const errors: string[] = [];
  const steps: ProvisioningStep[] = [
    {
      id: "project-config",
      title: `Write project config (profile: ${profile})`,
      kind: "write-project-config",
      privileged: false,
      config: { profile },
    },
    ...planPicklabHome({
      path: snapshot.picklabHome.path,
      exists: snapshot.picklabHome.exists,
    }).steps,
  ];

  const avdRequired = requiredIds.includes("avd");
  const labUserRequired = requiredIds.includes("lab-user");
  if (!snapshot.android.avdExists && (avdRequired || opts.createAvd === true)) {
    await planAvdProvisioning(snapshot, opts, steps, errors);
  }
  if (
    !snapshot.labUser.exists &&
    (labUserRequired || opts.createLabUser === true)
  ) {
    await planLabUserProvisioning(snapshot, opts, steps, errors);
  }

  for (const check of checks) {
    if (check.status !== "missing") continue;
    if (["picklab-home", "avd", "lab-user"].includes(check.id)) continue;
    errors.push(
      `Required check "${check.id}" failed: ${check.detail}.` +
        (check.hint === undefined ? "" : ` Hint: ${check.hint}`),
    );
  }

  const report: InitReport = {
    ok: errors.length === 0,
    profile,
    projectDir,
    dryRun: opts.dryRun === true,
    checks,
    plan: steps,
    results: [],
    errors,
  };

  if (errors.length > 0) {
    emit(report, opts);
    return 1;
  }

  const log =
    opts.json === true ? () => {} : (line: string) => console.log(line);
  const execution = await executePlan(
    { steps },
    { dryRun: opts.dryRun, env, projectDir, log },
  );
  report.results = execution.results;
  if (!execution.ok) {
    report.ok = false;
    report.errors.push(execution.error ?? "provisioning failed");
  }
  emit(report, opts);
  return report.ok ? 0 : 1;
}

function emit(report: InitReport, opts: InitCliOptions): void {
  if (opts.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const check of report.checks) {
    console.log(formatCheckLine(check));
  }
  for (const error of report.errors) {
    console.error(`error: ${error}`);
  }
  if (report.ok) {
    console.log(
      report.dryRun
        ? `[dry-run] init complete for profile ${report.profile} (no changes made)`
        : `Initialized PickLab project (profile: ${report.profile}) in ${report.projectDir}`,
    );
  }
}
