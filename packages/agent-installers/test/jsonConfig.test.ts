import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  jsonFileHasMcpServer,
  mergeMcpServerIntoJsonFile,
  removeMcpServerFromJsonFile,
} from "../src/index.js";

let tmpDir: string;
let file: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-json-"));
  file = path.join(tmpDir, "mcp.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, any>;
}

function backupsIn(dir: string): string[] {
  return fs.readdirSync(dir).filter((entry) => entry.includes("picklab-backup"));
}

describe("mergeMcpServerIntoJsonFile", () => {
  it("creates the file when allowed and missing", async () => {
    const nested = path.join(tmpDir, "deep", "mcp.json");
    const result = await mergeMcpServerIntoJsonFile(nested, {
      createIfMissing: true,
    });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(readJson(nested)).toEqual({
      mcpServers: { picklab: { command: "picklab", args: ["mcp", "serve"] } },
    });
  });

  it("fails when the file is missing and creation is not allowed", async () => {
    await expect(
      mergeMcpServerIntoJsonFile(file, { createIfMissing: false }),
    ).rejects.toThrow("Config file not found");
  });

  it("preserves existing servers and other keys, backing up first", async () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        theme: "dark",
        mcpServers: { other: { command: "other-mcp", args: [] } },
      }),
    );
    const result = await mergeMcpServerIntoJsonFile(file, {
      createIfMissing: false,
    });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath as string)).toBe(true);
    expect(readJson(file)).toEqual({
      theme: "dark",
      mcpServers: {
        other: { command: "other-mcp", args: [] },
        picklab: { command: "picklab", args: ["mcp", "serve"] },
      },
    });
  });

  it("is idempotent: no rewrite and no backup when already registered", async () => {
    await mergeMcpServerIntoJsonFile(file, { createIfMissing: true });
    const before = fs.readFileSync(file, "utf8");
    const result = await mergeMcpServerIntoJsonFile(file, {
      createIfMissing: false,
    });
    expect(result.changed).toBe(false);
    expect(result.backupPath).toBeUndefined();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(backupsIn(tmpDir)).toEqual([]);
  });

  it("rejects unparseable JSON without touching the file", async () => {
    fs.writeFileSync(file, "{ not json");
    await expect(
      mergeMcpServerIntoJsonFile(file, { createIfMissing: true }),
    ).rejects.toThrow("invalid JSON");
    expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
    expect(backupsIn(tmpDir)).toEqual([]);
  });

  it("rejects non-object top-level JSON", async () => {
    fs.writeFileSync(file, "[1, 2]");
    await expect(
      mergeMcpServerIntoJsonFile(file, { createIfMissing: true }),
    ).rejects.toThrow("top-level JSON object");
  });
});

describe("removeMcpServerFromJsonFile", () => {
  it("removes only the picklab entry and backs up first", async () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          other: { command: "other-mcp", args: [] },
          picklab: { command: "picklab", args: ["mcp", "serve"] },
        },
      }),
    );
    const result = await removeMcpServerFromJsonFile(file);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(readJson(file)).toEqual({
      mcpServers: { other: { command: "other-mcp", args: [] } },
    });
  });

  it("is a no-op when the entry or file is missing", async () => {
    expect((await removeMcpServerFromJsonFile(file)).changed).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ mcpServers: {} }));
    expect((await removeMcpServerFromJsonFile(file)).changed).toBe(false);
    expect(backupsIn(tmpDir)).toEqual([]);
  });
});

describe("jsonFileHasMcpServer", () => {
  it("detects the picklab entry", async () => {
    expect(await jsonFileHasMcpServer(file)).toBe(false);
    await mergeMcpServerIntoJsonFile(file, { createIfMissing: true });
    expect(await jsonFileHasMcpServer(file)).toBe(true);
  });

  it("returns false for unparseable files", async () => {
    fs.writeFileSync(file, "nope");
    expect(await jsonFileHasMcpServer(file)).toBe(false);
  });
});
