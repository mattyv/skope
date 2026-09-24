// Helper process for lock.test.ts. argv: <lock module .mjs> <dir> <name>.
// Loads the lock module, says "ready", acquires on "go" and reports the
// result, and releases and exits on "release". The parent sends "go" to
// every racer at once and "release" only after every result is in, so the
// winner holds the lock for as long as the others are looking.
import { pathToFileURL } from "node:url";

const [modPath, dir, name] = process.argv.slice(2);
const { acquireLock } = await import(pathToFileURL(modPath).href);
let held;
process.on("message", (m) => {
  if (m === "go") {
    held = acquireLock(name, dir);
    process.send({ pid: process.pid, status: held.status, holderPid: held.holderPid ?? null });
  } else if (m === "release") {
    held?.release?.();
    process.exit(0);
  }
});
process.send("ready");
