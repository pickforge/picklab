import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("package version parity", () => {
  it("keeps the mcp-server version in lockstep with the cli bundle", () => {
    const cli = require("../package.json") as { version: string };
    const mcpServer = require("../../mcp-server/package.json") as {
      version: string;
    };
    expect(mcpServer.version).toBe(cli.version);
  });
});
