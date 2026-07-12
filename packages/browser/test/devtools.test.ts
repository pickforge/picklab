import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseDevToolsActivePort,
  readDevToolsActivePort,
  waitForDevToolsPort,
} from "../src/devtools.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-devtools-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("parseDevToolsActivePort", () => {
  it("reads the port from the first line and ignores the websocket GUID", () => {
    expect(
      parseDevToolsActivePort("45123\n/devtools/browser/abc-123\n"),
    ).toBe(45123);
  });

  it("rejects empty, non-numeric, or out-of-range content", () => {
    expect(parseDevToolsActivePort("")).toBeUndefined();
    expect(parseDevToolsActivePort("not-a-port\n")).toBeUndefined();
    expect(parseDevToolsActivePort("0\n")).toBeUndefined();
    expect(parseDevToolsActivePort("70000\n")).toBeUndefined();
  });
});

describe("readDevToolsActivePort", () => {
  it("returns undefined when the file is missing", () => {
    expect(readDevToolsActivePort(tmp)).toBeUndefined();
  });

  it("reads the port once the file exists", () => {
    fs.writeFileSync(
      path.join(tmp, "DevToolsActivePort"),
      "33221\n/devtools/browser/xyz\n",
    );
    expect(readDevToolsActivePort(tmp)).toBe(33221);
  });
});

describe("waitForDevToolsPort", () => {
  it("resolves with the port as soon as it appears", async () => {
    setTimeout(() => {
      fs.writeFileSync(path.join(tmp, "DevToolsActivePort"), "5555\n/x\n");
    }, 50);
    const result = await waitForDevToolsPort({
      profileDir: tmp,
      timeoutMs: 2000,
      isAlive: () => true,
      pollIntervalMs: 10,
    });
    expect(result).toEqual({ ok: true, port: 5555 });
  });

  it("fails with 'exited' when the process dies before publishing a port", async () => {
    const result = await waitForDevToolsPort({
      profileDir: tmp,
      timeoutMs: 2000,
      isAlive: () => false,
      pollIntervalMs: 10,
    });
    expect(result).toEqual({ ok: false, reason: "exited" });
  });

  it("still reports the port if it was written as the process exited", async () => {
    fs.writeFileSync(path.join(tmp, "DevToolsActivePort"), "6006\n/x\n");
    const result = await waitForDevToolsPort({
      profileDir: tmp,
      timeoutMs: 2000,
      isAlive: () => false,
      pollIntervalMs: 10,
    });
    expect(result).toEqual({ ok: true, port: 6006 });
  });

  it("fails with 'timeout' when the port never appears", async () => {
    const result = await waitForDevToolsPort({
      profileDir: tmp,
      timeoutMs: 60,
      isAlive: () => true,
      pollIntervalMs: 10,
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
