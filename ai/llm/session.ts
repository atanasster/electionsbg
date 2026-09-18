// Stable main-project Hosting origin: marketing-domain redirects must not rewrite POSTs.
// Session tokens stay in memory. Reloading requires fresh verification; a
// server-side IP/day allowance prevents that from resetting the daily quota.
const HOSTING_PROXY_URL = "https://elections-bg.web.app/api/llm";

/** Hosts whose OWN /api/llm is the hosting rewrite to the function, served with
 *  no redirect (checked 2026-09-18: a POST there reaches the function). On these
 *  the chat calls the proxy SAME-ORIGIN, which skips the CORS preflight — a full
 *  round trip to us-central1 on every call, since the proxy's preflight cache
 *  is short. That round trip alone pushed every Jev call past its budget.
 *
 *  ⚠️ Never add a host that REDIRECTS /api/llm (electionsbg.com 301s to
 *  naiasno.bg): a redirect turns the POST into a GET. Anything not listed keeps
 *  the absolute main-project URL — localhost, staging, previews. */
export const SAME_ORIGIN_PROXY_HOSTS: ReadonlySet<string> = new Set([
  "naiasno.bg",
  "elections-bg.web.app",
]);

export const proxyUrlFor = (hostname: string | undefined): string =>
  hostname && SAME_ORIGIN_PROXY_HOSTS.has(hostname)
    ? "/api/llm"
    : HOSTING_PROXY_URL;

export const PROXY_URL =
  import.meta.env?.VITE_LLM_PROXY_URL ||
  proxyUrlFor(typeof location === "undefined" ? undefined : location.hostname);
let token = "";
let expiresAt = 0;
let notice = "";
const listeners = new Set<() => void>();
export const subscribeAiSession = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const aiSessionNotice = () => notice;
export const setAiNotice = (value: string) => {
  notice = value;
  listeners.forEach((listener) => listener());
};
export const hasAiSession = () => !!token && expiresAt > Date.now();
export async function sessionRequest(body: Record<string, unknown>) {
  let serverError = false;
  try {
    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
      serverError = true;
      const code =
        typeof data.error === "string" ? data.error : "ai_unavailable";
      if (response.status === 401) {
        token = "";
        expiresAt = 0;
      }
      setAiNotice(code);
      throw new Error(code);
    }
    return data;
  } catch (error) {
    if (!serverError) setAiNotice("ai_unavailable");
    throw error;
  }
}
export async function verifyAiSession(turnstileToken: string) {
  const data = await sessionRequest({ action: "session", turnstileToken });
  if (
    typeof data.token !== "string" ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt <= Date.now()
  )
    throw new Error("invalid_session");
  token = data.token;
  expiresAt = data.expiresAt;
  setAiNotice("");
}
export type QuestionAccess = {
  start(): Promise<{ sessionToken: string; questionId: string }>;
  finish(credentials: {
    sessionToken: string;
    questionId: string;
  }): Promise<void>;
};
export const questionAccess: QuestionAccess = {
  async start() {
    if (!hasAiSession()) {
      setAiNotice("verification_required");
      throw new Error("verification_required");
    }
    const sessionToken = token;
    const data = await sessionRequest({ action: "start", sessionToken });
    if (typeof data.questionId !== "string")
      throw new Error("invalid_question");
    setAiNotice("");
    return { sessionToken, questionId: data.questionId };
  },
  async finish(credentials) {
    await sessionRequest({ action: "finish", ...credentials });
  },
};
