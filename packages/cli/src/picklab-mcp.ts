#!/usr/bin/env node
import { runMcpServe } from "./commands/mcp.js";
import { captureFatal, initTelemetry } from "./telemetry.js";

initTelemetry();

try {
  process.exitCode = await runMcpServe();
} catch (error) {
  await captureFatal(error);
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
