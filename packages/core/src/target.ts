import path from "node:path";
import type { EnvLike } from "./paths.js";
import { createRun, type RunHandle } from "./run.js";
import { getSession, listSessions, type SessionRecord } from "./session.js";

export type RunnableSessionType = "desktop" | "android";

export interface ResolveRunnableSessionOptions {
  env?: EnvLike;
  consumerLabel: string;
  createHint: string;
  selectHint: string;
}

export async function resolveRunnableSession(
  type: RunnableSessionType,
  id: string | undefined,
  opts: ResolveRunnableSessionOptions,
): Promise<SessionRecord> {
  const env = opts.env ?? process.env;
  if (id !== undefined) {
    const record = await getSession(id, env);
    if (record === undefined) {
      throw new Error(`Session not found: ${id}`);
    }
    if (record.type !== type) {
      throw new Error(
        `Session ${id} is of type "${record.type}", but this ${opts.consumerLabel} needs a ${type} session`,
      );
    }
    return record;
  }
  const candidates = (await listSessions(env)).filter(
    (record) => record.type === type && record.status === "running",
  );
  if (candidates.length === 0) {
    throw new Error(`No running ${type} session found; ${opts.createHint}`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple running ${type} sessions found ` +
        `(${candidates.map((record) => record.id).join(", ")}); ` +
        opts.selectHint,
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

export interface ScreenshotTarget {
  outPath: string;
  run?: RunHandle;
}

export interface ResolveScreenshotTargetOptions {
  projectDir: string;
  out?: string;
  outBaseDir?: string;
  runSlug?: string;
  defaultSlug: string;
  sessionId?: string;
  conflictError: string;
}

export async function resolveScreenshotTarget(
  opts: ResolveScreenshotTargetOptions,
): Promise<ScreenshotTarget> {
  if (opts.out !== undefined && opts.runSlug !== undefined) {
    throw new Error(opts.conflictError);
  }
  if (opts.out !== undefined) {
    return {
      outPath:
        opts.outBaseDir === undefined
          ? path.resolve(opts.out)
          : path.resolve(opts.outBaseDir, opts.out),
    };
  }
  const run = await createRun(
    opts.projectDir,
    opts.runSlug ?? opts.defaultSlug,
    opts.sessionId === undefined ? {} : { sessionId: opts.sessionId },
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
