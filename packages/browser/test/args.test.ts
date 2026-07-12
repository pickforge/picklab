import { describe, expect, it } from "vitest";
import { buildChromeArgs } from "../src/args.js";

describe("buildChromeArgs", () => {
  it("uses an ephemeral profile, port 0, and explicit loopback", () => {
    const args = buildChromeArgs({ profileDir: "/tmp/p" });
    expect(args).toContain("--user-data-dir=/tmp/p");
    expect(args).toContain("--remote-debugging-port=0");
    expect(args).toContain("--remote-debugging-address=127.0.0.1");
    expect(args).toContain("--no-first-run");
    // The start URL is the final positional argument.
    expect(args[args.length - 1]).toBe("about:blank");
  });

  it("adds a window size only when both dimensions are given", () => {
    expect(buildChromeArgs({ profileDir: "/p", width: 800, height: 600 })).toContain(
      "--window-size=800,600",
    );
    expect(
      buildChromeArgs({ profileDir: "/p", width: 800 }).some((a) =>
        a.startsWith("--window-size"),
      ),
    ).toBe(false);
  });

  it("omits --no-sandbox by default and includes it only when asked", () => {
    expect(buildChromeArgs({ profileDir: "/p" })).not.toContain("--no-sandbox");
    expect(
      buildChromeArgs({ profileDir: "/p", noSandbox: true }),
    ).toContain("--no-sandbox");
  });

  it("refuses a non-loopback CDP address", () => {
    expect(() =>
      buildChromeArgs({ profileDir: "/p", cdpAddress: "0.0.0.0" }),
    ).toThrow(/non-loopback/);
  });

  it("requires a profile directory", () => {
    expect(() => buildChromeArgs({ profileDir: "" })).toThrow(/profileDir/);
  });

  it("appends caller extra args before the start URL", () => {
    const args = buildChromeArgs({
      profileDir: "/p",
      extraArgs: ["--mute-audio"],
      startUrl: "https://example.test",
    });
    expect(args).toContain("--mute-audio");
    expect(args[args.length - 1]).toBe("https://example.test");
    expect(args.indexOf("--mute-audio")).toBeLessThan(args.length - 1);
  });
});
