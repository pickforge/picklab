import { runCommand } from "@pickforge/picklab-core";
import { parseDisplayNumber } from "./display.js";

const TYPE_DELAY_MS = 50;
const INPUT_TIMEOUT_MS = 10_000;
const TYPE_TIMEOUT_MS = 60_000;

export interface ClickArgsOptions {
  x: number;
  y: number;
  button?: number;
}

export interface ClickOptions extends ClickArgsOptions {
  display: string;
}

export interface TypeTextOptions {
  display: string;
  text: string;
}

export interface PressKeyOptions {
  display: string;
  key: string;
}

function assertCoordinate(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid ${label} coordinate ${value}: expected a non-negative integer`,
    );
  }
}

export function buildClickArgs(opts: ClickArgsOptions): string[] {
  assertCoordinate(opts.x, "x");
  assertCoordinate(opts.y, "y");
  const button = opts.button ?? 1;
  if (!Number.isInteger(button) || button < 1 || button > 9) {
    throw new Error(`Invalid button ${button}: expected an integer in 1-9`);
  }
  return [
    "mousemove",
    "--sync",
    String(opts.x),
    String(opts.y),
    "click",
    String(button),
  ];
}

export function buildTypeArgs(text: string): string[] {
  if (text === "") {
    throw new Error("Invalid text: expected a non-empty string");
  }
  return ["type", "--delay", String(TYPE_DELAY_MS), "--", text];
}

export function buildKeyArgs(key: string): string[] {
  if (key === "") {
    throw new Error("Invalid key: expected a non-empty string");
  }
  return ["key", "--", key];
}

async function runXdotool(
  display: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  parseDisplayNumber(display);
  await runCommand("xdotool", args, {
    env: { DISPLAY: display },
    timeoutMs,
    check: true,
  });
}

export async function click(opts: ClickOptions): Promise<void> {
  await runXdotool(
    opts.display,
    buildClickArgs({ x: opts.x, y: opts.y, button: opts.button }),
    INPUT_TIMEOUT_MS,
  );
}

export async function typeText(opts: TypeTextOptions): Promise<void> {
  await runXdotool(opts.display, buildTypeArgs(opts.text), TYPE_TIMEOUT_MS);
}

export async function pressKey(opts: PressKeyOptions): Promise<void> {
  await runXdotool(opts.display, buildKeyArgs(opts.key), INPUT_TIMEOUT_MS);
}
