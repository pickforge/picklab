import fs from "node:fs";
import path from "node:path";
import { runCommand, type EnvLike } from "@pickforge/picklab-core";
import { parseDisplayNumber } from "./display.js";
import { findOnPath } from "./util.js";

const SCREENSHOT_TIMEOUT_MS = 20_000;

export type ScreenshotTool = "import" | "xwd" | "scrot";

export interface ScreenshotStep {
  cmd: string;
  args: string[];
}

export interface ScreenshotOptions {
  display: string;
  outPath: string;
  tool?: ScreenshotTool;
  env?: EnvLike;
}

export interface ScreenshotResult {
  path: string;
  tool: ScreenshotTool;
}

export function detectScreenshotTool(
  env: EnvLike = process.env,
): ScreenshotTool | null {
  if (findOnPath("import", env) !== null) {
    return "import";
  }
  if (findOnPath("xwd", env) !== null && findOnPath("convert", env) !== null) {
    return "xwd";
  }
  if (findOnPath("scrot", env) !== null) {
    return "scrot";
  }
  return null;
}

export function buildScreenshotCommand(
  tool: ScreenshotTool,
  display: string,
  outPath: string,
): ScreenshotStep[] {
  parseDisplayNumber(display);
  switch (tool) {
    case "import":
      return [
        {
          cmd: "import",
          args: ["-display", display, "-window", "root", outPath],
        },
      ];
    case "xwd": {
      const dumpPath = `${outPath}.xwd`;
      return [
        {
          cmd: "xwd",
          args: ["-root", "-silent", "-display", display, "-out", dumpPath],
        },
        {
          cmd: "convert",
          args: [`xwd:${dumpPath}`, `png:${outPath}`],
        },
      ];
    }
    case "scrot":
      return [{ cmd: "scrot", args: ["--overwrite", outPath] }];
  }
}

export async function screenshot(
  opts: ScreenshotOptions,
): Promise<ScreenshotResult> {
  parseDisplayNumber(opts.display);
  const env = opts.env ?? process.env;
  const tool = opts.tool ?? detectScreenshotTool(env);
  if (tool === null) {
    throw new Error(
      "No screenshot tool found on PATH. Install one of: " +
        "imagemagick (provides `import` and `convert`), " +
        "xorg-xwd (`xwd`, combined with imagemagick `convert`), or scrot.",
    );
  }

  await fs.promises.mkdir(path.dirname(opts.outPath), { recursive: true });
  const steps = buildScreenshotCommand(tool, opts.display, opts.outPath);
  try {
    for (const step of steps) {
      const result = await runCommand(step.cmd, step.args, {
        env: { ...opts.env, DISPLAY: opts.display },
        timeoutMs: SCREENSHOT_TIMEOUT_MS,
      });
      if (!result.ok) {
        const detail = result.stderr.trim() || `exit code ${result.code}`;
        throw new Error(
          `Screenshot command failed (${step.cmd} ${step.args.join(" ")}): ${detail}`,
        );
      }
    }
  } finally {
    if (tool === "xwd") {
      await fs.promises.rm(`${opts.outPath}.xwd`, { force: true });
    }
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(opts.outPath);
  } catch {
    throw new Error(
      `Screenshot command (${tool}) succeeded but produced no file at ${opts.outPath}`,
    );
  }
  if (stat.size === 0) {
    throw new Error(
      `Screenshot command (${tool}) produced an empty file at ${opts.outPath}`,
    );
  }
  return { path: opts.outPath, tool };
}
