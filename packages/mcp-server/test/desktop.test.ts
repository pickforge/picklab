import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSessions } from "@pickforge/picklab-core";
import {
  detectScreenshotTool,
  destroyDesktopSession,
  findOnPath,
} from "@pickforge/picklab-desktop-linux";
import {
  connectLab,
  makeLabDirs,
  parseToolJson,
  PNG_MAGIC,
  removeLabDirs,
  type ConnectedLab,
  type LabDirs,
} from "./helpers.js";

const hasDesktopStack =
  findOnPath("Xvfb") !== null &&
  findOnPath("xdotool") !== null &&
  detectScreenshotTool() !== null;

const TEST_TIMEOUT_MS = 60_000;

describe.skipIf(!hasDesktopStack)("desktop flow (real Xvfb)", () => {
  let dirs: LabDirs;
  let lab: ConnectedLab;
  let registryEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    dirs = makeLabDirs();
    registryEnv = { ...process.env, PICKLAB_HOME: dirs.home };
    lab = await connectLab({ projectDir: dirs.projectDir, env: registryEnv });
  });

  afterAll(async () => {
    for (const record of await listSessions(registryEnv)) {
      await destroyDesktopSession(record.id, registryEnv).catch(() => {});
    }
    await lab.close();
    removeLabDirs(dirs);
  });

  it(
    "creates a session, screenshots, drives input, and destroys",
    async () => {
      const created = parseToolJson(
        await lab.client.callTool({
          name: "session_create",
          arguments: { type: "desktop", width: 800, height: 600 },
        }),
      );
      expect(created.ok).toBe(true);
      const session = created.sessions[0];
      expect(session.id).toMatch(/^desk-[0-9a-f]+$/);
      expect(session.display).toMatch(/^:\d+$/);

      const status = parseToolJson(
        await lab.client.callTool({
          name: "session_status",
          arguments: { sessionId: session.id },
        }),
      );
      expect(status.ok).toBe(true);
      expect(status.sessions[0].desktop.xvfbAlive).toBe(true);

      const launch = parseToolJson(
        await lab.client.callTool({
          name: "desktop_launch",
          arguments: { command: "sleep", args: ["30"] },
        }),
      );
      expect(launch.ok).toBe(true);
      expect(launch.pid).toBeGreaterThan(0);
      expect(fs.existsSync(launch.logPath as string)).toBe(true);

      const shotResult = await lab.client.callTool({
        name: "desktop_screenshot",
        arguments: {},
      });
      const shot = parseToolJson(shotResult);
      expect(shot.ok).toBe(true);
      expect(shot.sessionId).toBe(session.id);
      expect(shot.runId).toBeDefined();
      expect(
        shot.path.startsWith(path.join(dirs.projectDir, ".picklab", "runs")),
      ).toBe(true);
      const png = fs.readFileSync(shot.path as string);
      expect(png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)).toBe(true);
      const content = shotResult.content as Array<Record<string, any>>;
      const image = content.find((block) => block.type === "image");
      expect(image?.mimeType).toBe("image/png");

      const click = parseToolJson(
        await lab.client.callTool({
          name: "desktop_click",
          arguments: { x: 10, y: 10 },
        }),
      );
      expect(click.ok).toBe(true);

      const typed = parseToolJson(
        await lab.client.callTool({
          name: "desktop_type",
          arguments: { text: "picklab" },
        }),
      );
      expect(typed.ok).toBe(true);

      const key = parseToolJson(
        await lab.client.callTool({
          name: "desktop_key",
          arguments: { key: "Return" },
        }),
      );
      expect(key.ok).toBe(true);

      const destroyed = parseToolJson(
        await lab.client.callTool({
          name: "session_destroy",
          arguments: { sessionId: session.id },
        }),
      );
      expect(destroyed.ok).toBe(true);
      expect(destroyed.destroyed).toEqual([session.id]);
      expect(await listSessions(registryEnv)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
