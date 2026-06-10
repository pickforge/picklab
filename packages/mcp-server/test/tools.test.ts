import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/index.js";
import {
  connectLab,
  makeLabDirs,
  parseToolJson,
  removeLabDirs,
  type ConnectedLab,
  type LabDirs,
} from "./helpers.js";

const EXPECTED_TOOLS = [
  "session_create",
  "session_status",
  "session_destroy",
  "desktop_launch",
  "desktop_screenshot",
  "desktop_click",
  "desktop_type",
  "desktop_key",
  "android_start",
  "android_install_apk",
  "android_launch_app",
  "android_screenshot",
  "android_tap",
  "android_type",
  "android_back",
  "android_home",
  "android_get_ui_tree",
  "android_logcat",
  "android_run_adb",
  "artifact_list",
  "artifact_report",
];

let dirs: LabDirs;
let lab: ConnectedLab;

beforeEach(async () => {
  dirs = makeLabDirs();
  lab = await connectLab({
    projectDir: dirs.projectDir,
    env: { PICKLAB_HOME: dirs.home, PATH: dirs.binDir },
  });
});

afterEach(async () => {
  await lab.close();
  removeLabDirs(dirs);
});

describe("tool inventory", () => {
  it("lists every PickLab tool with an input schema and description", async () => {
    const { tools } = await lab.client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
    expect(names).toHaveLength(EXPECTED_TOOLS.length);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description).toBeTruthy();
    }
  });

  it("declares required coordinates for click and tap", async () => {
    const { tools } = await lab.client.listTools();
    const click = tools.find((tool) => tool.name === "desktop_click");
    const tap = tools.find((tool) => tool.name === "android_tap");
    expect(click?.inputSchema.required).toEqual(
      expect.arrayContaining(["x", "y"]),
    );
    expect(tap?.inputSchema.required).toEqual(
      expect.arrayContaining(["x", "y"]),
    );
  });
});

describe("input validation", () => {
  it("rejects an invalid session type", async () => {
    const result = await lab.client.callTool({
      name: "session_create",
      arguments: { type: "mainframe" },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects non-integer coordinates", async () => {
    const result = await lab.client.callTool({
      name: "desktop_click",
      arguments: { x: "10", y: 20 },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects negative tap coordinates", async () => {
    const result = await lab.client.callTool({
      name: "android_tap",
      arguments: { x: -1, y: 5 },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects missing required arguments", async () => {
    const result = await lab.client.callTool({
      name: "android_install_apk",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("rejects empty adb argument lists", async () => {
    const result = await lab.client.callTool({
      name: "android_run_adb",
      arguments: { args: [] },
    });
    expect(result.isError).toBe(true);
  });
});

describe("empty lab", () => {
  it("reports no sessions", async () => {
    const result = await lab.client.callTool({
      name: "session_status",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const report = parseToolJson(result);
    expect(report.ok).toBe(true);
    expect(report.sessions).toEqual([]);
  });

  it("reports no runs", async () => {
    const result = await lab.client.callTool({
      name: "artifact_list",
      arguments: {},
    });
    const report = parseToolJson(result);
    expect(report.ok).toBe(true);
    expect(report.runs).toEqual([]);
  });

  it("fails artifact_report when there are no runs", async () => {
    const result = await lab.client.callTool({
      name: "artifact_report",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const report = parseToolJson(result);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain("No runs found");
  });

  it("requires a session id or all flag for session_destroy", async () => {
    const result = await lab.client.callTool({
      name: "session_destroy",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("fails desktop tools with an actionable error when no session runs", async () => {
    const result = await lab.client.callTool({
      name: "desktop_click",
      arguments: { x: 1, y: 2 },
    });
    expect(result.isError).toBe(true);
    const report = parseToolJson(result);
    expect(report.errors[0]).toContain("No running desktop session");
    expect(report.errors[0]).toContain("session_create");
  });
});

describe("server context", () => {
  it("falls back to PICKLAB_PROJECT_DIR from the environment", async () => {
    const projectDir = path.join(dirs.root, "env-project");
    const server = createMcpServer({
      env: {
        PICKLAB_HOME: dirs.home,
        PATH: dirs.binDir,
        PICKLAB_PROJECT_DIR: projectDir,
      },
    });
    const client = new Client({ name: "picklab-test", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const report = parseToolJson(
        await client.callTool({ name: "artifact_list", arguments: {} }),
      );
      expect(report.projectDir).toBe(projectDir);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
