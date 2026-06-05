// The chat surface. Provider-agnostic: it calls provider.respond() and renders
// the returned narration + Envelope. Swapping HeuristicProvider for a WebLLM
// provider requires no change here.

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileText,
  ImageDown,
  Plus,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LLMProvider } from "../llm/provider";
import { AnswerView } from "../render/AnswerView";
import type { Lang } from "../tools/types";
import {
  conversationToMarkdown,
  downloadAnswerImage,
  downloadMarkdown,
  downloadPdf,
  type ChatMsg,
} from "./export";
import { followUps } from "./followups";

type Msg = ChatMsg & { id: number };

const STARTERS: { bg: string; en: string }[] = [
  {
    bg: "Какъв е процентът машинно гласуване в последните 7 избора?",
    en: "What's the machine-voting % in the last 7 elections?",
  },
  {
    bg: "Как се представя ГЕРБ през годините?",
    en: "How has GERB performed over the years?",
  },
  {
    bg: "Какви са резултатите от последните избори?",
    en: "Results of the latest election?",
  },
  {
    bg: "Сравни изборите от 2022 и 2024",
    en: "Compare the 2022 and 2024 elections",
  },
  { bg: "Каква беше активността през 2023?", en: "What was turnout in 2023?" },
];

export const Chat = ({
  provider,
  lang,
  election,
}: {
  provider: LLMProvider;
  lang: Lang;
  election: string;
}) => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);
  const nextId = () => (idRef.current += 1);

  // keep the latest answer in view as the conversation grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId(), role: "user", text: q }]);
    setBusy(true);
    const res = await provider.respond(q, { lang, election });
    setMessages((m) => [
      ...m,
      { id: nextId(), role: "assistant", text: res.text, env: res.env },
    ]);
    setBusy(false);
  };

  // shareable deep-link: ?q=<question> auto-asks the question on load
  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        conversationToMarkdown(messages, lang),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const lastUserText = [...messages]
    .reverse()
    .find((m) => m.role === "user")?.text;

  const share = async () => {
    if (!lastUserText) return;
    const url = `${window.location.origin}${window.location.pathname}?q=${encodeURIComponent(lastUserText)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const last = messages[messages.length - 1];
  const followups =
    !busy && last?.role === "assistant" && last.env ? followUps(last.env) : [];

  const hasChat = messages.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {hasChat && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setMessages([])}>
            <Plus /> {t("Нов разговор", "New chat")}
          </Button>
          <Button variant="outline" size="sm" onClick={copyAll}>
            {copied ? <Check /> : <Copy />}
            {copied ? t("Копирано", "Copied") : t("Копирай", "Copy")}
          </Button>
          <Button variant="outline" size="sm" onClick={share}>
            {shared ? <Check /> : <Share2 />}
            {shared
              ? t("Линкът е копиран", "Link copied")
              : t("Сподели", "Share")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadMarkdown(messages, lang)}
          >
            <FileText /> .md
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void downloadPdf(messages, lang)}
          >
            <Download /> .pdf
          </Button>
        </div>
      )}

      {!hasChat && (
        <p className="pt-2 text-sm text-muted-foreground">
          {t(
            "Питайте за резултати, активност, партии, бюджет, депутати, местни избори…",
            "Ask about results, turnout, parties, budget, MPs, local elections…",
          )}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={m.id} className="max-w-[85%] self-end">
              <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div
              key={m.id}
              data-msg=""
              className="w-full max-w-[95%] space-y-2 self-start"
            >
              <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm text-foreground">
                {m.text}
              </div>
              {m.env && (
                <>
                  <div data-answer-card="">
                    <AnswerView env={m.env} lang={lang} />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={(e) => {
                      const card = e.currentTarget
                        .closest("[data-msg]")
                        ?.querySelector<HTMLElement>("[data-answer-card]");
                      if (card)
                        void downloadAnswerImage(
                          card,
                          messages[i - 1]?.text ?? "",
                          lang,
                        );
                    }}
                  >
                    <ImageDown /> {t("Изображение", "Image")}
                  </Button>
                </>
              )}
            </div>
          ),
        )}
        {followups.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 self-start">
            <span className="text-[11px] text-muted-foreground">
              {t("Свързани:", "Related:")}
            </span>
            {followups.map((s) => (
              <button
                key={s.en}
                onClick={() => send(s[lang])}
                className="rounded-full border border-input bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {s[lang]}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <div className="self-start text-sm text-muted-foreground">…</div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-2 bg-card/85 px-2 pb-3 pt-2 backdrop-blur sm:-mx-4 sm:px-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            className="flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={t(
              "Попитайте за изборите…",
              "Ask about the elections…",
            )}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={busy || !input.trim()}
          >
            {t("Изпрати", "Send")}
          </button>
        </form>
        {/* sample prompts live under the composer so they persist after the
            first question (don't vanish like an empty-state) */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {t("Опитайте:", "Try:")}
          </span>
          {STARTERS.map((s) => (
            <button
              key={s.en}
              onClick={() => send(s[lang])}
              disabled={busy}
              className="rounded-full border border-input bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {s[lang]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
