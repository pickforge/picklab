import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `startVnc` requires a verified `/proc`-backed process identity for the
// spawned x11vnc daemon, which does not exist on Darwin. These tests prove
// the takeover orchestration (lease acquisition, VNC mode switching,
// evidence, recovery) end-to-end against *real* spawned fake-x11vnc
// processes and real port listening, with only the two `/proc`-dependent
// identity functions replaced by a deterministic, pid-keyed stand-in — the
// same technique `destroy.test.ts` uses. Real x11vnc/Xvfb hardware
// validation is deferred (see AGENTS.md / release notes).
vi.mock("@pickforge/picklab-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pickforge/picklab-core")>();
  return {
    ...actual,
    readProcessIdentity: vi.fn((pid: number) => ({ pid, startTicks: pid })),
    processIdentityMatches: vi.fn(
      ({ pid, startTicks }: { pid: number; startTicks: number }) => startTicks === pid,
    ),
  };
});

import {
  HumanLeaseHeldError,
  createSession,
  getSession,
  isPidAlive,
  readActions,
  readHumanLease,
  resolveActivePointer,
  resolveRunStorage,
  stopPid,
  type EnvLike,
} from "@pickforge/picklab-core";
import {
  endHumanTakeover,
  recoverStaleHumanLease,
  renewHumanTakeover,
  startHumanTakeover,
} from "../src/takeover.js";

let root: string;
let binDir: string;
let env: EnvLike;
let argvLogPath: string;
// Monotonic across the whole file (never reset per test) so a test that fails
// before releasing its port never collides with the next test's port.
let syntheticPort = 15_900;

function nextPort(): number {
  syntheticPort += 1;
  return syntheticPort;
}

async function installFakeVnc(): Promise<void> {
  const script = path.join(binDir, "x11vnc");
  const source = [
    "const net = require('node:net');",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(process.env.ARGV_LOG, JSON.stringify(args) + '\\n');",
    "const port = Number(args[args.indexOf('-rfbport') + 1]);",
    "const server = net.createServer((socket) => socket.end());",
    "server.listen(port, '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join("\n");
  await fs.promises.writeFile(script, `#!${process.execPath}\n${source}`, "utf8");
  await fs.promises.chmod(script, 0o755);
}

async function readArgvLog(): Promise<string[][]> {
  const raw = await fs.promises.readFile(argvLogPath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as string[]);
}

async function createDesktop(desktop: Record<string, unknown> = {}): Promise<string> {
  const record = await createSession(
    {
      type: "desktop",
      projectDir: root,
      status: "running",
      desktop: { display: ":42", ...desktop },
    },
    env,
  );
  return record.id;
}

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-takeover-dl-"));
  binDir = path.join(root, "bin");
  await fs.promises.mkdir(binDir, { recursive: true });
  argvLogPath = path.join(root, "argv.log");
  env = {
    ...process.env,
    PICKLAB_HOME: path.join(root, "home"),
    PATH: binDir,
    ARGV_LOG: argvLogPath,
  };
  await installFakeVnc();
});

afterEach(async () => {
  vi.clearAllMocks();
  // Force-kill any fake x11vnc process a failed assertion left running, so a
  // failure in one test never blocks a later test's port.
  const sessionsDir = path.join(env.PICKLAB_HOME as string, "sessions");
  const entries = await fs.promises.readdir(sessionsDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    const record = await getSession(id, env).catch(() => undefined);
    const pid = record?.desktop?.vncPid;
    if (pid !== undefined && isPidAlive(pid)) {
      await stopPid(pid, { timeoutMs: 500 }).catch(() => {});
    }
  }
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe("startHumanTakeover / endHumanTakeover", () => {
  it("switches VNC writable on start and back to read-only on return, releasing the lease", async () => {
    const id = await createDesktop({ vncPort: nextPort() });

    const handle = await startHumanTakeover(id, {
      registryEnv: env,
      env,
      drainTimeoutMs: 500,
    });
    expect(handle.sessionId).toBe(id);
    expect(isPidAlive(handle.vncPid)).toBe(true);
    expect((await readHumanLease(id, env))?.leaseId).toBe(handle.leaseId);

    const afterStart = await getSession(id, env);
    expect(afterStart?.desktop?.vncViewOnly).toBe(false);
    expect(afterStart?.desktop?.vncPid).toBe(handle.vncPid);

    const startArgv = await readArgvLog();
    expect(startArgv).toHaveLength(1);
    expect(startArgv[0]).not.toContain("-viewonly");

    const startedVncPid = handle.vncPid;
    const result = await endHumanTakeover(handle, {
      registryEnv: env,
      env,
      reason: "return",
    });
    expect(result.reason).toBe("return");
    expect(isPidAlive(startedVncPid)).toBe(false);
    expect(await readHumanLease(id, env)).toBeUndefined();

    const afterEnd = await getSession(id, env);
    expect(afterEnd?.desktop?.vncViewOnly).toBe(true);
    expect(afterEnd?.desktop?.vncPid).not.toBe(startedVncPid);

    const fullArgv = await readArgvLog();
    expect(fullArgv).toHaveLength(2);
    expect(fullArgv[1]).toContain("-viewonly");
  });

  it("records a takeover_start and takeover_<reason> evidence transition", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });
    await endHumanTakeover(handle, { registryEnv: env, env, reason: "cancelled" });

    const pointerless = await resolveActivePointer(root, id, env);
    // The evidence run was finalized by nothing yet (no destroySessionRecord
    // call), so it is still resolvable as the session's active run.
    expect(pointerless.status === "active" || pointerless.status === "stale").toBe(
      true,
    );
    const runId =
      pointerless.status === "active" ? pointerless.pointer.runId : undefined;
    if (runId !== undefined) {
      const { runsDir } = await resolveRunStorage(root, env);
      const actions = await readActions(path.join(runsDir, runId));
      const tools = actions.map((a) => (a as { tool?: string }).tool);
      expect(tools).toContain("takeover_start");
      expect(tools).toContain("takeover_cancelled");
    }
  });

  it("refuses a second takeover while the first is live", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });
    await expect(
      startHumanTakeover(id, { registryEnv: env, env }),
    ).rejects.toThrow(HumanLeaseHeldError);
    await endHumanTakeover(handle, { registryEnv: env, env, reason: "return" });
  });

  it("renews the lease TTL while control is held", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });
    const before = await readHumanLease(id, env);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await renewHumanTakeover(handle, env)).toBe(true);
    const after = await readHumanLease(id, env);
    expect(Date.parse(after!.expiresAt)).toBeGreaterThanOrEqual(
      Date.parse(before!.expiresAt),
    );
    await endHumanTakeover(handle, { registryEnv: env, env, reason: "timeout" });
  });

  it("reports renewal failure once the lease is gone (post-timeout)", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });
    await endHumanTakeover(handle, { registryEnv: env, env, reason: "timeout" });
    expect(await renewHumanTakeover(handle, env)).toBe(false);
  });
});

describe("recoverStaleHumanLease (crash recovery)", () => {
  it("stops an orphaned writable VNC, clears the record, and releases a stale lease", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });
    const vncPid = handle.vncPid;
    expect(isPidAlive(vncPid)).toBe(true);

    // Simulate a crash: the owner process is gone and the TTL has lapsed,
    // but nobody ran the graceful `endHumanTakeover` cleanup.
    const crashed = {
      ...(await readHumanLease(id, env))!,
      ownerPid: 999_999,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    };
    await fs.promises.writeFile(
      path.join(env.PICKLAB_HOME as string, "sessions", id, "human.lease.json"),
      `${JSON.stringify(crashed)}\n`,
    );

    const { recovered } = await recoverStaleHumanLease(id, env);
    expect(recovered).toBe(true);
    expect(isPidAlive(vncPid)).toBe(false);
    expect(await readHumanLease(id, env)).toBeUndefined();
    const record = await getSession(id, env);
    expect(record?.desktop?.vncPid).toBeUndefined();
    expect(record?.desktop?.vncViewOnly).toBeUndefined();
  });

  it("leaves a live lease and its writable VNC untouched", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });

    const { recovered } = await recoverStaleHumanLease(id, env);
    expect(recovered).toBe(false);
    expect(isPidAlive(handle.vncPid)).toBe(true);
    expect((await readHumanLease(id, env))?.leaseId).toBe(handle.leaseId);

    await endHumanTakeover(handle, { registryEnv: env, env, reason: "return" });
  });

  it("is a no-op when there is no lease at all", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const { recovered } = await recoverStaleHumanLease(id, env);
    expect(recovered).toBe(false);
  });
});

describe("startHumanTakeover self-healing", () => {
  it("recovers a stale lease left by a crashed takeover, then proceeds", async () => {
    const id = await createDesktop({ vncPort: nextPort() });
    const firstHandle = await startHumanTakeover(id, { registryEnv: env, env });
    const staleVncPid = firstHandle.vncPid;

    const crashed = {
      ...(await readHumanLease(id, env))!,
      ownerPid: 999_999,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    };
    await fs.promises.writeFile(
      path.join(env.PICKLAB_HOME as string, "sessions", id, "human.lease.json"),
      `${JSON.stringify(crashed)}\n`,
    );

    const secondHandle = await startHumanTakeover(id, {
      registryEnv: env,
      env,
      drainTimeoutMs: 500,
    });
    expect(secondHandle.leaseId).not.toBe(firstHandle.leaseId);
    expect(isPidAlive(staleVncPid)).toBe(false);
    expect(isPidAlive(secondHandle.vncPid)).toBe(true);

    await endHumanTakeover(secondHandle, { registryEnv: env, env, reason: "return" });
  });
});

describe("ensureSessionVnc recovery integration", () => {
  it("recovers a crash-orphaned writable VNC instead of refusing to watch", async () => {
    const { ensureSessionVnc } = await import("../src/session.js");
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });
    const staleVncPid = handle.vncPid;

    const crashed = {
      ...(await readHumanLease(id, env))!,
      ownerPid: 999_999,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    };
    await fs.promises.writeFile(
      path.join(env.PICKLAB_HOME as string, "sessions", id, "human.lease.json"),
      `${JSON.stringify(crashed)}\n`,
    );

    const ensured = await ensureSessionVnc(id, { registryEnv: env, env });
    expect(ensured.reused).toBe(false);
    expect(isPidAlive(staleVncPid)).toBe(false);
    const record = await getSession(id, env);
    expect(record?.desktop?.vncViewOnly).toBe(true);
  });

  it("still refuses to watch while a live human lease holds writable VNC", async () => {
    const { ensureSessionVnc } = await import("../src/session.js");
    const id = await createDesktop({ vncPort: nextPort() });
    const handle = await startHumanTakeover(id, { registryEnv: env, env });

    await expect(ensureSessionVnc(id, { registryEnv: env, env })).rejects.toThrow(
      /server-enforced read-only VNC/,
    );

    await endHumanTakeover(handle, { registryEnv: env, env, reason: "return" });
  });
});
