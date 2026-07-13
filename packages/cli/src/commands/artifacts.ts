import { spawn } from "node:child_process";
import path from "node:path";
import {
  isEvidenceRun,
  listRuns,
  readActions,
  renderRunReport,
  runsDir,
  type RunManifest,
} from "@pickforge/picklab-core";
import { findOnPath } from "@pickforge/picklab-desktop-linux";
import {
  resolveProjectDir,
  runReported,
  type BaseCliOptions,
} from "./shared.js";

export async function runArtifactsList(opts: BaseCliOptions): Promise<number> {
  return runReported(opts, async () => {
    const projectDir = resolveProjectDir(opts);
    const manifests = await listRuns(projectDir);
    const runs = manifests.map((manifest) => ({
      runId: manifest.runId,
      slug: manifest.slug,
      createdAt: manifest.createdAt,
      status: manifest.status,
      artifacts: manifest.artifacts.length,
    }));
    return {
      data: { projectDir, runs },
      lines:
        runs.length === 0
          ? [`no runs found under ${runsDir(projectDir)}`]
          : runs.map(
              (run) =>
                `${run.runId}  ${run.status}  ${run.artifacts} artifact(s)`,
            ),
    };
  });
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId) && runId !== "." && runId !== "..";
}

async function findRun(
  projectDir: string,
  runId: string | undefined,
): Promise<{ manifest: RunManifest; dir: string }> {
  const manifests = (await listRuns(projectDir)).filter((candidate) =>
    isSafeRunId(candidate.runId),
  );
  let manifest: RunManifest | undefined;
  if (runId === undefined) {
    manifest = manifests[0];
    if (manifest === undefined) {
      throw new Error(`No runs found under ${runsDir(projectDir)}`);
    }
  } else {
    manifest = manifests.find((candidate) => candidate.runId === runId);
    if (manifest === undefined) {
      throw new Error(`Run not found: ${runId} (see: picklab artifacts list)`);
    }
  }
  return { manifest, dir: path.join(runsDir(projectDir), manifest.runId) };
}

export async function runArtifactsOpen(
  runId: string,
  opts: BaseCliOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const projectDir = resolveProjectDir(opts);
    const { manifest, dir } = await findRun(projectDir, runId);
    let opened = false;
    const display = process.env.DISPLAY;
    if (opts.json !== true && display !== undefined && display !== "") {
      const xdgOpen = findOnPath("xdg-open");
      if (xdgOpen !== null) {
        const child = spawn(xdgOpen, [dir], {
          detached: true,
          stdio: "ignore",
        });
        child.on("error", () => {});
        child.unref();
        opened = true;
      }
    }
    return {
      data: { runId: manifest.runId, dir, opened },
      lines: [dir],
    };
  });
}

export async function runArtifactsReport(
  runId: string | undefined,
  opts: BaseCliOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const projectDir = resolveProjectDir(opts);
    const { manifest, dir } = await findRun(projectDir, runId);
    const records = isEvidenceRun(manifest) ? await readActions(dir) : [];
    return {
      data: { runId: manifest.runId, dir, manifest },
      lines: renderRunReport(manifest, dir, records),
    };
  });
}
