import fs from "node:fs";
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  agentsDir,
  isProfileConfined,
  picklabHome,
  sessionsDir,
} from "../src/paths.js";

describe("picklabHome", () => {
  it("uses PICKLAB_HOME when set and non-empty", () => {
    expect(picklabHome({ PICKLAB_HOME: "/custom/home" })).toBe("/custom/home");
  });

  it("falls back to ~/.picklab when PICKLAB_HOME is empty", () => {
    expect(picklabHome({ PICKLAB_HOME: "" })).toBe(
      path.join(os.homedir(), ".picklab"),
    );
  });

  it("falls back to ~/.picklab when PICKLAB_HOME is unset", () => {
    expect(picklabHome({})).toBe(path.join(os.homedir(), ".picklab"));
  });
});

describe("global subdirs", () => {
  const env = { PICKLAB_HOME: "/lab" };

  it("builds the sessions dir", () => {
    expect(sessionsDir(env)).toBe(path.join("/lab", "sessions"));
  });

  it("builds the agents dir", () => {
    expect(agentsDir(env)).toBe(path.join("/lab", "agents"));
  });
});

describe("isProfileConfined", () => {
  it("accepts the profile and runtime paths beneath a resolved session", async () => {
    const sessionDir = "/tmp/picklab/sessions/../sessions/brow-12345678";
    expect(
      await isProfileConfined(
        sessionDir,
        "/tmp/picklab/sessions/brow-12345678/profile",
      ),
    ).toBe(true);
    expect(
      await isProfileConfined(
        sessionDir,
        "/tmp/picklab/sessions/brow-12345678/home/.cache",
      ),
    ).toBe(true);
  });

  it("rejects sibling paths with a shared prefix", async () => {
    expect(
      await isProfileConfined(
        "/tmp/picklab/sessions/brow-12345678",
        "/tmp/picklab/sessions/brow-123456789/profile",
      ),
    ).toBe(false);
  });

  it("rejects symlinked session and profile ancestry", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-paths-"));
    const sessions = path.join(root, "sessions");
    const outside = path.join(root, "outside");
    const id = "brow-12345678";
    const session = path.join(sessions, id);
    try {
      fs.mkdirSync(session, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.symlinkSync(outside, path.join(session, "profile"));
      expect(
        await isProfileConfined(session, path.join(session, "profile")),
      ).toBe(false);

      fs.rmSync(session, { recursive: true, force: true });
      fs.symlinkSync(outside, session);
      expect(
        await isProfileConfined(session, path.join(session, "profile")),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
