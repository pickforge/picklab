import { sdkmanagerInstallCommand } from "@pickforge/picklab-android";
import type { EnvLike } from "@pickforge/picklab-core";
import { collectSnapshot, type DetectionSnapshot } from "../provision/detect.js";
import { executePlan, type StepResult } from "../provision/executor.js";
import {
  planHasCommandSteps,
  type ProvisioningStep,
} from "../provision/plan.js";
import {
  planCreateAvd,
  RECOMMENDED_SYSTEM_IMAGE,
} from "../provision/planner.js";
import { confirm } from "../provision/prompts.js";

export interface SetupAndroidCliOptions {
  createAvd?: boolean;
  avdName?: string;
  systemImage?: string;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface SetupAndroidReport {
  ok: boolean;
  sdkRoot: string | null;
  tools: DetectionSnapshot["android"]["tools"];
  systemImages: string[];
  kvm: DetectionSnapshot["android"]["kvm"];
  avdName: string;
  avds: string[];
  avdExists: boolean;
  dryRun: boolean;
  plan: ProvisioningStep[];
  results: StepResult[];
  error?: string;
}

function describe(report: SetupAndroidReport): string[] {
  const lines = [
    `Android SDK:    ${report.sdkRoot ?? "not found"}`,
    `sdkmanager:     ${report.tools.sdkmanager ?? "not found"}`,
    `avdmanager:     ${report.tools.avdmanager ?? "not found"}`,
    `emulator:       ${report.tools.emulator ?? "not found"}`,
    `adb:            ${report.tools.adb ?? "not found"}`,
    `system images:  ${
      report.systemImages.length > 0
        ? report.systemImages.join(", ")
        : "none installed"
    }`,
    `KVM:            ${report.kvm.supported ? "available" : "unavailable"}`,
    `AVDs:           ${report.avds.length > 0 ? report.avds.join(", ") : "none"}`,
  ];
  if (report.systemImages.length === 0) {
    lines.push(
      `hint: install a system image with: ` +
        sdkmanagerInstallCommand(RECOMMENDED_SYSTEM_IMAGE),
    );
  }
  return lines;
}

function emit(report: SetupAndroidReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const line of describe(report)) {
    console.log(line);
  }
  if (report.error !== undefined) {
    console.error(`error: ${report.error}`);
  }
}

export async function runSetupAndroid(
  opts: SetupAndroidCliOptions,
  env: EnvLike = process.env,
): Promise<number> {
  const snapshot = await collectSnapshot({ env, avdName: opts.avdName });
  const android = snapshot.android;
  const report: SetupAndroidReport = {
    ok: true,
    sdkRoot: android.sdkRoot,
    tools: android.tools,
    systemImages: android.systemImages.map((image) => image.packageId),
    kvm: android.kvm,
    avdName: android.avdName,
    avds: android.avds,
    avdExists: android.avdExists,
    dryRun: opts.dryRun === true,
    plan: [],
    results: [],
  };

  if (opts.createAvd !== true) {
    emit(report, opts.json === true);
    return 0;
  }

  const result = planCreateAvd({
    avdName: android.avdName,
    systemImage: opts.systemImage,
    sdkRoot: android.sdkRoot,
    avdmanagerPath: android.tools.avdmanager,
    installedImages: android.systemImages,
    existingAvds: android.avds,
  });
  if (!result.ok) {
    report.ok = false;
    report.error = result.error;
    emit(report, opts.json === true);
    return 1;
  }
  report.plan = result.plan.steps;

  if (planHasCommandSteps(result.plan) && opts.dryRun !== true) {
    const answer = await confirm(`Create AVD "${android.avdName}"?`, {
      yes: opts.yes,
    });
    if (answer === "non-interactive") {
      report.ok = false;
      report.error =
        "Refusing to create the AVD without consent in a non-interactive " +
        "session. Re-run with --yes.";
      emit(report, opts.json === true);
      return 1;
    }
    if (answer === "no") {
      report.ok = false;
      report.error = "Aborted: AVD creation was declined.";
      emit(report, opts.json === true);
      return 1;
    }
  }

  const log =
    opts.json === true ? () => {} : (line: string) => console.log(line);
  if (opts.json !== true && android.avdExists) {
    console.log(`AVD "${android.avdName}" already exists.`);
  }
  const execution = await executePlan(result.plan, {
    dryRun: opts.dryRun,
    env,
    log,
  });
  report.results = execution.results;
  report.ok = execution.ok;
  if (!execution.ok) {
    report.error = execution.error;
  }
  emit(report, opts.json === true);
  return execution.ok ? 0 : 1;
}
