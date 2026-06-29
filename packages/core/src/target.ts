import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { EnvLike } from "./paths.js";
import { createRun, type RunHandle } from "./run.js";
import { getSession, listSessions, type SessionRecord } from "./session.js";

export type RunnableSessionType = "desktop" | "android";

export interface ResolveRunnableSessionOptions {
  env?: EnvLike;
  projectDir?: string;
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
  let candidates = (await listSessions(env)).filter(
    (record) => record.type === type && record.status === "running",
  );
  let scopeLabel = "found";
  if (opts.projectDir !== undefined) {
    const projectDir = path.resolve(opts.projectDir);
    candidates = candidates.filter(
      (record) => record.projectDir === projectDir,
    );
    scopeLabel = "for this project";
  }
  if (candidates.length === 0) {
    throw new Error(
      `No running ${type} session ${scopeLabel}; ${opts.createHint}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple running ${type} sessions ${scopeLabel} ` +
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

async function realpathNearest(target: string): Promise<string> {
  let probe = target;
  while (true) {
    try {
      const real = await realpath(probe);
      if (probe === target) {
        return real;
      }
      return path.join(real, path.relative(probe, target));
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        return target;
      }
      probe = parent;
    }
  }
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
    if (opts.outBaseDir === undefined) {
      return { outPath: path.resolve(opts.out) };
    }
    const base = path.resolve(opts.outBaseDir);
    const outPath = path.resolve(base, opts.out);
    const relative = path.relative(base, outPath);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Refusing to write screenshot outside the project directory: ${opts.out}`,
      );
    }
    // Reject a dangling final symlink: realpathNearest cannot resolve a
    // symlink whose target does not exist, so check lstat directly. A symlink
    // here would be followed by the subsequent write, creating a file outside
    // the base dir.
    try {
      const outStat = await lstat(outPath);
      if (outStat.isSymbolicLink()) {
        throw new Error(
          `Refusing to write screenshot outside the project directory: ${opts.out}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const realBase = await realpathNearest(base);
    const realProbe = await realpathNearest(outPath);
    const realRelative = path.relative(realBase, realProbe);
    if (
      realProbe !== realBase &&
      (realRelative.startsWith("..") || path.isAbsolute(realRelative))
    ) {
      throw new Error(
        `Refusing to write screenshot outside the project directory: ${opts.out}`,
      );
    }
    return { outPath };
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
