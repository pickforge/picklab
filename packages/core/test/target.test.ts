import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, updateSession } from "../src/session.js";
import { resolveRunnableSession } from "../src/target.js";

let home: string;
let env: { PICKLAB_HOME: string };

const HINTS = {
  consumerLabel: "test",
  createHint: "create one first",
  selectHint: "pick one explicitly",
};

async function createRunningDesktop(projectDir: string): Promise<string> {
  const record = await createSession({ type: "desktop", projectDir }, env);
  await updateSession(
    record.id,
    { status: "running", desktop: { display: ":99" } },
    env,
  );
  return record.id;
}

beforeEach(async () => {
  home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-target-"));
  env = { PICKLAB_HOME: home };
});

afterEach(async () => {
  await fs.promises.rm(home, { recursive: true, force: true });
});

describe("resolveRunnableSession project scoping", () => {
  it("resolves each project's own session when two projects run concurrently", async () => {
    const idA = await createRunningDesktop("/proj-a");
    const idB = await createRunningDesktop("/proj-b");

    const recordA = await resolveRunnableSession("desktop", undefined, {
      env,
      projectDir: "/proj-a",
      ...HINTS,
    });
    const recordB = await resolveRunnableSession("desktop", undefined, {
      env,
      projectDir: "/proj-b",
      ...HINTS,
    });
    expect(recordA.id).toBe(idA);
    expect(recordB.id).toBe(idB);
  });

  it("reports project-scoped ambiguity when one project has two sessions", async () => {
    const first = await createRunningDesktop("/proj-a");
    const second = await createRunningDesktop("/proj-a");

    const error = await resolveRunnableSession("desktop", undefined, {
      env,
      projectDir: "/proj-a",
      ...HINTS,
    }).then(
      () => undefined,
      (reason: unknown) => reason as Error,
    );
    expect(error?.message).toContain(
      "Multiple running desktop sessions for this project",
    );
    expect(error?.message).toContain(first);
    expect(error?.message).toContain(second);
    expect(error?.message).toContain("pick one explicitly");
  });

  it("reports a project-scoped miss when only other projects have sessions", async () => {
    await createRunningDesktop("/proj-b");

    await expect(
      resolveRunnableSession("desktop", undefined, {
        env,
        projectDir: "/proj-a",
        ...HINTS,
      }),
    ).rejects.toThrow(
      /No running desktop session for this project; create one first/,
    );
  });

  it("keeps the unscoped error semantics when no projectDir is given", async () => {
    await createRunningDesktop("/proj-a");
    await createRunningDesktop("/proj-b");

    await expect(
      resolveRunnableSession("desktop", undefined, { env, ...HINTS }),
    ).rejects.toThrow(/Multiple running desktop sessions found/);
  });

  it("lets explicit session ids bypass the project filter", async () => {
    const idB = await createRunningDesktop("/proj-b");

    const record = await resolveRunnableSession("desktop", idB, {
      env,
      projectDir: "/proj-a",
      ...HINTS,
    });
    expect(record.id).toBe(idB);
    expect(record.projectDir).toBe("/proj-b");
  });
});
