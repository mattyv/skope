import { StringDecoder } from "node:string_decoder";
import { CAP_BYTES } from "./exec.js";
import type { Redactor } from "./redact.js";

/** Line framing keeps UTF-8 characters and secrets split across chunks intact. */
export class OutputStream {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private deferred: boolean;
  private omitted = false;

  constructor(
    private redactor: Redactor,
    private write: (text: string) => void,
  ) {
    this.deferred = redactor.deferStreaming;
  }

  push(chunk: Buffer) {
    if (this.omitted) return;
    this.pending += this.decoder.write(chunk);
    if (!this.deferred) {
      while (true) {
        const newline = this.pending.indexOf("\n");
        if (newline === -1) break;
        const line = this.pending.slice(0, newline + 1);
        // These built-ins can extend across lines. Retain the remainder so
        // redaction sees the complete value, including quoted passwords.
        if (this.redactor.usingDefaults && /PRIVATE KEY|bearer|password|passwd|secret|token|api[_-]?key/i.test(line)) {
          this.deferred = true;
          break;
        }
        this.write(this.redactor.redact(line));
        this.pending = this.pending.slice(newline + 1);
      }
    }
    if (Buffer.byteLength(this.pending) > CAP_BYTES) {
      this.pending = "";
      this.omitted = true;
      this.write("skope: pending stream output omitted (over 1 MiB)\n");
    }
  }

  end() {
    if (this.omitted) return;
    this.pending += this.decoder.end();
    if (this.pending) {
      const text = this.redactor.redact(this.pending);
      this.write(text.endsWith("\n") ? text : `${text}\n`);
    }
    this.pending = "";
  }
}
