import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSession,
  destroySessionRecord,
  getSession,
  listSessions,
  updateSession,
} from "../src/session.js";

let home: string;
let env: { PICKLAB_HOME: string };

beforeEach(async () => {
  home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picklab-sess-"));
  env = { PICKLAB_HOME: home };
});

afterEach(async () => {
  await fs.promises.rm(home, { recursive: true, force: true });
});

describe("session registry", () => {
  it("creates a session record on disk with a typed id", async () => {
    const session = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    expect(session.id).toMatch(/^desk-[0-9a-f]{6}$/);
    expect(session.status).toBe("starting");
    expect(session.projectDir).toBe("/proj");
    expect(
      fs.existsSync(path.join(home, "sessions", `${session.id}.json`)),
    ).toBe(true);
  });

  it("round-trips through getSession", async () => {
    const created = await createSession(
      {
        type: "android",
        projectDir: "/proj",
        android: { avdName: "picklab-avd", consolePort: 5554 },
      },
      env,
    );
    const loaded = await getSession(created.id, env);
    expect(loaded).toEqual(created);
  });

  it("lists all sessions", async () => {
    const a = await createSession({ type: "desktop", projectDir: "/a" }, env);
    const b = await createSession(
      { type: "desktop+android", projectDir: "/b" },
      env,
    );
    const sessions = await listSessions(env);
    expect(sessions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("updates a session with a patch", async () => {
    const created = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    const updated = await updateSession(
      created.id,
      { status: "running", desktop: { display: ":99", xvfbPid: 1234 } },
      env,
    );
    expect(updated.status).toBe("running");
    expect(updated.desktop?.display).toBe(":99");
    const reloaded = await getSession(created.id, env);
    expect(reloaded?.status).toBe("running");
  });

  it("destroys session records", async () => {
    const created = await createSession(
      { type: "desktop", projectDir: "/proj" },
      env,
    );
    await destroySessionRecord(created.id, env);
    expect(await getSession(created.id, env)).toBeUndefined();
    expect(await listSessions(env)).toEqual([]);
  });

  it("returns undefined for unknown sessions", async () => {
    expect(await getSession("desk-ffffff", env)).toBeUndefined();
  });
});
