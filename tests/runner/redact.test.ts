// Redaction (SPEC §9): each built-in pattern, custom patterns, W-REDACT-OFF
// when the defaults are turned off, linear time on hostile input, and
// redact-before-cut around the capture cap and the 2KB tail.

import { describe, expect, test } from "vitest";
import { buildRedactor, compilePattern, tailBytes } from "../../src/runner/redact.js";

const R = "[REDACTED]";

describe("buildRedactor (SPEC §9)", () => {
  test("redacts an AWS access key id", () => {
    const r = buildRedactor();
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP end")).toBe(`key=${R} end`);
  });

  test("redacts a private key block through its matching END line", () => {
    const r = buildRedactor();
    const block = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIB...\nmore...\n-----END RSA PRIVATE KEY-----\nafter";
    expect(r.redact(block)).toBe(`before\n${R}\nafter`);
  });

  test("two private key blocks are redacted separately, keeping the text between them", () => {
    const r = buildRedactor();
    const k = (n: string) => `-----BEGIN PRIVATE KEY-----\n${n}\n-----END PRIVATE KEY-----`;
    expect(r.redact(`${k("a")}\nmiddle\n${k("b")}`)).toBe(`${R}\nmiddle\n${R}`);
  });

  test("a private key block with no END line is redacted to the end of the text", () => {
    const r = buildRedactor();
    expect(r.redact("ok\n-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\nstill key")).toBe(`ok\n${R}`);
  });

  test("a private key END line with no BEGIN is redacted from the start of the text", () => {
    const r = buildRedactor();
    expect(r.redact("MHcCAQEE\nkeybody\n-----END EC PRIVATE KEY-----\nafter")).toBe(`${R}\nafter`);
  });

  test("a BEGIN with no END before a complete block: everything from the orphan BEGIN is redacted", () => {
    const r = buildRedactor();
    const t = "x\n-----BEGIN RSA PRIVATE KEY-----\nhalf\n-----BEGIN RSA PRIVATE KEY-----\nfull\n-----END RSA PRIVATE KEY-----\ny";
    expect(r.redact(t)).toBe(`x\n${R}`);
  });

  test("redacts a bearer token, case-insensitively", () => {
    const r = buildRedactor();
    expect(r.redact("Authorization: Bearer abc.123-XYZ")).toBe(`Authorization: ${R}`);
    expect(r.redact("authorization: bearer abc")).toBe(`authorization: ${R}`);
  });

  test("redacts a JWT", () => {
    const r = buildRedactor();
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dGVzdHNpZw";
    expect(r.redact(`id is ${jwt} here`)).toBe(`id is ${R} here`);
  });

  test("redacts key-value secrets (password, passwd, secret, token, api_key), case-insensitively", () => {
    const r = buildRedactor();
    expect(r.redact("password=hunter2")).toBe(R);
    expect(r.redact("passwd=hunter2")).toBe(R);
    expect(r.redact("Secret: sh")).toBe(R);
    expect(r.redact("token=abc")).toBe(R);
    expect(r.redact("API_KEY=abc123")).toBe(R);
    expect(r.redact("apikey: xyz")).toBe(R);
    expect(r.redact("api-key: xyz")).toBe(R);
  });

  test("key-value secrets in JSON, with quoted values containing spaces (P2-14)", () => {
    const r = buildRedactor();
    const out = r.redact('{"password": "hunter2 with spaces", "user": "bob"}');
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("spaces");
    expect(out).toContain('"user": "bob"');
    expect(r.redact("x='secret: it is here' y")).not.toContain("it is here");
  });

  test("key-value secrets with prefixed names, such as aws_secret_access_key (P2-14)", () => {
    const r = buildRedactor();
    expect(r.redact("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG")).toBe(R);
    expect(r.redact("DB_PASSWORD_FILE: /run/pw")).toBe(R);
    expect(r.redact("github_token=ghp_abc")).toBe(R);
  });

  test("redacts credentials embedded in a URL", () => {
    const r = buildRedactor();
    expect(r.redact("fetch https://user:pass@example.com/path")).toBe(`fetch https${R}example.com/path`);
  });

  test("the backend key values are redacted literally, including regex metacharacters (P2-9)", () => {
    const r = buildRedactor({ literals: ["s3cr3t.+*?(x)", ""] });
    expect(r.redact("key s3cr3t.+*?(x) end")).toBe(`key ${R} end`);
    // Literal, not a pattern: '.' doesn't match any character.
    expect(r.redact("key s3cr3tX+*?(x) end")).toBe("key s3cr3tX+*?(x) end");
    // An empty value is ignored rather than matching everywhere.
    expect(r.redact("plain")).toBe("plain");
  });

  test("literal values are redacted even with the built-in patterns off", () => {
    const r = buildRedactor({ defaults: false, literals: ["abcdef123"] });
    expect(r.redact("x abcdef123 y")).toBe(`x ${R} y`);
  });

  test("leaves ordinary text untouched", () => {
    const r = buildRedactor();
    expect(r.redact("disk usage is 91%, nothing secret here")).toBe("disk usage is 91%, nothing secret here");
  });

  test("redact.defaults: false turns off the built-ins and reports usingDefaults false (W-REDACT-OFF)", () => {
    const r = buildRedactor({ defaults: false });
    expect(r.usingDefaults).toBe(false);
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP")).toBe("key=AKIAABCDEFGHIJKLMNOP");
  });

  test("defaults are on unless turned off, and usingDefaults reports true", () => {
    expect(buildRedactor().usingDefaults).toBe(true);
  });

  test("custom patterns from config.redact.patterns are applied in addition to the defaults", () => {
    const r = buildRedactor({ patterns: ["myco-[0-9a-f]{32}"] });
    expect(r.redact("id=myco-0123456789abcdef0123456789abcdef done")).toBe(`id=${R} done`);
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP")).toBe(`key=${R}`);
  });

  test("custom patterns still apply even with defaults turned off", () => {
    const r = buildRedactor({ defaults: false, patterns: ["myco-[0-9a-f]{32}"] });
    expect(r.redact("id=myco-0123456789abcdef0123456789abcdef")).toBe(`id=${R}`);
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP")).toBe("key=AKIAABCDEFGHIJKLMNOP");
  });

  test("a custom pattern may start with (?i) to ignore case", () => {
    const r = buildRedactor({ defaults: false, patterns: ["(?i)myco-[0-9a-f]{4}"] });
    expect(r.redact("MYCO-ABCD")).toBe(R);
  });
});

describe("compilePattern (SPEC §9 custom patterns)", () => {
  test("translates a leading (?i) into the i flag", () => {
    const re = compilePattern("(?i)abc");
    expect(re.flags).toContain("i");
    expect(re.source).toBe("abc");
    expect(compilePattern("abc").flags).not.toContain("i");
  });

  test.each(["a*", "", "(?i)x?", "^", "$", "\\b", "(?=a)", "a|"])("a pattern that can match the empty string is rejected: %j", (p) => {
    expect(() => compilePattern(p)).toThrow(/empty/);
  });

  test("an invalid pattern is rejected", () => {
    expect(() => compilePattern("(unclosed")).toThrow();
  });
});

describe("truncated capture (SPEC §9: redact before cutting)", () => {
  test("when the capture cap cut the start, the partial first line is dropped before redacting", () => {
    const r = buildRedactor();
    // The cap cut 'password=' off the front: the partial line holds just the secret.
    expect(r.redact("hunter2-leftover\nok line", { truncated: true })).toBe("ok line");
    // Not truncated: the first line is kept.
    expect(r.redact("first\nsecond")).toBe("first\nsecond");
  });

  test("a truncated capture with no newline at all is dropped entirely", () => {
    const r = buildRedactor();
    expect(r.redact("abcdef", { truncated: true })).toBe("");
  });

  test("a truncated capture that cut the BEGIN line off a private key redacts to the start", () => {
    const r = buildRedactor();
    const t = "IIEpAIBAAKCAQEA\nMIIEvQIBADANBg\nkqhkiG9w0BAQEF\n-----END RSA PRIVATE KEY-----\ndone";
    expect(r.redact(t, { truncated: true })).toBe(`${R}\ndone`);
  });

  test("redactedTail redacts the whole text, then cuts the tail, so a secret straddling the cut never leaks (P1-3)", () => {
    const r = buildRedactor();
    const secret = "hunter2hunter2hunter2";
    // 'password=' lies before the 2KB cut and the value straddles it.
    const text = `${"x".repeat(5000)}\npassword=${secret}${"y".repeat(2040)}`;
    const tail = r.redactedTail(text, 2048);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(2048);
    expect(tail).not.toContain("hunter2");
    expect(tail).not.toContain("unter2");
    // The naive order (cut, then redact) would leak part of the secret.
    const naive = r.redact(text.slice(text.length - 2048));
    expect(naive).toContain("unter2");
  });

  test("redactedTail with a private key straddling the cut", () => {
    const r = buildRedactor();
    const key = `-----BEGIN RSA PRIVATE KEY-----\n${"QUJD\n".repeat(600)}-----END RSA PRIVATE KEY-----\n`;
    const tail = r.redactedTail(`log\n${key}after\n`, 2048);
    expect(tail).toBe(`log\n${R}\nafter\n`);
    const long = r.redactedTail(`${"z".repeat(3000)}\n${key}after\n`, 64);
    expect(long).not.toContain("QUJD");
  });

  test("redactedTail applies the truncated rule too", () => {
    const r = buildRedactor();
    expect(r.redactedTail("leftover-secret\nfine\n", 2048, true)).toBe("fine\n");
  });

  test("tailBytes cuts on a UTF-8 character boundary", () => {
    // 'é' is 2 bytes: the last 4 bytes start inside it, so it's skipped.
    expect(tailBytes("héllo", 4)).toBe("llo");
    expect(tailBytes("héllo", 5)).toBe("éllo");
    expect(tailBytes("héllo", 6)).toBe("héllo");
    expect(tailBytes("short", 100)).toBe("short");
  });
});

describe("linear time on hostile input (SPEC §9, P1-2)", () => {
  const MiB = 1024 * 1024;
  const fill = (unit: string) => unit.repeat(Math.ceil(MiB / unit.length)).slice(0, MiB);
  // Worst cases for each built-in: long runs that almost match, many
  // overlapping start positions, and unterminated openings.
  const cases: Record<string, string> = {
    "aws: AKIA prefixes": fill("AKIA"),
    "private key: BEGIN lines with no END": fill("-----BEGIN RSA PRIVATE KEY-----\n"),
    "private key: BEGIN then a long body with END prefixes": `-----BEGIN RSA PRIVATE KEY-----\n${fill("-----END RSA PRIVATE KEY----")}`,
    "private key: long [A-Z ] run": `-----BEGIN ${fill("A ")}`,
    "private key: END lines with no BEGIN": fill("-----END RSA PRIVATE KEY-----x"),
    "bearer: long whitespace with no token": `bearer${fill(" ")}`,
    "bearer: repeated": fill("bearer "),
    "jwt: eyJ repeated": fill("eyJ"),
    "jwt: eyJ with one dot": `eyJ${fill("a")}.${fill("b")}`,
    "jwt: dotted runs": fill("eyJa.b"),
    "key-value: long identifier with no keyword": fill("a"),
    "key-value: keyword repeated with no separator": fill("password"),
    "key-value: keyword then spaces": `password${fill(" ")}`,
    "key-value: keyword, separator, spaces": `password=${fill(" ")}`,
    "key-value: unterminated quotes": fill('secret="x '),
    "key-value: token_ run": fill("token_"),
    "url: long user with no @": `://${fill("a")}:${fill("b")}`,
    "url: repeated scheme": fill("://a:b"),
    "none: long plain text": fill("the quick brown fox "),
  };

  test.each(Object.entries(cases))("%s: 1 MiB redacts in under 500 ms", (_name, input) => {
    const r = buildRedactor();
    const start = performance.now();
    r.redact(input);
    r.redact(input, { truncated: true });
    expect(performance.now() - start).toBeLessThan(500);
  });
});
