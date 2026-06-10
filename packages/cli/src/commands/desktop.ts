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
  parseIntArg,
  requireDisplay,
  resolveScreenshotTarget,
  resolveSessionRecord,
  runReported,
  type BaseCliOptions,
  type ScreenshotTargetOptions,
} from "./shared.js";

export interface DesktopCommandOptions extends BaseCliOptions {
  session?: string;
}

async function resolveDesktop(
  opts: DesktopCommandOptions,
): Promise<{ id: string; display: string }> {
  const record = await resolveSessionRecord("desktop", opts);
  return { id: record.id, display: requireDisplay(record) };
}

export interface DesktopLaunchOptions extends DesktopCommandOptions {
  cwd?: string;
  waitWindow?: string;
}

export async function runDesktopLaunch(
  command: string,
  args: string[],
  opts: DesktopLaunchOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const { id, display } = await resolveDesktop(opts);
    const app = await launchApp({
      display,
      command,
      args,
      logDir: desktopSessionLogDir(id),
      cwd: opts.cwd,
    });
    const data: Record<string, unknown> = {
      sessionId: id,
      display,
      pid: app.pid,
      logPath: app.logPath,
    };
    const lines = [
      `launched ${command} (pid ${app.pid}) on ${display}`,
      `log: ${app.logPath}`,
    ];
    if (opts.waitWindow !== undefined) {
      const window = await waitForWindow(display, opts.waitWindow);
      data.window = window;
      lines.push(`window appeared: ${JSON.stringify(window.name)} (id ${window.id})`);
    }
    return { data, lines };
  });
}

export interface DesktopScreenshotOptions
  extends DesktopCommandOptions,
    ScreenshotTargetOptions {}

export async function runDesktopScreenshot(
  opts: DesktopScreenshotOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const { id, display } = await resolveDesktop(opts);
    const target = await resolveScreenshotTarget(opts, "desktop", id);
    let tool: string | undefined;
    const data = await captureToTarget(target, async () => {
      const result = await screenshot({ display, outPath: target.outPath });
      tool = result.tool;
    });
    data.sessionId = id;
    data.display = display;
    data.tool = tool;
    const lines = [`screenshot saved to ${target.outPath}`];
    if (data.runId !== undefined) {
      lines.push(`run: ${data.runId}`);
    }
    return { data, lines };
  });
}

export interface DesktopClickOptions extends DesktopCommandOptions {
  button?: string;
}

export async function runDesktopClick(
  x: string,
  y: string,
  opts: DesktopClickOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const parsedX = parseIntArg(x, "x");
    const parsedY = parseIntArg(y, "y");
    const button =
      opts.button === undefined
        ? undefined
        : parseIntArg(opts.button, "--button");
    if (button !== undefined && (button < 1 || button > 9)) {
      throw new Error(
        `Invalid --button "${opts.button}": expected an integer between 1 and 9`,
      );
    }
    const { id, display } = await resolveDesktop(opts);
    await click({ display, x: parsedX, y: parsedY, button });
    return {
      data: { sessionId: id, display, x: parsedX, y: parsedY, button: button ?? 1 },
      lines: [`clicked (${parsedX}, ${parsedY}) on ${display}`],
    };
  });
}

export async function runDesktopType(
  text: string,
  opts: DesktopCommandOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const { id, display } = await resolveDesktop(opts);
    await typeText({ display, text });
    return {
      data: { sessionId: id, display, length: text.length },
      lines: [`typed ${text.length} character(s) on ${display}`],
    };
  });
}

export async function runDesktopKey(
  key: string,
  opts: DesktopCommandOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const { id, display } = await resolveDesktop(opts);
    await pressKey({ display, key });
    return {
      data: { sessionId: id, display, key },
      lines: [`pressed ${key} on ${display}`],
    };
  });
}
