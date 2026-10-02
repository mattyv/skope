/** A readable view of runtime events. Execution and approval rules stay in the host. */
export class ReadableOutput {
  private currentSection: string | null = null;
  constructor(private write: (text: string) => void) {}

  section(name: string) {
    if (name === this.currentSection) return;
    this.currentSection = name;
    this.write(`\n${name}\n`);
  }

  event(e: Record<string, unknown>) {
    if (typeof e.section === "string") this.section(e.section);
    switch (e.event) {
      case "run_start":
        this.write(`${e.dry_run ? "Previewing" : "Running"} ${e.skill}\n`);
        if (e.dry_run) this.write("Changes will be skipped. Read-only commands still run.\n");
        break;
      case "transfer":
        this.section(String(e.to));
        break;
      case "run":
      case "check_cmd":
      case "effect_end":
        this.write(
          e.timed_out
            ? "  [!] Timed out\n"
            : e.exit === 0
              ? "  [ok] Passed\n"
              : `  [!] ${e.exit === null ? "Interrupted" : `Failed (exit ${e.exit})`}\n`,
        );
        break;
      case "change":
        this.write(
          `  ${e.result === "already_applied" ? "Already in place" : e.result === "failed" ? "Could not change" : "Changed"}: ${e.path}\n`,
        );
        break;
      case "would_do":
        this.write(`  [ ] Would change: ${e.cmd}\n`);
        break;
      case "check":
        this.write(
          `  ${e.result === true ? "[ok]" : "[!]"} ${e.expr}: ${e.result === null ? "could not evaluate" : e.result ? "passed" : "condition not met"}${e.after_would_do ? " (preview; changes were skipped)" : ""}\n`,
        );
        break;
      case "ask":
        this.write(`  ${e.passed ? "[ok]" : "[!]"} ${e.question}: ${e.passed ? e.chosen : "no confident answer"}\n`);
        break;
      case "would_page":
        this.write(`  Would notify a person: ${e.text}\n`);
        break;
      case "page":
      case "handoff_page":
        this.write(`  ${e.ok ? "Notified a person" : "Could not send notification"}: ${e.text}\n`);
        break;
      case "handoff_record":
        this.write(`  Details for continuing: ${e.path}\n`);
        break;
      case "outcome": {
        const reasons: Record<string, string> = {
          explicit: "The plan asks a person or agent to continue.",
          gate_failed: "A decision did not meet the required confidence.",
          command_failed: "A command or check failed.",
          ask_unavailable: "The decision service was unavailable.",
          deadline: "The run reached its time limit.",
        };
        const status: Record<string, string> = {
          stopped: e.dry_run ? "Preview finished. Changes were skipped." : "Finished.",
          paged: "Stopped after notifying a person.",
          handoff: `Needs attention. ${reasons[String(e.reason)] ?? "A person or agent needs to continue."}`,
          invalid: "Could not start. See the error above.",
          error: "Stopped because of an error. See above.",
          locked: "Another run is already in progress.",
          stale_lock: "A previous run left a lock. Check it before continuing.",
        };
        this.write(`\n${status[String(e.outcome)] ?? "Stopped."}${e.summary ? ` ${e.summary}.` : ""}\n`);
        break;
      }
    }
  }
}
