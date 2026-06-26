import fs from "node:fs";
import path from "node:path";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import {
  getSession,
  listRuns,
  listSessions,
  redactSecrets,
  runsDir,
} from "@pickforge/picklab-core";
import type { ServerContext } from "./context.js";
import { isSafeRunId } from "./tools/artifacts.js";
import { sessionStatusEntry } from "./tools/session.js";

const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_BLOB_BYTES = 8 * 1024 * 1024;

function decodeVariable(variables: Variables, label: string): string {
  const raw = variables[label];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error(`Missing "${label}" in resource URI`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid "${label}" in resource URI`);
  }
  if (
    !SAFE_NAME_PATTERN.test(decoded) ||
    decoded === "." ||
    decoded.includes("..")
  ) {
    throw new Error(`Invalid "${label}" in resource URI: ${decoded}`);
  }
  return decoded;
}

function runFilePath(
  ctx: ServerContext,
  runId: string,
  subdir: "screenshots" | "logs",
  name: string,
): string {
  const base = path.join(runsDir(ctx.projectDir), runId, subdir);
  const resolved = path.resolve(base, name);
  if (resolved !== path.join(base, name)) {
    throw new Error(`Invalid resource path: ${name}`);
  }
  return resolved;
}

// Reject a run directory that is itself a symlink (or otherwise resolves
// outside the runs root). Returns true when the run dir is safe, false when it
// is missing or escapes the runs root via symlinks.
async function isRunDirSafe(
  ctx: ServerContext,
  runId: string,
): Promise<boolean> {
  const root = runsDir(ctx.projectDir);
  const runDir = path.join(root, runId);
  try {
    // The real runs root must be exactly `.picklab/runs` under the real
    // project dir. This rejects a symlinked `.picklab` or `.picklab/runs`
    // ancestor that would redirect reads to outside runs (core listRuns
    // applies the same confinement), while allowing the project dir itself to
    // be a symlink.
    const realProject = await fs.promises.realpath(ctx.projectDir);
    const realRoot = await fs.promises.realpath(root);
    if (realRoot !== path.join(realProject, ".picklab", "runs")) {
      return false;
    }
    const realRunDir = await fs.promises.realpath(runDir);
    return realRunDir === path.join(realRoot, runId);
  } catch {
    return false;
  }
}

// Reject paths whose real location escapes the run subdir via symlinks. When
// the file (or subdir) does not exist, return so the caller's read produces its
// usual not-found error.
async function assertWithinSubdir(
  ctx: ServerContext,
  runId: string,
  subdir: "screenshots" | "logs",
  filePath: string,
  notFound: () => Error,
): Promise<void> {
  if (!(await isRunDirSafe(ctx, runId))) {
    throw notFound();
  }
  // Reject a symlinked artifact file even when its target stays inside the run
  // subdir; direct log/screenshot reads must not follow symlinks.
  try {
    const lst = await fs.promises.lstat(filePath);
    if (lst.isSymbolicLink()) {
      throw notFound();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === undefined) {
      throw err;
    }
    return;
  }
  const runDir = path.join(runsDir(ctx.projectDir), runId);
  const base = path.join(runDir, subdir);
  let realRunDir: string;
  let realBase: string;
  let realFile: string;
  try {
    realRunDir = await fs.promises.realpath(runDir);
    realBase = await fs.promises.realpath(base);
    realFile = await fs.promises.realpath(filePath);
  } catch {
    return;
  }
  // The subdir itself must resolve to a real location inside the run dir, so a
  // symlinked logs/screenshots directory cannot redirect reads outside.
  const expectedBase = path.join(realRunDir, subdir);
  if (realBase !== expectedBase) {
    throw notFound();
  }
  if (realFile !== realBase && !realFile.startsWith(realBase + path.sep)) {
    throw notFound();
  }
}

// Reject a manifest whose real location escapes the run dir via symlinks. When
// the file (or run dir) does not exist, return so the caller's read produces
// its usual not-found error.
async function assertManifestWithinRun(
  ctx: ServerContext,
  runId: string,
  manifestPath: string,
  notFound: () => Error,
): Promise<void> {
  if (!(await isRunDirSafe(ctx, runId))) {
    throw notFound();
  }
  const runDir = path.join(runsDir(ctx.projectDir), runId);
  let realRunDir: string;
  let realFile: string;
  try {
    realRunDir = await fs.promises.realpath(runDir);
    realFile = await fs.promises.realpath(manifestPath);
  } catch {
    return;
  }
  if (realFile !== path.join(realRunDir, "manifest.json")) {
    throw notFound();
  }
}

// Return true when a run's manifest.json passes the same realpath confinement
// as direct manifest reads (run dir not a symlink, manifest not a symlink
// escaping the run dir). Runs that fail this are excluded from listings so a
// symlinked manifest cannot leak data via resource enumeration.
async function isManifestSafe(
  ctx: ServerContext,
  runId: string,
): Promise<boolean> {
  if (!(await isRunDirSafe(ctx, runId))) return false;
  const runDir = path.join(runsDir(ctx.projectDir), runId);
  const manifestPath = path.join(runDir, "manifest.json");
  try {
    const realRunDir = await fs.promises.realpath(runDir);
    const realFile = await fs.promises.realpath(manifestPath);
    return realFile === path.join(realRunDir, "manifest.json");
  } catch {
    return false;
  }
}

// List runs whose run id is safe and whose manifest passes realpath
// confinement, so symlinked manifests are never exposed via listings.
async function listSafeRuns(
  ctx: ServerContext,
): Promise<Awaited<ReturnType<typeof listRuns>>> {
  const safe: Awaited<ReturnType<typeof listRuns>> = [];
  for (const manifest of await listRuns(ctx.projectDir)) {
    if (!isSafeRunId(manifest.runId)) continue;
    if (!(await isManifestSafe(ctx, manifest.runId))) continue;
    safe.push(manifest);
  }
  return safe;
}

async function listRunFiles(
  ctx: ServerContext,
  subdir: "screenshots" | "logs",
): Promise<Array<{ runId: string; name: string }>> {
  const entries: Array<{ runId: string; name: string }> = [];
  for (const manifest of await listSafeRuns(ctx)) {
    const runDir = path.join(runsDir(ctx.projectDir), manifest.runId);
    const dir = path.join(runDir, subdir);
    try {
      const realRunDir = await fs.promises.realpath(runDir);
      const realDir = await fs.promises.realpath(dir);
      // Skip a symlinked subdir that resolves outside the run dir.
      if (realDir !== path.join(realRunDir, subdir)) continue;
    } catch {
      continue;
    }
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SAFE_NAME_PATTERN.test(name) || name.includes("..")) continue;
      let entry: fs.Stats;
      try {
        entry = await fs.promises.lstat(path.join(dir, name));
      } catch {
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      entries.push({ runId: manifest.runId, name });
    }
  }
  return entries;
}

export function registerResources(server: McpServer, ctx: ServerContext): void {
  server.registerResource(
    "runs",
    "picklab://runs",
    {
      title: "PickLab runs",
      description: "Index of recorded runs under .picklab/runs",
      mimeType: "application/json",
    },
    async (uri) => {
      const runs = (await listSafeRuns(ctx)).map((manifest) => ({
        runId: manifest.runId,
        slug: manifest.slug,
        createdAt: manifest.createdAt,
        status: manifest.status,
        artifacts: manifest.artifacts.length,
      }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(runs, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "run-manifest",
    new ResourceTemplate("picklab://runs/{runId}/manifest", {
      list: async () => ({
        resources: (await listSafeRuns(ctx)).map((manifest) => ({
            uri: `picklab://runs/${manifest.runId}/manifest`,
            name: `Run ${manifest.runId} manifest`,
            mimeType: "application/json",
          })),
      }),
    }),
    {
      title: "Run manifest",
      description: "Manifest (status and artifacts) of a recorded run",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const runId = decodeVariable(variables, "runId");
      const manifestPath = path.join(
        runsDir(ctx.projectDir),
        runId,
        "manifest.json",
      );
      await assertManifestWithinRun(
        ctx,
        runId,
        manifestPath,
        () => new Error(`Run not found: ${runId}`),
      );
      let raw: string;
      try {
        raw = await fs.promises.readFile(manifestPath, "utf8");
      } catch {
        throw new Error(`Run not found: ${runId}`);
      }
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: raw },
        ],
      };
    },
  );

  server.registerResource(
    "run-screenshot",
    new ResourceTemplate("picklab://runs/{runId}/screenshots/{name}", {
      list: async () => ({
        resources: (await listRunFiles(ctx, "screenshots")).map((entry) => ({
          uri: `picklab://runs/${entry.runId}/screenshots/${entry.name}`,
          name: `Run ${entry.runId} screenshot ${entry.name}`,
          mimeType: "image/png",
        })),
      }),
    }),
    {
      title: "Run screenshot",
      description: "PNG screenshot captured during a run",
      mimeType: "image/png",
    },
    async (uri, variables) => {
      const runId = decodeVariable(variables, "runId");
      const name = decodeVariable(variables, "name");
      if (!name.endsWith(".png")) {
        throw new Error(`Not a PNG screenshot: ${name}`);
      }
      const filePath = runFilePath(ctx, runId, "screenshots", name);
      await assertWithinSubdir(
        ctx,
        runId,
        "screenshots",
        filePath,
        () => new Error(`Screenshot not found: ${runId}/${name}`),
      );
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        throw new Error(`Screenshot not found: ${runId}/${name}`);
      }
      if (stat.size > MAX_BLOB_BYTES) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text:
                `Screenshot ${runId}/${name} is ${stat.size} bytes, over ` +
                `the ${MAX_BLOB_BYTES} byte inline limit; read the file ` +
                `directly at ${filePath}`,
            },
          ],
        };
      }
      let data: Buffer;
      try {
        data = await fs.promises.readFile(filePath);
      } catch {
        throw new Error(`Screenshot not found: ${runId}/${name}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "image/png",
            blob: data.toString("base64"),
          },
        ],
      };
    },
  );

  server.registerResource(
    "run-log",
    new ResourceTemplate("picklab://runs/{runId}/logs/{name}", {
      list: async () => ({
        resources: (await listRunFiles(ctx, "logs")).map((entry) => ({
          uri: `picklab://runs/${entry.runId}/logs/${entry.name}`,
          name: `Run ${entry.runId} log ${entry.name}`,
          mimeType: "text/plain",
        })),
      }),
    }),
    {
      title: "Run log",
      description: "Log captured during a run (secrets redacted)",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const runId = decodeVariable(variables, "runId");
      const name = decodeVariable(variables, "name");
      const filePath = runFilePath(ctx, runId, "logs", name);
      await assertWithinSubdir(
        ctx,
        runId,
        "logs",
        filePath,
        () => new Error(`Log not found: ${runId}/${name}`),
      );
      let raw: string;
      try {
        raw = await fs.promises.readFile(filePath, "utf8");
      } catch {
        throw new Error(`Log not found: ${runId}/${name}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: redactSecrets(raw),
          },
        ],
      };
    },
  );

  server.registerResource(
    "session-status",
    new ResourceTemplate("picklab://sessions/{sessionId}/status", {
      list: async () => ({
        resources: (await listSessions(ctx.env)).map((record) => ({
          uri: `picklab://sessions/${record.id}/status`,
          name: `Session ${record.id} status`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Session status",
      description: "Liveness and details of a lab session",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const sessionId = decodeVariable(variables, "sessionId");
      const record = await getSession(sessionId, ctx.env);
      if (record === undefined) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const entry = await sessionStatusEntry(ctx, record);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(entry, null, 2),
          },
        ],
      };
    },
  );
}
