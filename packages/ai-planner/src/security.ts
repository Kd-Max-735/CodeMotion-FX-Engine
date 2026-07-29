import { createHash } from "node:crypto";

const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\s"'<>]+/g;
const UNIX_PATH = /(?:^|\s)\/(?:Users|home|tmp|var|etc|opt)\/[^\s"'<>]+/g;
const BEARER_OR_KEY = /\b(?:Bearer\s+)?(?:[A-Za-z0-9_-]{32,}|sk-[A-Za-z0-9_-]{16,})\b/g;

export function sanitizeUserText(value: string): string {
  return value
    .replace(WINDOWS_PATH, "[local-path-redacted]")
    .replace(UNIX_PATH, (match) => `${match.startsWith(" ") ? " " : ""}[local-path-redacted]`)
    .replace(BEARER_OR_KEY, "[credential-redacted]");
}

export function fingerprintProviderRequestId(value: string): string {
  return `request-sha256:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}
