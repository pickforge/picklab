import { createMcpServer } from "@pickforge/picklab-mcp-server";

export async function runMcpServe(): Promise<number> {
  createMcpServer();
  console.error(
    "picklab mcp serve: the MCP transport is not yet implemented; " +
      "this command will start a stdio server in an upcoming release",
  );
  return 1;
}
