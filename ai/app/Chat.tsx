// The chat surface. Provider-agnostic: it calls provider.respond() and renders
// the returned narration + Envelope. Swapping HeuristicProvider for a WebLLM
// provider requires no change here.

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileText, Plus } from "lucide-react";
import type { LLMProvider } from "../llm/provider";
import { AnswerView } from "../render/AnswerView";
import type { Lang } from "../tools/types";
import {
  conversationToMarkdown,
  downloadMarkdown,
  downloadPdf,
  type ChatMsg,
} from "./export";

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
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
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

  const hasChat = messages.length > 0;
  const toolBtn =
    "inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted";

  return (
    <div className="flex flex-col gap-4">
      {hasChat && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <button className={toolBtn} onClick={() => setMessages([])}>
            <Plus className="size-3.5" /> {t("Нов разговор", "New chat")}
          </button>
          <button className={toolBtn} onClick={copyAll}>
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? t("Копирано", "Copied") : t("Копирай", "Copy")}
          </button>
          <button
            className={toolBtn}
            onClick={() => downloadMarkdown(messages, lang)}
          >
            <FileText className="size-3.5" /> .md
          </button>
          <button
            className={toolBtn}
            onClick={() => void downloadPdf(messages, lang)}
          >
            <Download className="size-3.5" /> .pdf
          </button>
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
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="max-w-[85%] self-end">
              <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="w-full max-w-[95%] space-y-3 self-start">
              <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm text-foreground">
                {m.text}
              </div>
              {m.env && <AnswerView env={m.env} />}
            </div>
          ),
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
