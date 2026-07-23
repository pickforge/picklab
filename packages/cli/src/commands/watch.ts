import { resolveDesktopCapableSession } from "@pickforge/picklab-core";
import {
  endHumanTakeover,
  ensureSessionVnc,
  openVncViewer,
  renewHumanTakeover,
  startHumanTakeover,
  type HumanTakeoverHandle,
  type TakeoverEndReason,
} from "@pickforge/picklab-desktop-linux";
import {
  resolveProjectDir,
  runReported,
  type BaseCliOptions,
  type CommandResult,
} from "./shared.js";

export interface WatchOptions extends BaseCliOptions {
  session?: string;
  waitForViewerExit?: boolean;
  control?: boolean;
}

const TAKEOVER_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Hold a human lease for the duration of the viewer wait, heartbeating it
 * every `heartbeatMs` so it never lapses while the human is actually there.
 * A terminal-wide SIGINT (the common interactive-cancel path) reaches the
 * viewer child too, since `openVncViewer` spawns it in our process group —
 * this handler exists so *our* process does not exit before running cleanup,
 * not to itself interrupt the viewer. `runControlledViewer` always ends the
 * takeover (VNC reverted, lease released) before returning or throwing.
 */
async function runControlledViewer(
  handle: HumanTakeoverHandle,
  port: number,
  registryEnv: NodeJS.ProcessEnv,
): Promise<{
  viewer: Awaited<ReturnType<typeof openVncViewer>>;
  reason: TakeoverEndReason;
  screenshotPath?: string;
}> {
  let cancelled = false;
  let leaseLost = false;
  const onSignal = (): void => {
    cancelled = true;
  };
  for (const signal of TAKEOVER_SIGNALS) {
    process.on(signal, onSignal);
  }
  const heartbeat = setInterval(() => {
    void renewHumanTakeover(handle, registryEnv).then((renewed) => {
      if (!renewed) {
        leaseLost = true;
        clearInterval(heartbeat);
      }
    });
  }, handle.heartbeatMs);
  heartbeat.unref();

  try {
    const viewer = await openVncViewer({ port, waitForExit: true });
    const reason: TakeoverEndReason = leaseLost
      ? "timeout"
      : cancelled
        ? "cancelled"
        : "return";
    const result = await endHumanTakeover(handle, { registryEnv, reason });
    return { viewer, reason, screenshotPath: result.screenshotPath };
  } catch (error) {
    await endHumanTakeover(handle, {
      registryEnv,
      reason: leaseLost ? "timeout" : "cancelled",
    }).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
    for (const signal of TAKEOVER_SIGNALS) {
      process.off(signal, onSignal);
    }
  }
}

async function watchWithControl(
  sessionId: string,
  registryEnv: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const handle = await startHumanTakeover(sessionId, { registryEnv });
  const data: Record<string, unknown> = {
    sessionId,
    leaseId: handle.leaseId,
    vncPid: handle.vncPid,
    vncPort: handle.vncPort,
  };

  let controlled: Awaited<ReturnType<typeof runControlledViewer>>;
  try {
    controlled = await runControlledViewer(handle, handle.vncPort, registryEnv);
  } catch (error) {
    throw error instanceof Error
      ? new Error(`Human takeover for session ${sessionId} ended abnormally: ${error.message}`)
      : error;
  }
  const { viewer, reason, screenshotPath } = controlled;
  data.opened = viewer.opened;
  data.endpoint = viewer.endpoint;
  data.controlReason = reason;
  if (viewer.viewer !== undefined) data.viewer = viewer.viewer;
  if (viewer.exitCode !== undefined) data.viewerExitCode = viewer.exitCode;
  if (viewer.signal !== undefined) data.viewerSignal = viewer.signal;
  if (viewer.guidance !== undefined) data.guidance = viewer.guidance;
  if (screenshotPath !== undefined) data.resumeScreenshot = screenshotPath;

  if (!viewer.opened) {
    return {
      data,
      errors: [
        `No writable VNC viewer could be opened for session ${sessionId}; ` +
          "control was granted and immediately returned. " +
          String(viewer.guidance ?? ""),
      ],
    };
  }
  const lines = [
    reason === "timeout"
      ? `human control lease for session ${sessionId} could not be renewed and was ended`
      : `human control for session ${sessionId} returned (${reason}); VNC is read-only again`,
  ];
  if (screenshotPath !== undefined) {
    lines.push(`resume screenshot recorded: ${screenshotPath}`);
  }
  return { data, lines };
}

export async function watchDesktopSession(
  opts: WatchOptions,
): Promise<CommandResult> {
  const record = await resolveDesktopCapableSession(opts.session, {
    projectDir: resolveProjectDir(opts),
  });
  if (opts.control === true) {
    if (opts.waitForViewerExit === false) {
      throw new Error(
        "--control requires waiting for the viewer to exit, to know when to end human control",
      );
    }
    return watchWithControl(record.id, process.env);
  }
  const vnc = await ensureSessionVnc(record.id);
  const viewer = await openVncViewer({
    port: vnc.port,
    waitForExit: opts.waitForViewerExit !== false,
  });
  const data: Record<string, unknown> = {
    sessionId: record.id,
    opened: viewer.opened,
    endpoint: viewer.endpoint,
    vncPid: vnc.pid,
    vncPort: vnc.port,
    vncReused: vnc.reused,
  };
  if (viewer.viewer !== undefined) data.viewer = viewer.viewer;
  if (viewer.exitCode !== undefined) data.viewerExitCode = viewer.exitCode;
  if (viewer.signal !== undefined) data.viewerSignal = viewer.signal;
  if (viewer.guidance !== undefined) data.guidance = viewer.guidance;

  if (!viewer.opened) {
    return {
      data,
      lines: [
        `viewer not opened for session ${record.id}`,
        `VNC endpoint: ${viewer.endpoint}`,
        viewer.guidance as string,
      ],
    };
  }
  if (opts.waitForViewerExit !== false) {
    if (viewer.signal !== undefined && viewer.signal !== null) {
      throw new Error(
        `VNC viewer for session ${record.id} exited on signal ${viewer.signal}; the session and VNC server remain running`,
      );
    }
    if (viewer.exitCode !== undefined && viewer.exitCode !== 0) {
      throw new Error(
        `VNC viewer for session ${record.id} exited with code ${String(viewer.exitCode)}; the session and VNC server remain running`,
      );
    }
  }
  return {
    data,
    lines: [
      opts.waitForViewerExit === false
        ? `viewer opened for session ${record.id}; the session and VNC server remain independent`
        : `viewer closed for session ${record.id}; the session and VNC server remain running`,
    ],
  };
}

export async function runWatch(opts: WatchOptions): Promise<number> {
  return runReported(opts, () => watchDesktopSession(opts));
}
