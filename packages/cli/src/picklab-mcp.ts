#!/usr/bin/env node
import { runMcpServe } from "./commands/mcp.js";

process.exitCode = await runMcpServe();
