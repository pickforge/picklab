import { resolveDesktopCapableSession } from "@pickforge/picklab-core";
import {
  ensureSessionVnc,
  openVncViewer,
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
}

export async function watchDesktopSession(
  opts: WatchOptions,
): Promise<CommandResult> {
  const record = await resolveDesktopCapableSession(opts.session, {
    projectDir: resolveProjectDir(opts),
  });
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
