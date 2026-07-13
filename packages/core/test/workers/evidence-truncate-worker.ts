// Separate-process truncation worker, run with `bun` (the repo's test runtime).
// Every append targets a run that is already over its byte cap, so each worker
// contends on the one-time truncation-marker sentinel from a distinct OS
// process. This proves the marker is written exactly once across processes, not
// just under in-process Promise.all. Not a `*.test.ts` file, so vitest never
// runs it directly.
import { appendAction, type EvidenceAction } from "../../src/evidence.js";

const runDir = process.argv[2];
const worker = process.argv[3];
const count = Number(process.argv[4]);
const maxBytes = Number(process.argv[5]);
if (
  runDir === undefined ||
  worker === undefined ||
  !Number.isInteger(count) ||
  !Number.isInteger(maxBytes)
) {
  console.error(
    "usage: evidence-truncate-worker <runDir> <workerId> <count> <maxBytes>",
  );
  process.exit(2);
}

for (let index = 0; index < count; index += 1) {
  const action: EvidenceAction = {
    actionId: `${worker}-${index}`,
    source: "worker",
    tool: "truncate",
    startedAt: new Date().toISOString(),
    status: "ok",
  };
  // Metadata-only actions past the cap are recorded (`appended`); the crossing
  // append reports `truncated`. Any other outcome is a bug under contention.
  const result = await appendAction(runDir, action, { maxBytes, maxLineBytes: 4096 });
  if (result.outcome !== "appended" && result.outcome !== "truncated") {
    console.error(`unexpected outcome ${result.outcome} at ${worker}-${index}`);
    process.exit(1);
  }
}
process.exit(0);
