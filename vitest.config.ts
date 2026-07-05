import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const runLiveAndroid = process.env.PICKLAB_LIVE_ANDROID === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@pickforge/picklab-core": fileURLToPath(
        new URL("packages/core/src/index.ts", import.meta.url),
      ),
      "@pickforge/picklab-desktop-linux": fileURLToPath(
        new URL("packages/desktop-linux/src/index.ts", import.meta.url),
      ),
      "@pickforge/picklab-android": fileURLToPath(
        new URL("packages/android/src/index.ts", import.meta.url),
      ),
      "@pickforge/picklab-agent-installers": fileURLToPath(
        new URL("packages/agent-installers/src/index.ts", import.meta.url),
      ),
      "@pickforge/picklab-mcp-server": fileURLToPath(
        new URL("packages/mcp-server/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    exclude: runLiveAndroid ? [] : ["packages/android/test/integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/test/**/*.test.ts"],
      thresholds: {
        branches: 85,
        functions: 79,
        lines: 73,
        statements: 73,
      },
    },
  },
});
