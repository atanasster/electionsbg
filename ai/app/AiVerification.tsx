import { useEffect, useRef, useState } from "react";
import type { Lang } from "../tools/types";
import { verifyAiSession } from "../llm/session";

type Turnstile = {
  render(host: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
const api = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
let loader: Promise<Turnstile> | undefined;
function load() {
  if (api()) return Promise.resolve(api()!);
  if (loader) return loader;
  loader = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => failed(), 10000);
    const failed = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("verification_unavailable"));
    };
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (api()) resolve(api()!);
      else failed();
    };
    script.onerror = failed;
    document.head.append(script);
  }).catch((error) => {
    loader = undefined;
    throw error;
  });
  return loader;
}
export function AiVerification({
  lang,
  onVerified,
}: {
  lang: Lang;
  onVerified: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onVerified);
  callback.current = onVerified;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const siteKey = import.meta.env.VITE_AI_TURNSTILE_SITE_KEY;
  useEffect(() => {
    let active = true;
    let widget: { api: Turnstile; id: string } | undefined;
    if (!siteKey) return;
    setError(false);
    void load()
      .then((turnstile) => {
        if (!active || !host.current) return;
        const failed = () => {
          if (active) setError(true);
          return true;
        };
        const id = turnstile.render(host.current, {
          sitekey: siteKey,
          action: "ai_chat",
          theme: "auto",
          language: lang,
          "response-field": false,
          callback: (token: string) => {
            void verifyAiSession(token)
              .then(() => {
                if (active) callback.current();
              })
              .catch(failed);
          },
          "error-callback": failed,
          "expired-callback": failed,
          "timeout-callback": failed,
        });
        widget = { api: turnstile, id };
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (widget) widget.api.remove(widget.id);
    };
  }, [lang, siteKey, attempt]);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm">
        {lang === "bg"
          ? "Завършете проверката, за да използвате AI. Без AI остава достъпно без проверка."
          : "Complete verification to use AI. No AI remains available without verification."}
      </p>
      <div ref={host} />
      {(!siteKey || error) && (
        <p className="text-sm text-destructive">
          {lang === "bg"
            ? "Проверката временно не е достъпна. Можете да продължите без AI."
            : "Verification is temporarily unavailable. You can continue without AI."}
        </p>
      )}
      {siteKey && error && (
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {lang === "bg" ? "Опитай отново" : "Retry"}
        </button>
      )}
    </div>
  );
}
