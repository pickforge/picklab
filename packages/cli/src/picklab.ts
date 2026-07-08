#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { captureFatal, initTelemetry } from "./telemetry.js";

initTelemetry();

try {
  await buildProgram().parseAsync();
} catch (error) {
  await captureFatal(error);
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
