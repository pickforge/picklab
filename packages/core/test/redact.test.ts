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

  it("redacts every pair in Cookie headers", () => {
    expect(redactSecrets("Cookie: sid=abc123; theme=dark; ga=GA1.2.3")).toBe(
      "Cookie: sid=[REDACTED]; theme=[REDACTED]; ga=[REDACTED]",
    );
  });

  it("redacts Set-Cookie values but keeps cookie attributes", () => {
    expect(
      redactSecrets(
        "Set-Cookie: session=s3cr3t; Path=/; SameSite=Lax; HttpOnly; Secure",
      ),
    ).toBe(
      "Set-Cookie: session=[REDACTED]; Path=/; SameSite=Lax; HttpOnly; Secure",
    );
    expect(
      redactSecrets(
        "Set-Cookie: id=x; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600",
      ),
    ).toBe(
      "Set-Cookie: id=[REDACTED]; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600",
    );
  });

  it("redacts balanced double-quoted cookie values without leaking the tail", () => {
    expect(redactSecrets('Cookie: sid="abc; def"; theme=dark')).toBe(
      'Cookie: sid="[REDACTED]"; theme=[REDACTED]',
    );
    expect(redactSecrets('Set-Cookie: sid="a;b"; Path=/; Max-Age=60')).toBe(
      'Set-Cookie: sid="[REDACTED]"; Path=/; Max-Age=60',
    );
  });

  it("redacts single-quoted cookie values and apostrophes in unquoted values", () => {
    expect(redactSecrets("Cookie: sid='abc; def'; theme=dark")).toBe(
      "Cookie: sid='[REDACTED]'; theme=[REDACTED]",
    );
    expect(redactSecrets("Cookie: name=o'brien; sid=secret")).toBe(
      "Cookie: name=[REDACTED]; sid=[REDACTED]",
    );
  });

  it("preserves XML and JSON embedding boundaries around cookie headers", () => {
    expect(
      redactSecrets('<node text="Cookie: sid=abc123; theme=dark" x="1" />'),
    ).toBe('<node text="Cookie: sid=[REDACTED]; theme=[REDACTED]" x="1" />');
    expect(
      redactSecrets("<node text='Cookie: sid=abc123' next='keep' />"),
    ).toBe("<node text='Cookie: sid=[REDACTED]' next='keep' />");
    expect(
      redactSecrets('{"h":"Set-Cookie: session=s3cr3t; Path=/","next":"keep"}'),
    ).toBe('{"h":"Set-Cookie: session=[REDACTED]; Path=/","next":"keep"}');
    // Escaped quotes inside a JSON string value stay balanced, and the
    // string's own closing quote survives.
    expect(
      redactSecrets(String.raw`{"h":"Cookie: sid=\"a;b\"; theme=dark"}`),
    ).toBe(String.raw`{"h":"Cookie: sid=\"[REDACTED]\"; theme=[REDACTED]"}`);
    // An unbalanced quote is the embedding document's closing delimiter.
    expect(redactSecrets('<n a="Cookie: sid=" b="x" />')).toBe(
      '<n a="Cookie: sid=[REDACTED]" b="x" />',
    );
  });

  it("fails closed on truly unterminated quoted cookie values (no opaque tail survives)", () => {
    const opaque = "ZmFrZWhpZ2hlbnRyb3B5c2VjcmV0dG9rZW4xMjM0NTY3ODkw";

    // Unmatched double quote with no other quote anywhere on the line: the
    // opening quote cannot be an embedding document's delimiter, so the
    // opaque tail must be redacted rather than left raw.
    expect(redactSecrets(`Cookie: sid="${opaque}`)).not.toContain(opaque);
    expect(redactSecrets(`Cookie: sid="${opaque}`)).toBe(
      "Cookie: sid=[REDACTED]",
    );
    expect(redactSecrets(`Set-Cookie: session="${opaque}`)).toBe(
      "Set-Cookie: session=[REDACTED]",
    );

    // Unmatched single quote, same shape.
    expect(redactSecrets(`Cookie: sid='${opaque}`)).not.toContain(opaque);
    expect(redactSecrets(`Cookie: sid='${opaque}`)).toBe(
      "Cookie: sid=[REDACTED]",
    );

    // Unmatched escaped quote inside a JSON string: the backslash-quote
    // opens a value with no matching escaped close anywhere on the line.
    const escapedDouble = String.raw`{"h":"Cookie: sid=\"${opaque}"}`;
    expect(redactSecrets(escapedDouble)).not.toContain(opaque);
    expect(redactSecrets(escapedDouble)).toBe(
      '{"h":"Cookie: sid=[REDACTED]',
    );

    // A trailing newline after the opaque tail still fails closed for the
    // header line, and does not touch content on the next line.
    expect(redactSecrets(`Cookie: sid="${opaque}\nAccept: text/html`)).toBe(
      "Cookie: sid=[REDACTED]\nAccept: text/html",
    );

    // A quote followed by trailing junk is malformed, not an embedding
    // delimiter. Fail closed even when another quote appears later.
    expect(redactSecrets(`Cookie: sid="${opaque}"EXTRA`)).toBe(
      "Cookie: sid=[REDACTED]",
    );
    expect(redactSecrets(`Cookie: sid='${opaque}'EXTRA`)).toBe(
      "Cookie: sid=[REDACTED]",
    );
    expect(
      redactSecrets(String.raw`{"h":"Cookie: sid=\"${opaque}\"x"}`),
    ).toBe('{"h":"Cookie: sid=[REDACTED]');

    // Nearby balanced quoted values remain untouched by this change.
    expect(redactSecrets('Cookie: sid="abc; def"; theme=dark')).toBe(
      'Cookie: sid="[REDACTED]"; theme=[REDACTED]',
    );

    // XML/JSON embedding controls: a genuine embedding closing quote (with
    // further document content after it) still preserves shape rather than
    // consuming the rest of the line.
    expect(redactSecrets('<n a="Cookie: sid=" b="x" />')).toBe(
      '<n a="Cookie: sid=[REDACTED]" b="x" />',
    );
    expect(
      redactSecrets(String.raw`{"h":"Cookie: sid=\"a;b\"; theme=dark"}`),
    ).toBe(String.raw`{"h":"Cookie: sid=\"[REDACTED]\"; theme=[REDACTED]"}`);
  });

  it("redacts Authorization headers of any scheme", () => {
    expect(redactSecrets("Authorization: Basic dXNlcjpwYXNz")).toBe(
      "Authorization: [REDACTED]",
    );
    expect(redactSecrets("Authorization: Bearer eyJhbGciOi")).toBe(
      "Authorization: [REDACTED]",
    );
    expect(redactSecrets("authorization: Digest username=alice")).toBe(
      "authorization: [REDACTED]",
    );
  });

  it("redacts the complete Digest credential including quoted parameters", () => {
    expect(
      redactSecrets(
        'Authorization: Digest username="alice", realm="api", nonce="n0nce", uri="/x", response="d1gest"',
      ),
    ).toBe("Authorization: [REDACTED]");
    expect(
      redactSecrets(
        "Authorization: Digest username=\"a\", response=\"b\"\nAccept: text/html",
      ),
    ).toBe("Authorization: [REDACTED]\nAccept: text/html");
  });

  it("preserves XML and JSON closing quotes after Authorization headers", () => {
    expect(
      redactSecrets('<n a="Authorization: Basic dXNlcjpwYXNz" b="keep" />'),
    ).toBe('<n a="Authorization: [REDACTED]" b="keep" />');
    expect(
      redactSecrets(
        String.raw`<n a="Authorization: Digest username=\"alice\", response=\"x\"" b="keep" />`,
      ),
    ).toBe('<n a="Authorization: [REDACTED]" b="keep" />');
    expect(
      redactSecrets(
        String.raw`{"h":"Authorization: Digest username=\"alice\", response=\"x\"","next":"keep"}`,
      ),
    ).toBe('{"h":"Authorization: [REDACTED]","next":"keep"}');
  });

  it("redacts bare JWTs anywhere in text", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM";
    expect(redactSecrets(`saw ${jwt} in a log line`)).toBe(
      "saw [REDACTED] in a log line",
    );
    const unsigned = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.";
    expect(redactSecrets(unsigned)).toBe("[REDACTED]");
  });

  it("redacts credential-bearing query values but keeps others", () => {
    expect(
      redactSecrets("GET https://api.test/cb?code=abc&state=xyz&page=2"),
    ).toBe("GET https://api.test/cb?code=[REDACTED]&state=xyz&page=2");
    expect(redactSecrets("url?access_token=tok123&next=1")).toBe(
      "url?access_token=[REDACTED]&next=1",
    );
    expect(redactSecrets("url?session_id=abc&sort=asc")).toBe(
      "url?session_id=[REDACTED]&sort=asc",
    );
    expect(redactSecrets("url?author=alice&q=cats")).toBe(
      "url?author=alice&q=cats",
    );
  });

  it("redacts semicolon path parameters like jsessionid in free text", () => {
    expect(redactSecrets("redirect /cart;jsessionid=ABC123 done")).toBe(
      "redirect /cart;jsessionid=[REDACTED] done",
    );
    expect(redactSecrets("GET /x;token=abc;v=2 ok")).toBe(
      "GET /x;token=[REDACTED];v=2 ok",
    );
  });

  it("redacts bare session and sessionId assignments and JSON fields", () => {
    expect(redactSecrets("session=abc123")).toBe("session=[REDACTED]");
    expect(redactSecrets("session_id: abc123")).toBe("session_id: [REDACTED]");
    expect(redactSecrets("PHPSESSID=deadbeef")).toBe("PHPSESSID=[REDACTED]");
    expect(redactSecrets('{"sessionId": "abc123"}')).toBe(
      '{"sessionId": "[REDACTED]"}',
    );
    expect(redactSecrets('{"session":"abc123"}')).toBe(
      '{"session":"[REDACTED]"}',
    );
  });

  it("leaves session-adjacent metadata keys untouched", () => {
    expect(redactSecrets("sessionCount=5")).toBe("sessionCount=5");
    expect(redactSecrets("sessionStatus=active")).toBe("sessionStatus=active");
    expect(redactSecrets("SESSION_MANAGER=local/unix:@/tmp/.ICE-unix/1")).toBe(
      "SESSION_MANAGER=local/unix:@/tmp/.ICE-unix/1",
    );
    expect(redactSecrets('{"sessionCount": "5"}')).toBe(
      '{"sessionCount": "5"}',
    );
    expect(
      redactSecrets("created desktop session lab-2f3a (display :90)"),
    ).toBe("created desktop session lab-2f3a (display :90)");
  });

  it("redacts OTP and CSRF assignments", () => {
    expect(redactSecrets("otp=123456")).toBe("otp=[REDACTED]");
    expect(redactSecrets("csrf_token=deadbeef next=/home")).toBe(
      "csrf_token=[REDACTED] next=/home",
    );
    expect(redactSecrets('{"xsrfToken": "deadbeef"}')).toBe(
      '{"xsrfToken": "[REDACTED]"}',
    );
  });

  it("redacts CDP websocket capability URLs and GUID paths", () => {
    expect(
      redactSecrets(
        "DevTools listening on ws://127.0.0.1:9222/devtools/browser/1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809",
      ),
    ).toBe(
      "DevTools listening on ws://127.0.0.1:9222/devtools/browser/[REDACTED]",
    );
    expect(redactSecrets("path /devtools/page/DEADBEEF0123 seen")).toBe(
      "path /devtools/page/[REDACTED] seen",
    );
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
