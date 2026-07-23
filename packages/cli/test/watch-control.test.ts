import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EndHumanTakeoverResult,
  HumanTakeoverHandle,
  OpenVncViewerResult,
} from "@pickforge/picklab-desktop-linux";

const { startHumanTakeover, endHumanTakeover, renewHumanTakeover, openVncViewer } =
  vi.hoisted(() => ({
    startHumanTakeover: vi.fn(),
    endHumanTakeover: vi.fn(),
    renewHumanTakeover: vi.fn(),
    openVncViewer: vi.fn(),
  }));

vi.mock("@pickforge/picklab-desktop-linux", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pickforge/picklab-desktop-linux")>();
  return {
    ...actual,
    startHumanTakeover,
    endHumanTakeover,
    renewHumanTakeover,
    openVncViewer,
  };
});

import { createSession } from "@pickforge/picklab-core";
import { watchDesktopSession } from "../src/commands/watch.js";

let root: string;

function fakeHandle(overrides: Partial<HumanTakeoverHandle> = {}): HumanTakeoverHandle {
  return {
    sessionId: "desk-aaaaaa11",
    leaseId: "lease-1",
    display: ":42",
    vncPid: 4242,
    vncPort: 5942,
    vncStartTimeTicks: 1,
    ttlMs: 30_000,
    heartbeatMs: 15,
    projectDir: root,
    ...overrides,
  };
}

function fakeViewer(overrides: Partial<OpenVncViewerResult> = {}): OpenVncViewerResult {
  return {
    opened: true,
    endpoint: "vnc://127.0.0.1:5942",
    viewer: "remote-viewer",
    exitCode: 0,
    signal: null,
    ...overrides,
  };
}

async function delayedResolve<T>(value: T, ms: number): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return value;
}

async function createDesktop(): Promise<string> {
  const record = await createSession(
    { type: "desktop", projectDir: root, status: "running", desktop: { display: ":42" } },
    { PICKLAB_HOME: path.join(root, "home") },
  );
  return record.id;
}

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-watch-control-"));
  process.env.PICKLAB_HOME = path.join(root, "home");
  startHumanTakeover.mockReset();
  endHumanTakeover.mockReset();
  renewHumanTakeover.mockReset();
  openVncViewer.mockReset();
  endHumanTakeover.mockResolvedValue({ reason: "return" } satisfies EndHumanTakeoverResult);
  renewHumanTakeover.mockResolvedValue(true);
});

afterEach(async () => {
  delete process.env.PICKLAB_HOME;
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe("watch --control (mocked)", () => {
  it("rejects --control combined with waitForViewerExit: false before any side effect", async () => {
    const id = await createDesktop();
    await expect(
      watchDesktopSession({
        session: id,
        projectDir: root,
        control: true,
        waitForViewerExit: false,
      }),
    ).rejects.toThrow(/requires waiting for the viewer to exit/);
    expect(startHumanTakeover).not.toHaveBeenCalled();
  });

  it("starts human takeover, waits for the viewer, and ends with reason 'return'", async () => {
    const id = await createDesktop();
    const handle = fakeHandle({ sessionId: id });
    startHumanTakeover.mockResolvedValue(handle);
    openVncViewer.mockResolvedValue(fakeViewer());
    endHumanTakeover.mockResolvedValue({
      reason: "return",
      screenshotPath: "screenshots/abc.png",
    } satisfies EndHumanTakeoverResult);

    const result = await watchDesktopSession({ session: id, projectDir: root, control: true });

    expect(startHumanTakeover).toHaveBeenCalledWith(id, { registryEnv: process.env });
    expect(openVncViewer).toHaveBeenCalledWith({ port: handle.vncPort, waitForExit: true });
    expect(endHumanTakeover).toHaveBeenCalledWith(handle, {
      registryEnv: process.env,
      reason: "return",
    });
    expect(result.data).toMatchObject({
      sessionId: id,
      leaseId: handle.leaseId,
      opened: true,
      controlReason: "return",
      resumeScreenshot: "screenshots/abc.png",
    });
    expect(result.lines?.join("\n")).toContain("returned (return)");
  });

  it("ends with reason 'cancelled' when a SIGINT arrives while the viewer is open", async () => {
    const id = await createDesktop();
    const handle = fakeHandle({ sessionId: id, heartbeatMs: 10_000 });
    startHumanTakeover.mockResolvedValue(handle);
    openVncViewer.mockImplementation(() => delayedResolve(fakeViewer({ signal: "SIGTERM" }), 60));
    endHumanTakeover.mockImplementation(async (_handle, opts) => ({
      reason: opts.reason,
    }));

    const pending = watchDesktopSession({ session: id, projectDir: root, control: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.emit("SIGINT");
    const result = await pending;

    expect(endHumanTakeover).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({ reason: "cancelled" }),
    );
    expect(result.data?.controlReason).toBe("cancelled");
  });

  it("ends with reason 'timeout' when the lease cannot be renewed", async () => {
    const id = await createDesktop();
    const handle = fakeHandle({ sessionId: id, heartbeatMs: 10 });
    startHumanTakeover.mockResolvedValue(handle);
    renewHumanTakeover.mockResolvedValue(false);
    openVncViewer.mockImplementation(() => delayedResolve(fakeViewer(), 80));
    endHumanTakeover.mockImplementation(async (_handle, opts) => ({
      reason: opts.reason,
    }));

    const result = await watchDesktopSession({ session: id, projectDir: root, control: true });

    expect(renewHumanTakeover).toHaveBeenCalled();
    expect(endHumanTakeover).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({ reason: "timeout" }),
    );
    expect(result.data?.controlReason).toBe("timeout");
    expect(result.lines?.join("\n")).toContain("could not be renewed");
  });

  it("ends control immediately and reports guidance when no viewer can be opened", async () => {
    const id = await createDesktop();
    const handle = fakeHandle({ sessionId: id });
    startHumanTakeover.mockResolvedValue(handle);
    openVncViewer.mockResolvedValue(
      fakeViewer({
        opened: false,
        viewer: undefined,
        exitCode: undefined,
        signal: undefined,
        guidance: "No graphical host session is available.",
      }),
    );
    endHumanTakeover.mockResolvedValue({ reason: "return" } satisfies EndHumanTakeoverResult);

    const result = await watchDesktopSession({ session: id, projectDir: root, control: true });

    expect(endHumanTakeover).toHaveBeenCalledWith(handle, {
      registryEnv: process.env,
      reason: "return",
    });
    expect(result.errors?.join("\n")).toContain("No writable VNC viewer could be opened");
    expect(result.errors?.join("\n")).toContain("No graphical host session is available.");
  });
});
