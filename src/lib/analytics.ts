// Cookieless, self-hosted audience measurement (Umami on Cloud Run, served first-party under
// /stats — see docs/plans/gdpr-consent-v1.md). This file is the ONLY analytics seam: every call
// site goes through `trackEvent`, so swapping the backend never touches a screen.
//
// ⚠ WHY THERE IS NO CONSENT BANNER, AND WHAT KEEPS IT THAT WAY. Umami sets no cookie and writes
// nothing to the device (its tracker only READS an opt-out flag), so ЗЕС чл. 4а asks for no
// consent. That conclusion holds only while this module never sends anything that identifies a
// person. Three rules follow, and each is enforced here rather than trusted to a caller:
//   1. No query string or hash ever leaves the page (`data-exclude-search` / `-hash`). On this
//      site `?q=` carries AI-chat questions and DbDataTable searches, i.e. free text.
//   2. Event props are scalars only, and free-text keys are refused (`FORBIDDEN_PROP_KEYS`).
//      Search terms and result labels are very often a person's name — personal data about a
//      third party that has no business in an analytics store.
//   3. Nothing loads in DEV, under automation, or off the production hostname.

declare global {
  interface Window {
    umami?: {
      track: (
        name: string,
        data?: Record<string, string | number | boolean>,
      ) => void;
    };
  }
}

/** Umami website id for naiasno.bg. Empty = analytics disabled (the loader no-ops). */
export const UMAMI_WEBSITE_ID = "4a29eca9-f428-4064-b974-0654598cce76";
/** Served by Firebase Hosting's `/stats/**` rewrite to the `umami` Cloud Run service. */
export const UMAMI_SCRIPT_PATH = "/stats/script.js";
/** Only the production host is counted — staging, preview channels and localhost never are. */
export const ANALYTICS_HOSTNAME = "naiasno.bg";

/** Prop keys that could carry free text. A call site passing one is a bug; the key is dropped. */
export const FORBIDDEN_PROP_KEYS = [
  "search_term",
  "term",
  "query",
  "q",
  "label",
  "result_label",
  "name",
  "title",
  "text",
  "url",
] as const;

type PropValue = string | number | boolean;

/** Keep scalar props, drop free-text keys and anything undefined/null/object. Exported for tests. */
export const sanitizeProps = (
  params?: Record<string, unknown>,
): Record<string, PropValue> | undefined => {
  if (!params) return undefined;
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(params)) {
    if ((FORBIDDEN_PROP_KEYS as readonly string[]).includes(k)) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    )
      out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
};

/** Send a custom event. No-ops until the tracker has loaded (or when it never will). */
export const trackEvent = (
  eventName: string,
  eventParams?: Record<string, unknown>,
) => {
  if (typeof window === "undefined" || !window.umami) return;
  try {
    window.umami.track(eventName, sanitizeProps(eventParams));
  } catch {
    // Analytics must never break a page.
  }
};

/** A search ran. Only the result COUNT is recorded — never the term. */
export const trackSearch = (resultCount?: number) => {
  trackEvent("search", { result_count: resultCount });
};

/** A search result was picked. Only its TYPE is recorded — never the term, key or label. */
export const trackSearchSelection = (selectedType: string) => {
  trackEvent("select_search_result", { result_type: selectedType });
};

/** Whether the tracker should load in this environment. Exported for tests. */
export const shouldLoadAnalytics = (env: {
  dev: boolean;
  webdriver: boolean;
  hostname: string;
  websiteId: string;
}) =>
  !env.dev &&
  !env.webdriver &&
  env.websiteId !== "" &&
  env.hostname === ANALYTICS_HOSTNAME;

/** Name of the global the tracker calls (`window[data-before-send]`) before every send. */
export const BEFORE_SEND_HOOK = "naiasnoAnalyticsBeforeSend";

/** Drop the page title before it leaves the browser: on /person/… pages it IS a person's name.
 *  scripts/umami/privacy.sql nulls it server-side as well; this keeps it off the wire. */
export const beforeSend = (
  _type: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...payload };
  delete out.title;
  return out;
};

/** Build the tracker <script> element. Exported for tests. */
export const buildTrackerScript = (doc: Document, origin: string) => {
  const s = doc.createElement("script");
  s.defer = true;
  s.src = UMAMI_SCRIPT_PATH;
  s.dataset.websiteId = UMAMI_WEBSITE_ID;
  // The tracker would otherwise derive its endpoint from the script's directory (/stats) and
  // then append COLLECT_API_ENDPOINT (/stats/api/send) — /stats/stats/api/send. Pin the origin.
  s.dataset.hostUrl = origin;
  s.dataset.excludeSearch = "true";
  s.dataset.excludeHash = "true";
  s.dataset.doNotTrack = "true";
  s.dataset.domains = ANALYTICS_HOSTNAME;
  s.dataset.beforeSend = BEFORE_SEND_HOOK;
  return s;
};

let installed = false;
/** Load the tracker once, after the page is idle. Safe to call repeatedly. */
export const installAnalytics = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;
  if (
    !shouldLoadAnalytics({
      dev: import.meta.env.DEV,
      webdriver: typeof navigator !== "undefined" && !!navigator.webdriver,
      hostname: window.location.hostname,
      websiteId: UMAMI_WEBSITE_ID,
    })
  )
    return;
  (window as unknown as Record<string, unknown>)[BEFORE_SEND_HOOK] = beforeSend;
  const load = () =>
    document.head.appendChild(
      buildTrackerScript(document, window.location.origin),
    );
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void) => number;
  };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(load);
  else setTimeout(load, 2000);
};
