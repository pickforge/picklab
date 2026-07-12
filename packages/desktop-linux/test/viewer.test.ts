import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  createSession,
  destroySessionRecord,
  getSession,
  isPidAlive,
  stopPid,
  updateSession,
} from "@pickforge/picklab-core";
import { ensureSessionVnc } from "../src/session.js";
import {
  buildVncViewerArgs,
  detectVncViewer,
  openVncViewer,
} from "../src/viewer.js";

let root: string;
let binDir: string;
let home: string;
const spawnedPids: number[] = [];

async function executable(name: string, source: string): Promise<string> {
  const file = path.join(binDir, name);
  await fs.promises.writeFile(file, `#!${process.execPath}\n${source}`, "utf8");
  await fs.promises.chmod(file, 0o755);
  return file;
}

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-viewer-"));
  binDir = path.join(root, "bin");
  home = path.join(root, "home");
  await fs.promises.mkdir(binDir, { recursive: true });
});

afterEach(async () => {
  for (const pid of spawnedPids.splice(0)) {
    if (isPidAlive(pid)) await stopPid(pid, { timeoutMs: 500 }).catch(() => {});
  }
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe("VNC viewer command", () => {
  it("detects clients in preference order and builds exact argv", async () => {
    const fallback = await executable("vncviewer", "process.exit(0);\n");
    expect(detectVncViewer({ PATH: binDir })).toEqual({
      name: "vncviewer",
      binary: fallback,
    });
    const preferred = await executable("remote-viewer", "process.exit(0);\n");
    expect(detectVncViewer({ PATH: binDir })).toEqual({
      name: "remote-viewer",
      binary: preferred,
    });
    expect(buildVncViewerArgs("remote-viewer", 5992)).toEqual([
      "vnc://127.0.0.1:5992",
    ]);
    expect(buildVncViewerArgs("vncviewer", 5992)).toEqual([
      "127.0.0.1::5992",
    ]);
  });

  it("returns endpoint and install/SSH guidance without opening in headless mode", async () => {
    const marker = path.join(root, "opened");
    await executable(
      "remote-viewer",
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "opened");\n`,
    );
    const result = await openVncViewer({
      port: 5992,
      env: { PATH: binDir, DISPLAY: undefined, WAYLAND_DISPLAY: undefined },
    });
    expect(result.opened).toBe(false);
    expect(result.endpoint).toBe("vnc://127.0.0.1:5992");
    expect(result.guidance).toMatch(/Install virt-viewer or TigerVNC/);
    expect(result.guidance).toContain("ssh -N -L 5992:127.0.0.1:5992");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("passes the endpoint as one argv item with shell disabled semantics", async () => {
    const argsPath = path.join(root, "args.json");
    await executable(
      "remote-viewer",
      `require("node:fs").writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)));\n`,
    );
    const result = await openVncViewer({
      port: 5993,
      env: { PATH: binDir, DISPLAY: ":0", ARGS_PATH: argsPath },
    });
    expect(result.opened).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await fs.promises.readFile(argsPath, "utf8"))).toEqual([
      "vnc://127.0.0.1:5993",
    ]);
  });

  it("returns client guidance when a graphical host has no supported viewer", async () => {
    const result = await openVncViewer({
      port: 5994,
      env: { PATH: binDir, DISPLAY: ":0" },
    });

    expect(result).toMatchObject({
      opened: false,
      endpoint: "vnc://127.0.0.1:5994",
    });
    expect(result.guidance).toContain("No supported VNC viewer was found");
  });

  it("returns after viewer spawn when exit waiting is disabled", async () => {
    await executable("remote-viewer", "process.exit(0);\n");
    const result = await openVncViewer({
      port: 5995,
      env: { PATH: binDir, DISPLAY: ":0" },
      waitForExit: false,
    });

    expect(result).toMatchObject({
      opened: true,
      endpoint: "vnc://127.0.0.1:5995",
      viewer: "remote-viewer",
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.signal).toBeUndefined();
  });

  it("rejects invalid viewer ports", () => {
    expect(() => buildVncViewerArgs("remote-viewer", 0)).toThrow(/Invalid port/);
    expect(() => buildVncViewerArgs("vncviewer", 65_536)).toThrow(
      /Invalid port/,
    );
  });
});

describe("ensureSessionVnc", () => {
  it("starts loopback read-only VNC once across concurrent callers and viewer exit owns nothing", async () => {
    const startsPath = path.join(root, "starts.log");
    await executable(
      "x11vnc",
      `const fs = require("node:fs");\nconst net = require("node:net");\nconst args = process.argv.slice(2);\nconst port = Number(args[args.indexOf("-rfbport") + 1]);\nfs.appendFileSync(process.env.STARTS_PATH, JSON.stringify(args) + "\\n");\nconst server = net.createServer((socket) => socket.end());\nserver.listen(port, "127.0.0.1");\nprocess.on("SIGTERM", () => server.close(() => process.exit(0)));\n`,
    );
    await executable("remote-viewer", "process.exit(0);\n");
    const registryEnv = { PICKLAB_HOME: home };
    const record = await createSession(
      {
        type: "desktop",
        projectDir: root,
        status: "running",
        desktop: { display: ":198" },
      },
      registryEnv,
    );

    const results = await Promise.all([
      ensureSessionVnc(record.id, {
        registryEnv,
        env: { PATH: binDir, STARTS_PATH: startsPath },
      }),
      ensureSessionVnc(record.id, {
        registryEnv,
        env: { PATH: binDir, STARTS_PATH: startsPath },
      }),
    ]);
    const first = results.find((result) => !result.reused);
    const second = results.find((result) => result.reused);
    if (first === undefined || second === undefined) {
      throw new Error("expected one VNC start and one reuse");
    }
    spawnedPids.push(first.pid);
    expect(first.port).toBe(6098);
    expect(second).toEqual({ ...first, reused: true });
    expect(
      (await fs.promises.readFile(startsPath, "utf8")).trim().split("\n"),
    ).toHaveLength(1);
    const stored = await getSession(record.id, registryEnv);
    expect(stored?.desktop).toMatchObject({
      vncPid: first.pid,
      vncPort: 6098,
      vncViewOnly: true,
    });

    await openVncViewer({
      port: first.port,
      env: { PATH: binDir, DISPLAY: ":0" },
    });
    expect(isPidAlive(first.pid)).toBe(true);
    expect((await getSession(record.id, registryEnv))?.status).toBe("running");

    await stopPid(first.pid, { timeoutMs: 500 });
    spawnedPids.splice(spawnedPids.indexOf(first.pid), 1);
    await destroySessionRecord(record.id, registryEnv);
  });

  it("refuses to reuse an active writable VNC server", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "require('node:net').createServer().listen(0)"],
      { stdio: "ignore" },
    );
    if (child.pid === undefined) throw new Error("helper process has no pid");
    spawnedPids.push(child.pid);
    const registryEnv = { PICKLAB_HOME: home };
    const record = await createSession(
      { type: "desktop", projectDir: root },
      registryEnv,
    );
    await updateSession(
      record.id,
      {
        status: "running",
        desktop: {
          display: ":199",
          vncPid: child.pid,
          vncPort: 6099,
          vncViewOnly: false,
        },
      },
      registryEnv,
    );

    await expect(
      ensureSessionVnc(record.id, { registryEnv, env: { PATH: binDir } }),
    ).rejects.toThrow(/server-enforced read-only/);
    expect(isPidAlive(child.pid)).toBe(true);
    await destroySessionRecord(record.id, registryEnv);
  });

  it("refuses to record VNC when another process owns the endpoint", async () => {
    const server = net.createServer((socket) => socket.end());
    const listening = once(server, "listening");
    server.listen(6100, "127.0.0.1");
    await listening;
    await executable("x11vnc", "process.exit(99);\n");
    const registryEnv = { PICKLAB_HOME: home };
    const record = await createSession(
      {
        type: "desktop",
        projectDir: root,
        status: "running",
        desktop: { display: ":200" },
      },
      registryEnv,
    );

    await expect(
      ensureSessionVnc(record.id, { registryEnv, env: { PATH: binDir } }),
    ).rejects.toThrow(/already in use; refusing to claim ownership/);
    expect((await getSession(record.id, registryEnv))?.desktop).toEqual({
      display: ":200",
    });

    const closed = once(server, "close");
    server.close();
    await closed;
    await destroySessionRecord(record.id, registryEnv);
  });
});
