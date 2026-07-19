import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyPlan,
  executeProvisioning,
  type ProvisioningExecutionAdapter,
  type ProvisioningSection,
} from "../src/provision/executor.js";
import type { ProvisioningPlan, ProvisioningStep } from "../src/provision/plan.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-executor-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function command(
  id: string,
  privileged = false,
  args: string[] = ["-e", "process.exit(0)"],
): ProvisioningStep {
  return {
    id,
    title: id,
    kind: "command",
    privileged,
    command: { cmd: process.execPath, args },
  };
}

function approved(plan: ProvisioningPlan): ProvisioningSection {
  return {
    kind: "plan",
    plan,
    consent: { decide: async () => ({ kind: "approved" }) },
  };
}

describe("classifyPlan", () => {
  it("classifies empty, automatic, unprivileged, privileged, and mixed plans", () => {
    expect(classifyPlan({ steps: [] })).toBe("empty");
    expect(
      classifyPlan({
        steps: [
          {
            id: "config",
            title: "config",
            kind: "write-global-config",
            privileged: false,
            config: { profile: "generic" },
          },
        ],
      }),
    ).toBe("automatic");
    expect(classifyPlan({ steps: [command("normal")] })).toBe("unprivileged");
    expect(classifyPlan({ steps: [command("root", true)] })).toBe("privileged");
    expect(
      classifyPlan({ steps: [command("normal"), command("root", true)] }),
    ).toBe("mixed");
  });
});

describe("executeProvisioning", () => {
  it("only logs redacted plan details in dry-run mode", async () => {
    const target = path.join(tmpDir, "home", ".picklab");
    const lines: string[] = [];
    let adapterCalls = 0;
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan: {
            steps: [
              {
                id: "picklab-home",
                title: "Create PickLab home",
                kind: "mkdir",
                privileged: false,
                dir: target,
              },
              command("secret", true, ["--token=planted-secret"]),
            ],
          },
        },
      ],
      {
        dryRun: true,
        log: (line) => lines.push(line),
        adapter: {
          materialize: (step) => step,
          execute: async () => {
            adapterCalls += 1;
          },
          executePrivileged: async () => {
            adapterCalls += 1;
          },
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.results.map((step) => step.detail)).toEqual([
      "dry-run",
      "dry-run",
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`mkdir -p ${target}`);
    expect(lines.join("\n")).toContain("--token=[REDACTED]");
    expect(lines.join("\n")).not.toContain("planted-secret");
    expect(adapterCalls).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "home"))).toBe(false);
  });

  it("fails closed before mutation when command consent is absent", async () => {
    const target = path.join(tmpDir, "should-not-exist");
    const result = await executeProvisioning([
      {
        kind: "plan",
        plan: {
          steps: [
            {
              id: "mk",
              title: "mk",
              kind: "mkdir",
              privileged: false,
              dir: target,
            },
          ],
        },
      },
      { kind: "plan", plan: { steps: [command("needs-consent")] } },
    ]);
    expect(result.status).toBe("cancelled");
    expect(result.results).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("preflights cancellation before earlier automatic steps mutate", async () => {
    const target = path.join(tmpDir, "should-not-exist");
    const result = await executeProvisioning([
      {
        kind: "plan",
        plan: {
          steps: [
            {
              id: "mk",
              title: "mk",
              kind: "mkdir",
              privileged: false,
              dir: target,
            },
          ],
        },
      },
      {
        kind: "plan",
        plan: { steps: [command("declined")] },
        consent: {
          decide: async () => ({
            kind: "declined",
            reason: "user declined",
          }),
        },
      },
    ]);
    expect(result.status).toBe("declined");
    expect(result.error).toBe("user declined");
    expect(result.plan.steps.map((step) => step.id)).toEqual(["mk"]);
    expect(result.results).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("skips declined sections and executes the remaining plan", async () => {
    const calls: string[] = [];
    const adapter: ProvisioningExecutionAdapter = {
      materialize: (step) => step,
      execute: async (step) => {
        calls.push(step.id);
      },
      executePrivileged: async (step) => {
        calls.push(step.id);
      },
    };
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan: { steps: [command("skip")] },
          consent: {
            onDenied: "skip",
            decide: async () => ({ kind: "declined", reason: "skipped item" }),
          },
        },
        approved({ steps: [command("run")] }),
      ],
      { adapter },
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual(["skipped item"]);
    expect(result.plan.steps.map((step) => step.id)).toEqual(["run"]);
    expect(calls).toEqual(["run"]);
  });

  it("routes mixed plans sequentially according to step privilege", async () => {
    const calls: string[] = [];
    const classifications: string[] = [];
    const plan = {
      steps: [command("first"), command("root", true), command("last")],
    };
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan,
          consent: {
            decide: async (classification) => {
              classifications.push(classification);
              return { kind: "approved" };
            },
          },
        },
      ],
      {
        adapter: {
          materialize: (step) => step,
          execute: async (step) => {
            calls.push(`normal:${step.id}`);
          },
          executePrivileged: async (step) => {
            calls.push(`privileged:${step.id}`);
          },
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(classifications).toEqual(["mixed"]);
    expect(calls).toEqual([
      "normal:first",
      "privileged:root",
      "normal:last",
    ]);
  });

  it("executes the exact materialized step through the selected route", async () => {
    const rawNormal = command("normal");
    const rawPrivileged = command("root", true);
    const materialized = new Map<ProvisioningStep, ProvisioningStep>();
    const routed: Array<{ route: string; step: ProvisioningStep }> = [];
    const adapter: ProvisioningExecutionAdapter = {
      materialize: (step) => {
        const value = {
          ...step,
          title: `${step.title}-materialized`,
        } as ProvisioningStep;
        materialized.set(step, value);
        return value;
      },
      execute: async (step) => {
        routed.push({ route: "normal", step });
      },
      executePrivileged: async (step) => {
        routed.push({ route: "privileged", step });
      },
    };

    await executeProvisioning(
      [approved({ steps: [rawNormal, rawPrivileged] })],
      { adapter },
    );

    expect(routed).toEqual([
      { route: "normal", step: materialized.get(rawNormal) },
      { route: "privileged", step: materialized.get(rawPrivileged) },
    ]);
  });

  it("stops on failure with redacted partial results", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const result = await executeProvisioning(
      [approved({ steps: [command("first"), command("root", true), command("last")] })],
      {
        log: (line) => lines.push(line),
        adapter: {
          materialize: (step) => step,
          execute: async (step) => {
            calls.push(step.id);
          },
          executePrivileged: async (step) => {
            calls.push(step.id);
            throw new Error("API_TOKEN=planted-secret");
          },
        },
      },
    );
    expect(result.status).toBe("failed");
    expect(result.results.map((step) => [step.id, step.ok])).toEqual([
      ["first", true],
      ["root", false],
    ]);
    expect(calls).toEqual(["first", "root"]);
    expect(result.error).toContain("API_TOKEN=[REDACTED]");
    expect(JSON.stringify(result) + lines.join("\n")).not.toContain(
      "planted-secret",
    );
  });

  it("returns the local sudo presentation when consent is declined", async () => {
    const raw: ProvisioningStep = {
      id: "useradd",
      title: "useradd",
      kind: "command",
      privileged: true,
      command: {
        cmd: "useradd",
        args: ["-r", "-M", "-s", "/usr/sbin/nologin", "picklab-lab"],
      },
    };
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan: { steps: [raw] },
          consent: {
            retainPlanOnDenied: true,
            decide: async () => ({ kind: "declined", reason: "declined" }),
          },
        },
      ],
      {
        privilege: { sudoPath: "/usr/bin/sudo", nonInteractive: true },
      },
    );
    expect(result.status).toBe("declined");
    expect(result.plan.steps[0]).toMatchObject({
      privileged: true,
      command: {
        cmd: "/usr/bin/sudo",
        args: [
          "-n",
          "useradd",
          "-r",
          "-M",
          "-s",
          "/usr/sbin/nologin",
          "picklab-lab",
        ],
      },
    });
    expect(raw).toMatchObject({ command: { cmd: "useradd" } });
    if (raw.kind !== "command") throw new Error("expected command step");
    expect(raw.command.args).toEqual([
      "-r",
      "-M",
      "-s",
      "/usr/sbin/nologin",
      "picklab-lab",
    ]);
  });

  it("fails privilege preflight before any mutation", async () => {
    const target = path.join(tmpDir, "should-not-exist");
    let consentCalls = 0;
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan: {
            steps: [
              {
                id: "mk",
                title: "mk",
                kind: "mkdir",
                privileged: false,
                dir: target,
              },
            ],
          },
        },
        {
          kind: "plan",
          plan: { steps: [command("root", true)] },
          privilegeUnavailable: { reason: "same missing sudo message" },
          consent: {
            decide: async () => {
              consentCalls += 1;
              return { kind: "approved" };
            },
          },
        },
      ],
      { privilege: { sudoPath: null, nonInteractive: true } },
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("same missing sudo message");
    expect(result.plan.steps.map((step) => step.id)).toEqual(["mk"]);
    expect(result.results).toEqual([]);
    expect(consentCalls).toBe(0);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("retains prior prepared sections and ordered policy results", async () => {
    const target = path.join(tmpDir, "should-not-exist");
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan: {
            steps: [
              {
                id: "mk",
                title: "mk",
                kind: "mkdir",
                privileged: false,
                dir: target,
              },
            ],
          },
        },
        { kind: "blocked", action: "skip", reason: "first skip" },
        {
          kind: "plan",
          plan: { steps: [command("root", true)] },
          privilegeUnavailable: { action: "skip", reason: "second skip" },
        },
        { kind: "blocked", reason: "later error" },
      ],
      { privilege: { sudoPath: null, nonInteractive: true } },
    );

    expect(result.plan.steps.map((step) => step.id)).toEqual(["mk"]);
    expect(result.skipped).toEqual(["first skip", "second skip"]);
    expect(result.errors).toEqual(["later error"]);
    expect(result.results).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("redacts the entire public plan while routing unredacted materialized data", async () => {
    const secret = "API_TOKEN=planted-secret";
    const routed: ProvisioningStep[] = [];
    const lines: string[] = [];
    const raw: ProvisioningStep = {
      id: secret,
      title: secret,
      kind: "command",
      privileged: true,
      command: {
        cmd: "tool",
        args: [secret],
        env: { API_TOKEN: "planted-secret" },
        input: secret,
      },
    };
    const config: ProvisioningStep = {
      id: "config",
      title: "config",
      kind: "write-global-config",
      privileged: false,
      config: { labUser: { name: secret, home: secret } },
    };
    const result = await executeProvisioning(
      [approved({ steps: [raw, config] })],
      {
        log: (line) => lines.push(line),
        adapter: {
          materialize: (step) => step,
          execute: async (step) => {
            routed.push(step);
          },
          executePrivileged: async (step) => {
            routed.push(step);
          },
        },
      },
    );

    expect(routed).toEqual([raw, config]);
    expect(JSON.stringify(result.plan) + lines.join("\n")).not.toContain(
      "planted-secret",
    );
    expect(JSON.stringify(result.plan)).toContain("[REDACTED]");
  });

  it("merges global and project config through the local adapter", async () => {
    const home = path.join(tmpDir, ".picklab");
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(projectDir);
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ profile: "android", android: { extra: true } }),
    );
    const result = await executeProvisioning(
      [
        {
          kind: "plan",
          plan: {
            steps: [
              {
                id: "global",
                title: "global",
                kind: "write-global-config",
                privileged: false,
                config: { android: { avdName: "picklab-avd" } },
              },
              {
                id: "project",
                title: "project",
                kind: "write-project-config",
                privileged: false,
                config: { profile: "generic" },
              },
            ],
          },
        },
      ],
      { env: { PICKLAB_HOME: home }, projectDir },
    );
    expect(result.ok).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")),
    ).toEqual({
      profile: "android",
      android: { extra: true, avdName: "picklab-avd" },
    });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(projectDir, ".picklab", "config.json"), "utf8"),
      ),
    ).toEqual({ profile: "generic" });
  });
});
