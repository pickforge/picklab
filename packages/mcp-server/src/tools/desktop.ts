import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  click,
  desktopSessionLogDir,
  launchApp,
  pressKey,
  screenshot,
  typeText,
  waitForWindow,
} from "@pickforge/picklab-desktop-linux";
import {
  captureToTarget,
  imageContent,
  requireDisplay,
  resolveScreenshotTarget,
  resolveSessionRecord,
  runTool,
  type ServerContext,
} from "../context.js";

const sessionArg = {
  session: z
    .string()
    .min(1)
    .optional()
    .describe("Desktop session id (default: the single running session)"),
};

async function resolveDesktop(
  ctx: ServerContext,
  session: string | undefined,
): Promise<{ id: string; display: string }> {
  const record = await resolveSessionRecord(ctx, "desktop", session);
  return { id: record.id, display: requireDisplay(record) };
}

export function registerDesktopTools(
  server: McpServer,
  ctx: ServerContext,
): void {
  server.registerTool(
    "desktop_launch",
    {
      title: "Launch desktop app",
      description:
        "Launch an application inside the desktop session (argument array, " +
        "no shell). Optionally wait for a window whose name contains a " +
        "pattern.",
      inputSchema: {
        ...sessionArg,
        command: z.string().min(1).describe("Executable to launch"),
        args: z
          .array(z.string())
          .optional()
          .describe("Arguments for the executable"),
        cwd: z
          .string()
          .min(1)
          .optional()
          .describe("Working directory (relative to the project dir)"),
        waitWindow: z
          .string()
          .min(1)
          .optional()
          .describe("Wait for a window whose name contains this pattern"),
      },
    },
    (args) =>
      runTool(async () => {
        const { id, display } = await resolveDesktop(ctx, args.session);
        const app = await launchApp({
          display,
          command: args.command,
          args: args.args ?? [],
          env: ctx.env,
          logDir: desktopSessionLogDir(id, ctx.env),
          cwd:
            args.cwd === undefined
              ? undefined
              : path.resolve(ctx.projectDir, args.cwd),
        });
        const data: Record<string, unknown> = {
          sessionId: id,
          display,
          pid: app.pid,
          logPath: app.logPath,
        };
        if (args.waitWindow !== undefined) {
          data.window = await waitForWindow(display, args.waitWindow);
        }
        return { data };
      }),
  );

  server.registerTool(
    "desktop_screenshot",
    {
      title: "Desktop screenshot",
      description:
        "Capture the desktop display as PNG. By default the image is " +
        "recorded as an artifact of a new run under .picklab/runs and " +
        "returned inline when small enough.",
      inputSchema: {
        ...sessionArg,
        out: z
          .string()
          .min(1)
          .optional()
          .describe("Explicit output path instead of a run artifact"),
        runSlug: z
          .string()
          .min(1)
          .optional()
          .describe('Run slug (default "desktop")'),
      },
    },
    (args) =>
      runTool(async () => {
        const { id, display } = await resolveDesktop(ctx, args.session);
        const target = await resolveScreenshotTarget(ctx, args, "desktop", id);
        let tool: string | undefined;
        const data = await captureToTarget(target, async () => {
          const result = await screenshot({
            display,
            outPath: target.outPath,
            env: ctx.env,
          });
          tool = result.tool;
        });
        data.sessionId = id;
        data.display = display;
        data.tool = tool;
        return { data, extraContent: await imageContent(target.outPath) };
      }),
  );

  server.registerTool(
    "desktop_click",
    {
      title: "Desktop click",
      description: "Click at the given desktop coordinates.",
      inputSchema: {
        ...sessionArg,
        x: z.number().int().nonnegative().describe("X coordinate"),
        y: z.number().int().nonnegative().describe("Y coordinate"),
        button: z
          .number()
          .int()
          .min(1)
          .max(9)
          .optional()
          .describe("Mouse button (1-9, default 1)"),
      },
    },
    (args) =>
      runTool(async () => {
        const { id, display } = await resolveDesktop(ctx, args.session);
        await click({ display, x: args.x, y: args.y, button: args.button });
        return {
          data: {
            sessionId: id,
            display,
            x: args.x,
            y: args.y,
            button: args.button ?? 1,
          },
        };
      }),
  );

  server.registerTool(
    "desktop_type",
    {
      title: "Desktop type",
      description: "Type text into the focused desktop window.",
      inputSchema: {
        ...sessionArg,
        text: z.string().min(1).describe("Text to type"),
      },
    },
    (args) =>
      runTool(async () => {
        const { id, display } = await resolveDesktop(ctx, args.session);
        await typeText({ display, text: args.text });
        return {
          data: { sessionId: id, display, length: args.text.length },
        };
      }),
  );

  server.registerTool(
    "desktop_key",
    {
      title: "Desktop key press",
      description:
        'Press a key or chord (e.g. "Return", "Tab", "ctrl+s") in the ' +
        "desktop session.",
      inputSchema: {
        ...sessionArg,
        key: z.string().min(1).describe("Key or chord to press"),
      },
    },
    (args) =>
      runTool(async () => {
        const { id, display } = await resolveDesktop(ctx, args.session);
        await pressKey({ display, key: args.key });
        return { data: { sessionId: id, display, key: args.key } };
      }),
  );
}
