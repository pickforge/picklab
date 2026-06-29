import { describe, expect, it } from "vitest";
import { redactEnv, redactSecrets } from "../src/redact.js";

describe("redactSecrets", () => {
  it("masks env-style assignments with secret-like keys", () => {
    expect(redactSecrets("GITHUB_TOKEN=abc123")).toBe(
      "GITHUB_TOKEN=[REDACTED]",
    );
    expect(redactSecrets("DB_PASSWORD=hunter2")).toBe(
      "DB_PASSWORD=[REDACTED]",
    );
    expect(redactSecrets("my_api_key=value")).toBe("my_api_key=[REDACTED]");
    expect(redactSecrets("API-KEY=value")).toBe("API-KEY=[REDACTED]");
  });

  it("masks JSON fields with secret-like keys", () => {
    expect(redactSecrets('{"apiKey": "xyz789"}')).toBe(
      '{"apiKey": "[REDACTED]"}',
    );
    expect(redactSecrets('{"client_secret":"s3cr3t"}')).toBe(
      '{"client_secret":"[REDACTED]"}',
    );
  });

  it("masks header-style values", () => {
    expect(redactSecrets("Authorization: Bearer eyJhbGciOi")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("masks values wrapped in or containing angle brackets", () => {
    expect(redactSecrets("token=<session-secret>")).toBe("token=[REDACTED]");
    expect(redactSecrets("authorization=Bearer <session-secret>")).toBe(
      "authorization=[REDACTED]",
    );
    expect(redactSecrets("Authorization: Bearer <secret>")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("redacts only the credential and keeps trailing same-line fields", () => {
    expect(
      redactSecrets("authorization=Bearer <secret> status=200"),
    ).toBe("authorization=[REDACTED] status=200");
    expect(redactSecrets("password=hunter2 next=field")).toBe(
      "password=[REDACTED] next=field",
    );
  });

  it("redacts standalone bearer tokens", () => {
    expect(redactSecrets("Bearer <secret>")).toBe("Bearer [REDACTED]");
    expect(redactSecrets("Bearer abc123")).toBe("Bearer [REDACTED]");
  });

  it("masks GitHub tokens", () => {
    const token = "ghp_" + "a1B2".repeat(9);
    expect(redactSecrets(`saw ${token} in logs`)).toBe(
      "saw [REDACTED] in logs",
    );
  });

  it("masks sk- style keys", () => {
    expect(redactSecrets("key sk-abcdefghijklmnopqrstuvwx end")).toBe(
      "key [REDACTED] end",
    );
  });

  it("masks AWS access key ids", () => {
    expect(redactSecrets("id AKIAIOSFODNN7EXAMPLE used")).toBe(
      "id [REDACTED] used",
    );
  });

  it("redacts secrets in one-line XML without corrupting structure", () => {
    const token = "ghp_" + "a".repeat(36);
    const xml = `<?xml version="1.0"?><hierarchy rotation="0"><node text="token=${token}" /></hierarchy>`;
    const out = redactSecrets(xml);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain(token);
    expect(out).toContain("</hierarchy>");
    expect(out).toContain("/>");
  });

  it("preserves quote delimiters for quoted XML attributes", () => {
    expect(redactSecrets('<node password="false" text="ok" />')).toBe(
      '<node password="[REDACTED]" text="ok" />',
    );
    expect(redactSecrets("token='abc'")).toBe("token='[REDACTED]'");
  });

  it("leaves non-secrets untouched", () => {
    const text = "PATH=/usr/bin\nname=alice\nport: 8080";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("redactEnv", () => {
  it("replaces values of matching keys only", () => {
    const env = {
      MY_SECRET: "x",
      AWS_ACCESS_TOKEN: "y",
      HOME: "/home/dev",
      LANG: "en_US.UTF-8",
    };
    const redacted = redactEnv(env);
    expect(redacted.MY_SECRET).toBe("[REDACTED]");
    expect(redacted.AWS_ACCESS_TOKEN).toBe("[REDACTED]");
    expect(redacted.HOME).toBe("/home/dev");
    expect(redacted.LANG).toBe("en_US.UTF-8");
    expect(env.MY_SECRET).toBe("x");
  });
});
