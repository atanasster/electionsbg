// Session tokens stay in memory. Reloading requires fresh verification; a
// server-side IP/day allowance prevents that from resetting the daily quota.
export const PROXY_URL = import.meta.env?.VITE_LLM_PROXY_URL || "/api/llm";
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
  try {
    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
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
    if (!notice) setAiNotice("ai_unavailable");
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
