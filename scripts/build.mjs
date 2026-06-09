import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const order = [
  "core",
  "desktop-linux",
  "android",
  "agent-installers",
  "mcp-server",
  "cli",
];

for (const dir of order) {
  const cwd = fileURLToPath(new URL(`../packages/${dir}`, import.meta.url));
  const result = spawnSync("npm", ["run", "build"], { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
