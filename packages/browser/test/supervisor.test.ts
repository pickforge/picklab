import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "@pickforge/picklab-core";
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

  it("redacts split capability URLs while preserving stderr diagnostics and stdout", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-supervisor-"));
    const browser = path.join(tmp, "browser.cjs");
    fs.writeFileSync(
      browser,
      [
        'process.stdout.write("browser stdout\\n");',
        'process.stderr.write("ordinary diagnostic\\nDevTools listening on ws://127.0.0.1:45123/devtools/browser/");',
        "setImmediate(() => {",
        '  process.stderr.write("secret-guid\\ntrailing diagnostic");',
        "});",
      ].join("\n"),
    );
    try {
      const command = buildSupervisedBrowserCommand(
        process.execPath,
        process.execPath,
        [browser],
      );
      const result = await runCommand(command.command, command.args);

      expect(result.ok).toBe(true);
      expect(result.stdout).toBe("browser stdout\n");
      expect(result.stderr).toContain("ordinary diagnostic");
      expect(result.stderr).toContain("[redacted DevTools capability URL]");
      expect(result.stderr).toContain("trailing diagnostic");
      expect(result.stderr).not.toContain("secret-guid");
      expect(result.stderr).not.toContain("/devtools/browser/");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
