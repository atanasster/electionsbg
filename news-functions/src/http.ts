import {
  deriveAbuseContext,
  systemClock,
  type AbuseContext,
  type AttemptLimiter,
  type Clock,
  type HmacKeyring,
} from "./abuse.js";
import { PUBLIC_REQUEST_BYTES } from "./contract.js";
import { canonicalJson } from "./eval-contract/canonical.js";
import { validateSchema } from "./eval-contract/validate.js";
import {
  boundedLatency,
  noOpSecurityMetrics,
  type SecurityEvent,
  type SecurityMetrics,
} from "./security.js";
import type {
  AggregateOutcome,
  EvaluationStore,
  SubmitOutcome,
} from "./storage.js";
import type { TurnstileVerifier } from "./turnstile.js";
import type { TurnstileVerification } from "./turnstile.js";

type HeaderValue = string | string[] | undefined;

export type RequestLike = {
  method?: string;
  url?: string;
  path?: string;
  headers?: Record<string, HeaderValue>;
  body?: unknown;
  rawBody?: Uint8Array;
  get?(name: string): string | undefined;
};

export type ResponseLike = {
  set(name: string, value: string): ResponseLike;
  vary(name: string): ResponseLike;
  status(code: number): ResponseLike;
  send(body?: string): unknown;
};

export type HttpConfig = {
  allowedOrigins: ReadonlySet<string>;
  security?(): Readonly<{
    turnstileVerifier: TurnstileVerifier;
    hmacKeyring: HmacKeyring;
  }>;
  attemptLimiter?: AttemptLimiter;
  metrics?: SecurityMetrics;
  store?: EvaluationStore;
  clock?: Clock;
};

type Route =
  | { kind: "submit"; methods: readonly ["POST"] }
  | {
      kind: "aggregate";
      methods: readonly ["GET"];
      domain: string;
      articleId: string;
    };

const PRODUCTION_ORIGIN = "https://news.electionsbg.com";
const LOCAL_ORIGINS = ["http://127.0.0.1:5190", "http://localhost:5190"];
import submissionSchema from "./eval-contract/submission_request.schema.json" with { type: "json" };

const MAX_REQUEST_BYTES = PUBLIC_REQUEST_BYTES;
const SUBMISSION_SCHEMA = submissionSchema as Record<string, unknown>;

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ASCII_TLD = /^[a-z]{2,63}$/;
const PUNYCODE_TLD = /^xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?$/;
const ARTICLE_ID = /^[A-Za-z0-9._~-]{1,255}$/;

function header(request: RequestLike, name: string): string | undefined {
  const throughGetter = request.get?.(name);
  if (throughGetter !== undefined) return throughGetter;
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestPath(request: RequestLike): string | null {
  const raw = request.path ?? request.url ?? "";
  try {
    return new URL(raw, "https://news.electionsbg.com").pathname;
  } catch {
    return null;
  }
}

function decodeSegment(value: string): string | null {
  if (/%2f|%5c/i.test(value)) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function validDomain(value: string): boolean {
  if (value.length > 253) return false;
  const labels = value.split(".");
  const finalLabel = labels.at(-1);
  return (
    labels.length >= 2 &&
    finalLabel !== undefined &&
    labels.every((label) => DOMAIN_LABEL.test(label)) &&
    (ASCII_TLD.test(finalLabel) || PUNYCODE_TLD.test(finalLabel))
  );
}

function matchRoute(path: string | null): Route | null {
  if (path === "/api/news-evals/submit")
    return { kind: "submit", methods: ["POST"] };
  const match = /^\/api\/news-evals\/aggregate\/([^/]+)\/([^/]+)$/.exec(
    path ?? "",
  );
  if (!match) return null;
  const encodedDomain = match[1];
  const encodedArticleId = match[2];
  if (encodedDomain === undefined || encodedArticleId === undefined)
    return null;
  const domain = decodeSegment(encodedDomain);
  const articleId = decodeSegment(encodedArticleId);
  if (
    !domain ||
    !articleId ||
    !validDomain(domain) ||
    !ARTICLE_ID.test(articleId)
  )
    return null;
  return { kind: "aggregate", methods: ["GET"], domain, articleId };
}

function error(
  response: ResponseLike,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).send(JSON.stringify({ error: { code, message } }));
}

function json(response: ResponseLike, status: number, payload: unknown): void {
  response.status(status).send(JSON.stringify(payload));
}

function setBaseHeaders(response: ResponseLike): void {
  response.set("Cache-Control", "no-store");
  response.set("Content-Type", "application/json; charset=utf-8");
  response.set("X-Content-Type-Options", "nosniff");
}

function applyCors(
  request: RequestLike,
  response: ResponseLike,
  config: HttpConfig,
): boolean {
  const origin = header(request, "origin");
  response.vary("Origin");
  if (!origin) return true;
  if (!config.allowedOrigins.has(origin)) {
    error(response, 403, "forbidden_origin", "This origin is not allowed.");
    return false;
  }
  response.set("Access-Control-Allow-Origin", origin);
  return true;
}

function requestSize(request: RequestLike): number {
  if (request.rawBody !== undefined) return request.rawBody.byteLength;
  try {
    const serialized = JSON.stringify(request.body);
    const method = (request.method ?? "GET").toUpperCase();
    const contentLength = header(request, "content-length")?.trim();
    const transferEncoding = header(request, "transfer-encoding")?.trim();
    if (
      (method === "GET" || method === "HEAD" || method === "OPTIONS") &&
      serialized === "{}" &&
      (contentLength === undefined || /^0+$/.test(contentLength)) &&
      !transferEncoding
    ) {
      // Firebase's Express adapter synthesizes `body: {}` for requests that
      // arrived without a body. Only treat that exact, undeclared shape as
      // empty; a raw or transfer-encoded body still follows the byte gate.
      return 0;
    }
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
  } catch {
    return MAX_REQUEST_BYTES + 1;
  }
}

function recordMetric(
  metrics: SecurityMetrics,
  event: SecurityEvent,
  latencyMilliseconds?: number,
): void {
  try {
    metrics.record(event, boundedLatency(latencyMilliseconds ?? Number.NaN));
  } catch {
    // Telemetry must never alter a public request outcome.
  }
}

function challengeEvent(
  verification: Exclude<TurnstileVerification, { kind: "valid" }>,
): SecurityEvent {
  if (verification.kind === "invalid") {
    switch (verification.reason) {
      case "provider_rejected":
        return "challenge_invalid_provider";
      case "hostname_mismatch":
        return "challenge_invalid_hostname";
      case "action_mismatch":
        return "challenge_invalid_action";
      case "invalid_timestamp":
        return "challenge_invalid_timestamp";
      case "expired_timestamp":
        return "challenge_expired";
    }
  }
  switch (verification.reason) {
    case "network":
      return "challenge_unavailable_network";
    case "timeout":
      return "challenge_unavailable_timeout";
    case "http":
      return "challenge_unavailable_http";
    case "provider_configuration":
      return "challenge_unavailable_configuration";
    case "provider_internal":
      return "challenge_unavailable_internal";
    case "invalid_response":
      return "challenge_unavailable_response";
  }
}

async function processSubmission(
  requestBody: Record<string, unknown>,
  response: ResponseLike,
  config: HttpConfig,
): Promise<void> {
  const metrics = config.metrics ?? noOpSecurityMetrics;
  let now: Date;
  try {
    now = (config.clock ?? systemClock).now();
    if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
  } catch {
    recordMetric(metrics, "clock_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }

  const attemptLimiter = config.attemptLimiter;
  if (!attemptLimiter || !config.security) {
    recordMetric(metrics, "configuration_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }
  let attemptAllowed: boolean;
  try {
    attemptAllowed = attemptLimiter.allow(now);
  } catch {
    recordMetric(metrics, "configuration_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }
  if (!attemptAllowed) {
    recordMetric(metrics, "attempt_limited");
    response.set("Retry-After", "60");
    error(
      response,
      429,
      "rate_limited",
      "Too many evaluation attempts. Please try again shortly.",
    );
    return;
  }

  let security: ReturnType<NonNullable<HttpConfig["security"]>>;
  try {
    security = config.security();
  } catch {
    recordMetric(metrics, "configuration_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }

  const startedAt = Date.now();
  let verification;
  try {
    verification = await security.turnstileVerifier.verify({
      token: String(requestBody.turnstile_token),
      remoteIp: null,
      now,
    });
  } catch {
    recordMetric(
      metrics,
      "challenge_unavailable_network",
      Date.now() - startedAt,
    );
    error(
      response,
      503,
      "challenge_unavailable",
      "The browser challenge could not be verified. Please try again.",
    );
    return;
  }
  if (verification.kind === "invalid") {
    recordMetric(metrics, challengeEvent(verification), Date.now() - startedAt);
    error(
      response,
      422,
      "challenge_failed",
      "The browser challenge is invalid or expired. Please try again.",
    );
    return;
  }
  if (verification.kind === "unavailable") {
    recordMetric(metrics, challengeEvent(verification), Date.now() - startedAt);
    error(
      response,
      503,
      "challenge_unavailable",
      "The browser challenge could not be verified. Please try again.",
    );
    return;
  }
  recordMetric(metrics, "challenge_valid", Date.now() - startedAt);

  let abuseContext: AbuseContext;
  try {
    abuseContext = deriveAbuseContext(
      {
        articleKey: String(requestBody.article_key),
        taskRevision: Number(requestBody.base_task_revision),
        idempotencyKey: String(requestBody.idempotency_key),
        browserNonce:
          typeof requestBody.browser_nonce === "string"
            ? requestBody.browser_nonce
            : null,
        semanticRequest: requestBody,
        now,
      },
      security.hmacKeyring,
    );
  } catch {
    recordMetric(metrics, "abuse_context_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }

  const store = config.store;
  if (!store) {
    recordMetric(metrics, "configuration_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }
  let outcome: SubmitOutcome;
  try {
    outcome = await store.submit({
      request: requestBody,
      abuse: abuseContext,
      now,
    });
  } catch {
    recordMetric(metrics, "submission_unavailable");
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }
  switch (outcome.kind) {
    case "accepted":
      json(response, outcome.created ? 201 : 200, {
        submission: outcome.receipt,
        idempotent: !outcome.created,
      });
      return;
    case "task_not_found":
      error(
        response,
        404,
        "task_not_found",
        "This evaluation task was not found.",
      );
      return;
    case "task_unavailable":
      error(
        response,
        409,
        "task_unavailable",
        "This evaluation task is not accepting submissions.",
      );
      return;
    case "task_conflict":
      json(response, 409, {
        error: {
          code: "stale_task",
          message: "The article analysis changed. Reload before evaluating it.",
          current_revision: outcome.currentRevision,
        },
      });
      return;
    case "invalid_evaluation":
      error(
        response,
        422,
        "invalid_evaluation",
        "The evaluation is inconsistent with the active task.",
      );
      return;
    case "idempotency_conflict":
      error(
        response,
        409,
        "idempotency_conflict",
        "This idempotency key was already used for another request.",
      );
      return;
    case "duplicate_article_revision":
      error(
        response,
        409,
        "duplicate_submission",
        "This browser already evaluated this article revision.",
      );
      return;
    case "rate_limited":
      response.set("Retry-After", String(outcome.retryAfterSeconds));
      error(
        response,
        429,
        "rate_limited",
        "The anonymous evaluation limit was reached. Please try later.",
      );
  }
}

async function processAggregate(
  route: Extract<Route, { kind: "aggregate" }>,
  response: ResponseLike,
  config: HttpConfig,
): Promise<void> {
  const store = config.store;
  if (!store) {
    error(
      response,
      503,
      "service_unavailable",
      "Community aggregates are not enabled yet.",
    );
    return;
  }
  let now: Date;
  try {
    now = (config.clock ?? systemClock).now();
    if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
  } catch {
    error(
      response,
      503,
      "service_unavailable",
      "Community aggregates are temporarily unavailable.",
    );
    return;
  }
  let outcome: AggregateOutcome;
  try {
    outcome = await store.aggregate({
      articleKey: `${route.domain}/${route.articleId}`,
      now,
    });
  } catch {
    error(
      response,
      503,
      "service_unavailable",
      "Community aggregates are temporarily unavailable.",
    );
    return;
  }
  if (outcome.kind === "task_not_found") {
    error(
      response,
      404,
      "task_not_found",
      "This evaluation task was not found.",
    );
    return;
  }
  if (outcome.kind === "withheld") {
    json(response, 200, {
      article_key: outcome.articleKey,
      task_revision: outcome.taskRevision,
      state: "more_evaluations_needed",
      public_distribution: false,
    });
    return;
  }
  json(response, 200, {
    article_key: outcome.articleKey,
    task_revision: outcome.taskRevision,
    state: "released",
    public_distribution: true,
    aggregate: outcome.aggregate,
  });
}

export function allowedOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> {
  const origins = new Set([PRODUCTION_ORIGIN]);
  if (environment.FUNCTIONS_EMULATOR === "true") {
    for (const origin of LOCAL_ORIGINS) origins.add(origin);
    for (const raw of (environment.NEWS_EVAL_LOCAL_ORIGINS ?? "").split(",")) {
      const value = raw.trim();
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (
          parsed.protocol === "http:" &&
          !parsed.username &&
          !parsed.password &&
          parsed.origin === value &&
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
        )
          origins.add(value);
      } catch {
        // Invalid local configuration is ignored rather than widening CORS.
      }
    }
  }
  return origins;
}

export function handleNewsEvalsRequest(
  request: RequestLike,
  response: ResponseLike,
  config: HttpConfig = { allowedOrigins: allowedOrigins() },
): void | Promise<void> {
  setBaseHeaders(response);
  const route = matchRoute(requestPath(request));
  if (!route) {
    error(
      response,
      404,
      "not_found",
      "No evaluation API route matches this request.",
    );
    return;
  }
  if (!applyCors(request, response, config)) return;

  const bodyBytes = requestSize(request);
  if (bodyBytes > MAX_REQUEST_BYTES) {
    error(
      response,
      413,
      "payload_too_large",
      `The request exceeds ${MAX_REQUEST_BYTES} bytes.`,
    );
    return;
  }

  const method = (request.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") {
    response.set("Access-Control-Allow-Methods", route.methods.join(", "));
    response.set("Access-Control-Allow-Headers", "Content-Type");
    response.set("Access-Control-Max-Age", "600");
    response.status(204).send();
    return;
  }
  if (!route.methods.includes(method as never)) {
    response.set("Allow", route.methods.join(", "));
    error(response, 405, "method_not_allowed", "This method is not allowed.");
    return;
  }

  if (route.kind === "aggregate") {
    if (bodyBytes > 0) {
      error(
        response,
        400,
        "unexpected_body",
        "Aggregate requests must not include a body.",
      );
      return;
    }
    if (!config.store) {
      error(
        response,
        503,
        "service_unavailable",
        "Community aggregates are not enabled yet.",
      );
      return;
    }
    return processAggregate(route, response, config);
  }

  const [mediaType = ""] = (header(request, "content-type") ?? "").split(
    ";",
    1,
  );
  const contentType = mediaType.trim().toLowerCase();
  if (contentType !== "application/json") {
    error(
      response,
      415,
      "unsupported_media_type",
      "The submission must use application/json.",
    );
    return;
  }
  if (
    request.body === null ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    error(
      response,
      400,
      "invalid_json",
      "The request body must be a JSON object.",
    );
    return;
  }
  let schemaErrors: string[];
  try {
    schemaErrors = validateSchema(SUBMISSION_SCHEMA, request.body);
  } catch {
    error(
      response,
      422,
      "invalid_request",
      "The request body does not match the evaluation schema.",
    );
    return;
  }
  if (schemaErrors.length > 0) {
    error(
      response,
      422,
      "invalid_request",
      "The request body does not match the evaluation schema.",
    );
    return;
  }
  try {
    canonicalJson(request.body);
  } catch {
    error(
      response,
      422,
      "invalid_request",
      "The request body does not match the evaluation schema.",
    );
    return;
  }

  const submission = request.body as Record<string, unknown>;
  if (!config.attemptLimiter || !config.security) {
    recordMetric(
      config.metrics ?? noOpSecurityMetrics,
      "configuration_unavailable",
    );
    error(
      response,
      503,
      "service_unavailable",
      "Evaluation submission is temporarily unavailable.",
    );
    return;
  }
  return processSubmission(submission, response, config);
}
