import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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
import { runTool, type ServerContext } from "../context.js";

interface SessionSummary extends Record<string, unknown> {
  id: string;
  type: "desktop" | "android" | "browser";
}

export interface SessionLifecycle {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export function progressReporter(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): ((message: string) => void) | undefined {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return undefined;
  }
  let progress = 0;
  return (message: string) => {
    progress += 1;
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress, message },
      })
      .catch(() => {});
  };
}

async function createDesktopLeg(
  ctx: ServerContext,
  args: {
    width?: number;
    height?: number;
    vnc?: boolean;
    vncControl?: boolean;
  },
): Promise<SessionSummary> {
  const handle = await createDesktopSession({
    projectDir: ctx.projectDir,
    registryEnv: ctx.env,
    env: ctx.env,
    width: args.width,
    height: args.height,
    vnc: args.vnc,
    vncControl: args.vncControl,
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
  ctx: ServerContext,
  args: { width?: number; height?: number },
  lifecycle: SessionLifecycle,
): Promise<SessionSummary> {
  const handle = await createBrowserSession({
    projectDir: ctx.projectDir,
    registryEnv: ctx.env,
    env: ctx.env,
    width: args.width,
    height: args.height,
    signal: lifecycle.signal,
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
  ctx: ServerContext,
  args: { avdName?: string },
  lifecycle: SessionLifecycle,
): Promise<SessionSummary> {
  const config = await loadConfig(ctx.projectDir, ctx.env);
  const avdName = args.avdName ?? config.android?.avdName;
  const handle = await createAndroidSession({
    projectDir: ctx.projectDir,
    registryEnv: ctx.env,
    env: ctx.env,
    onProgress: lifecycle.onProgress,
    signal: lifecycle.signal,
    ...(avdName === undefined ? {} : { avdName }),
  });
  return {
    id: handle.id,
    type: "android",
    avdName: handle.avdName,
    serial: handle.serial,
    consolePort: handle.consolePort,
    logDir: handle.logDir,
  };
}

export async function createSessions(
  ctx: ServerContext,
  args: {
    type?: "desktop" | "android" | "desktop+android" | "browser";
    width?: number;
    height?: number;
    vnc?: boolean;
    vncControl?: boolean;
    avdName?: string;
  },
  lifecycle: SessionLifecycle = {},
): Promise<SessionSummary[]> {
  const type = args.type ?? "desktop";
  const sessions: SessionSummary[] = [];
  if (type === "desktop" || type === "desktop+android") {
    sessions.push(await createDesktopLeg(ctx, args));
  }
  if (type === "browser") {
    sessions.push(await createBrowserLeg(ctx, args, lifecycle));
  }
  if (type === "android" || type === "desktop+android") {
    try {
      if (lifecycle.signal?.aborted === true) {
        throw new Error("Session creation aborted by the client");
      }
      sessions.push(await createAndroidLeg(ctx, args, lifecycle));
    } catch (error) {
      const desktop = sessions.find((session) => session.type === "desktop");
      if (desktop !== undefined) {
        await destroyDesktopSession(desktop.id, ctx.env).catch(() => {});
      }
      throw error;
    }
  }
  return sessions;
}

export async function sessionStatusEntry(
  ctx: ServerContext,
  record: SessionRecord,
): Promise<Record<string, unknown>> {
  const entry: Record<string, unknown> = {
    id: record.id,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt,
    projectDir: record.projectDir,
  };
  if (record.type === "desktop") {
    const status = await getDesktopSessionStatus(record.id, ctx.env);
    if (record.status === "running" && !status.xvfbAlive) {
      entry.status = "dead";
    }
    entry.desktop = {
      ...record.desktop,
      xvfbAlive: status.xvfbAlive,
      vncAlive: status.vncAlive,
      displayAlive: status.displayAlive,
    };
  } else if (record.type === "browser") {
    const status = await getBrowserSessionStatus(record.id, ctx.env);
    if (record.status === "running" && !status.alive) {
      entry.status = "dead";
    }
    entry.desktop = {
      ...record.desktop,
      xvfbAlive: status.xvfbAlive,
      displayAlive: status.displayAlive,
    };
    entry.browser = {
      ...record.browser,
      browserAlive: status.browserAlive,
    };
  } else if (record.type === "android") {
    const status = await getAndroidSessionStatus(record.id, ctx.env, {
      env: ctx.env,
    });
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

async function destroyRecord(
  ctx: ServerContext,
  record: SessionRecord,
): Promise<void> {
  if (record.type === "desktop") {
    await destroyDesktopSession(record.id, ctx.env);
  } else if (record.type === "browser") {
    await destroyBrowserSession(record.id, ctx.env);
  } else if (record.type === "android") {
    await destroyAndroidSession(record.id, ctx.env, { env: ctx.env });
  } else {
    throw new Error(
      `Cannot destroy session ${record.id} of type "${record.type}"`,
    );
  }
}

export function registerSessionTools(
  server: McpServer,
  ctx: ServerContext,
): void {
  server.registerTool(
    "session_create",
    {
      title: "Create lab session",
      description:
        "Create an isolated lab session: a virtual desktop display (Xvfb), " +
        "headed Chrome/Chromium browser, and/or an Android emulator. Defaults to type \"desktop\".",
      inputSchema: {
        type: z
          .enum(["desktop", "android", "desktop+android", "browser"])
          .optional()
          .describe('Session type (default "desktop")'),
        width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Desktop display width in pixels"),
        height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Desktop display height in pixels"),
        vnc: z
          .boolean()
          .optional()
          .describe("Expose the desktop display over read-only VNC"),
        vncControl: z
          .boolean()
          .optional()
          .describe(
            "Expose writable VNC for explicit manual secret entry; input is not coordinated with the agent",
          ),
        avdName: z.string().min(1).optional().describe("Android AVD name"),
      },
    },
    (args, extra) =>
      runTool(async () => ({
        data: {
          sessions: await createSessions(ctx, args, {
            onProgress: progressReporter(extra),
            signal: extra.signal,
          }),
        },
      })),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Show liveness for one session (by id) or for all known sessions.",
      inputSchema: {
        sessionId: z.string().min(1).optional().describe("Session id"),
      },
    },
    (args) =>
      runTool(async () => {
        let records: SessionRecord[];
        if (args.sessionId !== undefined) {
          const record = await getSession(args.sessionId, ctx.env);
          if (record === undefined) {
            throw new Error(`Session not found: ${args.sessionId}`);
          }
          records = [record];
        } else {
          records = await listSessions(ctx.env);
        }
        const sessions: Array<Record<string, unknown>> = [];
        for (const record of records) {
          sessions.push(await sessionStatusEntry(ctx, record));
        }
        return { data: { sessions } };
      }),
  );

  server.registerTool(
    "session_destroy",
    {
      title: "Destroy lab session",
      description:
        "Destroy a session and stop its processes. Pass a session id, or " +
        "all=true to destroy every session.",
      inputSchema: {
        sessionId: z.string().min(1).optional().describe("Session id"),
        all: z.boolean().optional().describe("Destroy all sessions"),
      },
    },
    (args) =>
      runTool(async () => {
        if (args.sessionId !== undefined && args.all === true) {
          throw new Error('Pass either "sessionId" or "all", not both');
        }
        if (args.sessionId === undefined && args.all !== true) {
          throw new Error('Pass a "sessionId" or set "all" to true');
        }
        const records: SessionRecord[] = [];
        if (args.sessionId !== undefined) {
          const record = await getSession(args.sessionId, ctx.env);
          if (record === undefined) {
            throw new Error(`Session not found: ${args.sessionId}`);
          }
          records.push(record);
        } else {
          records.push(...(await listSessions(ctx.env)));
        }
        const destroyed: string[] = [];
        const errors: string[] = [];
        for (const record of records) {
          try {
            await destroyRecord(ctx, record);
            destroyed.push(record.id);
          } catch (error) {
            errors.push(
              `${record.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { data: { destroyed }, errors };
      }),
  );
}
