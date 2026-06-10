import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  back,
  clearLogcat,
  getUiTree,
  home,
  installApk,
  launchApp,
  logcat,
  runAdb,
  screenshot,
  tap,
  typeText,
} from "@pickforge/picklab-android";
import { redactSecrets } from "@pickforge/picklab-core";
import {
  captureToTarget,
  imageContent,
  resolveScreenshotTarget,
  resolveSessionRecord,
  runTool,
  type ServerContext,
} from "../context.js";
import { createSessions } from "./session.js";

const targetArgs = {
  session: z
    .string()
    .min(1)
    .optional()
    .describe("Android session id (default: the single running session)"),
  serial: z
    .string()
    .min(1)
    .optional()
    .describe("Explicit adb device serial instead of a session"),
};

interface AndroidTarget {
  serial: string;
  sessionId?: string;
}

async function resolveAndroidTarget(
  ctx: ServerContext,
  args: { session?: string; serial?: string },
): Promise<AndroidTarget> {
  if (args.serial !== undefined && args.session !== undefined) {
    throw new Error('Pass either "session" or "serial", not both');
  }
  if (args.serial !== undefined) {
    return { serial: args.serial };
  }
  const record = await resolveSessionRecord(ctx, "android", args.session);
  const serial = record.android?.serial;
  if (serial === undefined) {
    throw new Error(`Session ${record.id} has no device serial recorded`);
  }
  return { serial, sessionId: record.id };
}

function targetData(target: AndroidTarget): Record<string, unknown> {
  const data: Record<string, unknown> = { serial: target.serial };
  if (target.sessionId !== undefined) {
    data.sessionId = target.sessionId;
  }
  return data;
}

export function registerAndroidTools(
  server: McpServer,
  ctx: ServerContext,
): void {
  server.registerTool(
    "android_start",
    {
      title: "Start Android session",
      description:
        "Start an Android emulator session (boots the dedicated PickLab AVD).",
      inputSchema: {
        avdName: z.string().min(1).optional().describe("Android AVD name"),
      },
    },
    (args) =>
      runTool(async () => ({
        data: {
          sessions: await createSessions(ctx, {
            type: "android",
            avdName: args.avdName,
          }),
        },
      })),
  );

  server.registerTool(
    "android_install_apk",
    {
      title: "Install APK",
      description:
        "Install an APK on the device (path relative to the project dir).",
      inputSchema: {
        ...targetArgs,
        apkPath: z.string().min(1).describe("Path to the APK"),
      },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        const apkPath = path.resolve(ctx.projectDir, args.apkPath);
        await installApk({ serial: target.serial, apkPath, env: ctx.env });
        return { data: { ...targetData(target), apkPath } };
      }),
  );

  server.registerTool(
    "android_launch_app",
    {
      title: "Launch Android app",
      description: "Launch an installed app by package name.",
      inputSchema: {
        ...targetArgs,
        packageName: z
          .string()
          .min(1)
          .describe('Application package name, e.g. "com.example.app"'),
        activity: z
          .string()
          .min(1)
          .optional()
          .describe('Activity to start, e.g. ".MainActivity"'),
      },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        await launchApp({
          serial: target.serial,
          packageName: args.packageName,
          activity: args.activity,
          env: ctx.env,
        });
        return {
          data: { ...targetData(target), packageName: args.packageName },
        };
      }),
  );

  server.registerTool(
    "android_screenshot",
    {
      title: "Android screenshot",
      description:
        "Capture the device screen as PNG. By default the image is recorded " +
        "as an artifact of a new run under .picklab/runs and returned inline " +
        "when small enough.",
      inputSchema: {
        ...targetArgs,
        out: z
          .string()
          .min(1)
          .optional()
          .describe("Explicit output path instead of a run artifact"),
        runSlug: z
          .string()
          .min(1)
          .optional()
          .describe('Run slug (default "android")'),
      },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        const destination = await resolveScreenshotTarget(
          ctx,
          args,
          "android",
          target.sessionId,
        );
        const data = await captureToTarget(destination, async () => {
          await screenshot({
            serial: target.serial,
            outPath: destination.outPath,
            env: ctx.env,
          });
        });
        Object.assign(data, targetData(target));
        return { data, extraContent: await imageContent(destination.outPath) };
      }),
  );

  server.registerTool(
    "android_tap",
    {
      title: "Android tap",
      description: "Tap at the given screen coordinates.",
      inputSchema: {
        ...targetArgs,
        x: z.number().int().nonnegative().describe("X coordinate"),
        y: z.number().int().nonnegative().describe("Y coordinate"),
      },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        await tap({ serial: target.serial, x: args.x, y: args.y, env: ctx.env });
        return { data: { ...targetData(target), x: args.x, y: args.y } };
      }),
  );

  server.registerTool(
    "android_type",
    {
      title: "Android type",
      description: "Type ASCII text into the focused field.",
      inputSchema: {
        ...targetArgs,
        text: z.string().min(1).describe("Text to type"),
      },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        await typeText({ serial: target.serial, text: args.text, env: ctx.env });
        return { data: { ...targetData(target), length: args.text.length } };
      }),
  );

  server.registerTool(
    "android_back",
    {
      title: "Android back",
      description: "Press the back button.",
      inputSchema: { ...targetArgs },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        await back({ serial: target.serial, env: ctx.env });
        return { data: targetData(target) };
      }),
  );

  server.registerTool(
    "android_home",
    {
      title: "Android home",
      description: "Press the home button.",
      inputSchema: { ...targetArgs },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        await home({ serial: target.serial, env: ctx.env });
        return { data: targetData(target) };
      }),
  );

  server.registerTool(
    "android_get_ui_tree",
    {
      title: "Android UI tree",
      description:
        "Dump the current UI hierarchy as XML (uiautomator dump). Use it to " +
        "find widget bounds before tapping.",
      inputSchema: { ...targetArgs },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        const xml = await getUiTree({ serial: target.serial, env: ctx.env });
        return { data: { ...targetData(target), xml } };
      }),
  );

  server.registerTool(
    "android_logcat",
    {
      title: "Android logcat",
      description:
        "Dump recent device log lines with secrets redacted, or clear the " +
        "log buffer with clear=true.",
      inputSchema: {
        ...targetArgs,
        lines: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of recent lines (default 500)"),
        filter: z
          .string()
          .min(1)
          .optional()
          .describe('Logcat filter spec, e.g. "ActivityManager:I *:S"'),
        clear: z
          .boolean()
          .optional()
          .describe("Clear the log buffer instead of dumping it"),
      },
    },
    (args) =>
      runTool(async () => {
        const target = await resolveAndroidTarget(ctx, args);
        if (args.clear === true) {
          await clearLogcat({ serial: target.serial, env: ctx.env });
          return { data: { ...targetData(target), cleared: true } };
        }
        const output = redactSecrets(
          await logcat({
            serial: target.serial,
            lines: args.lines,
            filter: args.filter,
            env: ctx.env,
          }),
        );
        return { data: { ...targetData(target), output } };
      }),
  );

  server.registerTool(
    "android_run_adb",
    {
      title: "Run adb command",
      description:
        "Run a raw adb command as an argument array. Output is redacted; " +
        "use the picklab CLI for unredacted adb access.",
      inputSchema: {
        ...targetArgs,
        args: z
          .array(z.string())
          .min(1)
          .describe('adb arguments, e.g. ["shell", "pm", "list", "packages"]'),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Command timeout in milliseconds"),
      },
    },
    (args) =>
      runTool(async () => {
        let target: AndroidTarget | undefined;
        if (args.serial !== undefined || args.session !== undefined) {
          target = await resolveAndroidTarget(ctx, args);
        } else {
          target = await resolveAndroidTarget(ctx, args).catch(() => undefined);
        }
        const result = await runAdb({
          args: args.args,
          serial: target?.serial,
          env: ctx.env,
          timeoutMs: args.timeoutMs,
        });
        const data: Record<string, unknown> = {
          ...(target === undefined ? {} : targetData(target)),
          code: result.code,
          stdout: redactSecrets(result.stdout),
          stderr: redactSecrets(result.stderr),
        };
        return {
          data,
          errors: result.ok ? [] : [`adb exited with code ${result.code}`],
        };
      }),
  );
}
