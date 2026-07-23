import { getTakeoverStatus, resolveDesktopCapableSession } from "@pickforge/picklab-core";
import {
  resolveProjectDir,
  runReported,
  type BaseCliOptions,
  type CommandResult,
} from "./shared.js";

export interface TakeoverStatusOptions extends BaseCliOptions {
  session?: string;
}

export async function takeoverStatus(
  opts: TakeoverStatusOptions,
): Promise<CommandResult> {
  const record = await resolveDesktopCapableSession(opts.session, {
    projectDir: resolveProjectDir(opts),
  });
  const status = await getTakeoverStatus(record.id);
  const data: Record<string, unknown> = {
    sessionId: record.id,
    active: status.active,
  };
  if (status.stale === true) data.stale = true;
  if (status.lease !== undefined) {
    data.lease = {
      leaseId: status.lease.leaseId,
      ownerPid: status.lease.ownerPid,
      createdAt: status.lease.createdAt,
      expiresAt: status.lease.expiresAt,
      ...(status.lease.vncPort === undefined ? {} : { vncPort: status.lease.vncPort }),
    };
  }
  const line = status.active
    ? `session ${record.id} is under human control (lease ${status.lease?.leaseId}, since ${status.lease?.createdAt})`
    : status.stale === true
      ? `session ${record.id} has a stale human lease pending recovery (lease ${status.lease?.leaseId})`
      : `session ${record.id} is agent-active (no human lease)`;
  return { data, lines: [line] };
}

export async function runTakeoverStatus(opts: TakeoverStatusOptions): Promise<number> {
  return runReported(opts, () => takeoverStatus(opts));
}
