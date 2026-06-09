import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const packageName = "@pickforge/picklab-mcp-server";

export function createMcpServer(): McpServer {
  return new McpServer({ name: "picklab", version: "0.1.0" });
}
