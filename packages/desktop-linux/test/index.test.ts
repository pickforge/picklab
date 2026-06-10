import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("@pickforge/picklab-desktop-linux", () => {
  it("exposes the package name", () => {
    expect(packageName).toBe("@pickforge/picklab-desktop-linux");
  });
});
