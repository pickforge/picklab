import { setTimeout as delay } from "node:timers/promises";

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal });
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
