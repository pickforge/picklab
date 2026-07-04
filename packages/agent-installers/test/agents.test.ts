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
  findClaudeBinary,
  linkClaudeCode,
  unlinkClaudeCode,
} from "../src/index.js";

let tmpDir: string;
let home: string;
let cleanEnv: Record<string, string>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-agents-"));
  home = path.join(tmpDir, "home");
  fs.mkdirSync(home, { recursive: true });
  cleanEnv = { HOME: home, PATH: path.join(tmpDir, "empty-bin") };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function installFakeClaude(script: string): Record<string, string> {
  const bin = path.join(tmpDir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const claude = path.join(bin, "claude");
  fs.writeFileSync(claude, script);
  fs.chmodSync(claude, 0o755);
  return {
    HOME: home,
    PATH: bin,
    CLAUDE_ARGS_FILE: path.join(tmpDir, "claude-args.txt"),
  };
}

function recordedArgs(env: Record<string, string>): string[] {
  return fs
    .readFileSync(env.CLAUDE_ARGS_FILE, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

const RECORDING_CLAUDE = '#!/bin/sh\nprintf \'%s\\n\' "$@" > "${CLAUDE_ARGS_FILE}"\n';

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

describe("findClaudeBinary", () => {
  it("finds an executable claude on PATH and ignores empty PATH entries", () => {
    const env = installFakeClaude(RECORDING_CLAUDE);
    expect(findClaudeBinary({ PATH: `:${env.PATH}` })).toBe(
      path.join(env.PATH, "claude"),
    );
    expect(findClaudeBinary(cleanEnv)).toBeUndefined();
    expect(findClaudeBinary({ PATH: undefined })).toBeUndefined();
  });
});

describe("linkClaudeCode without the claude binary", () => {
  it("instructs instead of creating a missing ~/.claude.json", async () => {
    const configPath = path.join(home, ".claude.json");
    const result = await linkClaudeCode(configPath, cleanEnv);
    expect(result.changed).toBe(false);
    expect(result.instructions).toContain(CLAUDE_CODE_MANUAL_COMMAND);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("merges into an existing parseable ~/.claude.json with a backup and warns", async () => {
    const configPath = path.join(home, ".claude.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ numStartups: 3, mcpServers: {} }),
    );
    const result = await linkClaudeCode(configPath, cleanEnv);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(result.warning).toContain("close Claude Code");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.numStartups).toBe(3);
    expect(config.mcpServers.picklab).toEqual({
      command: "picklab",
      args: ["mcp", "serve"],
    });
    expect(await claudeCodeIsRegistered(configPath)).toBe(true);

    const removed = await unlinkClaudeCode(configPath, cleanEnv);
    expect(removed.changed).toBe(true);
    expect(removed.warning).toContain("close Claude Code");
    expect(await claudeCodeIsRegistered(configPath)).toBe(false);
  });

  it("rejects an unparseable ~/.claude.json without touching it", async () => {
    const configPath = path.join(home, ".claude.json");
    fs.writeFileSync(configPath, "{ broken");
    await expect(linkClaudeCode(configPath, cleanEnv)).rejects.toThrow(
      "invalid JSON",
    );
    expect(fs.readFileSync(configPath, "utf8")).toBe("{ broken");
  });
});

describe("linkClaudeCode with the claude binary on PATH", () => {
  it("shells out to claude mcp add instead of editing the file", async () => {
    const env = installFakeClaude(RECORDING_CLAUDE);
    const configPath = path.join(home, ".claude.json");
    const result = await linkClaudeCode(configPath, env);
    expect(result.changed).toBe(true);
    expect(result.instructions).toBeUndefined();
    expect(recordedArgs(env)).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "picklab",
      "--",
      "picklab",
      "mcp",
      "serve",
    ]);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("does not shell out when ~/.claude.json already has picklab registered", async () => {
    const env = installFakeClaude(
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "${CLAUDE_ARGS_FILE}"\nexit 99\n',
    );
    const configPath = path.join(home, ".claude.json");
    const original = JSON.stringify({
      numStartups: 2,
      mcpServers: {
        picklab: { command: "picklab", args: ["mcp", "serve"] },
      },
    });
    fs.writeFileSync(configPath, original);

    const result = await linkClaudeCode(configPath, env);

    expect(result).toEqual({ configPath, changed: false });
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
    expect(fs.existsSync(env.CLAUDE_ARGS_FILE)).toBe(false);
  });

  it("repairs a stale ~/.claude.json picklab entry via remove and add", async () => {
    const env = installFakeClaude(
      [
        "#!/bin/sh",
        'printf \'%s\\n\' "$@" >> "${CLAUDE_ARGS_FILE}"',
        'if [ "${1:-}" = "mcp" ] && [ "${2:-}" = "add" ]; then',
        '  printf \'%s\\n\' \'{"mcpServers":{"picklab":{"command":"picklab","args":["mcp","serve"]}}}\' > "${HOME}/.claude.json"',
        "fi",
      ].join("\n"),
    );
    const configPath = path.join(home, ".claude.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          picklab: { command: "old-picklab", args: ["mcp", "serve"] },
        },
      }),
    );

    const result = await linkClaudeCode(configPath, env);

    expect(result).toEqual({ configPath, changed: true });
    expect(await claudeCodeIsRegistered(configPath)).toBe(true);
    expect(recordedArgs(env)).toEqual([
      "mcp",
      "remove",
      "--scope",
      "user",
      "picklab",
      "mcp",
      "add",
      "--scope",
      "user",
      "picklab",
      "--",
      "picklab",
      "mcp",
      "serve",
    ]);
  });

  it("shells out to claude mcp remove on unlink", async () => {
    const env = installFakeClaude(RECORDING_CLAUDE);
    const result = await unlinkClaudeCode(path.join(home, ".claude.json"), env);
    expect(result.changed).toBe(true);
    expect(recordedArgs(env)).toEqual([
      "mcp",
      "remove",
      "--scope",
      "user",
      "picklab",
    ]);
  });

  it("treats an already-exists claude mcp add failure as a no-op", async () => {
    const env = installFakeClaude(
      [
        "#!/bin/sh",
        'printf \'%s\\n\' \'{"mcpServers":{"picklab":{"command":"picklab","args":["mcp","serve"]}}}\' > "${HOME}/.claude.json"',
        'echo "MCP server picklab already exists in user config." >&2',
        "exit 1",
      ].join("\n"),
    );
    const configPath = path.join(home, ".claude.json");
    const result = await linkClaudeCode(configPath, env);
    expect(result).toEqual({ configPath, changed: false });
  });

  it("fails the link when claude mcp add exits with an unrelated error", async () => {
    const env = installFakeClaude('#!/bin/sh\necho "boom" >&2\nexit 1\n');
    await expect(
      linkClaudeCode(path.join(home, ".claude.json"), env),
    ).rejects.toThrow('"claude mcp add" failed (exit code 1): boom');
  });

  it("treats a not-found claude mcp remove as a no-op", async () => {
    const env = installFakeClaude(
      '#!/bin/sh\necho "No MCP server found with name: picklab" >&2\nexit 1\n',
    );
    const result = await unlinkClaudeCode(path.join(home, ".claude.json"), env);
    expect(result.changed).toBe(false);
  });
});
