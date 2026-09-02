import type { Leaning, RussiaStance, Tone } from "./data";
import { fetchData } from "./data";
import { canonicalEvalSha256 } from "./evals";

export type FeedbackTargetKind =
  | "person"
  | "party"
  | "settlement"
  | "institution"
  | "company"
  | "sector";

export interface FeedbackTarget {
  kind: FeedbackTargetKind;
  id: string;
  canonical: string;
  href: string;
  aliases: string[];
}

export interface FeedbackTargetRegistry {
  version: 1;
  generated_at: string;
  targets_sha256: string;
  target_count: number;
  targets: FeedbackTarget[];
}

export type FeedbackIssueKind =
  | "missing_analysis"
  | "missing_entity"
  | "wrong_entity_link"
  | "missing_topic"
  | "missing_sector"
  | "other";

export interface ArticleFeedbackTask {
  article_key: string;
  revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  target_registry_sha256: string;
  public_data_revision: string;
}

export interface ArticleFeedbackRequest {
  schema_version: 1;
  article_key: string;
  base_task_revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  target_registry_sha256: string;
  idempotency_key: string;
  turnstile_token: string;
  browser_nonce: string | null;
  feedback: {
    leaning: { label: Leaning; evidence: string } | null;
    russia_stance: { label: RussiaStance; evidence: string } | null;
    party_tones: Array<{
      party: string;
      party_id: string | null;
      resolution_status: "selected" | "unresolved";
      tone: Tone;
      evidence: string;
    }>;
    link_proposals: Array<{
      action: "add" | "replace";
      surface: string;
      target_kind: FeedbackTargetKind;
      resolution_status: "selected" | "unresolved";
      target_ref: Pick<FeedbackTarget, "kind" | "id"> | null;
      current_href: string | null;
      context: string;
      evidence: string;
    }>;
    issue_kinds: FeedbackIssueKind[];
    public_note: string | null;
  };
}

export class ArticleFeedbackError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ArticleFeedbackError";
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requestJson = async (
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<{ response: Response; value: unknown }> => {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new ArticleFeedbackError("network_error", 0);
  }
  const raw = await response.text();
  if (raw.length > 65_536)
    throw new ArticleFeedbackError("invalid_response", response.status);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ArticleFeedbackError("invalid_response", response.status);
  }
  if (!response.ok) {
    const error = object(object(value)?.error);
    throw new ArticleFeedbackError(
      typeof error?.code === "string" ? error.code : "request_failed",
      response.status,
    );
  }
  return { response, value };
};

export const loadArticleFeedbackTask = async (
  domain: string,
  articleId: string,
  fetcher: typeof fetch = fetch,
): Promise<ArticleFeedbackTask> => {
  const { value } = await requestJson(
    `/api/news-evals/feedback-task/${encodeURIComponent(domain)}/${encodeURIComponent(articleId)}`,
    { method: "GET" },
    fetcher,
  );
  const task = object(object(value)?.task);
  if (
    !task ||
    task.article_key !== `${domain}/${articleId}` ||
    !Number.isSafeInteger(task.revision) ||
    typeof task.content_sha256 !== "string" ||
    (task.analysis_sha256 !== null &&
      typeof task.analysis_sha256 !== "string") ||
    typeof task.target_registry_sha256 !== "string" ||
    typeof task.public_data_revision !== "string"
  )
    throw new ArticleFeedbackError("invalid_response", 200);
  return task as unknown as ArticleFeedbackTask;
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: string[],
): boolean =>
  Object.keys(value).sort().join("\u0000") ===
  [...expected].sort().join("\u0000");

export const parseFeedbackTargetRegistry = async (
  input: unknown,
): Promise<FeedbackTargetRegistry> => {
  const value = object(input);
  const kinds = new Set<FeedbackTargetKind>([
    "person",
    "party",
    "settlement",
    "institution",
    "company",
    "sector",
  ]);
  const seen = new Set<string>();
  if (
    !value ||
    !exactKeys(value, [
      "version",
      "generated_at",
      "targets_sha256",
      "target_count",
      "targets",
    ]) ||
    value.version !== 1 ||
    typeof value.generated_at !== "string" ||
    typeof value.targets_sha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.targets_sha256) ||
    !Number.isSafeInteger(value.target_count) ||
    !Array.isArray(value.targets) ||
    value.targets.length !== value.target_count ||
    value.targets.length > 20_000 ||
    value.targets.some((rawTarget) => {
      const target = object(rawTarget);
      if (
        !target ||
        !exactKeys(target, ["kind", "id", "canonical", "href", "aliases"]) ||
        !kinds.has(target.kind as FeedbackTargetKind) ||
        typeof target.id !== "string" ||
        !target.id ||
        target.id.length > 160 ||
        typeof target.canonical !== "string" ||
        !target.canonical ||
        target.canonical.length > 300 ||
        typeof target.href !== "string" ||
        !/^https:\/\/electionsbg\.com\/\S{1,500}$/.test(target.href) ||
        !Array.isArray(target.aliases) ||
        target.aliases.length < 1 ||
        target.aliases.length > 20 ||
        target.aliases.some(
          (alias) => typeof alias !== "string" || !alias || alias.length > 300,
        ) ||
        new Set(target.aliases).size !== target.aliases.length
      )
        return true;
      const key = `${target.kind as string}\u0000${target.id as string}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    }) ||
    (await canonicalEvalSha256(value.targets)) !== value.targets_sha256
  )
    throw new ArticleFeedbackError("invalid_target_registry", 200);
  return value as unknown as FeedbackTargetRegistry;
};

export const loadFeedbackTargets = async (): Promise<FeedbackTargetRegistry> =>
  parseFeedbackTargetRegistry(
    await fetchData<unknown>("feedback-targets.json"),
  );

export interface CurrentFeedbackLink {
  surface: string;
  kind: FeedbackTargetKind;
  id: string;
  href: string;
}

export const loadCurrentFeedbackLinks = async (
  domain: string,
  articleId: string,
): Promise<CurrentFeedbackLink[]> => {
  const bundle = object(
    await fetchData<unknown>(`articles/${encodeURIComponent(domain)}.json`),
  );
  const articles = bundle?.articles;
  if (!Array.isArray(articles))
    throw new ArticleFeedbackError("invalid_article_bundle", 200);
  const article = articles.map(object).find((item) => item?.id === articleId);
  const links = object(object(article?.analysis)?.entity_links);
  if (!links) return [];
  const out: CurrentFeedbackLink[] = [];
  for (const [surface, raw] of Object.entries(links)) {
    const link = object(raw);
    const kind = link?.kind === "place" ? "settlement" : link?.kind;
    if (
      typeof surface !== "string" ||
      !kind ||
      !["person", "party", "settlement", "institution", "company"].includes(
        kind as string,
      ) ||
      typeof link?.id !== "string" ||
      typeof link.href !== "string" ||
      !link.href.startsWith("https://electionsbg.com/")
    )
      throw new ArticleFeedbackError("invalid_article_links", 200);
    out.push({
      surface,
      kind: kind as FeedbackTargetKind,
      id: link.id,
      href: link.href,
    });
  }
  return out.sort(
    (left, right) =>
      left.surface.localeCompare(right.surface, "bg") ||
      left.href.localeCompare(right.href),
  );
};

const foldSearch = (value: string): string =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("bg").trim();

export const searchFeedbackTargets = (
  registry: FeedbackTargetRegistry,
  query: string,
  kind: FeedbackTargetKind,
  limit = 12,
): FeedbackTarget[] => {
  const needle = foldSearch(query);
  if (needle.length < 2) return [];
  return registry.targets
    .filter((target) => target.kind === kind)
    .map((target) => {
      const canonical = foldSearch(target.canonical);
      const aliases = target.aliases.map(foldSearch);
      const score =
        canonical === needle
          ? 0
          : aliases.includes(needle)
            ? 1
            : canonical.startsWith(needle)
              ? 2
              : aliases.some((alias) => alias.startsWith(needle))
                ? 3
                : aliases.some((alias) => alias.includes(needle))
                  ? 4
                  : 5;
      return { target, score };
    })
    .filter(({ score }) => score < 5)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.target.canonical.localeCompare(right.target.canonical, "bg") ||
        left.target.id.localeCompare(right.target.id),
    )
    .slice(0, limit)
    .map(({ target }) => target);
};

export const submitArticleFeedback = async (
  request: ArticleFeedbackRequest,
  fetcher: typeof fetch = fetch,
): Promise<string> => {
  const { value } = await requestJson(
    "/api/news-evals/feedback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(request),
    },
    fetcher,
  );
  const submission = object(object(value)?.submission);
  if (
    !submission ||
    typeof submission.submission_id !== "string" ||
    submission.article_key !== request.article_key ||
    submission.task_revision !== request.base_task_revision ||
    submission.status !== "raw"
  )
    throw new ArticleFeedbackError("invalid_response", 200);
  return submission.submission_id;
};
