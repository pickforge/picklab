import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";

describe("@pickforge/picklab", () => {
  it("builds the picklab program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("picklab");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
