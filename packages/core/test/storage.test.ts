import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalProjectPath,
  deriveProjectId,
  projectId,
  resolveRunStorage,
  StorageConfigError,
} from "../src/storage.js";
import { saveProjectConfig } from "../src/config.js";
import { createRun } from "../src/run.js";

const execFileAsync = promisify(execFile);

let root: string;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-storage-"));
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe("deriveProjectId", () => {
  it("is stable for the same canonical path", () => {
    const id = deriveProjectId("/home/u/projects/widget");
    expect(deriveProjectId("/home/u/projects/widget")).toBe(id);
  });

  it("differs for different canonical paths", () => {
    expect(deriveProjectId("/home/u/projects/widget")).not.toBe(
      deriveProjectId("/home/u/projects/gadget"),
    );
  });

  it("includes a debuggable slug derived from the basename", () => {
    const id = deriveProjectId("/home/u/projects/My Cool App!");
    expect(id.startsWith("my-cool-app-")).toBe(true);
  });

  it("falls back to a generic slug for an unrepresentable basename", () => {
    const id = deriveProjectId("/home/u/projects/___");
    expect(id.startsWith("project-")).toBe(true);
  });
});

describe("projectId / canonicalProjectPath", () => {
  it("resolves the same id for the same directory reached through a symlink", async () => {
    const real = path.join(root, "real-project");
    const link = path.join(root, "linked-project");
    await fs.promises.mkdir(real);
    await fs.promises.symlink(real, link);

    expect(await projectId(link)).toBe(await projectId(real));
  });

  it("resolves different ids for different projects", async () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await fs.promises.mkdir(a);
    await fs.promises.mkdir(b);

    expect(await projectId(a)).not.toBe(await projectId(b));
  });

  it("does not throw for a project directory that does not exist yet", async () => {
    const missing = path.join(root, "not-created-yet");
    await expect(canonicalProjectPath(missing)).resolves.toBeTruthy();
    await expect(projectId(missing)).resolves.toBeTruthy();
  });
});

describe("resolveRunStorage", () => {
  it("defaults to home mode under the resolved PickLab home", async () => {
    const home = path.join(root, "home");
    const project = path.join(root, "project");
    await fs.promises.mkdir(project, { recursive: true });
    const env = { PICKLAB_HOME: home };

    const resolved = await resolveRunStorage(project, env);

    expect(resolved.mode).toBe("home");
    expect(resolved.projectId).toBeDefined();
    expect(resolved.runsDir).toBe(
      path.join(home, "projects", resolved.projectId!, "runs"),
    );
  });

  it("resolves project-local mode from PICKLAB_STORAGE_MODE", async () => {
    const project = path.join(root, "project");
    await fs.promises.mkdir(project, { recursive: true });

    const resolved = await resolveRunStorage(project, {
      PICKLAB_STORAGE_MODE: "project-local",
    });

    expect(resolved.mode).toBe("project-local");
    expect(resolved.runsDir).toBe(path.join(project, ".picklab", "runs"));
  });

  it("resolves project-local mode from project config", async () => {
    const project = path.join(root, "project");
    await fs.promises.mkdir(project, { recursive: true });
    await saveProjectConfig(project, { storage: { mode: "project-local" } });

    const resolved = await resolveRunStorage(project, {});

    expect(resolved.mode).toBe("project-local");
    expect(resolved.runsDir).toBe(path.join(project, ".picklab", "runs"));
  });

  it("lets an env override win over project config", async () => {
    const home = path.join(root, "home");
    const project = path.join(root, "project");
    await fs.promises.mkdir(project, { recursive: true });
    await saveProjectConfig(project, { storage: { mode: "project-local" } });

    const resolved = await resolveRunStorage(project, {
      PICKLAB_HOME: home,
      PICKLAB_STORAGE_MODE: "home",
    });

    expect(resolved.mode).toBe("home");
  });

  it("resolves custom mode from config with an absolute path", async () => {
    const project = path.join(root, "project");
    const custom = path.join(root, "custom-artifacts");
    await fs.promises.mkdir(project, { recursive: true });
    await saveProjectConfig(project, {
      storage: { mode: "custom", path: custom },
    });

    const resolved = await resolveRunStorage(project, {});

    expect(resolved.mode).toBe("custom");
    expect(resolved.runsDir).toBe(path.join(custom, "runs"));
  });

  it("rejects custom mode with no path", async () => {
    const project = path.join(root, "project");
    await fs.promises.mkdir(project, { recursive: true });

    await expect(
      resolveRunStorage(project, { PICKLAB_STORAGE_MODE: "custom" }),
    ).rejects.toThrow(StorageConfigError);
  });

  it("rejects custom mode with a relative path", async () => {
    const project = path.join(root, "project");
    await fs.promises.mkdir(project, { recursive: true });

    await expect(
      resolveRunStorage(project, {
        PICKLAB_STORAGE_MODE: "custom",
        PICKLAB_STORAGE_PATH: "relative/path",
      }),
    ).rejects.toThrow(/absolute/i);
  });
});

describe("repo cleanliness smoke", () => {
  it("leaves a target git repo's working tree clean after a default run", async () => {
    const home = path.join(root, "home");
    const project = path.join(root, "target-repo");
    await fs.promises.mkdir(project, { recursive: true });
    const env = { ...process.env, PICKLAB_HOME: home };

    await execFileAsync("git", ["init", "-q"], { cwd: project });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: project,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], {
      cwd: project,
    });
    await fs.promises.writeFile(path.join(project, "README.md"), "# repo\n");
    await execFileAsync("git", ["add", "-A"], { cwd: project });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], {
      cwd: project,
    });

    const run = await createRun(project, "smoke", {}, env);
    await fs.promises.writeFile(
      path.join(run.dir, "screenshots", "screenshot.png"),
      "fake-png",
    );
    await run.addArtifact(
      "screenshot",
      "screenshot.png",
      path.join(run.dir, "screenshots", "screenshot.png"),
    );
    await run.finish("completed");

    const status = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: project,
    });
    expect(status.stdout.trim()).toBe("");
    expect(fs.existsSync(path.join(project, ".picklab"))).toBe(false);
    expect(run.dir.startsWith(home)).toBe(true);
  });
});
