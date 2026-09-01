export type NewsRouteFamily =
  | "home"
  | "story"
  | "article"
  | "outlet"
  | "outlets"
  | "topics"
  | "methodology"
  | "saved"
  | "about"
  | "corrections"
  | "evals"
  | "other";

type ContentType = "story" | "article";
export type NewsVitalName = "LCP" | "INP" | "CLS";
export type NewsVitalRating = "good" | "needs_improvement" | "poor";
type ReaderTask =
  | "briefing"
  | "find_story"
  | "compare_coverage"
  | "open_original";
export type NewsAnalyticsEvent =
  | { name: "page_view"; route: NewsRouteFamily }
  | {
      name: "web_vital";
      route: NewsRouteFamily;
      metric: NewsVitalName;
      value: number;
      rating: NewsVitalRating;
    }
  | {
      name: "reader_task";
      task: ReaderTask;
      signal: "completed";
    }
  | {
      name: "reader_outcome";
      task: "search" | "comparison";
      outcome: "results" | "empty" | "available" | "unavailable";
    }
  | {
      name: "briefing_preference";
      preference: "cadence" | "density" | "topic";
      active: boolean;
    }
  | {
      name: "home_filter";
      filter: "category" | "period" | "reset";
      active: boolean;
    }
  | { name: "story_filter"; axis: "leaning" | "russia"; active: boolean }
  | { name: "reader_save"; content: ContentType; saved: boolean }
  | {
      name: "reader_share";
      content: ContentType;
      method: "native";
      outcome: "opened" | "cancelled" | "failed";
    }
  | {
      name: "reader_share";
      content: ContentType;
      method: "clipboard";
      outcome: "copied" | "failed";
    }
  | {
      name: "reader_share";
      content: ContentType;
      method: "unavailable";
      outcome: "failed";
    }
  | { name: "source_open"; surface: "article" };

declare global {
  interface Window {
    /** Optional host sink. The news bundle never loads a tracker itself. */
    naiasnoNewsAnalytics?: (event: NewsAnalyticsEvent) => void | Promise<void>;
  }
}

export const newsRouteFamily = (pathname: string): NewsRouteFamily => {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/story/")) return "story";
  if (pathname.startsWith("/article/")) return "article";
  if (pathname.startsWith("/outlet/")) return "outlet";
  if (pathname === "/outlets") return "outlets";
  if (pathname === "/topics") return "topics";
  if (pathname === "/methodology") return "methodology";
  if (pathname === "/saved") return "saved";
  if (pathname === "/about") return "about";
  if (pathname === "/corrections") return "corrections";
  if (pathname === "/evals" || pathname.startsWith("/evals/article/"))
    return "evals";
  return "other";
};

const ROUTES = new Set<NewsRouteFamily>([
  "home",
  "story",
  "article",
  "outlet",
  "outlets",
  "topics",
  "methodology",
  "saved",
  "about",
  "corrections",
  "evals",
  "other",
]);
const CONTENT = new Set<ContentType>(["story", "article"]);
const VITALS = new Set<NewsVitalName>(["LCP", "INP", "CLS"]);
const TASKS = new Set<ReaderTask>([
  "briefing",
  "find_story",
  "compare_coverage",
  "open_original",
]);

export const newsVitalRating = (
  metric: NewsVitalName,
  value: number,
): NewsVitalRating => {
  const [good, poor] =
    metric === "LCP"
      ? [2_500, 4_000]
      : metric === "INP"
        ? [200, 500]
        : [0.1, 0.25];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
};

const roundedVitalValue = (metric: NewsVitalName, value: number): number =>
  metric === "CLS" ? Math.round(value * 1_000) / 1_000 : Math.round(value);

/** Reconstruct from allow-lists; unknown values and extra PII fields die here. */
const sanitizeNewsEventUnsafe = (raw: object): NewsAnalyticsEvent | null => {
  const event = raw as NewsAnalyticsEvent & Record<string, unknown>;
  switch (event.name) {
    case "page_view":
      return ROUTES.has(event.route)
        ? { name: "page_view", route: event.route }
        : null;
    case "web_vital": {
      if (
        !ROUTES.has(event.route) ||
        !VITALS.has(event.metric) ||
        typeof event.value !== "number" ||
        !Number.isFinite(event.value) ||
        event.value < 0 ||
        (event.metric === "CLS" ? event.value > 10 : event.value > 120_000)
      )
        return null;
      const value = roundedVitalValue(event.metric, event.value);
      return {
        name: "web_vital",
        route: event.route,
        metric: event.metric,
        value,
        rating: newsVitalRating(event.metric, value),
      };
    }
    case "reader_task":
      return TASKS.has(event.task) && event.signal === "completed"
        ? { name: "reader_task", task: event.task, signal: "completed" }
        : null;
    case "reader_outcome":
      if (
        (event.task === "search" &&
          ["results", "empty"].includes(event.outcome)) ||
        (event.task === "comparison" &&
          ["available", "unavailable"].includes(event.outcome))
      )
        return {
          name: "reader_outcome",
          task: event.task,
          outcome: event.outcome,
        };
      return null;
    case "briefing_preference":
      return ["cadence", "density", "topic"].includes(event.preference) &&
        typeof event.active === "boolean"
        ? {
            name: "briefing_preference",
            preference: event.preference,
            active: event.active,
          }
        : null;
    case "home_filter":
      return ["category", "period", "reset"].includes(event.filter) &&
        typeof event.active === "boolean"
        ? { name: "home_filter", filter: event.filter, active: event.active }
        : null;
    case "story_filter":
      return ["leaning", "russia"].includes(event.axis) &&
        typeof event.active === "boolean"
        ? { name: "story_filter", axis: event.axis, active: event.active }
        : null;
    case "reader_save":
      return CONTENT.has(event.content) && typeof event.saved === "boolean"
        ? { name: "reader_save", content: event.content, saved: event.saved }
        : null;
    case "reader_share":
      if (!CONTENT.has(event.content)) return null;
      if (
        (event.method === "native" &&
          ["opened", "cancelled", "failed"].includes(event.outcome)) ||
        (event.method === "clipboard" &&
          ["copied", "failed"].includes(event.outcome)) ||
        (event.method === "unavailable" && event.outcome === "failed")
      )
        return {
          name: "reader_share",
          content: event.content,
          method: event.method,
          outcome: event.outcome,
        } as NewsAnalyticsEvent;
      return null;
    case "source_open":
      return event.surface === "article"
        ? { name: "source_open", surface: "article" }
        : null;
    default:
      return null;
  }
};

export const sanitizeNewsEvent = (raw: unknown): NewsAnalyticsEvent | null => {
  if (raw === null || typeof raw !== "object") return null;
  try {
    return sanitizeNewsEventUnsafe(raw);
  } catch {
    return null;
  }
};

export const emitNewsEvent = (event: NewsAnalyticsEvent): void => {
  if (typeof window === "undefined") return;
  const safe = sanitizeNewsEvent(event);
  const sink = window.naiasnoNewsAnalytics;
  if (!safe || !sink) return;
  queueMicrotask(() => {
    try {
      void Promise.resolve(sink(safe)).catch(() => undefined);
    } catch {
      // Analytics must never break a reader action or navigation.
    }
  });
};
