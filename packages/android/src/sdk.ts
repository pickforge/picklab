import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvLike } from "@pickforge/picklab-core";
import { findOnPath, isExecutableFile } from "./util.js";

export type SdkToolName = "sdkmanager" | "avdmanager" | "emulator" | "adb";

export interface SdkToolPaths {
  sdkmanager: string | null;
  avdmanager: string | null;
  emulator: string | null;
  adb: string | null;
}

export interface DetectSdkRootOptions {
  env?: EnvLike;
  homeDir?: string;
  commonPaths?: readonly string[];
}

export interface SystemImage {
  packageId: string;
  api: string;
  tag: string;
  abi: string;
  path: string;
}

export interface KvmStatus {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  supported: boolean;
}

export interface AndroidEnvironment {
  sdkRoot: string | null;
  tools: SdkToolPaths;
  systemImages: SystemImage[];
  kvm: KvmStatus;
}

const SYSTEM_IMAGE_ID_PATTERN = /^system-images;[^;\s]+;[^;\s]+;[^;\s]+$/;

const TOOL_RELATIVE_DIRS: Record<Exclude<SdkToolName, "adb">, string[]> = {
  sdkmanager: [
    path.join("cmdline-tools", "latest", "bin"),
    path.join("tools", "bin"),
  ],
  avdmanager: [
    path.join("cmdline-tools", "latest", "bin"),
    path.join("tools", "bin"),
  ],
  emulator: ["emulator"],
};

export function commonSdkPaths(homeDir: string = os.homedir()): string[] {
  return [
    path.join(homeDir, "Android", "Sdk"),
    path.join(homeDir, "Library", "Android", "sdk"),
    path.join("/opt", "android-sdk"),
  ];
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function detectSdkRoot(opts: DetectSdkRootOptions = {}): string | null {
  const env = opts.env ?? process.env;
  for (const key of ["ANDROID_HOME", "ANDROID_SDK_ROOT"] as const) {
    const candidate = env[key];
    if (candidate !== undefined && candidate !== "" && isDirectory(candidate)) {
      return candidate;
    }
  }
  const candidates = opts.commonPaths ?? commonSdkPaths(opts.homeDir);
  for (const candidate of candidates) {
    if (isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function missingSdkMessage(): string {
  return (
    "Android SDK not found. Set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK " +
    "directory, or install it to one of: " +
    `${commonSdkPaths().join(", ")}. ` +
    "See https://developer.android.com/studio#command-line for command-line tools."
  );
}

export function findSdkTool(
  sdk: string | null | undefined,
  tool: SdkToolName,
  env: EnvLike = process.env,
): string | null {
  if (tool === "adb") {
    if (sdk !== null && sdk !== undefined) {
      const candidate = path.join(sdk, "platform-tools", "adb");
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
    return findOnPath("adb", env);
  }
  if (sdk === null || sdk === undefined) {
    return findOnPath(tool, env);
  }
  for (const dir of TOOL_RELATIVE_DIRS[tool]) {
    const candidate = path.join(sdk, dir, tool);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return findOnPath(tool, env);
}

export function detectSdkTools(
  opts: { sdk?: string | null; env?: EnvLike } = {},
): SdkToolPaths {
  const sdk = opts.sdk === undefined ? detectSdkRoot({ env: opts.env }) : opts.sdk;
  const env = opts.env ?? process.env;
  return {
    sdkmanager: findSdkTool(sdk, "sdkmanager", env),
    avdmanager: findSdkTool(sdk, "avdmanager", env),
    emulator: findSdkTool(sdk, "emulator", env),
    adb: findSdkTool(sdk, "adb", env),
  };
}

function listSubdirs(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export function listSystemImages(sdk: string): SystemImage[] {
  const root = path.join(sdk, "system-images");
  const images: SystemImage[] = [];
  for (const api of listSubdirs(root)) {
    for (const tag of listSubdirs(path.join(root, api))) {
      for (const abi of listSubdirs(path.join(root, api, tag))) {
        images.push({
          packageId: `system-images;${api};${tag};${abi}`,
          api,
          tag,
          abi,
          path: path.join(root, api, tag, abi),
        });
      }
    }
  }
  images.sort((a, b) => a.packageId.localeCompare(b.packageId));
  return images;
}

export function isValidSystemImageId(packageId: string): boolean {
  return SYSTEM_IMAGE_ID_PATTERN.test(packageId);
}

export function assertSystemImageId(packageId: string): void {
  if (!isValidSystemImageId(packageId)) {
    throw new Error(
      `Invalid system image "${packageId}": expected the form ` +
        `"system-images;android-<api>;<tag>;<abi>"`,
    );
  }
}

export function systemImageInstalled(sdk: string, packageId: string): boolean {
  assertSystemImageId(packageId);
  const [, api, tag, abi] = packageId.split(";") as [
    string,
    string,
    string,
    string,
  ];
  return isDirectory(path.join(sdk, "system-images", api, tag, abi));
}

export function sdkmanagerInstallCommand(packageId: string): string {
  assertSystemImageId(packageId);
  return `sdkmanager "${packageId}"`;
}

export function detectKvm(kvmPath = "/dev/kvm"): KvmStatus {
  const exists = fs.existsSync(kvmPath);
  let readable = false;
  let writable = false;
  if (exists) {
    try {
      fs.accessSync(kvmPath, fs.constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }
    try {
      fs.accessSync(kvmPath, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  return { exists, readable, writable, supported: exists && readable && writable };
}

export function detectAndroidEnvironment(
  opts: DetectSdkRootOptions & { kvmPath?: string } = {},
): AndroidEnvironment {
  const sdkRoot = detectSdkRoot(opts);
  return {
    sdkRoot,
    tools: detectSdkTools({ sdk: sdkRoot, env: opts.env }),
    systemImages: sdkRoot === null ? [] : listSystemImages(sdkRoot),
    kvm: detectKvm(opts.kvmPath),
  };
}
