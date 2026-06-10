import fs from "node:fs";
import path from "node:path";
import { ensureDir, runsDir } from "./paths.js";

export type RunStatus = "running" | "completed" | "failed";
export type ArtifactType = "screenshot" | "log" | "report" | "other";

export interface RunArtifact {
  type: ArtifactType;
  name: string;
  path: string;
  createdAt: string;
}

export interface RunManifest {
  runId: string;
  slug: string;
  createdAt: string;
  sessionId?: string;
  status: RunStatus;
  artifacts: RunArtifact[];
  meta?: Record<string, unknown>;
}

export interface CreateRunOptions {
  now?: Date;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

let tmpCounter = 0;

function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug) || slug.includes("..")) {
    throw new Error(
      `Invalid run slug "${slug}": must start with a letter or digit and ` +
        `contain only letters, digits, ".", "_", or "-" (no path separators or "..")`,
    );
  }
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

async function writeManifest(runDir: string, manifest: RunManifest): Promise<void> {
  const target = path.join(runDir, "manifest.json");
  tmpCounter += 1;
  const tmp = path.join(
    runDir,
    `.manifest.json.tmp-${process.pid}-${tmpCounter}`,
  );
  await fs.promises.writeFile(
    tmp,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await fs.promises.rename(tmp, target);
}

export class RunHandle {
  readonly dir: string;
  readonly manifest: RunManifest;

  constructor(dir: string, manifest: RunManifest) {
    this.dir = dir;
    this.manifest = manifest;
  }

  get runId(): string {
    return this.manifest.runId;
  }

  async addArtifact(
    type: ArtifactType,
    name: string,
    artifactPath: string,
  ): Promise<RunArtifact> {
    const relative = path.isAbsolute(artifactPath)
      ? path.relative(this.dir, artifactPath)
      : artifactPath;
    const artifact: RunArtifact = {
      type,
      name,
      path: relative,
      createdAt: new Date().toISOString(),
    };
    this.manifest.artifacts.push(artifact);
    await writeManifest(this.dir, this.manifest);
    return artifact;
  }

  async setStatus(status: RunStatus): Promise<void> {
    this.manifest.status = status;
    await writeManifest(this.dir, this.manifest);
  }

  async finish(status: RunStatus = "completed"): Promise<void> {
    await this.setStatus(status);
  }
}

export async function createRun(
  projectDir: string,
  slug: string,
  opts: CreateRunOptions = {},
): Promise<RunHandle> {
  assertValidSlug(slug);
  const now = opts.now ?? new Date();
  const baseName = `${formatTimestamp(now)}-${slug}`;
  const parent = runsDir(projectDir);
  await ensureDir(parent);

  let runDir: string | undefined;
  let runId = baseName;
  for (let attempt = 1; runDir === undefined; attempt += 1) {
    runId = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const candidate = path.join(parent, runId);
    try {
      await fs.promises.mkdir(candidate);
      runDir = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  await ensureDir(path.join(runDir, "screenshots"));
  await ensureDir(path.join(runDir, "logs"));

  const manifest: RunManifest = {
    runId,
    slug,
    createdAt: now.toISOString(),
    status: "running",
    artifacts: [],
  };
  if (opts.sessionId !== undefined) manifest.sessionId = opts.sessionId;
  if (opts.meta !== undefined) manifest.meta = opts.meta;

  await writeManifest(runDir, manifest);
  return new RunHandle(runDir, manifest);
}

export async function listRuns(projectDir: string): Promise<RunManifest[]> {
  const parent = runsDir(projectDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(parent, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const manifests: RunManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(parent, entry.name, "manifest.json");
    try {
      const raw = await fs.promises.readFile(manifestPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as RunManifest).runId === "string" &&
        typeof (parsed as RunManifest).createdAt === "string" &&
        Array.isArray((parsed as RunManifest).artifacts)
      ) {
        manifests.push(parsed as RunManifest);
      }
    } catch {
      continue;
    }
  }

  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return manifests;
}
