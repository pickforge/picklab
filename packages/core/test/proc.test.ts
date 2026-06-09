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

  it("passes cwd and env", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-"));
    const result = await runCommand(
      node,
      ["-e", "console.log(process.cwd(), process.env.PICKLAB_TEST)"],
      { cwd: dir, env: { ...process.env, PICKLAB_TEST: "yes" } },
    );
    expect(result.stdout).toContain("yes");
    expect(result.stdout).toContain(await fs.promises.realpath(dir));
    await fs.promises.rm(dir, { recursive: true, force: true });
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

  it("starts a detached daemon, reports liveness, and stops it", async () => {
    const daemon = startDaemon(
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
