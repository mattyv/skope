import { describe, expect, test } from "vitest";
import { buildRedactor } from "../../src/runner/redact.js";
import { OutputStream } from "../../src/runner/stream.js";

describe("command output streaming", () => {
  test("emits complete lines before exit and preserves split UTF-8", () => {
    const output: string[] = [];
    const stream = new OutputStream(buildRedactor(), (s) => output.push(s));
    const bytes = Buffer.from("hello 世界\npartial");
    stream.push(bytes.subarray(0, 8));
    expect(output).toEqual([]);
    stream.push(bytes.subarray(8));
    expect(output.join("")).toBe("hello 世界\n");
    stream.end();
    expect(output.join("")).toBe("hello 世界\npartial\n");
  });

  test.each([
    "AKIAABCDEFGHIJKLMNOP\n",
    'password="first\nsecond"\n',
    "bearer\ncredential\n",
    "-----BEGIN PRIVATE KEY-----\nbody\n-----END PRIVATE KEY-----\n",
  ])("redacts secrets split into individual bytes: %s", (secret) => {
    let output = "";
    const r = buildRedactor();
    const stream = new OutputStream(r, (s) => {
      output += s;
    });
    for (const byte of Buffer.from(secret)) stream.push(Buffer.from([byte]));
    stream.end();
    const expected = r.redact(secret);
    expect(output).toBe(expected.endsWith("\n") ? expected : `${expected}\n`);
  });

  test("defers custom multiline patterns and literals until exit", () => {
    for (const opts of [{ patterns: ["first\\s+second"] }, { literals: ["first\nsecond"] }]) {
      let output = "";
      const stream = new OutputStream(buildRedactor(opts), (s) => {
        output += s;
      });
      stream.push(Buffer.from("first\n"));
      expect(output).toBe("");
      stream.push(Buffer.from("second\n"));
      stream.end();
      expect(output).toBe("[REDACTED]\n");
    }
  });

  test("omits oversized pending secrets without leaking their tail", () => {
    let output = "";
    const stream = new OutputStream(buildRedactor(), (s) => {
      output += s;
    });
    stream.push(Buffer.from(`password=${"x".repeat(1024 * 1024)}\n`));
    stream.push(Buffer.from("secret-tail\n"));
    stream.end();
    expect(output).toBe("skope: pending stream output omitted (over 1 MiB)\n");
  });
});
