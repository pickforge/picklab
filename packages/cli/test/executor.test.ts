import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../src/provision/executor.js";
import type { ProvisioningPlan } from "../src/provision/plan.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-executor-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("executePlan", () => {
  it("only logs in dry-run mode and touches nothing", async () => {
    const target = path.join(tmpDir, "home", ".picklab");
    const plan: ProvisioningPlan = {
      steps: [
        {
          id: "picklab-home",
          title: "Create PickLab home",
          kind: "mkdir",
          privileged: false,
          dir: target,
        },
        {
          id: "persist",
          title: "Persist config",
          kind: "write-global-config",
          privileged: false,
          config: { android: { avdName: "picklab-avd" } },
        },
        {
          id: "boom",
          title: "Never runs",
          kind: "command",
          privileged: false,
          command: { cmd: "/nonexistent/bin", args: ["x"] },
        },
      ],
    };
    const lines: string[] = [];
    const result = await executePlan(plan, {
      dryRun: true,
      env: { PICKLAB_HOME: path.join(tmpDir, "home", ".picklab") },
      log: (line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    expect(result.results.map((step) => step.detail)).toEqual([
      "dry-run",
      "dry-run",
      "dry-run",
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("[dry-run]");
    expect(lines[0]).toContain(`mkdir -p ${target}`);
    expect(fs.existsSync(path.join(tmpDir, "home"))).toBe(false);
  });

  it("creates directories for mkdir steps", async () => {
    const target = path.join(tmpDir, "a", "b");
    const result = await executePlan({
      steps: [
        {
          id: "mk",
          title: "mk",
          kind: "mkdir",
          privileged: false,
          dir: target,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("merges global config patches into an existing file", async () => {
    const home = path.join(tmpDir, ".picklab");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ profile: "android", android: { extra: true } }),
    );
    const result = await executePlan(
      {
        steps: [
          {
            id: "persist",
            title: "persist",
            kind: "write-global-config",
            privileged: false,
            config: { android: { avdName: "picklab-avd" } },
          },
        ],
      },
      { env: { PICKLAB_HOME: home } },
    );
    expect(result.ok).toBe(true);
    const saved = JSON.parse(
      fs.readFileSync(path.join(home, "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(saved).toEqual({
      profile: "android",
      android: { extra: true, avdName: "picklab-avd" },
    });
  });

  it("writes project config patches", async () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await executePlan(
      {
        steps: [
          {
            id: "project",
            title: "project",
            kind: "write-project-config",
            privileged: false,
            config: { profile: "generic" },
          },
        ],
      },
      { projectDir },
    );
    expect(result.ok).toBe(true);
    const saved = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".picklab", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(saved).toEqual({ profile: "generic" });
  });

  it("runs command steps and reports success", async () => {
    const result = await executePlan({
      steps: [
        {
          id: "ok",
          title: "ok",
          kind: "command",
          privileged: false,
          command: { cmd: process.execPath, args: ["-e", "process.exit(0)"] },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("stops at the first failing command with stderr detail", async () => {
    const marker = path.join(tmpDir, "should-not-exist");
    const result = await executePlan({
      steps: [
        {
          id: "fail",
          title: "fail",
          kind: "command",
          privileged: false,
          command: {
            cmd: process.execPath,
            args: ["-e", 'console.error("boom"); process.exit(3)'],
          },
        },
        {
          id: "after",
          title: "after",
          kind: "mkdir",
          privileged: false,
          dir: marker,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
    expect(result.results).toHaveLength(1);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
