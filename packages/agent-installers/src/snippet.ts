import fs from "node:fs";
import path from "node:path";
import { agentsDir, ensureDir, type EnvLike } from "@pickforge/picklab-core";
import type { McpServerEntry } from "./types.js";

export const MCP_SERVER_NAME = "picklab";

export const SHARED_SNIPPET_BASENAMES = [
  "picklab-mcp.json",
  "picklab-mcp.toml",
] as const;

export function mcpServerEntry(): McpServerEntry {
  return { command: "picklab", args: ["mcp", "serve"] };
}

export function renderJsonSnippet(
  entry: McpServerEntry = mcpServerEntry(),
): string {
  const snippet = {
    mcpServers: {
      [MCP_SERVER_NAME]: { command: entry.command, args: entry.args },
    },
  };
  return `${JSON.stringify(snippet, null, 2)}\n`;
}

export function renderTomlSnippet(
  entry: McpServerEntry = mcpServerEntry(),
): string {
  const args = entry.args.map((arg) => JSON.stringify(arg)).join(", ");
  return (
    `[mcp_servers.${MCP_SERVER_NAME}]\n` +
    `command = ${JSON.stringify(entry.command)}\n` +
    `args = [${args}]\n`
  );
}

export interface SharedSnippets {
  jsonPath: string;
  tomlPath: string;
}

export async function writeSharedSnippets(
  env: EnvLike = process.env,
): Promise<SharedSnippets> {
  const dir = await ensureDir(agentsDir(env));
  const jsonPath = path.join(dir, SHARED_SNIPPET_BASENAMES[0]);
  const tomlPath = path.join(dir, SHARED_SNIPPET_BASENAMES[1]);
  await fs.promises.writeFile(jsonPath, renderJsonSnippet(), "utf8");
  await fs.promises.writeFile(tomlPath, renderTomlSnippet(), "utf8");
  return { jsonPath, tomlPath };
}
