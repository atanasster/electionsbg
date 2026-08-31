import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render(
    target: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "auto";
      language: "bg";
      size: "flexible";
      tabindex: number;
      "response-field": false;
      callback(token: string): void;
      "error-callback"(): boolean;
      "expired-callback"(): void;
      "timeout-callback"(): void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileState =
  | "loading"
  | "ready"
  | "verified"
  | "expired"
  | "error"
  | "unavailable";

const SCRIPT_ID = "news-eval-turnstile-script";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loader: Promise<TurnstileApi> | null = null;

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(
      SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", ready);
      script.removeEventListener("error", failed);
    };
    const ready = () => {
      cleanup();
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile API unavailable"));
    };
    const failed = () => {
      cleanup();
      reject(new Error("Turnstile script unavailable"));
    };
    const timeout = window.setTimeout(failed, 10_000);
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error) => {
    loader = null;
    throw error;
  });
  return loader;
};

export const TurnstileWidget = ({
  siteKey,
  action,
  resetSignal,
  onToken,
  onStateChange,
}: {
  siteKey: string;
  action: string;
  resetSignal: number;
  onToken: (token: string | null) => void;
  onStateChange: (state: TurnstileState) => void;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const [state, setState] = useState<TurnstileState>(
    siteKey ? "loading" : "unavailable",
  );

  useEffect(() => {
    onStateChange(state);
  }, [onStateChange, state]);

  useEffect(() => {
    let active = true;
    if (!siteKey || !host.current) {
      setState("unavailable");
      onToken(null);
      return;
    }
    setState("loading");
    void loadTurnstile()
      .then((api) => {
        if (!active || !host.current) return;
        setState("ready");
        const id = api.render(host.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          language: "bg",
          size: "flexible",
          tabindex: 0,
          "response-field": false,
          callback: (token) => {
            if (!active) return;
            onToken(token);
            setState("verified");
          },
          "error-callback": () => {
            if (!active) return true;
            onToken(null);
            setState("error");
            return true;
          },
          "expired-callback": () => {
            if (!active) return;
            onToken(null);
            setState("expired");
          },
          "timeout-callback": () => {
            if (!active) return;
            onToken(null);
            setState("expired");
          },
        });
        widget.current = { api, id };
      })
      .catch(() => {
        if (!active) return;
        onToken(null);
        setState("unavailable");
      });
    return () => {
      active = false;
      if (widget.current) {
        widget.current.api.remove(widget.current.id);
        widget.current = null;
      }
    };
  }, [action, onToken, siteKey]);

  useEffect(() => {
    if (!resetSignal || !widget.current) return;
    widget.current.api.reset(widget.current.id);
    onToken(null);
    setState("ready");
  }, [onToken, resetSignal]);

  return (
    <div className="min-w-0" aria-live="polite">
      <div ref={host} className="min-h-16 min-w-0" />
      <p className="mt-1 text-xs text-muted-foreground">
        {state === "loading"
          ? "Зарежда се проверката срещу злоупотреба…"
          : null}
        {state === "ready" ? "Завършете проверката срещу злоупотреба." : null}
        {state === "verified" ? "Проверката е завършена." : null}
        {state === "expired" ? "Проверката изтече. Завършете я отново." : null}
        {state === "error" ? "Проверката не успя. Опитайте отново." : null}
        {state === "unavailable"
          ? "Изпращането временно не е достъпно, защото проверката не се зареди. Черновата остава само в този браузър."
          : null}
      </p>
    </div>
  );
};
