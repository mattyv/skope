// Helper process for lock.test.ts: acquires the lock, prints the result as
// JSON, and (if acquired) holds it briefly before releasing, so a sibling
// process racing for the same lock sees it held.
import { acquireLock } from "../../../src/runner/lock.ts";

const [dir, name] = process.argv.slice(2);
const r = acquireLock(name, dir);
if (r.status === "acquired") {
  process.stdout.write(`${JSON.stringify({ status: r.status })}\n`);
  // Hold the lock briefly so a racing sibling reliably observes it held.
  await new Promise((res) => setTimeout(res, 200));
  r.release();
} else {
  process.stdout.write(`${JSON.stringify({ status: r.status })}\n`);
}
