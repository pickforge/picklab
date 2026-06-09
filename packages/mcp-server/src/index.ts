import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export const packageName = "@pickforge/picklab-mcp-server";

export function createMcpServer(): McpServer {
  return new McpServer({ name: "picklab", version });
}
