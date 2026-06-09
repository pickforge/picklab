import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { agentsDir, picklabHome, sessionsDir } from "../src/paths.js";

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
