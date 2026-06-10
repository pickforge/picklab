import path from "node:path";
import {
  createRun,
  getSession,
  listSessions,
  type EnvLike,
  type RunHandle,
  type SessionRecord,
} from "@pickforge/picklab-core";

export interface BaseCliOptions {
  json?: boolean;
  projectDir?: string;
}

export interface CommandResult {
  data?: Record<string, unknown>;
  lines?: string[];
  errors?: string[];
}

export function resolveProjectDir(opts: { projectDir?: string }): string {
  return path.resolve(opts.projectDir ?? process.cwd());
}

export function parseIntArg(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Invalid ${label} "${value}": expected a non-negative integer`,
    );
  }
  return Number(value);
}

export async function runReported(
  opts: { json?: boolean },
  fn: () => Promise<CommandResult>,
): Promise<number> {
  let result: CommandResult;
  try {
    result = await fn();
  } catch (error) {
    result = {
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const errors = result.errors ?? [];
  const report: Record<string, unknown> = { ok: errors.length === 0 };
  for (const [key, value] of Object.entries(result.data ?? {})) {
    if (key !== "ok" && key !== "errors") {
      report[key] = value;
    }
  }
  report.errors = errors;
  if (opts.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const line of result.lines ?? []) {
      console.log(line);
    }
    for (const error of errors) {
      console.error(`error: ${error}`);
    }
  }
  return errors.length === 0 ? 0 : 1;
}

export type RunnableSessionType = "desktop" | "android";

export async function resolveSessionRecord(
  type: RunnableSessionType,
  id: string | undefined,
  env: EnvLike = process.env,
): Promise<SessionRecord> {
  if (id !== undefined) {
    const record = await getSession(id, env);
    if (record === undefined) {
      throw new Error(`Session not found: ${id}`);
    }
    if (record.type !== type) {
      throw new Error(
        `Session ${id} is of type "${record.type}", but this command needs a ${type} session`,
      );
    }
    return record;
  }
  const candidates = (await listSessions(env)).filter(
    (record) => record.type === type && record.status === "running",
  );
  if (candidates.length === 0) {
    throw new Error(
      `No running ${type} session found; create one with: ` +
        `picklab session create --type ${type}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple running ${type} sessions found ` +
        `(${candidates.map((record) => record.id).join(", ")}); ` +
        `pick one with --session <id>`,
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

export interface ScreenshotTargetOptions extends BaseCliOptions {
  out?: string;
  run?: string;
}

export interface ScreenshotTarget {
  outPath: string;
  run?: RunHandle;
}

export async function resolveScreenshotTarget(
  opts: ScreenshotTargetOptions,
  defaultSlug: string,
  sessionId?: string,
): Promise<ScreenshotTarget> {
  if (opts.out !== undefined && opts.run !== undefined) {
    throw new Error("use either --out or --run, not both");
  }
  if (opts.out !== undefined) {
    return { outPath: path.resolve(opts.out) };
  }
  const run = await createRun(
    resolveProjectDir(opts),
    opts.run ?? defaultSlug,
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
