import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  resolvedDefaults,
  saveGlobalConfig,
  saveProjectConfig,
} from "../src/config.js";

let home: string;
let project: string;
let env: { PICKLAB_HOME: string };

beforeEach(async () => {
  home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-home-"));
  project = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-proj-"));
  env = { PICKLAB_HOME: home };
});

afterEach(async () => {
  await fs.promises.rm(home, { recursive: true, force: true });
  await fs.promises.rm(project, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config files exist", async () => {
    const config = await loadConfig(project, env);
    expect(config.android?.avdName).toBe("picklab-avd");
    expect(config.labUser?.name).toBe("picklab-lab");
    expect(config.labUser?.home).toBe("/var/lib/picklab/lab-home");
  });

  it("applies global config over defaults", async () => {
    await saveGlobalConfig(
      {
        profile: "android",
        android: { avdName: "global-avd" },
      },
      env,
    );
    const config = await loadConfig(project, env);
    expect(config.profile).toBe("android");
    expect(config.android?.avdName).toBe("global-avd");
    expect(config.labUser?.name).toBe("picklab-lab");
  });

  it("applies project config over global config", async () => {
    await saveGlobalConfig({ android: { avdName: "global-avd" } }, env);
    await saveProjectConfig(project, { android: { avdName: "project-avd" } });
    const config = await loadConfig(project, env);
    expect(config.android?.avdName).toBe("project-avd");
  });

  it("deep-merges nested objects across layers", async () => {
    await saveGlobalConfig(
      {
        android: { avdName: "global-avd" },
        labUser: { name: "global-user" },
      },
      env,
    );
    await saveProjectConfig(project, { labUser: { home: "/proj/home" } });
    const config = await loadConfig(project, env);
    expect(config.android?.avdName).toBe("global-avd");
    expect(config.labUser?.name).toBe("global-user");
    expect(config.labUser?.home).toBe("/proj/home");
  });

  it("throws with the file path on malformed JSON", async () => {
    const configPath = path.join(project, ".picklab", "config.json");
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await fs.promises.writeFile(configPath, "{ not json", "utf8");
    await expect(loadConfig(project, env)).rejects.toThrow(configPath);
  });

  it("round-trips unknown keys", async () => {
    await saveProjectConfig(project, {
      custom: { nested: { value: 42 } },
      flag: true,
    });
    const config = await loadConfig(project, env);
    expect(config.custom).toEqual({ nested: { value: 42 } });
    expect(config.flag).toBe(true);
  });
});

describe("save/load round-trip", () => {
  it("persists project config as pretty JSON", async () => {
    await saveProjectConfig(project, { profile: "flutter-desktop" });
    const raw = await fs.promises.readFile(
      path.join(project, ".picklab", "config.json"),
      "utf8",
    );
    expect(raw).toContain("\n");
    expect(JSON.parse(raw).profile).toBe("flutter-desktop");
  });

  it("persists global config under picklab home", async () => {
    await saveGlobalConfig({ profile: "generic" }, env);
    const raw = await fs.promises.readFile(
      path.join(home, "config.json"),
      "utf8",
    );
    expect(JSON.parse(raw).profile).toBe("generic");
  });
});

describe("resolvedDefaults", () => {
  it("exposes the documented defaults", () => {
    expect(resolvedDefaults.android.avdName).toBe("picklab-avd");
    expect(resolvedDefaults.labUser.name).toBe("picklab-lab");
    expect(resolvedDefaults.labUser.home).toBe("/var/lib/picklab/lab-home");
  });
});
