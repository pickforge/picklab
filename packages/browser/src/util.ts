export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
