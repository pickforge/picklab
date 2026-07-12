import { describe, expect, it } from "vitest";
import { buildSupervisedBrowserCommand } from "../src/supervisor.js";

describe("buildSupervisedBrowserCommand", () => {
  it("runs the browser behind a stable Node process-group leader", () => {
    const command = buildSupervisedBrowserCommand(
      "/usr/bin/node",
      "/usr/bin/chromium",
      ["--remote-debugging-port=0", "about:blank"],
    );

    expect(command.command).toBe("/usr/bin/node");
    expect(command.args).toEqual([
      "--input-type=module",
      "-e",
      expect.stringContaining('import * as fs from "node:fs";'),
      "/usr/bin/chromium",
      "--remote-debugging-port=0",
      "about:blank",
    ]);
    expect(command.args[2]).toContain(
      'import { spawn } from "node:child_process";',
    );
  });

  it("rejects missing executable paths", () => {
    expect(() =>
      buildSupervisedBrowserCommand("", "/usr/bin/chromium", []),
    ).toThrow(/Node.js executable/);
    expect(() =>
      buildSupervisedBrowserCommand("/usr/bin/node", "", []),
    ).toThrow(/browser binary/);
  });
});
