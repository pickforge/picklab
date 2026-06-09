import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../dist/picklab.js", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJson(result: CliResult): Record<string, any> {
  try {
    return JSON.parse(result.stdout) as Record<string, any>;
  } catch (error) {
    throw new Error(
      `CLI did not print JSON (${(error as Error).message}); ` +
        `stdout: ${result.stdout}; stderr: ${result.stderr}`,
    );
  }
}

function writeScript(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

interface FakeSdkOptions {
  images?: string[];
  avdNames?: string[];
}

function makeFakeSdk(root: string, opts: FakeSdkOptions = {}): string {
  const bin = path.join(root, "cmdline-tools", "latest", "bin");
  writeScript(path.join(bin, "sdkmanager"), "exit 0");
  writeScript(
    path.join(bin, "avdmanager"),
    `printf '%s\\n' "$*" >> ${path.join(root, "avdmanager.log")}\nexit 0`,
  );
  const avdLines = (opts.avdNames ?? [])
    .map((name) => `echo ${name}`)
    .join("\n");
  writeScript(
    path.join(root, "emulator", "emulator"),
    avdLines === "" ? "exit 0" : avdLines,
  );
  writeScript(path.join(root, "platform-tools", "adb"), "exit 0");
  for (const image of opts.images ?? []) {
    const [, api, tag, abi] = image.split(";") as [
      string,
      string,
      string,
      string,
    ];
    fs.mkdirSync(path.join(root, "system-images", api, tag, abi), {
      recursive: true,
    });
  }
  return root;
}

interface FakeEnvOptions {
  bins?: Record<string, string>;
  sdk?: string;
}

function makeEnv(
  tmp: string,
  opts: FakeEnvOptions = {},
): Record<string, string> {
  const home = path.join(tmp, "home");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(opts.bins ?? {})) {
    writeScript(path.join(bin, name), body);
  }
  const env: Record<string, string> = {
    HOME: home,
    PICKLAB_HOME: path.join(home, ".picklab"),
    PATH: bin,
    PICKLAB_KVM_PATH: path.join(tmp, "no-kvm"),
  };
  if (opts.sdk !== undefined) {
    env.ANDROID_HOME = opts.sdk;
  }
  return env;
}

const IMAGE = "system-images;android-34;google_apis;x86_64";

let tmpDir: string;

beforeAll(() => {
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: repoRoot,
    stdio: "pipe",
    timeout: 280_000,
  });
  if (build.status !== 0) {
    throw new Error(
      `build failed: ${build.stdout?.toString()}${build.stderr?.toString()}`,
    );
  }
}, 300_000);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-cli-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("picklab doctor", () => {
  it("exits 0 with findings on a bare machine", async () => {
    const env = makeEnv(tmpDir);
    const result = await runCli(["doctor", "--json"], env, tmpDir);
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.ok).toBe(false);
    const byId = Object.fromEntries(
      (report.checks as Array<{ id: string; status: string }>).map((c) => [
        c.id,
        c.status,
      ]),
    );
    expect(byId["picklab-home"]).toBe("missing");
    expect(byId["xvfb"]).toBe("missing");
    expect(byId["android-sdk"]).toBe("missing");
    expect(byId["x11vnc"]).toBe("warn");
    expect(byId["kvm"]).toBe("warn");
    expect(byId["lab-user"]).toBe("missing");
  });

  it("creates the picklab home with --fix and skips privileged repairs", async () => {
    const env = makeEnv(tmpDir);
    const result = await runCli(["doctor", "--json", "--fix"], env, tmpDir);
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(fs.statSync(env.PICKLAB_HOME!).isDirectory()).toBe(true);
    expect(report.fix.results).toEqual([
      { id: "picklab-home", ok: true, detail: expect.stringContaining("mkdir") },
    ]);
    const skipped = (report.fix.skipped as string[]).join("\n");
    expect(skipped).toContain("avd:");
    expect(skipped).toContain("lab-user:");
  });

  it("prints the repair plan without applying it under --fix --dry-run", async () => {
    const env = makeEnv(tmpDir);
    const result = await runCli(
      ["doctor", "--json", "--fix", "--dry-run"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.fix.dryRun).toBe(true);
    expect(
      (report.fix.steps as Array<{ id: string }>).map((step) => step.id),
    ).toEqual(["picklab-home"]);
    expect(fs.existsSync(env.PICKLAB_HOME!)).toBe(false);
  });
});

describe("picklab init", () => {
  it("writes the project config for the generic profile", async () => {
    const env = makeEnv(tmpDir);
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await runCli(
      ["init", "--profile", "generic", "--json"],
      env,
      projectDir,
    );
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.ok).toBe(true);
    const config = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".picklab", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(config).toEqual({ profile: "generic" });
    expect(fs.statSync(env.PICKLAB_HOME!).isDirectory()).toBe(true);
  });

  it("does not write anything in --dry-run", async () => {
    const env = makeEnv(tmpDir);
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await runCli(
      ["init", "--profile", "generic", "--dry-run", "--json"],
      env,
      projectDir,
    );
    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(projectDir, ".picklab"))).toBe(false);
    expect(fs.existsSync(env.PICKLAB_HOME!)).toBe(false);
  });

  it("fails closed with the exact sdkmanager command when system images are missing", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"));
    const env = makeEnv(tmpDir, { sdk });
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await runCli(
      ["init", "--profile", "android", "--yes", "--create-avd", "--json"],
      env,
      projectDir,
    );
    expect(result.code).toBe(1);
    const report = parseJson(result);
    expect(report.ok).toBe(false);
    expect((report.errors as string[]).join("\n")).toContain(
      'sdkmanager "system-images;android-35;google_apis;x86_64"',
    );
    expect(fs.existsSync(path.join(projectDir, ".picklab"))).toBe(false);
    expect(fs.existsSync(env.PICKLAB_HOME!)).toBe(false);
  });

  it("fails closed without side effects when sudo is unavailable", async () => {
    const env = makeEnv(tmpDir, {
      bins: { Xvfb: "exit 0", xdotool: "exit 0", import: "exit 0" },
    });
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await runCli(
      [
        "init",
        "--profile",
        "flutter-desktop",
        "--yes",
        "--create-lab-user",
        "--json",
      ],
      env,
      projectDir,
    );
    expect(result.code).toBe(1);
    const report = parseJson(result);
    expect((report.errors as string[]).join("\n")).toContain("sudo not found");
    expect(fs.existsSync(path.join(projectDir, ".picklab"))).toBe(false);
    expect(fs.existsSync(env.PICKLAB_HOME!)).toBe(false);
  });

  it("prints the full provisioning plan under --dry-run for android", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), { images: [IMAGE] });
    const env = makeEnv(tmpDir, { sdk });
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await runCli(
      [
        "init",
        "--profile",
        "android",
        "--yes",
        "--create-avd",
        "--dry-run",
        "--json",
      ],
      env,
      projectDir,
    );
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.ok).toBe(true);
    const ids = (report.plan as Array<{ id: string }>).map((step) => step.id);
    expect(ids).toEqual([
      "project-config",
      "picklab-home",
      "create-avd",
      "persist-avd",
    ]);
    const createAvd = (report.plan as Array<any>).find(
      (step) => step.id === "create-avd",
    );
    expect(createAvd.command.args).toEqual([
      "create",
      "avd",
      "-n",
      "picklab-avd",
      "-k",
      IMAGE,
    ]);
    expect(fs.existsSync(path.join(sdk, "avdmanager.log"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, ".picklab"))).toBe(false);
  });

  it("provisions the AVD via avdmanager and persists configs", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), { images: [IMAGE] });
    const env = makeEnv(tmpDir, { sdk });
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const result = await runCli(
      ["init", "--profile", "android", "--yes", "--create-avd", "--json"],
      env,
      projectDir,
    );
    expect(result.code).toBe(0);
    const log = fs.readFileSync(path.join(sdk, "avdmanager.log"), "utf8");
    expect(log.trim()).toBe(`create avd -n picklab-avd -k ${IMAGE}`);
    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".picklab", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(projectConfig).toEqual({ profile: "android" });
    const globalConfig = JSON.parse(
      fs.readFileSync(path.join(env.PICKLAB_HOME!, "config.json"), "utf8"),
    ) as Record<string, any>;
    expect(globalConfig.android.avdName).toBe("picklab-avd");
  });
});

describe("picklab setup lab-user", () => {
  it("prints the provisioning plan in --dry-run without running sudo", async () => {
    const sudoLog = path.join(tmpDir, "sudo.log");
    const env = makeEnv(tmpDir, {
      bins: { sudo: `printf '%s\\n' "$*" >> ${sudoLog}\nexit 0` },
    });
    const result = await runCli(
      ["setup", "lab-user", "--dry-run", "--yes", "--json"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.ok).toBe(true);
    const ids = (report.plan as Array<{ id: string }>).map((step) => step.id);
    expect(ids).toEqual([
      "useradd",
      "mkdir-home",
      "chown-home",
      "chmod-home",
      "persist-lab-user",
    ]);
    expect((report.plan as Array<any>)[0].command.args).toEqual([
      "-n",
      "useradd",
      "-r",
      "-M",
      "-s",
      "/usr/sbin/nologin",
      "picklab-lab",
    ]);
    expect(fs.existsSync(sudoLog)).toBe(false);
  });

  it("fails closed without --yes in a non-interactive session", async () => {
    const env = makeEnv(tmpDir, { bins: { sudo: "exit 0" } });
    const result = await runCli(["setup", "lab-user", "--json"], env, tmpDir);
    expect(result.code).toBe(1);
    const report = parseJson(result);
    expect(report.error).toContain("--yes");
  });

  it("fails closed when sudo is unavailable", async () => {
    const env = makeEnv(tmpDir);
    const result = await runCli(
      ["setup", "lab-user", "--yes", "--json"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(1);
    const report = parseJson(result);
    expect(report.error).toContain("sudo not found");
  });

  it("runs each provisioning step through sudo and persists the config", async () => {
    const sudoLog = path.join(tmpDir, "sudo.log");
    const env = makeEnv(tmpDir, {
      bins: { sudo: `printf '%s\\n' "$*" >> ${sudoLog}\nexit 0` },
    });
    const result = await runCli(
      ["setup", "lab-user", "--yes", "--json", "--name", "picklab-lab"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(0);
    const lines = fs
      .readFileSync(sudoLog, "utf8")
      .trim()
      .split("\n");
    expect(lines).toEqual([
      "-n useradd -r -M -s /usr/sbin/nologin picklab-lab",
      "-n mkdir -p /var/lib/picklab/lab-home",
      "-n chown picklab-lab:picklab-lab /var/lib/picklab/lab-home",
      "-n chmod 750 /var/lib/picklab/lab-home",
    ]);
    const globalConfig = JSON.parse(
      fs.readFileSync(path.join(env.PICKLAB_HOME!, "config.json"), "utf8"),
    ) as Record<string, any>;
    expect(globalConfig.labUser).toEqual({
      name: "picklab-lab",
      home: "/var/lib/picklab/lab-home",
    });
  });
});

describe("picklab setup android", () => {
  it("reports the detected toolchain without --create-avd", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), { images: [IMAGE] });
    const env = makeEnv(tmpDir, { sdk });
    const result = await runCli(["setup", "android", "--json"], env, tmpDir);
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.sdkRoot).toBe(sdk);
    expect(report.tools.avdmanager).toBe(
      path.join(sdk, "cmdline-tools", "latest", "bin", "avdmanager"),
    );
    expect(report.systemImages).toEqual([IMAGE]);
    expect(report.avdExists).toBe(false);
    expect(report.plan).toEqual([]);
  });

  it("fails closed with the exact sdkmanager command when the image is missing", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), { images: [IMAGE] });
    const env = makeEnv(tmpDir, { sdk });
    const result = await runCli(
      [
        "setup",
        "android",
        "--create-avd",
        "--yes",
        "--json",
        "--system-image",
        "system-images;android-36;google_apis;x86_64",
      ],
      env,
      tmpDir,
    );
    expect(result.code).toBe(1);
    const report = parseJson(result);
    expect(report.error).toContain(
      'sdkmanager "system-images;android-36;google_apis;x86_64"',
    );
  });

  it("prints the creation plan in --dry-run without invoking avdmanager", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), { images: [IMAGE] });
    const env = makeEnv(tmpDir, { sdk });
    const result = await runCli(
      ["setup", "android", "--create-avd", "--dry-run", "--yes", "--json"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(
      (report.plan as Array<{ id: string }>).map((step) => step.id),
    ).toEqual(["create-avd", "persist-avd"]);
    expect(fs.existsSync(path.join(sdk, "avdmanager.log"))).toBe(false);
  });

  it("fails closed without --yes in a non-interactive session", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), { images: [IMAGE] });
    const env = makeEnv(tmpDir, { sdk });
    const result = await runCli(
      ["setup", "android", "--create-avd", "--json"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(1);
    const report = parseJson(result);
    expect(report.error).toContain("--yes");
  });

  it("is a no-op (config persistence only) when the AVD already exists", async () => {
    const sdk = makeFakeSdk(path.join(tmpDir, "sdk"), {
      images: [IMAGE],
      avdNames: ["picklab-avd"],
    });
    const env = makeEnv(tmpDir, { sdk });
    const result = await runCli(
      ["setup", "android", "--create-avd", "--yes", "--json"],
      env,
      tmpDir,
    );
    expect(result.code).toBe(0);
    const report = parseJson(result);
    expect(report.avdExists).toBe(true);
    expect(
      (report.plan as Array<{ id: string }>).map((step) => step.id),
    ).toEqual(["persist-avd"]);
    expect(fs.existsSync(path.join(sdk, "avdmanager.log"))).toBe(false);
  });
});
