import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import {
  connectLab,
  makeLabDirs,
  parseToolJson,
  PLANTED_TOKEN,
  PNG_MAGIC,
  removeLabDirs,
  writeDesktopSessionRecord,
  writeSyntheticRun,
  type ConnectedLab,
  type LabDirs,
} from "./helpers.js";

const RUN_ID = "20260609-120000-synthetic";

function first(contents: unknown): Record<string, any> {
  return (contents as Array<Record<string, any>>)[0] as Record<string, any>;
}

let dirs: LabDirs;
let lab: ConnectedLab;
let sessionId: string;

beforeEach(async () => {
  dirs = makeLabDirs();
  writeSyntheticRun(dirs.projectDir, RUN_ID);
  sessionId = writeDesktopSessionRecord(dirs.home, dirs.projectDir);
  lab = await connectLab({
    projectDir: dirs.projectDir,
    env: { PICKLAB_HOME: dirs.home, PATH: dirs.binDir },
  });
});

afterEach(async () => {
  await lab.close();
  removeLabDirs(dirs);
});

describe("resource listing", () => {
  it("lists runs, manifests, screenshots, logs, and session statuses", async () => {
    const { resources } = await lab.client.listResources();
    const uris = resources.map((resource) => resource.uri);
    expect(uris).toContain("picklab://runs");
    expect(uris).toContain(`picklab://runs/${RUN_ID}/manifest`);
    expect(uris).toContain(
      `picklab://runs/${RUN_ID}/screenshots/screenshot.png`,
    );
    expect(uris).toContain(`picklab://runs/${RUN_ID}/logs/app.log`);
    expect(uris).toContain(`picklab://sessions/${sessionId}/status`);
  });

  it("exposes the parameterized resource templates", async () => {
    const { resourceTemplates } = await lab.client.listResourceTemplates();
    const templates = resourceTemplates.map(
      (template) => template.uriTemplate,
    );
    expect(templates).toEqual(
      expect.arrayContaining([
        "picklab://runs/{runId}/manifest",
        "picklab://runs/{runId}/screenshots/{name}",
        "picklab://runs/{runId}/logs/{name}",
        "picklab://sessions/{sessionId}/status",
      ]),
    );
  });
});

describe("resource reads", () => {
  it("reads the run index as JSON", async () => {
    const { contents } = await lab.client.readResource({
      uri: "picklab://runs",
    });
    const runs = JSON.parse(first(contents).text as string);
    expect(runs[0].runId).toBe(RUN_ID);
  });

  it("reads a run manifest as JSON", async () => {
    const { contents } = await lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/manifest`,
    });
    expect(first(contents).mimeType).toBe("application/json");
    const manifest = JSON.parse(first(contents).text as string);
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.artifacts).toHaveLength(2);
  });

  it("reads a screenshot as a base64 blob", async () => {
    const { contents } = await lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/screenshots/screenshot.png`,
    });
    expect(first(contents).mimeType).toBe("image/png");
    const data = Buffer.from(first(contents).blob as string, "base64");
    expect(data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)).toBe(true);
  });

  it("refuses to inline a screenshot blob over 8MB", async () => {
    const bigPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "screenshots",
      "big.png",
    );
    fs.writeFileSync(
      bigPath,
      Buffer.concat([PNG_MAGIC, Buffer.alloc(8 * 1024 * 1024)]),
    );
    const { contents } = await lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/screenshots/big.png`,
    });
    expect(first(contents).mimeType).toBe("text/plain");
    expect(first(contents).blob).toBeUndefined();
    expect(first(contents).text).toContain("inline limit");
    expect(first(contents).text).toContain(bigPath);
  });

  it("reads a log with secrets redacted", async () => {
    const { contents } = await lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/logs/app.log`,
    });
    const text = first(contents).text as string;
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(PLANTED_TOKEN);
  });

  it("reads a session status as JSON", async () => {
    const { contents } = await lab.client.readResource({
      uri: `picklab://sessions/${sessionId}/status`,
    });
    const status = JSON.parse(first(contents).text as string);
    expect(status.id).toBe(sessionId);
    expect(status.type).toBe("desktop");
    expect(status.desktop.xvfbAlive).toBe(false);
    expect(status.viewer).toEqual({
      endpoint: null,
      ready: false,
      readOnly: false,
      hostGuiLaunchSupported: false,
    });
  });
});

describe("traversal protection", () => {
  it.each([
    "picklab://runs/../x/manifest",
    "picklab://runs/%2e%2e/manifest",
    `picklab://runs/${RUN_ID}/logs/%2e%2e%2fmanifest.json`,
    `picklab://runs/${RUN_ID}/screenshots/..%2f..%2fmanifest.json`,
    "picklab://sessions/%2e%2e%2fdesk-000001/status",
  ])("rejects %s", async (uri) => {
    await expect(lab.client.readResource({ uri })).rejects.toThrow();
  });

  it("rejects an unknown run id", async () => {
    await expect(
      lab.client.readResource({ uri: "picklab://runs/nope/manifest" }),
    ).rejects.toThrow();
  });
});

describe("symlink protection", () => {
  it("rejects a screenshot symlink pointing outside the run dir", async () => {
    const secret = path.join(dirs.root, "outside-secret.png");
    fs.writeFileSync(secret, Buffer.concat([PNG_MAGIC, Buffer.from([9])]));
    const linkPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "screenshots",
      "escape.png",
    );
    fs.symlinkSync(secret, linkPath);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/screenshots/escape.png`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    expect(resources.map((r) => r.uri)).not.toContain(
      `picklab://runs/${RUN_ID}/screenshots/escape.png`,
    );
  });

  it("rejects a log symlink pointing outside the run dir", async () => {
    const secret = path.join(dirs.root, "outside-secret.log");
    fs.writeFileSync(secret, `token=${PLANTED_TOKEN}\n`);
    const linkPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "logs",
      "escape.log",
    );
    fs.symlinkSync(secret, linkPath);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/logs/escape.log`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    expect(resources.map((r) => r.uri)).not.toContain(
      `picklab://runs/${RUN_ID}/logs/escape.log`,
    );
  });

  it("rejects a screenshot symlink pointing to a safe in-run file", async () => {
    const linkPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "screenshots",
      "link.png",
    );
    fs.symlinkSync("screenshot.png", linkPath);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/screenshots/link.png`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    expect(resources.map((r) => r.uri)).not.toContain(
      `picklab://runs/${RUN_ID}/screenshots/link.png`,
    );
  });

  it("rejects a log symlink pointing to a safe in-run file", async () => {
    const linkPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "logs",
      "link.log",
    );
    fs.symlinkSync("app.log", linkPath);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/logs/link.log`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    expect(resources.map((r) => r.uri)).not.toContain(
      `picklab://runs/${RUN_ID}/logs/link.log`,
    );
  });

  it("rejects a symlinked screenshots dir pointing outside the run dir", async () => {
    const outsideDir = path.join(dirs.root, "outside-screenshots");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(
      path.join(outsideDir, "leak.png"),
      Buffer.concat([PNG_MAGIC, Buffer.from([9])]),
    );
    const subdir = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "screenshots",
    );
    fs.rmSync(subdir, { recursive: true, force: true });
    fs.symlinkSync(outsideDir, subdir);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/screenshots/leak.png`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    expect(resources.map((r) => r.uri)).not.toContain(
      `picklab://runs/${RUN_ID}/screenshots/leak.png`,
    );
  });

  it("rejects a manifest symlink pointing outside the run dir", async () => {
    const secret = path.join(dirs.root, "outside-manifest.json");
    fs.writeFileSync(secret, JSON.stringify({ runId: "evil-leak" }));
    const manifestPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "manifest.json",
    );
    fs.rmSync(manifestPath, { force: true });
    fs.symlinkSync(secret, manifestPath);

    const result = lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/manifest`,
    });
    await expect(result).rejects.toThrow(/Run not found/i);
    await expect(result).rejects.not.toThrow(/evil-leak/);
  });

  it("does not leak a symlinked manifest via listings", async () => {
    const secret = path.join(dirs.root, "outside-manifest-leak.json");
    fs.writeFileSync(
      secret,
      JSON.stringify({
        runId: "evil-leak",
        slug: "leaked-slug",
        secretField: PLANTED_TOKEN,
        artifacts: [],
      }),
    );
    const manifestPath = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "manifest.json",
    );
    fs.rmSync(manifestPath, { force: true });
    fs.symlinkSync(secret, manifestPath);

    // picklab://runs must not contain leaked fields/values or the skipped run.
    const { contents } = await lab.client.readResource({
      uri: "picklab://runs",
    });
    const text = first(contents).text as string;
    expect(text).not.toContain(PLANTED_TOKEN);
    expect(text).not.toContain("leaked-slug");
    expect(text).not.toContain(RUN_ID);

    // listResources() must not include the run's manifest or files.
    const { resources } = await lab.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).not.toContain(`picklab://runs/${RUN_ID}/manifest`);
    expect(uris).not.toContain(
      `picklab://runs/${RUN_ID}/screenshots/screenshot.png`,
    );
    expect(uris).not.toContain(`picklab://runs/${RUN_ID}/logs/app.log`);

    // Direct manifest read still rejects without leaking.
    const result = lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/manifest`,
    });
    await expect(result).rejects.toThrow(/Run not found/i);
    await expect(result).rejects.not.toThrow(/evil-leak/);
  });

  it("rejects a symlinked logs dir pointing outside the run dir", async () => {
    const outsideDir = path.join(dirs.root, "outside-logs");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(
      path.join(outsideDir, "leak.log"),
      `token=${PLANTED_TOKEN}\n`,
    );
    const subdir = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
      "logs",
    );
    fs.rmSync(subdir, { recursive: true, force: true });
    fs.symlinkSync(outsideDir, subdir);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/logs/leak.log`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    expect(resources.map((r) => r.uri)).not.toContain(
      `picklab://runs/${RUN_ID}/logs/leak.log`,
    );
  });

  it("rejects a symlinked run dir pointing outside the runs root", async () => {
    const outsideRun = path.join(dirs.root, "outside-run");
    fs.mkdirSync(path.join(outsideRun, "logs"), { recursive: true });
    fs.mkdirSync(path.join(outsideRun, "screenshots"), { recursive: true });
    fs.writeFileSync(
      path.join(outsideRun, "manifest.json"),
      JSON.stringify({ runId: "evil-leak" }),
    );
    fs.writeFileSync(
      path.join(outsideRun, "logs", "leak.log"),
      `token=${PLANTED_TOKEN}\n`,
    );
    fs.writeFileSync(
      path.join(outsideRun, "screenshots", "leak.png"),
      Buffer.concat([PNG_MAGIC, Buffer.from([9])]),
    );

    const runDir = path.join(
      dirs.projectDir,
      ".picklab",
      "runs",
      RUN_ID,
    );
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.symlinkSync(outsideRun, runDir);

    const manifestResult = lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/manifest`,
    });
    await expect(manifestResult).rejects.toThrow(/not found/i);
    await expect(manifestResult).rejects.not.toThrow(/evil-leak/);

    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/logs/leak.log`,
      }),
    ).rejects.toThrow(/not found/i);
    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/screenshots/leak.png`,
      }),
    ).rejects.toThrow(/not found/i);

    const { resources } = await lab.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).not.toContain(`picklab://runs/${RUN_ID}/logs/leak.log`);
    expect(uris).not.toContain(
      `picklab://runs/${RUN_ID}/screenshots/leak.png`,
    );
  });

  it("rejects a symlinked .picklab dir pointing outside the project", async () => {
    // Build a real outside project whose `.picklab/runs` holds a leaking run,
    // then point this project's `.picklab` at the outside `.picklab`.
    const outsideProject = fs.mkdtempSync(
      path.join(os.tmpdir(), "picklab-outside-proj-"),
    );
    try {
      const leakRunId = "20260609-130000-leak";
      writeSyntheticRun(outsideProject, leakRunId, {
        logBody: `token=${PLANTED_TOKEN}\n`,
      });
      // Rewrite the leaking manifest to carry a recognizable slug/field.
      const leakManifestPath = path.join(
        outsideProject,
        ".picklab",
        "runs",
        leakRunId,
        "manifest.json",
      );
      fs.writeFileSync(
        leakManifestPath,
        JSON.stringify({
          runId: leakRunId,
          slug: "leaked-slug",
          createdAt: "2026-06-09T13:00:00.000Z",
          status: "completed",
          secretField: PLANTED_TOKEN,
          artifacts: [],
        }),
      );

      const projectPicklab = path.join(dirs.projectDir, ".picklab");
      fs.rmSync(projectPicklab, { recursive: true, force: true });
      fs.symlinkSync(
        path.join(outsideProject, ".picklab"),
        projectPicklab,
      );

      // picklab://runs must be empty and leak nothing.
      const { contents } = await lab.client.readResource({
        uri: "picklab://runs",
      });
      const text = first(contents).text as string;
      expect(JSON.parse(text)).toEqual([]);
      expect(text).not.toContain(PLANTED_TOKEN);
      expect(text).not.toContain("leaked-slug");

      // Direct manifest/log/screenshot reads reject without leaking.
      const manifestResult = lab.client.readResource({
        uri: `picklab://runs/${leakRunId}/manifest`,
      });
      await expect(manifestResult).rejects.toThrow(/not found/i);
      await expect(manifestResult).rejects.not.toThrow(/leaked-slug/);
      await expect(
        lab.client.readResource({
          uri: `picklab://runs/${leakRunId}/logs/app.log`,
        }),
      ).rejects.toThrow(/not found/i);
      await expect(
        lab.client.readResource({
          uri: `picklab://runs/${leakRunId}/screenshots/screenshot.png`,
        }),
      ).rejects.toThrow(/not found/i);

      // MCP tools must not expose outside manifest data.
      const listResult = parseToolJson(
        await lab.client.callTool({ name: "artifact_list", arguments: {} }),
      );
      expect(listResult.runs).toEqual([]);
      expect(JSON.stringify(listResult)).not.toContain(PLANTED_TOKEN);
      expect(JSON.stringify(listResult)).not.toContain("leaked-slug");

      const reportResult = await lab.client.callTool({
        name: "artifact_report",
        arguments: { runId: leakRunId },
      });
      expect(reportResult.isError).toBe(true);
      expect(JSON.stringify(reportResult)).not.toContain(PLANTED_TOKEN);
      expect(JSON.stringify(reportResult)).not.toContain("leaked-slug");
    } finally {
      fs.rmSync(outsideProject, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked runs root pointing outside the project", async () => {
    const outsideRuns = path.join(dirs.root, "outside-runs");
    const outsideRun = path.join(outsideRuns, RUN_ID);
    fs.mkdirSync(path.join(outsideRun, "logs"), { recursive: true });
    fs.mkdirSync(path.join(outsideRun, "screenshots"), { recursive: true });
    fs.writeFileSync(
      path.join(outsideRun, "manifest.json"),
      JSON.stringify({
        runId: "evil-leak",
        slug: "leaked-slug",
        secretField: PLANTED_TOKEN,
        artifacts: [],
      }),
    );
    fs.writeFileSync(
      path.join(outsideRun, "logs", "leak.log"),
      `token=${PLANTED_TOKEN}\n`,
    );
    fs.writeFileSync(
      path.join(outsideRun, "screenshots", "leak.png"),
      Buffer.concat([PNG_MAGIC, Buffer.from([9])]),
    );

    const runsRoot = path.join(dirs.projectDir, ".picklab", "runs");
    fs.rmSync(runsRoot, { recursive: true, force: true });
    fs.symlinkSync(outsideRuns, runsRoot);

    // Direct manifest read rejects without leaking outside data.
    const manifestResult = lab.client.readResource({
      uri: `picklab://runs/${RUN_ID}/manifest`,
    });
    await expect(manifestResult).rejects.toThrow(/not found/i);
    await expect(manifestResult).rejects.not.toThrow(/evil-leak/);
    await expect(manifestResult).rejects.not.toThrow(/leaked-slug/);

    // Direct log read rejects without leaking outside data.
    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/logs/leak.log`,
      }),
    ).rejects.toThrow(/not found/i);

    // Direct screenshot read rejects without leaking outside data.
    await expect(
      lab.client.readResource({
        uri: `picklab://runs/${RUN_ID}/screenshots/leak.png`,
      }),
    ).rejects.toThrow(/not found/i);

    // Listing remains empty and exposes no outside resources.
    const { contents } = await lab.client.readResource({
      uri: "picklab://runs",
    });
    const text = first(contents).text as string;
    expect(JSON.parse(text)).toEqual([]);
    expect(text).not.toContain(PLANTED_TOKEN);
    expect(text).not.toContain("leaked-slug");

    const { resources } = await lab.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).not.toContain(`picklab://runs/${RUN_ID}/manifest`);
    expect(uris).not.toContain(`picklab://runs/${RUN_ID}/logs/leak.log`);
    expect(uris).not.toContain(
      `picklab://runs/${RUN_ID}/screenshots/leak.png`,
    );
  });
});
