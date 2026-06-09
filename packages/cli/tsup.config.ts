import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/picklab.ts", "src/picklab-mcp.ts"],
  format: ["esm"],
  platform: "node",
  clean: true,
  noExternal: [/^@pickforge\//],
});
