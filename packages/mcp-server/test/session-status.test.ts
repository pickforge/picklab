import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectLab,
  makeLabDirs,
  parseToolJson,
  removeLabDirs,
  writeDesktopSessionRecord,
  type ConnectedLab,
  type LabDirs,
} from "./helpers.js";

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

describe("session_status", () => {
  it("reports dead when a running desktop session pid is gone", async () => {
    const id = writeDesktopSessionRecord(dirs.home, dirs.projectDir);

    const result = await lab.client.callTool({
      name: "session_status",
      arguments: { sessionId: id },
    });

    expect(result.isError).toBeFalsy();
    const report = parseToolJson(result);
    expect(report.sessions[0].id).toBe(id);
    expect(report.sessions[0].status).toBe("dead");
    expect(report.sessions[0].desktop.xvfbAlive).toBe(false);
  });
});
