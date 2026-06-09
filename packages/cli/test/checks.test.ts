import { describe, expect, it } from "vitest";
import {
  evaluateChecks,
  PROFILE_REQUIRED_CHECKS,
  requiredChecksForProfile,
} from "../src/provision/checks.js";
import type { DetectionSnapshot } from "../src/provision/detect.js";

function snapshot(
  overrides: {
    picklabHome?: Partial<DetectionSnapshot["picklabHome"]>;
    config?: Partial<DetectionSnapshot["config"]>;
    desktop?: Partial<DetectionSnapshot["desktop"]>;
    android?: Partial<DetectionSnapshot["android"]>;
    labUser?: Partial<DetectionSnapshot["labUser"]>;
    sudo?: string | null;
  } = {},
): DetectionSnapshot {
  return {
    picklabHome: {
      path: "/home/u/.picklab",
      exists: true,
      writable: true,
      ...overrides.picklabHome,
    },
    config: { ok: true, error: null, profile: null, ...overrides.config },
    desktop: {
      xvfb: "/usr/bin/Xvfb",
      xdotool: "/usr/bin/xdotool",
      screenshotTool: "import",
      x11vnc: "/usr/bin/x11vnc",
      ...overrides.desktop,
    },
    android: {
      sdkRoot: "/sdk",
      tools: {
        sdkmanager: "/sdk/cmdline-tools/latest/bin/sdkmanager",
        avdmanager: "/sdk/cmdline-tools/latest/bin/avdmanager",
        emulator: "/sdk/emulator/emulator",
        adb: "/sdk/platform-tools/adb",
      },
      systemImages: [
        {
          packageId: "system-images;android-34;google_apis;x86_64",
          api: "android-34",
          tag: "google_apis",
          abi: "x86_64",
          path: "/sdk/system-images/android-34/google_apis/x86_64",
        },
      ],
      kvm: { exists: true, readable: true, writable: true, supported: true },
      avdName: "picklab-avd",
      avds: ["picklab-avd"],
      avdExists: true,
      ...overrides.android,
    },
    labUser: {
      name: "picklab-lab",
      home: "/var/lib/picklab/lab-home",
      exists: true,
      homeExists: true,
      ...overrides.labUser,
    },
    sudo: overrides.sudo === undefined ? "/usr/bin/sudo" : overrides.sudo,
  };
}

function checkById(s: DetectionSnapshot, id: string) {
  const check = evaluateChecks(s).find((entry) => entry.id === id);
  expect(check).toBeDefined();
  return check!;
}

describe("evaluateChecks", () => {
  it("reports everything ok for a fully provisioned machine", () => {
    const checks = evaluateChecks(snapshot());
    expect(checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("flags a missing picklab home", () => {
    const check = checkById(
      snapshot({ picklabHome: { exists: false, writable: false } }),
      "picklab-home",
    );
    expect(check.status).toBe("missing");
  });

  it("flags an unwritable picklab home as missing", () => {
    const check = checkById(
      snapshot({ picklabHome: { writable: false } }),
      "picklab-home",
    );
    expect(check.status).toBe("missing");
    expect(check.detail).toContain("not writable");
  });

  it("flags a broken config with its parse error", () => {
    const check = checkById(
      snapshot({ config: { ok: false, error: "Invalid PickLab config" } }),
      "config",
    );
    expect(check.status).toBe("missing");
    expect(check.detail).toContain("Invalid PickLab config");
  });

  it("treats x11vnc as optional (warn, not missing)", () => {
    const check = checkById(snapshot({ desktop: { x11vnc: null } }), "x11vnc");
    expect(check.status).toBe("warn");
  });

  it("treats absent KVM as a warning", () => {
    const check = checkById(
      snapshot({
        android: {
          kvm: { exists: false, readable: false, writable: false, supported: false },
        },
      }),
      "kvm",
    );
    expect(check.status).toBe("warn");
    expect(check.hint).toContain("slow");
  });

  it("hints the exact sdkmanager command when system images are missing", () => {
    const check = checkById(
      snapshot({ android: { systemImages: [] } }),
      "system-image",
    );
    expect(check.status).toBe("missing");
    expect(check.hint).toContain(
      'sdkmanager "system-images;android-35;google_apis;x86_64"',
    );
  });

  it("flags a missing AVD with a setup hint", () => {
    const check = checkById(
      snapshot({ android: { avds: [], avdExists: false } }),
      "avd",
    );
    expect(check.status).toBe("missing");
    expect(check.hint).toContain("picklab setup android --create-avd");
  });

  it("flags a missing lab user with a setup hint", () => {
    const check = checkById(snapshot({ labUser: { exists: false } }), "lab-user");
    expect(check.status).toBe("missing");
    expect(check.hint).toContain("picklab setup lab-user");
  });
});

describe("requiredChecksForProfile", () => {
  it("keeps generic projects to home and config", () => {
    expect(requiredChecksForProfile("generic")).toEqual([
      "picklab-home",
      "config",
    ]);
  });

  it("requires desktop tooling and the lab user for flutter-desktop", () => {
    const ids = requiredChecksForProfile("flutter-desktop");
    expect(ids).toContain("xvfb");
    expect(ids).toContain("xdotool");
    expect(ids).toContain("screenshot-tool");
    expect(ids).toContain("lab-user");
    expect(ids).not.toContain("android-sdk");
    expect(ids).not.toContain("x11vnc");
  });

  it("requires the android toolchain and AVD for android", () => {
    const ids = requiredChecksForProfile("android");
    expect(ids).toEqual(
      expect.arrayContaining([
        "android-sdk",
        "sdkmanager",
        "avdmanager",
        "emulator",
        "adb",
        "system-image",
        "avd",
      ]),
    );
    expect(ids).not.toContain("xvfb");
    expect(ids).not.toContain("kvm");
  });

  it("unions desktop and android for desktop+android", () => {
    const ids = requiredChecksForProfile("desktop+android");
    expect(ids).toContain("xvfb");
    expect(ids).toContain("avd");
    expect(ids).toContain("lab-user");
  });

  it("covers every profile", () => {
    expect(Object.keys(PROFILE_REQUIRED_CHECKS).sort()).toEqual([
      "android",
      "desktop+android",
      "flutter-desktop",
      "generic",
    ]);
  });
});
