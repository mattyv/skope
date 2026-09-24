// The --fake and --fake-exec files, checked by hand against
// contracts/fakes.schema.json (SPEC §7.1 E-CONFIG). The schema is small
// enough that this is shorter than shipping a validator;
// tests/runner/fakes.test.ts checks the two agree. Numbers are checked as
// JSON Schema (ajv) checks them: `integer` is any number with no fraction.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === "number" && !(v % 1) && !Number.isNaN(v);
const RESULT_KEYS = ["exit", "stdout", "stderr", "timed_out", "ms"];

function resultError(r: unknown): string | null {
  if (typeof r === "string") return null; // shorthand for {exit: 0, stdout: r}
  if (!isObj(r)) return "a result must be a mapping or a string";
  const extra = Object.keys(r).find((k) => !RESULT_KEYS.includes(k));
  if (extra !== undefined) return `unknown key ${extra}`;
  if (!("exit" in r)) return "exit is required";
  if (r.exit !== null && !isInt(r.exit)) return "exit must be an integer or null";
  for (const k of ["stdout", "stderr"]) if (k in r && typeof r[k] !== "string") return `${k} must be a string`;
  if ("timed_out" in r && typeof r.timed_out !== "boolean") return "timed_out must be true or false";
  if ("ms" in r && !(isInt(r.ms) && (r.ms as number) >= 0)) return "ms must be a whole number of 0 or more";
  return null;
}

function answerError(a: unknown): string | null {
  if (a === "unsure" || a === "unavailable") return null;
  if (!isObj(a) || Object.keys(a).length === 0) return 'an answer must be "unsure", "unavailable" or probabilities by option id';
  return Object.values(a).every((p) => typeof p === "number") ? null : "every probability must be a number";
}

/** commands.yaml's string shorthand (SPEC §7.3): a plain string result. */
const SHORTHAND_EXIT = 0;

const expandResult = (r: unknown): unknown => (typeof r === "string" ? { exit: SHORTHAND_EXIT, stdout: r } : r);

/**
 * `commands.yaml` (or a tests.yaml scenario's `commands`) with every string-shorthand result
 * expanded to `{exit: 0, stdout: <the string>}`, so downstream code (the strict key rules,
 * `fakeExec`) only ever sees full result objects. Only commands.yaml has the shorthand: call this
 * for `def === "commands"` only.
 */
export function expandCommands(doc: unknown): unknown {
  if (!isObj(doc)) return doc;
  return Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, Array.isArray(v) ? v.map(expandResult) : expandResult(v)]));
}

/** Why `doc` isn't a valid fake `def` file, or null if it is. */
export function fakesError(doc: unknown, def: "answers" | "commands"): string | null {
  if (!isObj(doc)) return "the file must be a mapping";
  for (const [key, v] of Object.entries(doc)) {
    if (key === "") return "a key must not be empty";
    const why =
      def === "answers"
        ? answerError(v)
        : Array.isArray(v)
          ? v.length === 0
            ? "a list of results must not be empty"
            : (v.map(resultError).find((e) => e !== null) ?? null)
          : resultError(v);
    if (why !== null) return `${key}: ${why}`;
  }
  return null;
}
