import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { lint } from "../lint.js";
import { preprocess } from "../preprocess/index.js";
import { currentText } from "../runner/change.js";
import { plainText } from "../runner/events.js";
import { parsePatch, patchText, safePatchPath } from "../runner/patch.js";
import { changeHash, effectsOf } from "./effects.js";
import { claudeDir } from "./hooks.js";
import { fileSteps, planChanges, planDiff, repoRoot, rootForPlan, unifiedDiff } from "./plan.js";

const HELP = `usage: skope plan --from-tree DIR [--base DIR] --output PATH [--check COMMAND]... [--name NAME]
       skope plan --from-diff FILE [--base DIR] --output PATH [--check COMMAND]... [--name NAME]
       skope plan PATH --review [--diff]

Compare the current base tree with a complete prototype tree, or import a unified
diff. Write an executable plan without changing the base files or approving it.
--check adds a check with a Fix handoff. --review prints compact approval text.
Text content changes only: binary files, symlinks, renames, and mode changes are refused.`;

function gitFiles(root: string): string[] | null {
  try {
    if (realpathSync(repoRoot(root)) !== root) return null;
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
      .toString()
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function files(root: string): string[] {
  const git = gitFiles(root);
  if (git) return git.filter((p) => !p.startsWith(".skope/") && p !== ".git");
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      if ([".git", ".skope", "node_modules"].includes(entry.name)) continue;
      const p = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(p);
      else out.push(p);
      if (out.length > 100_000) throw new Error("prototype contains too many files; use a clean scratch tree or worktree");
    }
  };
  walk("");
  return out;
}

function treePatches(base: string, tree: string): { path: string; text: string }[] {
  if (base === tree) throw new Error("the prototype must be a separate tree; base files are never reverted by this command");
  const baseInTree = relative(tree, base);
  if (baseInTree && !baseInTree.startsWith("..") && !isAbsolute(baseInTree)) throw new Error("the prototype cannot contain the base tree");
  const treeInBase = relative(base, tree);
  const nested = treeInBase && !treeInBase.startsWith("..") && !isAbsolute(treeInBase) ? treeInBase : null;
  const baseline = files(base).filter((path) => !nested || (path !== nested && !path.startsWith(`${nested}/`)));
  const prototype = files(tree);
  let ignored = new Set<string>();
  if (prototype.length && gitFiles(base)) {
    try {
      ignored = new Set(
        execFileSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
          cwd: base,
          input: `${prototype.join("\0")}\0`,
          maxBuffer: 16 * 1024 * 1024,
        })
          .toString()
          .split("\0")
          .filter(Boolean),
      );
    } catch (err) {
      const result = err as { status?: number; stdout?: Buffer };
      if (result.status !== 1) throw err;
    }
  }
  const paths = [...new Set([...baseline, ...prototype.filter((p) => !ignored.has(p))])].sort();
  const out: { path: string; text: string }[] = [];
  for (const path of paths) {
    safePatchPath(path);
    const read = (root: string) => {
      try {
        const st = lstatSync(join(root, path));
        if (!st.isFile()) throw new Error(`${path}: symlinks and non-regular files are not supported`);
        return { text: currentText(root, path), mode: st.mode & 0o777, raw: readFileSync(join(root, path)) };
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return { text: null, mode: null, raw: null };
        throw err;
      }
    };
    const before = read(base);
    const after = read(tree);
    if (before.mode !== null && after.mode !== null && before.mode !== after.mode)
      throw new Error(`${path}: file mode changes are not supported`);
    if (before.mode === null && after.mode !== null && ![0o644, 0o664].includes(after.mode))
      throw new Error(`${path}: new files must have mode 0644 or 0664 (created with mode 0644)`);
    if (before.text === after.text && before.raw?.equals(after.raw ?? Buffer.alloc(0)) === false)
      throw new Error(`${path}: changing line endings is not supported`);
    if (before.raw && after.raw && before.raw.includes(Buffer.from("\r\n")) !== after.raw.includes(Buffer.from("\r\n")))
      throw new Error(`${path}: changing line endings is not supported`);
    if (before.text === after.text) continue;
    let text = unifiedDiff(path, before.text, after.text);
    const simulated = patchText(before.text, path, text);
    if (simulated.result !== "applied" || simulated.after !== after.text) {
      // Repeated lines can make a short insertion look already applied.
      // More context removes the ambiguity without guessing where to edit.
      text = unifiedDiff(
        path,
        before.text,
        after.text,
        Math.max(before.text?.split("\n").length ?? 0, after.text?.split("\n").length ?? 0),
      );
      const full = patchText(before.text, path, text);
      if (full.result !== "applied" || full.after !== after.text)
        throw new Error(`${path}: the patch cannot represent this change unambiguously`);
    }
    out.push({ path, text });
  }
  return out;
}

function validated(text: string) {
  const parsed = preprocess(text);
  if ("errors" in parsed) throw new Error(parsed.errors.map((e) => `${e.code} at line ${e.line}: ${e.message}`).join("\n"));
  const checked = lint(parsed.program);
  if (checked.errors.length) throw new Error(checked.errors.map((e) => `${e.code} at line ${e.line}`).join("\n"));
  if (parsed.program.kind !== "plan") throw new Error("expected a kind: plan document");
  return parsed;
}

/** Compact approval text identifies the exact executable plan without copying its body. */
export function reviewPlan(file: string, includeDiff = false): string {
  if (/\s/.test(file)) throw new Error("approval marker paths cannot contain whitespace");
  const parsed = validated(readFileSync(file, "utf8"));
  const changes = planChanges(parsed.program);
  const steps = fileSteps(rootForPlan(file, process.cwd(), claudeDir()), changes);
  for (const [path, step] of steps) if (step.error) throw new Error(`${path}: ${step.error}`);
  const effects = effectsOf(parsed.program, parsed.choices);
  const commands = effects.commands.filter((c) => c.kind !== "do");
  // Raw do commands are still listed: no command disappears from the review.
  const changeDescriptors = new Set(changes.map((c) => `${c.op} ${c.path} #${changeHash(c)}`));
  const containsDo = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(containsDo)
      : value !== null && typeof value === "object"
        ? Object.entries(value).some(([key, child]) => key === "do" || containsDo(child))
        : false;
  const hasRawDo = containsDo(parsed.program.sections);
  const actions = effects.commands.filter((c) => c.kind === "do" && (hasRawDo || !changeDescriptors.has(c.cmd)));
  const lines = [
    `skope plan: ${file} ${effects.hash.slice(7)}`,
    "",
    `Review ${steps.size} file change${steps.size === 1 ? "" : "s"} in ${file}.`,
  ];
  for (const [path] of steps) lines.push(`- ${path}`);
  lines.push("", "Commands:");
  for (const c of [...commands, ...actions]) lines.push(`- ${c.kind}: ${c.cmd}`);
  if (!commands.length && !actions.length) lines.push("- None.");
  lines.push(
    "",
    "Approve only after reviewing the complete diff and commands.",
    `Inspect: skope ${file} --effects --diff`,
    "This text records no approval; the host's plan-mode hook records the person's approval.",
  );
  if (includeDiff) lines.push("", "Complete diff:", planDiff(rootForPlan(file, process.cwd(), claudeDir()), changes));
  return `${lines.join("\n")}\n`;
}

export function generatePlan(argv: string[]): number {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "from-tree": { type: "string" },
        "from-diff": { type: "string" },
        base: { type: "string" },
        output: { type: "string" },
        check: { type: "string", multiple: true },
        name: { type: "string" },
        review: { type: "boolean" },
        diff: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
    if (values.review) {
      if (positionals.length !== 1 || Object.keys(values).some((key) => key !== "review" && key !== "diff"))
        throw new Error("--review takes exactly one plan path and optionally --diff");
      process.stdout.write(plainText(reviewPlan(positionals[0] as string, values.diff)));
      return 0;
    }
    if (values.diff) throw new Error("--diff goes with --review");
    if (positionals.length || !!values["from-tree"] === !!values["from-diff"] || !values.output)
      throw new Error("give exactly one of --from-tree or --from-diff, and --output");
    const base = realpathSync(values.base ?? repoRoot(process.cwd()));
    if (!statSync(base).isDirectory()) throw new Error("--base must be a directory");
    const output = resolve(values.output);
    if (/\s/.test(values.output)) throw new Error("--output cannot contain whitespace (the approval marker needs a single path)");
    const name =
      values.name ??
      basename(output, ".md")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-");
    if (!/^[a-z][a-z0-9-]*$/.test(name))
      throw new Error("--name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens");
    const diffBytes = values["from-diff"] ? readFileSync(values["from-diff"]) : null;
    if (diffBytes && Buffer.from(diffBytes.toString("utf8")).compare(diffBytes) !== 0) throw new Error("the diff is not valid UTF-8");
    const patches = values["from-tree"]
      ? treePatches(base, realpathSync(values["from-tree"]))
      : parsePatch((diffBytes as Buffer).toString("utf8"));
    if (!patches.length) throw new Error("the prototype has no content changes");
    for (const patch of patches) {
      if (resolve(base, patch.path) === output) throw new Error("the plan cannot change its own output file");
      if (patch.path.includes("`") || /[{}]/.test(patch.path))
        throw new Error(`${patch.path}: this path cannot be represented by a literal skope path`);
    }
    const lines = [
      "---",
      `name: ${name}`,
      "description: Apply the reviewed changes and run the listed checks.",
      "---",
      "",
      `# ${name}`,
      "",
      "A skope plan. Run it with skope, never by hand.",
      "",
      "```skope",
      "format: 1",
      "kind: plan",
      "```",
      "",
      "Run this skope plan through the runtime, never by hand.",
      "",
      "## Apply changes",
      "Apply only the reviewed file patches.",
      "",
    ];
    for (const patch of patches) {
      const fence = "`".repeat(Math.max(3, ...[...patch.text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      lines.push(
        `- **patch** \`${patch.path}\` · else [Fix]`,
        `  ${fence}diff`,
        ...patch.text
          .replace(/\n$/, "")
          .split("\n")
          .map((line) => `  ${line}`),
        `  ${fence}`,
      );
    }
    if (values.check?.length) {
      lines.push("- **then** [Check changes]", "", "## Check changes", "Run the reviewed checks before finishing.", "");
      for (const command of values.check) {
        if (!command || /[\r\n`]/.test(command)) throw new Error("--check must be a nonempty single-line command without backticks");
        lines.push(`- **check** \`${command}\` succeeds · else [Fix]`);
      }
    }
    lines.push(
      "- **stop**",
      "",
      "## Fix",
      "A patch or check failed. Inspect the handoff record, update the plan, and resume.",
      "",
      "- **hand off**",
      "",
    );
    const text = lines.join("\n");
    const parsed = validated(text);
    for (const [path, step] of fileSteps(base, planChanges(parsed.program))) if (step.error) throw new Error(`${path}: ${step.error}`);
    // A plan outside the repository would execute against the wrong root.
    const candidateRoot = rootForPlan(output, base, claudeDir());
    if (candidateRoot !== base) throw new Error("--output must belong to the base repository, normally .skope/plans/NAME.md");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, text, { flag: "wx", mode: 0o600 });
    process.stderr.write(
      `skope: wrote ${values.output}; ${patches.length} file change${patches.length === 1 ? "" : "s"}, ${values.check?.length ?? 0} checks. Nothing applied or approved.\n`,
    );
    process.stdout.write(plainText(reviewPlan(values.output)));
    return 0;
  } catch (err) {
    process.stderr.write(plainText(`skope plan: ${(err as Error).message}\n${HELP}\n`));
    return 40;
  }
}
