const SUPERVISOR_SCRIPT = String.raw`
import * as fs from "node:fs";
import { spawn } from "node:child_process";
const [binary, ...args] = process.argv.slice(1);
if (!binary) process.exit(127);

function hasLiveGroupMembers() {
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let content;
    try {
      content = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    } catch {
      continue;
    }
    const close = content.lastIndexOf(")");
    if (close === -1) continue;
    const fields = content.slice(close + 1).trim().split(/\s+/);
    const state = fields[0];
    const pgrp = Number(fields[2]);
    if (state !== "Z" && pgrp === process.pid) return true;
  }
  return false;
}

let childExited = false;
let childCode = 1;
const child = spawn(binary, args, {
  env: process.env,
  shell: false,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error("Failed to launch browser:", error.message);
  childExited = true;
  childCode = 127;
});
child.once("exit", (code) => {
  childExited = true;
  childCode = code == null ? 1 : code;
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {});
}
const timer = setInterval(() => {
  if (childExited && !hasLiveGroupMembers()) {
    clearInterval(timer);
    process.exit(childCode);
  }
}, 50);
`;

export interface SupervisedBrowserCommand {
  command: string;
  args: string[];
}

export function buildSupervisedBrowserCommand(
  nodePath: string,
  binaryPath: string,
  browserArgs: string[],
): SupervisedBrowserCommand {
  if (nodePath === "") {
    throw new Error("Browser supervisor requires a Node.js executable path");
  }
  if (binaryPath === "") {
    throw new Error("Browser supervisor requires a browser binary path");
  }
  return {
    command: nodePath,
    args: [
      "--input-type=module",
      "-e",
      SUPERVISOR_SCRIPT,
      binaryPath,
      ...browserArgs,
    ],
  };
}
