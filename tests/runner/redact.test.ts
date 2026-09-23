// Redaction (SPEC §9): each built-in pattern, custom patterns, and
// W-REDACT-OFF when the defaults are turned off.

import { describe, expect, test } from "vitest";
import { buildRedactor } from "../../src/runner/redact.js";

describe("buildRedactor (SPEC §9)", () => {
  test("redacts an AWS access key id", () => {
    const r = buildRedactor();
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP end")).toBe("key=[REDACTED] end");
  });

  test("redacts a private key block through its matching END line", () => {
    const r = buildRedactor();
    const block = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIB...\nmore...\n-----END RSA PRIVATE KEY-----\nafter";
    expect(r.redact(block)).toBe("before\n[REDACTED]\nafter");
  });

  test("redacts a bearer token, case-insensitively", () => {
    const r = buildRedactor();
    expect(r.redact("Authorization: Bearer abc.123-XYZ")).toBe("Authorization: [REDACTED]");
    expect(r.redact("authorization: bearer abc")).toBe("authorization: [REDACTED]");
  });

  test("redacts a JWT", () => {
    const r = buildRedactor();
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dGVzdHNpZw";
    expect(r.redact(`token is ${jwt} here`)).toBe("token is [REDACTED] here");
  });

  test("redacts key-value secrets (password, secret, token, api_key), case-insensitively", () => {
    const r = buildRedactor();
    expect(r.redact("password=hunter2")).toBe("[REDACTED]");
    expect(r.redact("Secret: sh")).toBe("[REDACTED]");
    expect(r.redact("API_KEY=abc123")).toBe("[REDACTED]");
    expect(r.redact("apikey: xyz")).toBe("[REDACTED]");
  });

  test("redacts credentials embedded in a URL", () => {
    const r = buildRedactor();
    expect(r.redact("fetch https://user:pass@example.com/path")).toBe("fetch https[REDACTED]example.com/path");
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
    const r = buildRedactor();
    expect(r.usingDefaults).toBe(true);
  });

  test("custom patterns from config.redact.patterns are applied in addition to the defaults", () => {
    const r = buildRedactor({ patterns: ["myco-[0-9a-f]{32}"] });
    expect(r.redact("id=myco-0123456789abcdef0123456789abcdef done")).toBe("id=[REDACTED] done");
    // Built-ins still apply alongside a custom pattern.
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP")).toBe("key=[REDACTED]");
  });

  test("custom patterns still apply even with defaults turned off", () => {
    const r = buildRedactor({ defaults: false, patterns: ["myco-[0-9a-f]{32}"] });
    expect(r.redact("id=myco-0123456789abcdef0123456789abcdef")).toBe("id=[REDACTED]");
    expect(r.redact("key=AKIAABCDEFGHIJKLMNOP")).toBe("key=AKIAABCDEFGHIJKLMNOP");
  });
});
