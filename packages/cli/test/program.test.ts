import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";

describe("@pickforge/picklab", () => {
  it("builds the picklab program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("picklab");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes only project scope on the static browser relay command", () => {
    const program = buildProgram();
    const browser = program.commands.find((command) => command.name() === "browser");
    const relay = browser?.commands.find(
      (command) => command.name() === "devtools-mcp",
    );
    expect(relay).toBeDefined();
    expect(relay?.options.map((option) => option.long)).toEqual([
      "--project-dir",
    ]);
  });
});
