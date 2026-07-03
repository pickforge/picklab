import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureCliBuilt } from "./build-once.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPackageDir = path.join(repoRoot, "packages", "cli");
const installScript = path.join(repoRoot, "scripts", "install.sh");
const cliVersion = (
  JSON.parse(
    fs.readFileSync(path.join(cliPackageDir, "package.json"), "utf8"),
  ) as { version: string }
).version;

const NETWORK_TIMEOUT = 300_000;

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: string[],
  opts: { cwd?: string; env: Record<string, string> },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
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

function describeFailure(result: ExecResult): string {
  return `exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

let suiteDir: string;
let tarball: string;
let npmCache: string;

function makeCase(name: string): { home: string; dir: string } {
  const dir = path.join(suiteDir, name);
  const home = path.join(dir, "home");
  fs.mkdirSync(home, { recursive: true });
  return { home, dir };
}

function baseEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: home,
    PICKLAB_HOME: path.join(home, ".picklab"),
    PATH: process.env.PATH ?? "",
    npm_config_cache: npmCache,
    ...extra,
  };
}

function hasBun(): boolean {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => {
      try {
        fs.accessSync(path.join(dir, "bun"), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

beforeAll(async () => {
  await ensureCliBuilt();
  suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), "picklab-installer-"));
  npmCache = path.join(suiteDir, "npm-cache");
  fs.mkdirSync(npmCache, { recursive: true });
  const packDir = path.join(suiteDir, "pack");
  fs.mkdirSync(packDir, { recursive: true });
  const packed = await run(
    "npm",
    ["pack", "--pack-destination", packDir, "--json"],
    { cwd: cliPackageDir, env: baseEnv(path.join(suiteDir, "pack-home")) },
  );
  if (packed.code !== 0) {
    throw new Error(`npm pack failed: ${describeFailure(packed)}`);
  }
  const [entry] = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  tarball = path.join(packDir, entry.filename);
  if (!fs.existsSync(tarball)) {
    throw new Error(`packed tarball not found at ${tarball}`);
  }
}, NETWORK_TIMEOUT);

afterAll(() => {
  fs.rmSync(suiteDir, { recursive: true, force: true });
});

describe("install.sh", () => {
  it("passes a POSIX sh syntax check", async () => {
    const result = await run("sh", ["-n", installScript], {
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.code, describeFailure(result)).toBe(0);
  });

  it(
    "installs from a tarball with npm into a user prefix and verifies the binary",
    async () => {
      const { home, dir } = makeCase("sh-npm");
      const prefix = path.join(dir, "prefix");
      const env = baseEnv(home, {
        PICKLAB_INSTALL_FROM_TARBALL: tarball,
        PICKLAB_INSTALL_RUNTIME: "npm",
        npm_config_prefix: prefix,
      });
      const result = await run("sh", [installScript], { cwd: dir, env });
      expect(result.code, describeFailure(result)).toBe(0);
      expect(result.stdout).toContain(`picklab ${cliVersion} installed.`);
      expect(result.stdout).toContain("picklab agents install");
      expect(result.stdout).toContain("picklab init --profile");

      const binary = path.join(prefix, "bin", "picklab");
      const version = await run(binary, ["--version"], { env: baseEnv(home) });
      expect(version.code, describeFailure(version)).toBe(0);
      expect(version.stdout.trim()).toBe(cliVersion);
    },
    NETWORK_TIMEOUT,
  );

  it(
    "creates the global home and project config via init from the installed binary",
    async () => {
      const { home, dir } = makeCase("sh-init");
      const prefix = path.join(dir, "prefix");
      const project = path.join(dir, "project");
      fs.mkdirSync(project, { recursive: true });
      const install = await run("sh", [installScript], {
        cwd: dir,
        env: baseEnv(home, {
          PICKLAB_INSTALL_FROM_TARBALL: tarball,
          PICKLAB_INSTALL_RUNTIME: "npm",
          npm_config_prefix: prefix,
        }),
      });
      expect(install.code, describeFailure(install)).toBe(0);

      const picklabHome = path.join(home, ".picklab");
      expect(fs.existsSync(picklabHome)).toBe(false);
      const init = await run(
        path.join(prefix, "bin", "picklab"),
        ["init", "--profile", "generic", "--yes", "--json"],
        { cwd: project, env: baseEnv(home) },
      );
      expect(init.code, describeFailure(init)).toBe(0);
      const report = JSON.parse(init.stdout) as Record<string, any>;
      expect(report.ok).toBe(true);
      expect(fs.existsSync(picklabHome)).toBe(true);
      const config = JSON.parse(
        fs.readFileSync(path.join(project, ".picklab", "config.json"), "utf8"),
      );
      expect(config.profile).toBe("generic");
    },
    NETWORK_TIMEOUT,
  );

  it.runIf(hasBun())(
    "installs from a tarball with bun into an isolated BUN_INSTALL",
    async () => {
      const { home, dir } = makeCase("sh-bun");
      const bunInstall = path.join(dir, "bun");
      const env = baseEnv(home, {
        PICKLAB_INSTALL_FROM_TARBALL: tarball,
        PICKLAB_INSTALL_RUNTIME: "bun",
        BUN_INSTALL: bunInstall,
      });
      const result = await run("sh", [installScript], { cwd: dir, env });
      expect(result.code, describeFailure(result)).toBe(0);
      expect(result.stdout).toContain(`picklab ${cliVersion} installed.`);

      const version = await run(
        path.join(bunInstall, "bin", "picklab"),
        ["--version"],
        { env: baseEnv(home) },
      );
      expect(version.code, describeFailure(version)).toBe(0);
      expect(version.stdout.trim()).toBe(cliVersion);
    },
    NETWORK_TIMEOUT,
  );

  it("fails closed when the tarball override points nowhere", async () => {
    const { home, dir } = makeCase("sh-missing-tarball");
    const result = await run("sh", [installScript], {
      cwd: dir,
      env: baseEnv(home, {
        PICKLAB_INSTALL_FROM_TARBALL: path.join(dir, "nope.tgz"),
      }),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missing file");
  });

  it("fails closed for an unsupported runtime override", async () => {
    const { home, dir } = makeCase("sh-bad-runtime");
    const result = await run("sh", [installScript], {
      cwd: dir,
      env: baseEnv(home, {
        PICKLAB_INSTALL_FROM_TARBALL: tarball,
        PICKLAB_INSTALL_RUNTIME: "yarn",
      }),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unsupported");
  });
});

describe("packed tarball execution", () => {
  it(
    "runs picklab via npm exec from the tarball (npx equivalent)",
    async () => {
      const { home, dir } = makeCase("npx");
      const result = await run(
        "npm",
        ["exec", "--yes", `--package=${tarball}`, "--", "picklab", "--version"],
        { cwd: dir, env: baseEnv(home) },
      );
      expect(result.code, describeFailure(result)).toBe(0);
      expect(result.stdout.trim()).toContain(cliVersion);
    },
    NETWORK_TIMEOUT,
  );

  it(
    "runs picklab init via npm exec from the tarball (npx -y @pickforge/picklab init)",
    async () => {
      const { home, dir } = makeCase("npx-init");
      const project = path.join(dir, "project");
      fs.mkdirSync(project, { recursive: true });
      const result = await run(
        "npm",
        [
          "exec",
          "--yes",
          `--package=${tarball}`,
          "--",
          "picklab",
          "init",
          "--profile",
          "generic",
          "--yes",
          "--json",
        ],
        { cwd: project, env: baseEnv(home) },
      );
      expect(result.code, describeFailure(result)).toBe(0);
      const report = JSON.parse(result.stdout) as Record<string, any>;
      expect(report.ok).toBe(true);
      expect(fs.existsSync(path.join(home, ".picklab"))).toBe(true);
      expect(
        fs.existsSync(path.join(project, ".picklab", "config.json")),
      ).toBe(true);
    },
    NETWORK_TIMEOUT,
  );

  it.runIf(hasBun())(
    "installs the tarball with bun and runs both bins (bunx substitution: proves bun compatibility of the package)",
    async () => {
      const { home, dir } = makeCase("bun-project");
      const project = path.join(dir, "project");
      fs.mkdirSync(project, { recursive: true });
      fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({ name: "picklab-bun-host", private: true }),
      );
      const env = baseEnv(home, { BUN_INSTALL: path.join(dir, "bun") });
      const added = await run("bun", ["add", tarball], { cwd: project, env });
      expect(added.code, describeFailure(added)).toBe(0);

      const picklab = await run(
        path.join(project, "node_modules", ".bin", "picklab"),
        ["--version"],
        { cwd: project, env },
      );
      expect(picklab.code, describeFailure(picklab)).toBe(0);
      expect(picklab.stdout.trim()).toBe(cliVersion);

      const mcpBin = path.join(project, "node_modules", ".bin", "picklab-mcp");
      expect(fs.existsSync(mcpBin)).toBe(true);
    },
    NETWORK_TIMEOUT,
  );
});
