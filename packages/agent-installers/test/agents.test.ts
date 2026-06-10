import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_MANUAL_COMMAND,
  claudeCodeConfigPath,
  claudeCodeIsRegistered,
  codexConfigPath,
  cursorConfigPath,
  linkClaudeCode,
  unlinkClaudeCode,
} from "../src/index.js";

let tmpDir: string;
let home: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-agents-"));
  home = path.join(tmpDir, "home");
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("default config paths", () => {
  it("derive from HOME", () => {
    const env = { HOME: home };
    expect(codexConfigPath(env)).toBe(
      path.join(home, ".codex", "config.toml"),
    );
    expect(claudeCodeConfigPath(env)).toBe(path.join(home, ".claude.json"));
    expect(cursorConfigPath(env)).toBe(path.join(home, ".cursor", "mcp.json"));
  });

  it("honor CODEX_HOME for codex", () => {
    const env = { HOME: home, CODEX_HOME: path.join(tmpDir, "codex-home") };
    expect(codexConfigPath(env)).toBe(
      path.join(tmpDir, "codex-home", "config.toml"),
    );
  });
});

describe("linkClaudeCode", () => {
  it("instructs instead of creating a missing ~/.claude.json", async () => {
    const configPath = path.join(home, ".claude.json");
    const result = await linkClaudeCode(configPath);
    expect(result.changed).toBe(false);
    expect(result.instructions).toContain(CLAUDE_CODE_MANUAL_COMMAND);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("merges into an existing parseable ~/.claude.json with a backup", async () => {
    const configPath = path.join(home, ".claude.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ numStartups: 3, mcpServers: {} }),
    );
    const result = await linkClaudeCode(configPath);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.numStartups).toBe(3);
    expect(config.mcpServers.picklab).toEqual({
      command: "picklab",
      args: ["mcp", "serve"],
    });
    expect(await claudeCodeIsRegistered(configPath)).toBe(true);

    const removed = await unlinkClaudeCode(configPath);
    expect(removed.changed).toBe(true);
    expect(await claudeCodeIsRegistered(configPath)).toBe(false);
  });

  it("rejects an unparseable ~/.claude.json without touching it", async () => {
    const configPath = path.join(home, ".claude.json");
    fs.writeFileSync(configPath, "{ broken");
    await expect(linkClaudeCode(configPath)).rejects.toThrow("invalid JSON");
    expect(fs.readFileSync(configPath, "utf8")).toBe("{ broken");
  });
});
