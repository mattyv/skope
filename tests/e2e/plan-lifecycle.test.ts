// Plan mode end to end (tests/e2e/README.md): a simulated Claude Code or Codex session writes a
// skope plan, the person approves (or doesn't), the hook runs, and the agent runs the plan and
// handles what comes back. Every scenario runs for both tools, through the built CLI and the real
// hook. What's simulated is only the tool: its transcript, and when it calls the hook.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { create, edit, plan, sessions, world } from "./lib.js";

const TOOLS = ["claude", "codex"] as const;
const changeEvents = (r: { events: { event: string }[] }) =>
  r.events.filter((e) => e.event === "change") as unknown as { op: string; path: string; result: string }[];

describe.each(TOOLS)("%s", (tool) => {
  const session = (w: ReturnType<typeof world>, name: string) => sessions[tool](w, name);

  test("happy path: edits, a new file, a deletion and a check, approved and applied", () => {
    const w = world({ "src/app.ts": "const retries = 3;\nexport { retries };\n", "old.txt": "gone\n" });
    const s = session(w, "happy");
    s.write(
      plan(
        "happy",
        `## Change\nRaise the limit.\n\n${edit("src/app.ts", "const retries = 3;\n", "const retries = 5;\n")}\n${create("NOTES.md", "Retries are 5.\n")}\n- **delete** \`old.txt\`\n- **check** \`grep -q "retries = 5" src/app.ts\` succeeds · else [Fix]\n- **stop**\n\n## Fix\n- **hand off**`,
      ),
    );
    const shown = s.present();
    expect(shown.lint.code).toBe(0);
    // Not approved yet: nothing runs.
    expect(s.apply().error).toMatchObject({ code: "E-NOT-APPROVED" });
    expect(s.approve().code).toBe(0);
    const r = s.apply();
    expect(r.code).toBe(0);
    expect(changeEvents(r).map((e) => [e.op, e.result])).toEqual([
      ["edit", "applied"],
      ["create", "applied"],
      ["delete", "applied"],
    ]);
    expect(w.read("src/app.ts")).toBe("const retries = 5;\nexport { retries };\n");
    expect(w.read("NOTES.md")).toBe("Retries are 5.\n");
    expect(w.exists("old.txt")).toBe(false);
  });

  test("fix loop: a failing check hands back with its output; the agent revises, is re-approved, and finishes", () => {
    const w = world({ "src/app.ts": "const retries = 3;\nconst timeout = 10;\n" });
    const s = session(w, "fixloop");
    const check = `- **check** \`grep -q "timeout = 30" src/app.ts\` succeeds · else [Fix]\n- **stop**\n\n## Fix\n- **hand off**`;
    s.write(plan("fixloop", `## Change\n${edit("src/app.ts", "const retries = 3;\n", "const retries = 5;\n")}\n${check}`));
    s.present();
    s.approve();
    const first = s.apply();
    expect(first.code).toBe(20);
    const record = first.events.find((e) => e.event === "handoff_record")?.record as { detail: Record<string, unknown> };
    expect(record.detail).toMatchObject({ cmd: 'grep -q "timeout = 30" src/app.ts', exit: 1 });
    expect(String(record.detail.log)).toMatch(/exec-\d+\.log$/);
    expect(w.read("src/app.ts")).toBe("const retries = 5;\nconst timeout = 10;\n");

    // The skill: take out the edit that already applied, add the missing one, present again.
    s.write(plan("fixloop", `## Change\n${edit("src/app.ts", "const timeout = 10;\n", "const timeout = 30;\n")}\n${check}`));
    // The old approval doesn't cover the revised plan.
    expect(s.apply().error).toMatchObject({ code: "E-NOT-APPROVED" });
    s.present();
    s.approve();
    const second = s.apply();
    expect(second.code).toBe(0);
    expect(w.read("src/app.ts")).toBe("const retries = 5;\nconst timeout = 30;\n");
  });

  test("resume: same plan, same approval, --from the section that failed", () => {
    const w = world({ "a.txt": "one\n" });
    const s = session(w, "resume");
    s.write(
      plan(
        "resume",
        `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **then** [Test]\n\n## Test\n- **check** \`test -f ready\` succeeds · else [Fix]\n- **stop**\n\n## Fix\n- **hand off**`,
      ),
    );
    s.present();
    s.approve();
    expect(s.apply().code).toBe(20);
    w.write("ready", ""); // what the check was waiting for
    const resumed = s.apply(["--from", "Test"]);
    expect(resumed.code).toBe(0);
    expect(resumed.events.find((e) => e.event === "run_start")).toMatchObject({ from: "Test" });
    expect(changeEvents(resumed)).toEqual([]);
    // Running the whole plan again is safe too: the edit is already in place.
    const again = s.apply();
    expect(again.code).toBe(0);
    expect(changeEvents(again).map((e) => e.result)).toEqual(["already_applied"]);
  });

  test("text files keep their line endings and a missing final newline", () => {
    const w = world({ "win.txt": "a\r\nb\r\n", "tail.txt": "x\ny" });
    const s = session(w, "eol");
    s.write(plan("eol", `## Change\n${edit("win.txt", "b\n", "c\n")}\n${edit("tail.txt", "y\n", "z\n")}\n- **stop**`));
    s.present();
    s.approve();
    expect(s.apply().code).toBe(0);
    expect(w.read("win.txt")).toBe("a\r\nc\r\n");
    expect(w.read("tail.txt")).toBe("x\nz");
  });

  test("a file changed after approval stops the run before anything changes (E-PLAN-STALE)", () => {
    const w = world({ "a.txt": "one\n", "b.txt": "keep\n" });
    const s = session(w, "stale");
    s.write(plan("stale", `## Change\n${edit("b.txt", "keep\n", "kept\n")}\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    s.present();
    s.approve();
    w.write("a.txt", "someone else's edit\n");
    const r = s.apply();
    expect(r.error).toMatchObject({ code: "E-PLAN-STALE" });
    expect(w.read("b.txt")).toBe("keep\n");
    expect(w.read("a.txt")).toBe("someone else's edit\n");
  });

  test("a plan edited after approval doesn't run", () => {
    const w = world({ "a.txt": "one\n" });
    const s = session(w, "edited");
    s.write(plan("edited", `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    s.present();
    s.approve();
    s.write(plan("edited", `## Change\n${edit("a.txt", "one\n", "rm -rf, but as text\n")}\n- **stop**`));
    expect(s.apply().error).toMatchObject({ code: "E-NOT-APPROVED" });
    expect(w.read("a.txt")).toBe("one\n");
  });

  test("a rejected plan doesn't run", () => {
    const w = world({ "a.txt": "one\n" });
    const s = session(w, "rejected");
    s.write(plan("rejected", `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    s.present();
    s.reject();
    expect(s.apply().error).toMatchObject({ code: "E-NOT-APPROVED" });
    expect(w.read("a.txt")).toBe("one\n");
  });

  test("the agent can't approve its own plan: --approve, a hand-written approval, a made-up hook call", () => {
    const w = world({ "a.txt": "one\n" });
    const s = session(w, "forged");
    s.write(plan("forged", `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    const { hash, line } = s.present();
    expect(w.skope([s.path, "--approve", "--config", w.config]).error).toMatchObject({ code: "E-USAGE" });
    writeFileSync(join(w.repo, "forged.approval.json"), JSON.stringify({ skill: "forged", effects_hash: `sha256:${hash}`, commands: [] }));
    // A hook call the tool never made: no such call in the transcript.
    w.skope(
      ["--plan-approved"],
      w.repo,
      JSON.stringify(
        tool === "claude"
          ? {
              hook_event_name: "PostToolUse",
              tool_name: "ExitPlanMode",
              tool_use_id: "toolu_madeup",
              cwd: w.repo,
              transcript_path: join(w.claude, "projects", "p", "forged.jsonl"),
              tool_response: { plan: line },
            }
          : {
              hook_event_name: "UserPromptSubmit",
              prompt: `Implement the plan now. ${line}`,
              cwd: w.repo,
              transcript_path: join(w.codex, "sessions", "forged.jsonl"),
            },
      ),
    );
    expect(s.apply().error).toMatchObject({ code: "E-NOT-APPROVED" });
    expect(w.read("a.txt")).toBe("one\n");
  });
});

describe("tool-specific", () => {
  test("claude: a session started in a subfolder approves and runs the plan for the whole repository", () => {
    const w = world({ "pkg/lib.ts": "export const v = 1;\n" });
    const s = sessions.claude(w, "subdir");
    s.write(plan("subdir", `## Change\n${edit("pkg/lib.ts", "export const v = 1;\n", "export const v = 2;\n")}\n- **stop**`));
    s.present();
    const sub = join(w.repo, "pkg");
    expect(s.approve({ cwd: sub }).code).toBe(0);
    expect(s.apply([], sub).code).toBe(0);
    expect(w.read("pkg/lib.ts")).toBe("export const v = 2;\n");
  });

  test("claude: an approval works once", () => {
    const w = world({ "a.txt": "one\n" });
    const s = sessions.claude(w, "once");
    s.write(plan("once", `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    s.present();
    s.approve();
    expect(s.approve().stderr).toContain("already used");
  });

  test("codex: the clear-context approval carries the plan", () => {
    const w = world({ "a.txt": "one\n" });
    const s = sessions.codex(w, "fresh", { clearContext: true } as never);
    s.write(plan("fresh", `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    s.present();
    expect(s.approve().stderr).toContain("approved");
    expect(s.apply().code).toBe(0);
    expect(w.read("a.txt")).toBe("two\n");
  });

  test("codex: a plan in a folder that isn't a git repository", () => {
    const w = world({ "a.txt": "one\n" }, { git: false });
    const s = sessions.codex(w, "nogit");
    s.write(plan("nogit", `## Change\n${edit("a.txt", "one\n", "two\n")}\n- **stop**`));
    s.present();
    s.approve();
    const r = s.apply();
    expect({ code: r.code, error: r.error?.code }).toEqual({ code: 0, error: undefined });
    expect(w.read("a.txt")).toBe("two\n");
  });
});
