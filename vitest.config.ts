import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
  },
});
