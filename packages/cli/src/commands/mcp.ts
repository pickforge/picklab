import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "@pickforge/picklab-mcp-server";

export async function runMcpServe(): Promise<number> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("picklab mcp server: listening on stdio");
  return new Promise<number>((resolve) => {
    server.server.onclose = () => {
      resolve(0);
    };
  });
}
