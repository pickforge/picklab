import { describe, expect, it, vi } from "vitest";
import { runBrowserDevtoolsMcp } from "../src/commands/browser.js";

describe("runBrowserDevtoolsMcp exit propagation", () => {
  it("returns 137 instead of self-SIGKILL after EOF-hung cleanup", async () => {
    const signalCurrentProcess = vi.fn();
    const code = await runBrowserDevtoolsMcp(
      { projectDir: "/project" },
      {
        runRelay: async () => ({ code: null, signal: "SIGKILL" }),
        signalCurrentProcess,
      },
    );
    expect(code).toBe(137);
    expect(signalCurrentProcess).not.toHaveBeenCalled();
  });

  it("returns 137 instead of self-SIGKILL after signal escalation", async () => {
    const signalCurrentProcess = vi.fn();
    const code = await runBrowserDevtoolsMcp(
      { projectDir: "/project" },
      {
        runRelay: async () => ({ code: null, signal: "SIGKILL" }),
        signalCurrentProcess,
      },
    );
    expect(code).toBe(137);
    expect(signalCurrentProcess).not.toHaveBeenCalled();
  });

  it("continues propagating non-SIGKILL upstream signals", async () => {
    const signalCurrentProcess = vi.fn();
    const code = await runBrowserDevtoolsMcp(
      { projectDir: "/project" },
      {
        runRelay: async () => ({ code: null, signal: "SIGTERM" }),
        signalCurrentProcess,
      },
    );
    expect(signalCurrentProcess).toHaveBeenCalledWith("SIGTERM");
    expect(code).toBe(128);
  });
});
