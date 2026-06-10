import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inspectTomlFile,
  removeTomlMarkerBlock,
  TOML_MARKER_BEGIN,
  TOML_MARKER_END,
  tomlFileHasMcpServer,
  upsertTomlMarkerBlock,
} from "../src/index.js";

let tmpDir: string;
let file: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-toml-"));
  file = path.join(tmpDir, "config.toml");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const EXPECTED_BLOCK =
  `${TOML_MARKER_BEGIN}\n` +
  '[mcp_servers.picklab]\ncommand = "picklab"\nargs = ["mcp", "serve"]\n' +
  `${TOML_MARKER_END}\n`;

function backupsIn(dir: string): string[] {
  return fs.readdirSync(dir).filter((entry) => entry.includes("picklab-backup"));
}

describe("upsertTomlMarkerBlock", () => {
  it("creates the file with the marker block when missing", async () => {
    const result = await upsertTomlMarkerBlock(file);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(fs.readFileSync(file, "utf8")).toBe(EXPECTED_BLOCK);
  });

  it("appends after existing content with a blank-line separator", async () => {
    fs.writeFileSync(file, 'model = "gpt-5"\n');
    const result = await upsertTomlMarkerBlock(file);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(fs.readFileSync(file, "utf8")).toBe(
      `model = "gpt-5"\n\n${EXPECTED_BLOCK}`,
    );
  });

  it("is idempotent: second run changes nothing and writes no backup", async () => {
    fs.writeFileSync(file, 'model = "gpt-5"\n');
    await upsertTomlMarkerBlock(file);
    const before = fs.readFileSync(file, "utf8");
    const backupsBefore = backupsIn(tmpDir).length;
    const result = await upsertTomlMarkerBlock(file);
    expect(result.changed).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(backupsIn(tmpDir).length).toBe(backupsBefore);
  });

  it("replaces drifted content inside the markers", async () => {
    fs.writeFileSync(
      file,
      `before = 1\n\n${TOML_MARKER_BEGIN}\nstale = true\n${TOML_MARKER_END}\nafter = 2\n`,
    );
    const result = await upsertTomlMarkerBlock(file);
    expect(result.changed).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(
      `before = 1\n\n${EXPECTED_BLOCK}after = 2\n`,
    );
  });

  it("refuses a foreign [mcp_servers.picklab] section and leaves the file untouched", async () => {
    const content = '[mcp_servers.picklab]\ncommand = "something-else"\n';
    fs.writeFileSync(file, content);
    await expect(upsertTomlMarkerBlock(file)).rejects.toThrow(
      "outside the picklab markers",
    );
    expect(fs.readFileSync(file, "utf8")).toBe(content);
    expect(backupsIn(tmpDir)).toEqual([]);
  });

  it("refuses unbalanced markers", async () => {
    fs.writeFileSync(file, `${TOML_MARKER_BEGIN}\n`);
    await expect(upsertTomlMarkerBlock(file)).rejects.toThrow(
      "unbalanced picklab markers",
    );
  });
});

describe("removeTomlMarkerBlock", () => {
  it("removes the marker block and backs up first", async () => {
    fs.writeFileSync(file, 'model = "gpt-5"\n');
    await upsertTomlMarkerBlock(file);
    const result = await removeTomlMarkerBlock(file);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(fs.readFileSync(file, "utf8")).toBe('model = "gpt-5"\n\n');
  });

  it("is a no-op without markers or without the file", async () => {
    expect((await removeTomlMarkerBlock(file)).changed).toBe(false);
    fs.writeFileSync(file, 'model = "gpt-5"\n');
    expect((await removeTomlMarkerBlock(file)).changed).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe('model = "gpt-5"\n');
  });
});

describe("inspectTomlFile / tomlFileHasMcpServer", () => {
  it("reports a healthy managed block", async () => {
    await upsertTomlMarkerBlock(file);
    expect(await inspectTomlFile(file)).toEqual({
      exists: true,
      markersPresent: true,
      markersHaveSection: true,
      foreignSection: false,
    });
    expect(await tomlFileHasMcpServer(file)).toBe(true);
  });

  it("reports markers without content as stale", async () => {
    fs.writeFileSync(file, `${TOML_MARKER_BEGIN}\n${TOML_MARKER_END}\n`);
    const inspection = await inspectTomlFile(file);
    expect(inspection.markersPresent).toBe(true);
    expect(inspection.markersHaveSection).toBe(false);
  });

  it("reports foreign sections", async () => {
    fs.writeFileSync(file, '[mcp_servers.picklab]\ncommand = "x"\n');
    const inspection = await inspectTomlFile(file);
    expect(inspection.foreignSection).toBe(true);
    expect(await tomlFileHasMcpServer(file)).toBe(true);
  });

  it("reports a missing file", async () => {
    expect(await inspectTomlFile(file)).toEqual({
      exists: false,
      markersPresent: false,
      markersHaveSection: false,
      foreignSection: false,
    });
  });
});
