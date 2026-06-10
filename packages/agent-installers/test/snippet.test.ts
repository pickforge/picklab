import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mcpServerEntry,
  renderJsonSnippet,
  renderTomlSnippet,
  writeSharedSnippets,
} from "../src/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-snippet-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("mcpServerEntry", () => {
  it("uses picklab mcp serve as the canonical command", () => {
    expect(mcpServerEntry()).toEqual({
      command: "picklab",
      args: ["mcp", "serve"],
    });
  });
});

describe("renderJsonSnippet", () => {
  it("renders the exact JSON snippet", () => {
    expect(renderJsonSnippet()).toBe(
      `${JSON.stringify(
        {
          mcpServers: {
            picklab: { command: "picklab", args: ["mcp", "serve"] },
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("renders custom entries", () => {
    const snippet = renderJsonSnippet({ command: "node", args: ["serve.js"] });
    expect(JSON.parse(snippet)).toEqual({
      mcpServers: { picklab: { command: "node", args: ["serve.js"] } },
    });
  });
});

describe("renderTomlSnippet", () => {
  it("renders the exact TOML snippet", () => {
    expect(renderTomlSnippet()).toBe(
      '[mcp_servers.picklab]\ncommand = "picklab"\nargs = ["mcp", "serve"]\n',
    );
  });
});

describe("writeSharedSnippets", () => {
  it("writes both snippet files into the agents dir", async () => {
    const env = { PICKLAB_HOME: path.join(tmpDir, ".picklab") };
    const snippets = await writeSharedSnippets(env);
    expect(snippets.jsonPath).toBe(
      path.join(tmpDir, ".picklab", "agents", "picklab-mcp.json"),
    );
    expect(snippets.tomlPath).toBe(
      path.join(tmpDir, ".picklab", "agents", "picklab-mcp.toml"),
    );
    expect(fs.readFileSync(snippets.jsonPath, "utf8")).toBe(
      renderJsonSnippet(),
    );
    expect(fs.readFileSync(snippets.tomlPath, "utf8")).toBe(
      renderTomlSnippet(),
    );
  });
});
