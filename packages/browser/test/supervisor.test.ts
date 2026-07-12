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
    expect(command.args[0]).toBe("-e");
    expect(command.args[1]).toContain("hasLiveGroupMembers");
    expect(command.args.slice(2)).toEqual([
      "/usr/bin/chromium",
      "--remote-debugging-port=0",
      "about:blank",
    ]);
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
