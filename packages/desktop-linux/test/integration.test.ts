import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createRun,
  getSession,
  isPidAlive,
  type EnvLike,
} from "@pickforge/picklab-core";
import {
  click,
  createDesktopSession,
  destroyDesktopSession,
  detectScreenshotTool,
  detectVncBinary,
  findOnPath,
  getDesktopSessionStatus,
  isDisplayAlive,
  launchApp,
  pressKey,
  screenshot,
  typeText,
  waitForWindow,
} from "../src/index.js";

const hasXvfb = findOnPath("Xvfb") !== null;
const hasXdotool = findOnPath("xdotool") !== null;
const hasDesktopStack = hasXvfb && hasXdotool;
const screenshotTool = detectScreenshotTool();
const hasXterm = findOnPath("xterm") !== null;
const hasVnc = detectVncBinary() !== null;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEST_TIMEOUT_MS = 30_000;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-desktop-test-"));
const home = path.join(tmpRoot, "home");
const projectDir = path.join(tmpRoot, "project");
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });
const env: EnvLike = { ...process.env, PICKLAB_HOME: home };

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("screenshot tool detection failure", () => {
  it("rejects with install candidates when no tool is on PATH", async () => {
    await expect(
      screenshot({
        display: ":99",
        outPath: path.join(tmpRoot, "never.png"),
        env: { PATH: "" },
      }),
    ).rejects.toThrow(/install one of/i);
  });
});

describe.skipIf(!hasDesktopStack)("desktop integration (Xvfb + xdotool)", () => {
  it(
    "runs an xvfb session and screenshots the display",
    async () => {
      const session = await createDesktopSession({
        projectDir,
        env,
        width: 800,
        height: 600,
      });
      try {
        expect(session.display).toMatch(/^:\d+$/);
        expect(isDisplayAlive(session.display)).toBe(true);
        expect(isPidAlive(session.xvfbPid)).toBe(true);

        const status = await getDesktopSessionStatus(session.id, env);
        expect(status.record.status).toBe("running");
        expect(status.record.desktop?.display).toBe(session.display);
        expect(status.xvfbAlive).toBe(true);
        expect(status.displayAlive).toBe(true);

        if (screenshotTool !== null) {
          const outPath = path.join(tmpRoot, "session-shot.png");
          const result = await screenshot({
            display: session.display,
            outPath,
          });
          expect(result.tool).toBe(screenshotTool);
          const data = fs.readFileSync(outPath);
          expect(data.length).toBeGreaterThan(0);
          expect(data.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
        } else {
          console.warn(
            "no screenshot tool (import, xwd+convert, or scrot) found; skipping screenshot assertions",
          );
        }
      } finally {
        await destroyDesktopSession(session.id, env);
      }
      expect(isPidAlive(session.xvfbPid)).toBe(false);
      expect(isDisplayAlive(session.display)).toBe(false);
      expect(await getSession(session.id, env)).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasXterm)(
    "launches xterm and drives click, type, and key input",
    async () => {
      const session = await createDesktopSession({ projectDir, env });
      try {
        const app = await launchApp({
          display: session.display,
          command: "xterm",
          args: ["-T", "picklab-itest"],
          logDir: session.logDir,
        });
        const win = await waitForWindow(
          session.display,
          "picklab-itest",
          15_000,
        );
        expect(win.id).toMatch(/^\d+$/);
        expect(win.name).toContain("picklab-itest");

        await click({ display: session.display, x: 40, y: 40 });
        await typeText({ display: session.display, text: "echo picklab" });
        await pressKey({ display: session.display, key: "Return" });
        await pressKey({ display: session.display, key: "ctrl+shift+t" });

        expect(isPidAlive(app.pid)).toBe(true);
      } finally {
        await destroyDesktopSession(session.id, env);
      }
      expect(isPidAlive(session.xvfbPid)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(screenshotTool === null)(
    "records a screenshot artifact in a run",
    async () => {
      const session = await createDesktopSession({ projectDir, env });
      try {
        const run = await createRun(projectDir, "desktop-shot", {
          sessionId: session.id,
        });
        const outPath = path.join(run.dir, "screenshots", "desktop.png");
        await screenshot({ display: session.display, outPath });
        await run.addArtifact("screenshot", "desktop.png", outPath);
        await run.finish();

        const data = fs.readFileSync(outPath);
        expect(data.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);

        const manifest = JSON.parse(
          fs.readFileSync(path.join(run.dir, "manifest.json"), "utf8"),
        );
        expect(manifest.status).toBe("completed");
        expect(manifest.sessionId).toBe(session.id);
        expect(manifest.artifacts).toHaveLength(1);
        expect(manifest.artifacts[0].type).toBe("screenshot");
        expect(manifest.artifacts[0].path).toBe(
          path.join("screenshots", "desktop.png"),
        );
      } finally {
        await destroyDesktopSession(session.id, env);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasVnc)(
    "attaches x11vnc to the session display",
    async () => {
      const session = await createDesktopSession({ projectDir, env, vnc: true });
      try {
        expect(session.vncPid).toBeDefined();
        expect(session.vncPort).toBeGreaterThan(0);
        const status = await getDesktopSessionStatus(session.id, env);
        expect(status.vncAlive).toBe(true);
      } finally {
        await destroyDesktopSession(session.id, env);
      }
      expect(isPidAlive(session.vncPid as number)).toBe(false);
      expect(isPidAlive(session.xvfbPid)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(hasVnc)(
    "fails session creation cleanly when VNC is requested without x11vnc",
    async () => {
      await expect(
        createDesktopSession({ projectDir, env, vnc: true }),
      ).rejects.toThrow(/x11vnc/);
    },
    TEST_TIMEOUT_MS,
  );
});
