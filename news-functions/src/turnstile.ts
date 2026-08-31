import { createHmac } from "node:crypto";

import { PUBLIC_ABUSE_POLICY, type PublicAbusePolicy } from "./contract.js";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_SITEVERIFY_RESPONSE_BYTES = 16 * 1024;
const VISITOR_ERROR_CODES = new Set([
  "missing-input-response",
  "invalid-input-response",
  "timeout-or-duplicate",
]);
const PROVIDER_CONFIGURATION_CODES = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
]);
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

type Fetch = typeof globalThis.fetch;

class InvalidSiteverifyResponseError extends Error {}

type SiteverifyPayload = {
  success?: unknown;
  challenge_ts?: unknown;
  hostname?: unknown;
  action?: unknown;
  "error-codes"?: unknown;
};

export type TurnstileVerification =
  | { kind: "valid" }
  | {
      kind: "invalid";
      reason:
        | "provider_rejected"
        | "hostname_mismatch"
        | "action_mismatch"
        | "invalid_timestamp"
        | "expired_timestamp";
    }
  | {
      kind: "unavailable";
      reason:
        | "network"
        | "timeout"
        | "http"
        | "provider_configuration"
        | "provider_internal"
        | "invalid_response";
    };

export type VerifyTurnstileInput = Readonly<{
  token: string;
  remoteIp: string | null;
  now: Date;
}>;

export interface TurnstileVerifier {
  verify(input: VerifyTurnstileInput): Promise<TurnstileVerification>;
}

function record(value: unknown): SiteverifyPayload | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SiteverifyPayload)
    : null;
}

function errorCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function deterministicValidationId(secret: string, token: string): string {
  const bytes = Buffer.from(
    createHmac("sha256", secret)
      .update("news-evals:v1:turnstile-siteverify\0", "utf8")
      .update(token, "utf8")
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseRfc3339(value: string): number | null {
  const match = RFC3339.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const fraction = (match[7] ?? "").padEnd(3, "0").slice(0, 3);
  const milliseconds = Number(fraction || "0");
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, milliseconds);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  )
    return null;
  if (match[8] === "Z") return calendar.getTime();
  const offsetHour = Number(match[10]);
  const offsetMinute = Number(match[11]);
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const direction = match[9] === "+" ? 1 : -1;
  return (
    calendar.getTime() -
    direction * (offsetHour * 60 + offsetMinute) * 60 * 1000
  );
}

function validateSuccess(
  payload: SiteverifyPayload,
  now: Date,
  policy: PublicAbusePolicy,
): TurnstileVerification {
  if (payload.hostname !== policy.turnstileHostname)
    return { kind: "invalid", reason: "hostname_mismatch" };
  if (payload.action !== policy.turnstileAction)
    return { kind: "invalid", reason: "action_mismatch" };
  if (typeof payload.challenge_ts !== "string")
    return { kind: "invalid", reason: "invalid_timestamp" };
  const challengedAt = parseRfc3339(payload.challenge_ts);
  if (challengedAt === null || !Number.isFinite(now.getTime()))
    return { kind: "invalid", reason: "invalid_timestamp" };
  const ageMilliseconds = now.getTime() - challengedAt;
  if (
    ageMilliseconds > policy.turnstileMaxAgeSeconds * 1000 ||
    ageMilliseconds < -policy.turnstileFutureSkewSeconds * 1000
  )
    return { kind: "invalid", reason: "expired_timestamp" };
  return { kind: "valid" };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    if (Number(contentLength) > MAX_SITEVERIFY_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new InvalidSiteverifyResponseError(
        "siteverify response exceeds its byte limit",
      );
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SITEVERIFY_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new InvalidSiteverifyResponseError(
          "siteverify response exceeds its byte limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new InvalidSiteverifyResponseError(
      "siteverify response is not valid UTF-8",
    );
  }
}

function rejectedVerification(codes: readonly string[]): TurnstileVerification {
  if (codes.length > 0 && codes.every((code) => VISITOR_ERROR_CODES.has(code)))
    return { kind: "invalid", reason: "provider_rejected" };
  if (codes.some((code) => PROVIDER_CONFIGURATION_CODES.has(code)))
    return { kind: "unavailable", reason: "provider_configuration" };
  if (codes.includes("internal-error"))
    return { kind: "unavailable", reason: "provider_internal" };
  return { kind: "unavailable", reason: "invalid_response" };
}

export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  readonly #secret: string;
  readonly #fetch: Fetch;
  readonly #policy: PublicAbusePolicy;

  constructor(
    secret: string,
    options: { fetch?: Fetch; policy?: PublicAbusePolicy } = {},
  ) {
    if (!secret) throw new Error("NEWS_EVAL_TURNSTILE_SECRET is empty");
    this.#secret = secret;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#policy = options.policy ?? PUBLIC_ABUSE_POLICY;
  }

  async verify(input: VerifyTurnstileInput): Promise<TurnstileVerification> {
    if (
      input.token.length < 1 ||
      input.token.length > this.#policy.turnstileTokenCharacters
    )
      return { kind: "invalid", reason: "provider_rejected" };

    const validationId = deterministicValidationId(this.#secret, input.token);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.#policy.turnstileTimeoutMilliseconds,
      );
      try {
        const body = new URLSearchParams({
          secret: this.#secret,
          response: input.token,
          idempotency_key: validationId,
        });
        if (input.remoteIp) body.set("remoteip", input.remoteIp);
        const response = await this.#fetch(SITEVERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          if (attempt === 0 && response.status >= 500) continue;
          return { kind: "unavailable", reason: "http" };
        }
        let text: string;
        try {
          text = await readBoundedResponse(response);
        } catch (caught) {
          if (caught instanceof InvalidSiteverifyResponseError)
            return { kind: "unavailable", reason: "invalid_response" };
          throw caught;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return { kind: "unavailable", reason: "invalid_response" };
        }
        const payload = record(parsed);
        if (!payload)
          return { kind: "unavailable", reason: "invalid_response" };
        if (payload.success === true)
          return validateSuccess(payload, input.now, this.#policy);
        const codes = errorCodes(payload["error-codes"]);
        if (attempt === 0 && codes.includes("internal-error")) continue;
        return rejectedVerification(codes);
      } catch {
        if (attempt === 1)
          return {
            kind: "unavailable",
            reason: controller.signal.aborted ? "timeout" : "network",
          };
      } finally {
        clearTimeout(timeout);
      }
    }
    return { kind: "unavailable", reason: "provider_internal" };
  }
}
