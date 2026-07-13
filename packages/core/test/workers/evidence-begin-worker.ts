// Separate-process begin worker, run with `bun`. Races real `beginEvidenceRun`
// calls from distinct processes to prove the wx claim protocol yields exactly
// one run with no orphan directories. Not a `*.test.ts` file, so vitest never
// runs it directly.
//
// An optional 4th arg is a post-begin hold in milliseconds. The winner is the
// run's owner; adoption is only meaningful while that owner is alive (a run
// whose creator has exited is, by design, a recoverable orphan — see
// resolveActivePointer's dead-owner handling). Holding every racer alive for the
// duration of the race models the real, long-lived session owner, so the losers
// resolve the winner's pointer as active and adopt it instead of each starting a
// fresh recovery run.
import { setTimeout as delay } from "node:timers/promises";
import { beginEvidenceRun } from "../../src/evidence.js";

const projectDir = process.argv[2];
const sessionId = process.argv[3];
const holdMs = process.argv[4] === undefined ? 0 : Number(process.argv[4]);
if (projectDir === undefined || sessionId === undefined || !Number.isFinite(holdMs)) {
  console.error("usage: evidence-begin-worker <projectDir> <sessionId> [holdMs]");
  process.exit(2);
}

const result = await beginEvidenceRun(projectDir, sessionId, { slug: "race" });
// The parent reads this single line from stdout to tally winners/adopters. Emit
// it before the hold so the parent sees the outcome even if it stops waiting.
process.stdout.write(
  `${JSON.stringify({ runId: result.run.runId, adopted: result.adopted })}\n`,
);
if (holdMs > 0) await delay(holdMs);
process.exit(0);
