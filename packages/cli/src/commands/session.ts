import {
  createAndroidSession,
  destroyAndroidSession,
  getAndroidSessionStatus,
} from "@pickforge/picklab-android";
import {
  createBrowserSession,
  destroyBrowserSession,
  getBrowserSessionStatus,
} from "@pickforge/picklab-browser";
import {
  getSession,
  listSessions,
  loadConfig,
  type SessionRecord,
} from "@pickforge/picklab-core";
import {
  createDesktopSession,
  destroyDesktopSession,
  getDesktopSessionStatus,
} from "@pickforge/picklab-desktop-linux";
import {
  parseIntArg,
  resolveProjectDir,
  runReported,
  type BaseCliOptions,
} from "./shared.js";
import { watchDesktopSession } from "./watch.js";

export interface SessionCreateOptions extends BaseCliOptions {
  type: string;
  width?: string;
  height?: string;
  vnc?: boolean;
  vncControl?: boolean;
  avdName?: string;
  viewer?: boolean;
}

interface SessionSummary extends Record<string, unknown> {
  id: string;
  type: "desktop" | "android" | "browser";
}

async function createDesktopLeg(
  opts: SessionCreateOptions,
): Promise<SessionSummary> {
  const handle = await createDesktopSession({
    projectDir: resolveProjectDir(opts),
    width:
      opts.width === undefined ? undefined : parseIntArg(opts.width, "--width"),
    height:
      opts.height === undefined
        ? undefined
        : parseIntArg(opts.height, "--height"),
    vnc: opts.vnc,
    vncControl: opts.vncControl,
  });
  const summary: SessionSummary = {
    id: handle.id,
    type: "desktop",
    display: handle.display,
    logDir: handle.logDir,
  };
  if (handle.vncPort !== undefined) {
    summary.vncPort = handle.vncPort;
    summary.vncViewOnly = handle.vncViewOnly;
  }
  return summary;
}
async function createBrowserLeg(
  opts: SessionCreateOptions,
): Promise<SessionSummary> {
  const handle = await createBrowserSession({
    projectDir: resolveProjectDir(opts),
    width:
      opts.width === undefined ? undefined : parseIntArg(opts.width, "--width"),
    height:
      opts.height === undefined
        ? undefined
        : parseIntArg(opts.height, "--height"),
  });
  return {
    id: handle.id,
    type: "browser",
    display: handle.display,
    cdpPort: handle.cdpPort,
    profileDir: handle.profileDir,
    binaryPath: handle.binaryPath,
    logDir: handle.logDir,
  };
}

async function createAndroidLeg(
  opts: SessionCreateOptions,
): Promise<SessionSummary> {
  const projectDir = resolveProjectDir(opts);
  const config = await loadConfig(projectDir);
  const avdName = opts.avdName ?? config.android?.avdName;
  const handle = await createAndroidSession(
    avdName === undefined ? { projectDir } : { projectDir, avdName },
  );
  return {
    id: handle.id,
    type: "android",
    avdName: handle.avdName,
    serial: handle.serial,
    consolePort: handle.consolePort,
    logDir: handle.logDir,
  };
}

function describeCreated(summary: SessionSummary): string {
  if (summary.type === "desktop") {
    const vnc =
      summary.vncPort === undefined ? "" : `, vnc port ${summary.vncPort}`;
    return `created desktop session ${summary.id} (display ${summary.display}${vnc})`;
  }
  if (summary.type === "browser") {
    return `created browser session ${summary.id} (display ${summary.display}, cdp port ${summary.cdpPort})`;
  }
  return `created android session ${summary.id} (serial ${summary.serial})`;
}

export async function runSessionCreate(
  opts: SessionCreateOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const projectDir = resolveProjectDir(opts);
    const config = await loadConfig(projectDir);
    const viewerMode = config.viewer?.mode ?? "manual";
    if (viewerMode !== "manual" && viewerMode !== "auto") {
      throw new Error(
        `Invalid viewer.mode "${String(viewerMode)}": expected "manual" or "auto"`,
      );
    }
    if (opts.viewer === true && opts.vncControl === true) {
      throw new Error(
        "--viewer cannot be combined with --vnc-control because watch is read-only",
      );
    }
    if (opts.viewer === true && opts.type === "android") {
      throw new Error("--viewer requires a desktop-capable session type");
    }
    const createsWatchable =
      opts.type === "desktop" ||
      opts.type === "desktop+android" ||
      opts.type === "browser";
    const createsWritableDesktop =
      opts.type === "desktop" || opts.type === "desktop+android";
    const autoViewerSuppressed =
      createsWritableDesktop &&
      opts.viewer === undefined &&
      viewerMode === "auto" &&
      opts.vncControl === true;
    const wantsViewer =
      createsWatchable &&
      (opts.viewer ??
        (viewerMode === "auto" &&
          (!createsWritableDesktop || opts.vncControl !== true)));

    const sessions: SessionSummary[] = [];
    if (opts.type === "desktop" || opts.type === "desktop+android") {
      sessions.push(await createDesktopLeg(opts));
    }
    if (opts.type === "browser") {
      sessions.push(await createBrowserLeg(opts));
    }
    if (opts.type === "android" || opts.type === "desktop+android") {
      try {
        sessions.push(await createAndroidLeg(opts));
      } catch (error) {
        const desktop = sessions.find((session) => session.type === "desktop");
        if (desktop !== undefined) {
          await destroyDesktopSession(desktop.id).catch(() => {});
        }
        throw error;
      }
    }

    const lines = sessions.map(describeCreated);
    const data: Record<string, unknown> = { sessions };
    const errors: string[] = [];
    const watchable = sessions.find((session) => session.type !== "android");
    if (autoViewerSuppressed) {
      const reason =
        "viewer.mode=auto was suppressed because --vnc-control creates writable VNC";
      data.viewer = { opened: false, suppressed: true, reason };
      lines.push(reason);
    } else if (wantsViewer && watchable !== undefined) {
      try {
        const watched = await watchDesktopSession({
          session: watchable.id,
          projectDir,
          waitForViewerExit: false,
        });
        data.viewer = watched.data;
        lines.push(...(watched.lines ?? []));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const viewerError =
          `Viewer failed after creating session ${watchable.id}: ${message}`;
        data.viewer = {
          sessionId: watchable.id,
          opened: false,
          error: message,
        };
        errors.push(viewerError);
      }
    }
    return { data, lines, errors };
  });
}

async function sessionStatusEntry(
  record: SessionRecord,
): Promise<Record<string, unknown>> {
  const entry: Record<string, unknown> = {
    id: record.id,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt,
    projectDir: record.projectDir,
  };
  if (record.type === "browser") {
    const browserStatus = await getBrowserSessionStatus(record.id);
    const desktopStatus = await getDesktopSessionStatus(record.id);
    if (record.status === "running" && !browserStatus.alive) {
      entry.status = "dead";
    }
    entry.desktop = {
      ...record.desktop,
      xvfbAlive: browserStatus.xvfbAlive,
      vncAlive: desktopStatus.vncAlive,
      displayAlive: browserStatus.displayAlive,
    };
    entry.browser = {
      ...record.browser,
      browserAlive: browserStatus.browserAlive,
    };
    entry.viewer = {
      endpoint:
        record.desktop?.vncPort === undefined
          ? null
          : `vnc://127.0.0.1:${record.desktop.vncPort}`,
      ready: desktopStatus.vncAlive,
      readOnly: record.desktop?.vncViewOnly === true,
    };
  } else if (record.desktop !== undefined) {
    const status = await getDesktopSessionStatus(record.id);
    if (record.status === "running" && !status.xvfbAlive) {
      entry.status = "dead";
    }
    entry.desktop = {
      ...record.desktop,
      xvfbAlive: status.xvfbAlive,
      vncAlive: status.vncAlive,
      displayAlive: status.displayAlive,
    };
    entry.viewer = {
      endpoint:
        record.desktop.vncPort === undefined
          ? null
          : `vnc://127.0.0.1:${record.desktop.vncPort}`,
      ready: status.vncAlive,
      readOnly: record.desktop.vncViewOnly === true,
    };
  }
  if (record.android !== undefined) {
    const status = await getAndroidSessionStatus(record.id);
    if (record.status === "running" && !status.emulatorAlive) {
      entry.status = "dead";
    }
    entry.android = {
      ...record.android,
      emulatorAlive: status.emulatorAlive,
      deviceState: status.deviceState,
    };
  }
  return entry;
}

function statusLine(entry: Record<string, unknown>): string {
  const parts = [`${entry.id}  ${entry.type}  ${entry.status}`];
  const desktop = entry.desktop as Record<string, unknown> | undefined;
  if (desktop !== undefined) {
    parts.push(
      `display=${desktop.display}`,
      `xvfb=${desktop.xvfbAlive === true ? "alive" : "dead"}`,
    );
    if (desktop.vncPort !== undefined) {
      parts.push(`vnc=${desktop.vncAlive === true ? "alive" : "dead"}`);
    }
  }
  const browser = entry.browser as Record<string, unknown> | undefined;
  if (browser !== undefined) {
    parts.push(
      `browser=${browser.browserAlive === true ? "alive" : "dead"}`,
      `cdp=${browser.cdpPort ?? "unknown"}`,
    );
  }
  const android = entry.android as Record<string, unknown> | undefined;
  if (android !== undefined) {
    parts.push(
      `serial=${android.serial ?? "unknown"}`,
      `emulator=${android.emulatorAlive === true ? "alive" : "dead"}`,
      `device=${android.deviceState ?? "unknown"}`,
    );
  }
  return parts.join("  ");
}

export async function runSessionStatus(
  id: string | undefined,
  opts: BaseCliOptions,
): Promise<number> {
  return runReported(opts, async () => {
    let records: SessionRecord[];
    if (id !== undefined) {
      const record = await getSession(id);
      if (record === undefined) {
        throw new Error(`Session not found: ${id}`);
      }
      records = [record];
    } else {
      records = await listSessions();
    }
    const sessions: Array<Record<string, unknown>> = [];
    for (const record of records) {
      sessions.push(await sessionStatusEntry(record));
    }
    return {
      data: { sessions },
      lines: sessions.length === 0 ? ["no sessions"] : sessions.map(statusLine),
    };
  });
}

export interface SessionDestroyOptions extends BaseCliOptions {
  all?: boolean;
}

async function destroyRecord(record: SessionRecord): Promise<void> {
  if (record.type === "desktop") {
    await destroyDesktopSession(record.id);
  } else if (record.type === "browser") {
    await destroyBrowserSession(record.id);
  } else if (record.type === "android") {
    await destroyAndroidSession(record.id);
  } else {
    throw new Error(
      `Cannot destroy session ${record.id} of type "${record.type}"`,
    );
  }
}

export async function runSessionDestroy(
  id: string | undefined,
  opts: SessionDestroyOptions,
): Promise<number> {
  return runReported(opts, async () => {
    if (id !== undefined && opts.all === true) {
      throw new Error("Pass either a session id or --all, not both");
    }
    if (id === undefined && opts.all !== true) {
      throw new Error("Pass a session id or --all");
    }
    const records: SessionRecord[] = [];
    if (id !== undefined) {
      const record = await getSession(id);
      if (record === undefined) {
        throw new Error(`Session not found: ${id}`);
      }
      records.push(record);
    } else {
      records.push(...(await listSessions()));
    }
    const destroyed: string[] = [];
    const errors: string[] = [];
    for (const record of records) {
      try {
        await destroyRecord(record);
        destroyed.push(record.id);
      } catch (error) {
        errors.push(
          `${record.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      data: { destroyed },
      lines:
        destroyed.length === 0
          ? ["no sessions destroyed"]
          : destroyed.map((sessionId) => `destroyed session ${sessionId}`),
      errors,
    };
  });
}
