import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REAPER_CLEANUP_PENDING_META_KEY,
  destroySessionRecord,
  isPidAlive,
  listSessions,
  type EnvLike,
} from "@pickforge/picklab-core";

// A sentinel Xvfb pid/display, standing in for a real X server: this suite
// only exercises the pre-identity Chrome cleanup path, so Xvfb itself is
// mocked away (no Xvfb binary required, unlike the fake-binary suites in
// session.test.ts).
const FAKE_XVFB_PID = 4_194_301;
const FAKE_DISPLAY = ":244";

vi.mock("@pickforge/picklab-desktop-linux", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pickforge/picklab-desktop-linux")>();
  return {
    ...actual,
    startXvfb: vi.fn(
      async (opts: {
        onSpawn?: (partial: {
          pid: number;
          display: string;
          startTimeTicks: number;
          width: number;
          height: number;
        }) => void | Promise<void>;
      }) => {
        const partial = {
          pid: FAKE_XVFB_PID,
          display: FAKE_DISPLAY,
          startTimeTicks: 456,
          width: 1280,
          height: 800,
        };
        await opts.onSpawn?.(partial);
        return {
          ...partial,
          logPath: "/tmp/fake-browser-pre-identity-xvfb.log",
        };
      },
    ),
  };
});

// Simulate the "pathological /proc identity-read failure" the issue
// describes: the owned Chrome supervisor is alive, but its own identity can
// never be captured.
vi.mock("@pickforge/picklab-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pickforge/picklab-core")>();
  return {
    ...actual,
    readProcessIdentity: vi.fn(() => undefined),
  };
});

import { createBrowserSession, browserSessionLogDir } from "../src/session.js";
import { writeFakeChrome } from "./fakes.js";

const TEST_TIMEOUT_MS = 15_000;

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("pre-identity browser daemon cleanup", () => {
  it(
    "kills a live Chrome left behind when the supervisor's own identity never resolves",
    async () => {
      root = fs.mkdtempSync(
        path.join(os.tmpdir(), "picklab-browser-pre-identity-"),
      );
      const home = path.join(root, "home");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(home, { recursive: true });
      // "stall" never exits and never publishes a DevTools port on its own,
      // so it stays alive for the full identity-wait window like a real
      // Chrome would, and only our teardown code can end it.
      writeFakeChrome(binDir, "stall");
      const env: EnvLike = {
        ...process.env,
        HOME: home,
        PICKLAB_HOME: path.join(root, "picklab-home"),
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      };

      await expect(
        createBrowserSession({
          projectDir: path.join(root, "project"),
          registryEnv: env,
          env,
        }),
      ).rejects.toThrow(/could not be identified during startup/);

      const records = await listSessions(env);
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record.status).toBe("error");
      // Identity was never captured, so nothing was ever recorded to retry
      // against later; the only way this can be a true "cleanup complete" is
      // if the group was actually confirmed dead synchronously.
      expect(record.browser).toBeUndefined();
      expect(record.meta?.[REAPER_CLEANUP_PENDING_META_KEY]).toBeUndefined();

      const sessionDir = browserSessionLogDir(record.id, env);
      const pidFile = path.join(sessionDir, "chrome.pid");
      const pidDeadline = Date.now() + 5_000;
      while (!fs.existsSync(pidFile) && Date.now() < pidDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(fs.existsSync(pidFile)).toBe(true);
      const chromePid = Number(fs.readFileSync(pidFile, "utf8").trim());
      expect(Number.isSafeInteger(chromePid)).toBe(true);

      try {
        // The fix: the whole process group (supervisor + Chrome) is killed
        // and confirmed empty before cleanup is reported complete, so by now
        // the fake Chrome must already be dead. Before the fix, only the
        // supervisor was signaled, leaving this process running.
        expect(isPidAlive(chromePid)).toBe(false);
      } finally {
        if (isPidAlive(chromePid)) {
          try {
            process.kill(chromePid, "SIGKILL");
          } catch {
            // already gone
          }
        }
      }

      await destroySessionRecord(record.id, env);
    },
    TEST_TIMEOUT_MS,
  );
});
