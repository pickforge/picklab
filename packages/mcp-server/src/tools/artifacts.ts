import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listRuns, runsDir, type RunManifest } from "@pickforge/picklab-core";
import { runTool, type ServerContext } from "../context.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isSafeRunId(runId: string): boolean {
  return (
    RUN_ID_PATTERN.test(runId) &&
    runId !== "." &&
    runId !== ".." &&
    !runId.includes("..")
  );
}

export async function findRun(
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
      throw new Error(
        `Run not found: ${runId} (see the artifact_list tool)`,
      );
    }
  }
  return { manifest, dir: path.join(runsDir(projectDir), manifest.runId) };
}

function renderRunReport(manifest: RunManifest, dir: string): string {
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
  return lines.join("\n");
}

export function registerArtifactTools(
  server: McpServer,
  ctx: ServerContext,
): void {
  server.registerTool(
    "artifact_list",
    {
      title: "List runs",
      description:
        "List recorded runs (screenshots, logs, reports) under " +
        ".picklab/runs in the project directory.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const manifests = await listRuns(ctx.projectDir);
        const runs = manifests.map((manifest) => ({
          runId: manifest.runId,
          slug: manifest.slug,
          createdAt: manifest.createdAt,
          status: manifest.status,
          artifacts: manifest.artifacts.length,
        }));
        return { data: { projectDir: ctx.projectDir, runs } };
      }),
  );

  server.registerTool(
    "artifact_report",
    {
      title: "Run report",
      description:
        "Render a report for one run (default: the most recent run), " +
        "including its artifact inventory.",
      inputSchema: {
        runId: z.string().min(1).optional().describe("Run id"),
      },
    },
    (args) =>
      runTool(async () => {
        const { manifest, dir } = await findRun(ctx.projectDir, args.runId);
        return {
          data: {
            runId: manifest.runId,
            dir,
            manifest,
            report: renderRunReport(manifest, dir),
          },
        };
      }),
  );
}
