import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPidAlive, runCommand, startDaemon, stopPid } from "../src/proc.js";

const node = process.execPath;

describe("runCommand", () => {
  it("passes arguments verbatim without shell interpretation", async () => {
    const args = ["a b", ";", "$HOME", "`id`", "&& rm -rf /", "'quoted'"];
    const result = await runCommand(node, [
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)))",
      ...args,
    ]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  it("captures nonzero exit without throwing by default", async () => {
    const result = await runCommand(node, [
      "-e",
      "console.error('boom'); process.exit(3)",
    ]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("boom");
  });

  it("throws on nonzero exit when check is set", async () => {
    await expect(
      runCommand(node, ["-e", "process.exit(2)"], { check: true }),
    ).rejects.toThrow(/exit/i);
  });

  it("kills the process on timeout", async () => {
    const start = Date.now();
    const result = await runCommand(
      node,
      ["-e", "setTimeout(() => {}, 30000)"],
      { timeoutMs: 400 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.code).not.toBe(0);
    expect(Date.now() - start).toBeLessThan(10000);
  });

  it("passes cwd and merges env over the inherited environment", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-"));
    const result = await runCommand(
      node,
      [
        "-e",
        "console.log(process.cwd(), process.env.PICKLAB_TEST, typeof process.env.PATH)",
      ],
      { cwd: dir, env: { PICKLAB_TEST: "yes" } },
    );
    expect(result.stdout).toContain("yes");
    expect(result.stdout).toContain("string");
    expect(result.stdout).toContain(await fs.promises.realpath(dir));
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("supports a clean environment via cleanEnv", async () => {
    const result = await runCommand(
      node,
      ["-e", "console.log(JSON.stringify(Object.keys(process.env)))"],
      { cleanEnv: true, env: { PICKLAB_ONLY: "1" } },
    );
    expect(JSON.parse(result.stdout)).toEqual(["PICKLAB_ONLY"]);
  });

  it("does not crash when the child exits before consuming stdin", async () => {
    const result = await runCommand(node, ["-e", "process.exit(7)"], {
      input: "x".repeat(8 * 1024 * 1024),
    });
    expect(result.code).toBe(7);
  });

  it("resolves promptly on timeout even when a grandchild holds stdio pipes", async () => {
    const script = [
      'const { spawn } = require("node:child_process");',
      'const gc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], {',
      "  detached: true,",
      '  stdio: ["ignore", "inherit", "inherit"],',
      "});",
      "gc.unref();",
      "setTimeout(() => {}, 15000);",
    ].join("\n");
    const start = Date.now();
    const result = await runCommand(node, ["-e", script], {
      timeoutMs: 300,
      killGraceMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("reports output truncation", async () => {
    const result = await runCommand(
      node,
      ["-e", "process.stdout.write('a'.repeat(64 * 1024))"],
      { maxOutputBytes: 1024 },
    );
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(false);
    expect(result.stdout.length).toBe(1024);
  });

  it("formats CommandError messages for exit codes and signals", async () => {
    await expect(
      runCommand(node, ["-e", "process.exit(2)"], { check: true }),
    ).rejects.toThrow(/exited with code 2/);
    await expect(
      runCommand(node, ["-e", "setTimeout(() => {}, 30000)"], {
        check: true,
        timeoutMs: 200,
        killGraceMs: 200,
      }),
    ).rejects.toThrow(/(exited with code \d+|killed with signal SIG\w+)/);
  });
});

describe("daemon supervision", () => {
  let logDir: string;
  let pid: number | undefined;

  beforeEach(async () => {
    logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-log-"));
  });

  afterEach(async () => {
    if (pid !== undefined && isPidAlive(pid)) {
      await stopPid(pid, { timeoutMs: 1000 });
    }
    await fs.promises.rm(logDir, { recursive: true, force: true });
  });

  it("rejects catchably when the daemon binary does not exist", async () => {
    await expect(
      startDaemon("/nonexistent/picklab-missing-binary", [], { logDir }),
    ).rejects.toThrow(/ENOENT/);
  });

  it("starts a detached daemon, reports liveness, and stops it", async () => {
    const daemon = await startDaemon(
      node,
      ["-e", "console.log('daemon up'); setInterval(() => {}, 1000)"],
      { logDir, name: "test-daemon" },
    );
    pid = daemon.pid;
    expect(daemon.pid).toBeGreaterThan(0);
    expect(daemon.logPath.startsWith(logDir)).toBe(true);
    expect(fs.existsSync(daemon.logPath)).toBe(true);
    expect(isPidAlive(daemon.pid)).toBe(true);

    const stopped = await stopPid(daemon.pid, { timeoutMs: 3000 });
    expect(stopped).toBe(true);
    expect(isPidAlive(daemon.pid)).toBe(false);
  });

  it("isPidAlive returns false for a dead pid", async () => {
    const result = await runCommand(node, ["-e", "console.log(process.pid)"]);
    const deadPid = Number(result.stdout.trim());
    expect(isPidAlive(deadPid)).toBe(false);
  });

  it("stopPid is idempotent for already-dead pids", async () => {
    const result = await runCommand(node, ["-e", "console.log(process.pid)"]);
    const deadPid = Number(result.stdout.trim());
    expect(await stopPid(deadPid, { timeoutMs: 500 })).toBe(true);
  });
});
