import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

export type PublicAbusePolicy = Readonly<{
  turnstileAction: string;
  turnstileHostname: string;
  turnstileTokenCharacters: number;
  turnstileTimeoutMilliseconds: number;
  turnstileMaxAgeSeconds: number;
  turnstileFutureSkewSeconds: number;
  siteverifyAttemptsPerInstanceMinute: number;
  trustedClientIpAvailable: false;
  browserDailySubmissions: number;
  globalDailySubmissions: number;
  abuseMetadataRetentionHours: number;
  rateMetadataRetentionHours: number;
}>;

export type PublicAggregatePolicy = Readonly<{
  publicDistributionEnabled: boolean;
  minimumValidSubmissions: number;
  minimumDistinctBrowserBuckets: number;
  strongAgreementFraction: number;
}>;

export type PublicLabelVocabularies = Readonly<{
  leaning: readonly string[];
  russiaStance: readonly string[];
  partyTone: readonly string[];
}>;

const CONTRACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./eval-contract/contract.json", import.meta.url)),
    "utf8",
  ),
) as unknown;

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as JsonObject;
}

function positiveInteger(
  value: unknown,
  path: string,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  )
    throw new Error(`${path} must be a safe positive integer`);
  return value as number;
}

function nonemptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path} must be a non-empty string`);
  return value;
}

function disabledFlag(value: unknown, path: string): false {
  if (value !== false)
    throw new Error(`${path} must remain false until verified`);
  return false;
}

function vocabulary(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32)
    throw new Error(`${path} must be a non-empty bounded array`);
  const entries = value.map((entry, index) =>
    nonemptyString(entry, `${path}[${index}]`),
  );
  if (new Set(entries).size !== entries.length)
    throw new Error(`${path} must not contain duplicates`);
  return Object.freeze(entries);
}

const root = object(CONTRACT, "contract");
const limits = object(root.limits, "contract.limits");
const vocabularies = object(root.vocabularies, "contract.vocabularies");
const abuse = object(
  root.public_abuse_controls,
  "contract.public_abuse_controls",
);
const aggregate = object(
  root.community_aggregate_release,
  "contract.community_aggregate_release",
);

export const PUBLIC_REQUEST_BYTES = positiveInteger(
  limits.public_request_bytes,
  "contract.limits.public_request_bytes",
  10 * 1024 * 1024,
);

export const PUBLIC_PARTY_DECISIONS = positiveInteger(
  limits.party_decisions,
  "contract.limits.party_decisions",
  100,
);

export const PUBLIC_LABEL_VOCABULARIES: PublicLabelVocabularies = Object.freeze(
  {
    leaning: vocabulary(vocabularies.leaning, "contract.vocabularies.leaning"),
    russiaStance: vocabulary(
      vocabularies.russia_stance,
      "contract.vocabularies.russia_stance",
    ),
    partyTone: vocabulary(
      vocabularies.party_tone,
      "contract.vocabularies.party_tone",
    ),
  },
);

const parsedAbusePolicy: PublicAbusePolicy = {
  turnstileAction: nonemptyString(
    abuse.turnstile_action,
    "contract.public_abuse_controls.turnstile_action",
  ),
  turnstileHostname: nonemptyString(
    abuse.turnstile_hostname,
    "contract.public_abuse_controls.turnstile_hostname",
  ),
  turnstileTokenCharacters: positiveInteger(
    abuse.turnstile_token_characters,
    "contract.public_abuse_controls.turnstile_token_characters",
    2048,
  ),
  turnstileTimeoutMilliseconds: positiveInteger(
    abuse.turnstile_timeout_milliseconds,
    "contract.public_abuse_controls.turnstile_timeout_milliseconds",
    30_000,
  ),
  turnstileMaxAgeSeconds: positiveInteger(
    abuse.turnstile_max_age_seconds,
    "contract.public_abuse_controls.turnstile_max_age_seconds",
    300,
  ),
  turnstileFutureSkewSeconds: positiveInteger(
    abuse.turnstile_future_skew_seconds,
    "contract.public_abuse_controls.turnstile_future_skew_seconds",
    60,
  ),
  siteverifyAttemptsPerInstanceMinute: positiveInteger(
    abuse.siteverify_attempts_per_instance_minute,
    "contract.public_abuse_controls.siteverify_attempts_per_instance_minute",
    10_000,
  ),
  trustedClientIpAvailable: disabledFlag(
    abuse.trusted_client_ip_available,
    "contract.public_abuse_controls.trusted_client_ip_available",
  ),
  browserDailySubmissions: positiveInteger(
    abuse.browser_daily_submissions,
    "contract.public_abuse_controls.browser_daily_submissions",
    100_000,
  ),
  globalDailySubmissions: positiveInteger(
    abuse.global_daily_submissions,
    "contract.public_abuse_controls.global_daily_submissions",
    1_000_000,
  ),
  abuseMetadataRetentionHours: positiveInteger(
    abuse.abuse_metadata_retention_hours,
    "contract.public_abuse_controls.abuse_metadata_retention_hours",
    24 * 30,
  ),
  rateMetadataRetentionHours: positiveInteger(
    abuse.rate_metadata_retention_hours,
    "contract.public_abuse_controls.rate_metadata_retention_hours",
    24 * 30,
  ),
};
if (
  parsedAbusePolicy.globalDailySubmissions <
  parsedAbusePolicy.browserDailySubmissions
)
  throw new Error(
    "contract public global daily cap must cover the browser daily cap",
  );

export const PUBLIC_ABUSE_POLICY: PublicAbusePolicy =
  Object.freeze(parsedAbusePolicy);

const strongAgreementFraction = aggregate.strong_agreement_fraction;
if (typeof aggregate.public_distribution_enabled !== "boolean")
  throw new Error(
    "contract community public distribution flag must be boolean",
  );
if (
  typeof strongAgreementFraction !== "number" ||
  !Number.isFinite(strongAgreementFraction) ||
  strongAgreementFraction <= 0 ||
  strongAgreementFraction > 1
)
  throw new Error(
    "contract community strong agreement fraction must be in (0, 1]",
  );

export const PUBLIC_AGGREGATE_POLICY: PublicAggregatePolicy = Object.freeze({
  publicDistributionEnabled: aggregate.public_distribution_enabled,
  minimumValidSubmissions: positiveInteger(
    aggregate.minimum_valid_submissions,
    "contract.community_aggregate_release.minimum_valid_submissions",
    1_000_000,
  ),
  minimumDistinctBrowserBuckets: positiveInteger(
    aggregate.minimum_distinct_browser_buckets,
    "contract.community_aggregate_release.minimum_distinct_browser_buckets",
    1_000_000,
  ),
  strongAgreementFraction,
});
