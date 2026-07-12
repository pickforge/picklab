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
  it("accepts the profile and runtime paths beneath a resolved session", () => {
    const sessionDir = "/tmp/picklab/sessions/../sessions/brow-12345678";
    expect(
      isProfileConfined(
        sessionDir,
        "/tmp/picklab/sessions/brow-12345678/profile",
      ),
    ).toBe(true);
    expect(
      isProfileConfined(
        sessionDir,
        "/tmp/picklab/sessions/brow-12345678/home/.cache",
      ),
    ).toBe(true);
  });

  it("rejects sibling paths with a shared prefix", () => {
    expect(
      isProfileConfined(
        "/tmp/picklab/sessions/brow-12345678",
        "/tmp/picklab/sessions/brow-123456789/profile",
      ),
    ).toBe(false);
  });
});
