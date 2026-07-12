import { describe, expect, it } from "vitest";
import { buildXvfbArgs, parseDisplayNumber } from "../src/display.js";
import { buildVncArgs } from "../src/vnc.js";
import { buildScreenshotCommand } from "../src/screenshot.js";
import { buildClickArgs, buildKeyArgs, buildTypeArgs } from "../src/input.js";

const INJECTION_STRINGS = ["; rm -rf /", "$(reboot)", "`reboot`", "a && b | c"];

describe("buildXvfbArgs", () => {
  it("builds args with defaults", () => {
    expect(buildXvfbArgs({ display: ":90" })).toEqual([
      ":90",
      "-screen",
      "0",
      "1280x800x24",
      "-nolisten",
      "tcp",
    ]);
  });

  it("builds args with custom geometry", () => {
    expect(
      buildXvfbArgs({ display: ":123", width: 1920, height: 1080, depth: 16 }),
    ).toEqual([":123", "-screen", "0", "1920x1080x16", "-nolisten", "tcp"]);
  });

  it("rejects invalid displays", () => {
    expect(() => buildXvfbArgs({ display: "90" })).toThrow(/display/i);
    expect(() => buildXvfbArgs({ display: ":90; rm -rf /" })).toThrow(
      /display/i,
    );
  });

  it("rejects non-positive geometry", () => {
    expect(() => buildXvfbArgs({ display: ":90", width: 0 })).toThrow(/width/i);
    expect(() => buildXvfbArgs({ display: ":90", height: -1 })).toThrow(
      /height/i,
    );
    expect(() => buildXvfbArgs({ display: ":90", depth: 1.5 })).toThrow(
      /depth/i,
    );
  });
});

describe("parseDisplayNumber", () => {
  it("parses :N displays", () => {
    expect(parseDisplayNumber(":0")).toBe(0);
    expect(parseDisplayNumber(":92")).toBe(92);
  });

  it("rejects malformed displays", () => {
    for (const bad of ["", ":", "92", ":92.0", ":92 ", "localhost:1", ...INJECTION_STRINGS]) {
      expect(() => parseDisplayNumber(bad)).toThrow(/display/i);
    }
  });
});

describe("buildVncArgs", () => {
  it("builds x11vnc args bound to loopback, view-only, by default", () => {
    const args = buildVncArgs({ display: ":92", port: 5992 });
    expect(args).toEqual([
      "-display",
      ":92",
      "-rfbport",
      "5992",
      "-localhost",
      "-forever",
      "-shared",
      "-nopw",
      "-viewonly",
      "-quiet",
    ]);
    expect(args).toContain("-localhost");
    expect(args).toContain("-viewonly");
  });

  it("omits view-only mode for an explicit writable control session", () => {
    const args = buildVncArgs({
      display: ":92",
      port: 5992,
      viewOnly: false,
    });
    expect(args).toContain("-localhost");
    expect(args).not.toContain("-viewonly");
  });

  it("rejects invalid ports", () => {
    expect(() => buildVncArgs({ display: ":92", port: 0 })).toThrow(/port/i);
    expect(() => buildVncArgs({ display: ":92", port: 65536 })).toThrow(
      /port/i,
    );
    expect(() => buildVncArgs({ display: ":92", port: 1.5 })).toThrow(/port/i);
  });
});

describe("buildScreenshotCommand", () => {
  it("builds the import command", () => {
    expect(buildScreenshotCommand("import", ":92", "/tmp/out.png")).toEqual([
      {
        cmd: "import",
        args: ["-display", ":92", "-window", "root", "/tmp/out.png"],
      },
    ]);
  });

  it("builds the xwd pipeline as discrete steps", () => {
    expect(buildScreenshotCommand("xwd", ":92", "/tmp/out.png")).toEqual([
      {
        cmd: "xwd",
        args: ["-root", "-silent", "-display", ":92", "-out", "/tmp/out.png.xwd"],
      },
      {
        cmd: "convert",
        args: ["xwd:/tmp/out.png.xwd", "png:/tmp/out.png"],
      },
    ]);
  });

  it("accepts an explicit xwd dump path for unique temp files", () => {
    expect(
      buildScreenshotCommand(
        "xwd",
        ":92",
        "/tmp/out.png",
        "/tmp/out.png.123-abcd.xwd",
      ),
    ).toEqual([
      {
        cmd: "xwd",
        args: [
          "-root",
          "-silent",
          "-display",
          ":92",
          "-out",
          "/tmp/out.png.123-abcd.xwd",
        ],
      },
      {
        cmd: "convert",
        args: ["xwd:/tmp/out.png.123-abcd.xwd", "png:/tmp/out.png"],
      },
    ]);
  });

  it("builds the scrot command, which targets the display via the DISPLAY env", () => {
    expect(buildScreenshotCommand("scrot", ":92", "/tmp/out.png")).toEqual([
      {
        cmd: "scrot",
        args: ["--overwrite", "/tmp/out.png"],
        requiresDisplayEnv: true,
      },
    ]);
  });
});

describe("buildClickArgs", () => {
  it("builds a left click by default", () => {
    expect(buildClickArgs({ x: 10, y: 20 })).toEqual([
      "mousemove",
      "--sync",
      "10",
      "20",
      "click",
      "1",
    ]);
  });

  it("supports other buttons", () => {
    expect(buildClickArgs({ x: 0, y: 0, button: 3 })).toEqual([
      "mousemove",
      "--sync",
      "0",
      "0",
      "click",
      "3",
    ]);
  });

  it("rejects non-integer coordinates and bad buttons", () => {
    expect(() => buildClickArgs({ x: 1.5, y: 0 })).toThrow(/x/i);
    expect(() => buildClickArgs({ x: 0, y: Number.NaN })).toThrow(/y/i);
    expect(() => buildClickArgs({ x: -1, y: 0 })).toThrow(/x/i);
    expect(() => buildClickArgs({ x: 0, y: 0, button: 0 })).toThrow(/button/i);
    expect(() => buildClickArgs({ x: 0, y: 0, button: 10 })).toThrow(
      /button/i,
    );
  });
});

describe("buildTypeArgs", () => {
  it("passes text as a single argv element after --", () => {
    expect(buildTypeArgs("hello world")).toEqual([
      "type",
      "--delay",
      "50",
      "--",
      "hello world",
    ]);
  });

  it("keeps shell metacharacters as literal text", () => {
    for (const text of INJECTION_STRINGS) {
      const args = buildTypeArgs(text);
      expect(args).toEqual(["type", "--delay", "50", "--", text]);
      expect(args[args.length - 1]).toBe(text);
    }
  });

  it("rejects empty text", () => {
    expect(() => buildTypeArgs("")).toThrow(/text/i);
  });
});

describe("buildKeyArgs", () => {
  it("builds key combos after --", () => {
    expect(buildKeyArgs("ctrl+shift+t")).toEqual(["key", "--", "ctrl+shift+t"]);
    expect(buildKeyArgs("Return")).toEqual(["key", "--", "Return"]);
  });

  it("keeps shell metacharacters as literal argv", () => {
    for (const key of INJECTION_STRINGS) {
      expect(buildKeyArgs(key)).toEqual(["key", "--", key]);
    }
  });

  it("rejects empty keys", () => {
    expect(() => buildKeyArgs("")).toThrow(/key/i);
  });
});
