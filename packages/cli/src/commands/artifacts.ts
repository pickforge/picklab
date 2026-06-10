import { spawn } from "node:child_process";
import path from "node:path";
import { listRuns, runsDir, type RunManifest } from "@pickforge/picklab-core";
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

async function findRun(
  projectDir: string,
  runId: string | undefined,
): Promise<{ manifest: RunManifest; dir: string }> {
  const manifests = await listRuns(projectDir);
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

export function renderRunReport(manifest: RunManifest, dir: string): string[] {
  const lines = [
    `# PickLab run ${manifest.runId}`,
    "",
    `- Slug: ${manifest.slug}`,
    `- Status: ${manifest.status}`,
    `- Created: ${manifest.createdAt}`,
  ];
  if (manifest.sessionId !== undefined) {
    lines.push(`- Session: ${manifest.sessionId}`);
  }
  lines.push(
    `- Directory: ${dir}`,
    "",
    `## Artifacts (${manifest.artifacts.length})`,
    "",
  );
  if (manifest.artifacts.length === 0) {
    lines.push("(none)");
  }
  for (const artifact of manifest.artifacts) {
    lines.push(
      `- [${artifact.type}] ${artifact.name} — ${artifact.path} (${artifact.createdAt})`,
    );
  }
  return lines;
}

export async function runArtifactsReport(
  runId: string | undefined,
  opts: BaseCliOptions,
): Promise<number> {
  return runReported(opts, async () => {
    const projectDir = resolveProjectDir(opts);
    const { manifest, dir } = await findRun(projectDir, runId);
    return {
      data: { runId: manifest.runId, dir, manifest },
      lines: renderRunReport(manifest, dir),
    };
  });
}
