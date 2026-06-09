import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("@pickforge/picklab-agent-installers", () => {
  it("exposes the package name", () => {
    expect(packageName).toBe("@pickforge/picklab-agent-installers");
  });
});
