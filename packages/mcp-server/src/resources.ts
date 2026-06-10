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

async function listRunFiles(
  ctx: ServerContext,
  subdir: "screenshots" | "logs",
): Promise<Array<{ runId: string; name: string }>> {
  const entries: Array<{ runId: string; name: string }> = [];
  for (const manifest of await listRuns(ctx.projectDir)) {
    if (!isSafeRunId(manifest.runId)) continue;
    const dir = path.join(runsDir(ctx.projectDir), manifest.runId, subdir);
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (SAFE_NAME_PATTERN.test(name) && !name.includes("..")) {
        entries.push({ runId: manifest.runId, name });
      }
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
      const runs = (await listRuns(ctx.projectDir)).map((manifest) => ({
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
        resources: (await listRuns(ctx.projectDir))
          .filter((manifest) => isSafeRunId(manifest.runId))
          .map((manifest) => ({
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
