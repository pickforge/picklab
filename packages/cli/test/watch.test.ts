import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  destroySessionRecord,
  isPidAlive,
  listSessions,
  stopPid,
} from "@pickforge/picklab-core";
import { runWatch, watchDesktopSession } from "../src/commands/watch.js";

let root: string;
let binDir: string;
const originalEnv = {
  PICKLAB_HOME: process.env.PICKLAB_HOME,
  PATH: process.env.PATH,
  DISPLAY: process.env.DISPLAY,
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
};

function restoreEnv(name: keyof typeof originalEnv): void {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function executable(name: string, source: string): Promise<void> {
  const file = path.join(binDir, name);
  await fs.promises.writeFile(file, `#!${process.execPath}\n${source}`, "utf8");
  await fs.promises.chmod(file, 0o755);
}

async function createDesktop(
  display: string,
  desktop: Record<string, unknown> = {},
): Promise<string> {
  const record = await createSession({
    type: "desktop",
    projectDir: root,
    status: "running",
    desktop: { display, ...desktop },
  });
  return record.id;
}

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-watch-unit-"));
  binDir = path.join(root, "bin");
  await fs.promises.mkdir(binDir, { recursive: true });
  process.env.PICKLAB_HOME = path.join(root, "home");
  process.env.PATH = binDir;
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const record of await listSessions()) {
    const pid = record.desktop?.vncPid;
    if (pid !== undefined && pid !== process.pid && isPidAlive(pid)) {
      await stopPid(pid, { timeoutMs: 500 }).catch(() => {});
    }
    await destroySessionRecord(record.id).catch(() => {});
  }
  restoreEnv("PICKLAB_HOME");
  restoreEnv("PATH");
  restoreEnv("DISPLAY");
  restoreEnv("WAYLAND_DISPLAY");
  await fs.promises.rm(root, { recursive: true, force: true });
});

async function installVnc(): Promise<void> {
  await executable(
    "x11vnc",
    `const net = require("node:net");\nconst args = process.argv.slice(2);\nconst port = Number(args[args.indexOf("-rfbport") + 1]);\nconst server = net.createServer((socket) => socket.end());\nserver.listen(port, "127.0.0.1");\nprocess.on("SIGTERM", () => server.close(() => process.exit(0)));\n`,
  );
}

describe("watch command in process", () => {
  it("reports an actionable JSON error when no session exists", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runWatch({ json: true, projectDir: root });

    expect(code).toBe(1);
    const report = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain(
      "picklab session create --type desktop",
    );
  });

  it("fails closed when desktop sessions are ambiguous", async () => {
    await createDesktop(":240");
    await createDesktop(":241");

    await expect(
      watchDesktopSession({ projectDir: root }),
    ).rejects.toThrow(/Multiple running desktop sessions/);
  });

  it("starts VNC headlessly and returns endpoint guidance without a viewer", async () => {
    await installVnc();
    const id = await createDesktop(":242");

    const result = await watchDesktopSession({ session: id, projectDir: root });

    expect(result.data).toMatchObject({
      sessionId: id,
      opened: false,
      vncReused: false,
    });
    expect(result.lines?.join("\n")).toContain("viewer not opened");
    expect(result.lines?.join("\n")).toContain("ssh -N -L");
  });

  it("opens a viewer, waits for exit, then reuses the same VNC server", async () => {
    await installVnc();
    await executable(
      "remote-viewer",
      `process.stdout.write("ignored viewer output\\n");\nprocess.exit(0);\n`,
    );
    process.env.DISPLAY = ":0";
    const id = await createDesktop(":243");

    const first = await watchDesktopSession({ session: id, projectDir: root });
    const second = await watchDesktopSession({ session: id, projectDir: root });

    expect(first.data).toMatchObject({
      opened: true,
      viewer: "remote-viewer",
      viewerExitCode: 0,
      vncReused: false,
    });
    expect(second.data).toMatchObject({ opened: true, vncReused: true });
    expect(first.lines?.join("\n")).toContain("viewer closed");
  });

  it("rejects a writable VNC server instead of attaching a viewer", async () => {
    const id = await createDesktop(":244", {
      vncPid: process.pid,
      vncPort: 6144,
      vncViewOnly: false,
    });

    await expect(
      watchDesktopSession({ session: id, projectDir: root }),
    ).rejects.toThrow(/server-enforced read-only VNC/);
  });
});
