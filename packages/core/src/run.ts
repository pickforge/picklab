import fs from "node:fs";
import path from "node:path";
import { ensureDir, runsDir } from "./paths.js";

export type RunStatus = "running" | "completed" | "failed";
export type ArtifactType = "screenshot" | "log" | "report" | "other";

/**
 * Evidence storage constants. Kept in `run.ts` (not `evidence.ts`) so that
 * `createRun` can stamp the manifest without importing the evidence module,
 * avoiding an import cycle: `evidence.ts` depends on `run.ts`, never the
 * reverse.
 */
export const EVIDENCE_VERSION = 1 as const;
export const EVIDENCE_ACTION_LOG = "actions.jsonl";

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
  /**
   * Evidence marker. Present (value `1`) only on computer-use runs that carry
   * an append-only action journal. Absent on legacy/plain screenshot runs,
   * which keeps them listing and reading unchanged.
   */
  evidenceVersion?: typeof EVIDENCE_VERSION;
  /** Journal file name relative to the run dir, e.g. `actions.jsonl`. */
  actionLog?: string;
  /**
   * Summary flag copied from the authoritative journal by a finalizer once the
   * evidence cap is hit. The journal (its truncation marker) remains the source
   * of truth; appends never rewrite the manifest to set this.
   */
  evidenceTruncated?: boolean;
}

export interface CreateRunOptions {
  now?: Date;
  sessionId?: string;
  meta?: Record<string, unknown>;
  /**
   * When true, stamp the manifest with evidence fields and create an empty
   * append-only action journal. Plain runs omit this and stay non-evidence.
   */
  evidence?: boolean;
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
  if (opts.evidence === true) {
    manifest.evidenceVersion = EVIDENCE_VERSION;
    manifest.actionLog = EVIDENCE_ACTION_LOG;
    // Create the empty journal up front so appenders open (not create) it and
    // readers see a real file even before the first action lands.
    await fs.promises.writeFile(path.join(runDir, EVIDENCE_ACTION_LOG), "", {
      encoding: "utf8",
      flag: "wx",
    });
  }

  await writeManifest(runDir, manifest);
  return new RunHandle(runDir, manifest);
}

export async function listRuns(projectDir: string): Promise<RunManifest[]> {
  const parent = runsDir(projectDir);

  // Confine the runs root to the real `.picklab/runs` under the real project
  // dir. This rejects a symlinked `.picklab` or `.picklab/runs` (which could
  // redirect reads to outside runs) while still allowing the project dir
  // itself to be a symlink.
  try {
    const realProject = await fs.promises.realpath(projectDir);
    const realParent = await fs.promises.realpath(parent);
    if (realParent !== path.join(realProject, ".picklab", "runs")) {
      return [];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

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
    // Skip symlinked run entries; only follow real directories.
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const manifestPath = path.join(parent, entry.name, "manifest.json");
    try {
      const manifestStat = await fs.promises.lstat(manifestPath);
      if (manifestStat.isSymbolicLink()) continue;
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
