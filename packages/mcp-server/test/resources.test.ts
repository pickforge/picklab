import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectLab,
  makeLabDirs,
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
