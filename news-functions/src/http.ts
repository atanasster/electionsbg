import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateSchema } from "./eval-contract/validate.js";

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
const CONTRACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./eval-contract/contract.json", import.meta.url)),
    "utf8",
  ),
) as Record<string, unknown>;
const limits = CONTRACT.limits;
const publicRequestBytes =
  limits !== null && typeof limits === "object"
    ? (limits as Record<string, unknown>).public_request_bytes
    : undefined;
if (
  !Number.isSafeInteger(publicRequestBytes) ||
  (publicRequestBytes as number) < 1 ||
  (publicRequestBytes as number) > 10 * 1024 * 1024
)
  throw new Error(
    "contract limits.public_request_bytes must be a safe positive integer",
  );
const MAX_REQUEST_BYTES = publicRequestBytes as number;
const SUBMISSION_SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "./eval-contract/submission_request.schema.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
) as Record<string, unknown>;

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
  if (request.rawBody) return request.rawBody.byteLength;
  try {
    const serialized = JSON.stringify(request.body);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
  } catch {
    return MAX_REQUEST_BYTES + 1;
  }
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
): void {
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
    error(
      response,
      503,
      "service_unavailable",
      "Community aggregates are not enabled yet.",
    );
    return;
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
  error(
    response,
    503,
    "service_unavailable",
    "Evaluation submission is not enabled yet.",
  );
}
