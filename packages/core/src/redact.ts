const REPLACEMENT = "[REDACTED]";

const KEY_PATTERN =
  /(token|secret|password|passwd|api[_-]?key|authorization|bearer|credential)/i;

const JSON_FIELD_RE =
  /("[^"\r\n]*(?:token|secret|password|passwd|api[_-]?key|authorization|bearer|credential)[^"\r\n]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

const ASSIGNMENT_RE =
  /(\b[A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[_-]?key|authorization|bearer|credential)[A-Za-z0-9_.-]*\s*[=:]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi;

const LITERAL_RES: RegExp[] = [
  /ghp_[A-Za-z0-9]{36}/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

export function redactSecrets(text: string): string {
  let result = text.replace(JSON_FIELD_RE, `$1"${REPLACEMENT}"`);
  result = result.replace(ASSIGNMENT_RE, `$1${REPLACEMENT}`);
  for (const re of LITERAL_RES) {
    result = result.replace(re, REPLACEMENT);
  }
  return result;
}

export function isSecretKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function redactEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] =
      value !== undefined && isSecretKey(key) ? REPLACEMENT : value;
  }
  return result;
}
