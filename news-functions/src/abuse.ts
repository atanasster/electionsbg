import { createHmac, timingSafeEqual } from "node:crypto";

import { PUBLIC_ABUSE_POLICY, type PublicAbusePolicy } from "./contract.js";
import { canonicalJson } from "./eval-contract/canonical.js";

const KEY_VERSION = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_KEYRING_KEYS = 5;

export type Clock = {
  now(): Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

export type HmacKey = Readonly<{
  version: string;
  secret: string;
}>;

export type HmacKeyring = Readonly<{
  activeVersion: string;
  keys: readonly HmacKey[];
}>;

export type IdempotencyLookup = Readonly<{
  key: string;
  requestFingerprint: string;
}>;

export type AbuseContext = Readonly<{
  day: string;
  activeKeyVersion: string;
  abuseRef: string;
  activeIdempotency: IdempotencyLookup;
  idempotencyLookups: readonly IdempotencyLookup[];
  globalDayKey: string;
  activeBrowserDayKey: string | null;
  browserDayLookupKeys: readonly string[];
  activeBrowserArticleRevisionKey: string | null;
  browserArticleRevisionLookupKeys: readonly string[];
  abuseExpiresAt: Date;
  rateExpiresAt: Date;
}>;

export type AbuseSnapshot = Readonly<{
  idempotentSubmissionId: string | null;
  idempotentRequestMatches: boolean;
  browserArticleRevisionExists: boolean;
  globalDayCount: number;
  browserDayCount: number | null;
}>;

export type AbuseDecision =
  | { kind: "allow" }
  | { kind: "idempotent"; submissionId: string }
  | { kind: "idempotency_conflict" }
  | { kind: "duplicate_article_revision" }
  | { kind: "rate_limited"; scope: "global" | "browser" };

export type DeriveAbuseInput = Readonly<{
  articleKey: string;
  taskRevision: number;
  idempotencyKey: string;
  browserNonce: string | null;
  semanticRequest: Readonly<Record<string, unknown>>;
  now: Date;
}>;

export interface AttemptLimiter {
  allow(now: Date): boolean;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as JsonObject;
}

export function parseHmacKeyring(value: unknown): HmacKeyring {
  const root = object(value, "NEWS_EVAL_HMAC_KEYRING");
  const activeVersion = root.active;
  const rawKeys = object(root.keys, "NEWS_EVAL_HMAC_KEYRING.keys");
  if (typeof activeVersion !== "string" || !KEY_VERSION.test(activeVersion))
    throw new Error("NEWS_EVAL_HMAC_KEYRING.active is invalid");
  const entries = Object.entries(rawKeys);
  if (entries.length < 1 || entries.length > MAX_KEYRING_KEYS)
    throw new Error("NEWS_EVAL_HMAC_KEYRING must contain one to five keys");
  const keys = entries
    .map(([version, secret]): HmacKey => {
      if (!KEY_VERSION.test(version))
        throw new Error("NEWS_EVAL_HMAC_KEYRING contains an invalid version");
      if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32)
        throw new Error(
          "each NEWS_EVAL_HMAC_KEYRING key needs at least 32 bytes",
        );
      return Object.freeze({ version, secret });
    })
    .sort((left, right) =>
      left.version === activeVersion
        ? -1
        : right.version === activeVersion
          ? 1
          : left.version.localeCompare(right.version),
    );
  if (!keys.some(({ version }) => version === activeVersion))
    throw new Error("NEWS_EVAL_HMAC_KEYRING.active has no matching key");
  return Object.freeze({ activeVersion, keys: Object.freeze(keys) });
}

function digest(key: HmacKey, purpose: string, value: string): string {
  return createHmac("sha256", key.secret)
    .update(`news-evals:v1:${purpose}\0${value}`, "utf8")
    .digest("base64url");
}

function opaqueKey(prefix: string, key: HmacKey, value: string): string {
  return `${prefix}-${key.version}-${digest(key, prefix, value)}`;
}

function expiry(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function semanticPayload(
  request: Readonly<Record<string, unknown>>,
): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(request)) {
    if (
      key === "turnstile_token" ||
      key === "idempotency_key" ||
      key === "browser_nonce"
    )
      continue;
    result[key] = value;
  }
  return result;
}

export function deriveAbuseContext(
  input: DeriveAbuseInput,
  keyring: HmacKeyring,
  policy: PublicAbusePolicy = PUBLIC_ABUSE_POLICY,
): AbuseContext {
  if (!Number.isFinite(input.now.getTime()))
    throw new Error("abuse clock returned an invalid date");
  if (!Number.isSafeInteger(input.taskRevision) || input.taskRevision < 1)
    throw new Error("task revision must be a safe positive integer");
  if (
    keyring.keys.length < 1 ||
    keyring.keys[0]?.version !== keyring.activeVersion
  )
    throw new Error("HMAC keyring is not normalized with its active key first");

  const day = input.now.toISOString().slice(0, 10);
  const canonicalRequest = canonicalJson(
    semanticPayload(input.semanticRequest),
  );
  const idempotencyLookups = keyring.keys.map((key) => ({
    key: opaqueKey("idempotency", key, input.idempotencyKey),
    requestFingerprint: digest(key, "request-fingerprint", canonicalRequest),
  }));
  const browserDayLookupKeys = input.browserNonce
    ? keyring.keys.map((key) =>
        opaqueKey("browser-day", key, `${day}\0${input.browserNonce}`),
      )
    : [];
  const browserArticleRevisionLookupKeys = input.browserNonce
    ? keyring.keys.map((key) =>
        opaqueKey(
          "browser-article",
          key,
          `${input.articleKey}\0${input.taskRevision}\0${input.browserNonce}`,
        ),
      )
    : [];
  const activeIdempotency = idempotencyLookups[0];
  if (!activeIdempotency)
    throw new Error("HMAC keyring did not produce an active idempotency key");
  return Object.freeze({
    day,
    activeKeyVersion: keyring.activeVersion,
    abuseRef: `abuse-${activeIdempotency.key}`,
    activeIdempotency,
    idempotencyLookups: Object.freeze(idempotencyLookups),
    globalDayKey: `global-day-${day}`,
    activeBrowserDayKey: browserDayLookupKeys[0] ?? null,
    browserDayLookupKeys: Object.freeze(browserDayLookupKeys),
    activeBrowserArticleRevisionKey:
      browserArticleRevisionLookupKeys[0] ?? null,
    browserArticleRevisionLookupKeys: Object.freeze(
      browserArticleRevisionLookupKeys,
    ),
    abuseExpiresAt: expiry(input.now, policy.abuseMetadataRetentionHours),
    rateExpiresAt: expiry(input.now, policy.rateMetadataRetentionHours),
  });
}

function safeCount(value: number | null): number | null {
  if (value === null) return null;
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}

export function requestFingerprintMatches(
  stored: string,
  expected: string,
): boolean {
  const storedBytes = Buffer.from(stored, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    storedBytes.length === expectedBytes.length &&
    timingSafeEqual(storedBytes, expectedBytes)
  );
}

export function assessAbuse(
  snapshot: AbuseSnapshot,
  policy: PublicAbusePolicy = PUBLIC_ABUSE_POLICY,
): AbuseDecision {
  if (snapshot.idempotentSubmissionId)
    return snapshot.idempotentRequestMatches
      ? {
          kind: "idempotent",
          submissionId: snapshot.idempotentSubmissionId,
        }
      : { kind: "idempotency_conflict" };
  if (snapshot.browserArticleRevisionExists)
    return { kind: "duplicate_article_revision" };
  if (
    (safeCount(snapshot.globalDayCount) ?? Number.MAX_SAFE_INTEGER) >=
    policy.globalDailySubmissions
  )
    return { kind: "rate_limited", scope: "global" };
  const browserCount = safeCount(snapshot.browserDayCount);
  if (browserCount !== null && browserCount >= policy.browserDailySubmissions)
    return { kind: "rate_limited", scope: "browser" };
  return { kind: "allow" };
}

export class FixedWindowAttemptLimiter implements AttemptLimiter {
  readonly #maximum: number;
  readonly #windowMilliseconds: number;
  #window = Number.NaN;
  #count = 0;

  constructor(maximum: number, windowMilliseconds = 60_000) {
    if (!Number.isSafeInteger(maximum) || maximum < 1)
      throw new Error("attempt maximum must be a safe positive integer");
    if (!Number.isSafeInteger(windowMilliseconds) || windowMilliseconds < 1)
      throw new Error("attempt window must be a safe positive integer");
    this.#maximum = maximum;
    this.#windowMilliseconds = windowMilliseconds;
  }

  allow(now: Date): boolean {
    const milliseconds = now.getTime();
    if (!Number.isFinite(milliseconds)) return false;
    const window = Math.floor(milliseconds / this.#windowMilliseconds);
    if (window !== this.#window) {
      this.#window = window;
      this.#count = 0;
    }
    if (this.#count >= this.#maximum) return false;
    this.#count += 1;
    return true;
  }
}
