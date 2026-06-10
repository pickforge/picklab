import fs from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createRun,
  getSession,
  listSessions,
  type EnvLike,
  type RunHandle,
  type SessionRecord,
} from "@pickforge/picklab-core";

const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface CreateMcpServerOptions {
  projectDir?: string;
  env?: EnvLike;
}

export interface ServerContext {
  projectDir: string;
  env: EnvLike;
}

export function resolveContext(
  opts: CreateMcpServerOptions = {},
): ServerContext {
  const env = opts.env ?? process.env;
  const projectDir = path.resolve(
    opts.projectDir ?? env.PICKLAB_PROJECT_DIR ?? process.cwd(),
  );
  return { projectDir, env };
}

export interface ToolReport {
  data?: Record<string, unknown>;
  errors?: string[];
  extraContent?: CallToolResult["content"];
}

export function reportResult(report: ToolReport): CallToolResult {
  const errors = report.errors ?? [];
  const body: Record<string, unknown> = { ok: errors.length === 0 };
  for (const [key, value] of Object.entries(report.data ?? {})) {
    if (key !== "ok" && key !== "errors") {
      body[key] = value;
    }
  }
  body.errors = errors;
  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(body, null, 2) },
    ...(report.extraContent ?? []),
  ];
  return errors.length === 0 ? { content } : { content, isError: true };
}

export async function runTool(
  fn: () => Promise<ToolReport>,
): Promise<CallToolResult> {
  try {
    return reportResult(await fn());
  } catch (error) {
    return reportResult({
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }
}

export async function imageContent(
  filePath: string,
): Promise<CallToolResult["content"]> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return [];
  }
  if (stat.size > MAX_INLINE_IMAGE_BYTES) {
    return [];
  }
  const data = await fs.promises.readFile(filePath);
  return [
    { type: "image", data: data.toString("base64"), mimeType: "image/png" },
  ];
}

export type RunnableSessionType = "desktop" | "android";

export async function resolveSessionRecord(
  ctx: ServerContext,
  type: RunnableSessionType,
  id: string | undefined,
): Promise<SessionRecord> {
  if (id !== undefined) {
    const record = await getSession(id, ctx.env);
    if (record === undefined) {
      throw new Error(`Session not found: ${id}`);
    }
    if (record.type !== type) {
      throw new Error(
        `Session ${id} is of type "${record.type}", but this tool needs a ${type} session`,
      );
    }
    return record;
  }
  const candidates = (await listSessions(ctx.env)).filter(
    (record) => record.type === type && record.status === "running",
  );
  if (candidates.length === 0) {
    throw new Error(
      `No running ${type} session found; create one with the session_create ` +
        `tool (type "${type}")`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple running ${type} sessions found ` +
        `(${candidates.map((record) => record.id).join(", ")}); ` +
        `pick one with the "session" argument`,
    );
  }
  return candidates[0] as SessionRecord;
}

export function requireDisplay(record: SessionRecord): string {
  const display = record.desktop?.display;
  if (display === undefined) {
    throw new Error(`Session ${record.id} has no display recorded`);
  }
  return display;
}

export interface ScreenshotTargetArgs {
  out?: string;
  runSlug?: string;
}

export interface ScreenshotTarget {
  outPath: string;
  run?: RunHandle;
}

export async function resolveScreenshotTarget(
  ctx: ServerContext,
  args: ScreenshotTargetArgs,
  defaultSlug: string,
  sessionId?: string,
): Promise<ScreenshotTarget> {
  if (args.out !== undefined && args.runSlug !== undefined) {
    throw new Error('Use either "out" or "runSlug", not both');
  }
  if (args.out !== undefined) {
    return { outPath: path.resolve(ctx.projectDir, args.out) };
  }
  const run = await createRun(
    ctx.projectDir,
    args.runSlug ?? defaultSlug,
    sessionId === undefined ? {} : { sessionId },
  );
  return {
    outPath: path.join(run.dir, "screenshots", "screenshot.png"),
    run,
  };
}

export async function captureToTarget(
  target: ScreenshotTarget,
  capture: () => Promise<void>,
): Promise<Record<string, unknown>> {
  try {
    await capture();
  } catch (error) {
    if (target.run !== undefined) {
      await target.run.finish("failed").catch(() => {});
    }
    throw error;
  }
  const data: Record<string, unknown> = { path: target.outPath };
  if (target.run !== undefined) {
    try {
      await target.run.addArtifact(
        "screenshot",
        path.basename(target.outPath),
        target.outPath,
      );
      await target.run.finish("completed");
    } catch (error) {
      await target.run.finish("failed").catch(() => {});
      throw error;
    }
    data.runId = target.run.runId;
    data.runDir = target.run.dir;
  }
  return data;
}
