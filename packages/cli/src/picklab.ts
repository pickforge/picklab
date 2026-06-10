#!/usr/bin/env node
import { buildProgram } from "./program.js";

try {
  await buildProgram().parseAsync();
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
}
