// The chat surface. Provider-agnostic: it calls provider.respond() and renders
// the returned narration + Envelope. Swapping HeuristicProvider for a WebLLM
// provider (M3) requires no change here.

import { useRef, useState } from "react";
import type { LLMProvider } from "../llm/provider";
import { AnswerView } from "../render/AnswerView";
import type { Envelope, Lang } from "../tools/types";

type Msg = {
  id: number;
  role: "user" | "assistant";
  text: string;
  env?: Envelope | null;
};

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
  const idRef = useRef(0);
  const nextId = () => (idRef.current += 1);

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

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-5">
          <p className="mb-3 text-sm text-muted-foreground">
            {lang === "bg" ? "Опитайте въпрос:" : "Try a question:"}
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s.en}
                onClick={() => send(s[lang])}
                className="rounded-full border border-input bg-card px-3 py-1.5 text-sm hover:bg-muted"
              >
                {s[lang]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="self-end max-w-[85%]">
              <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="self-start w-full max-w-[95%] space-y-3">
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
      </div>

      <form
        className="sticky bottom-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={
            lang === "bg"
              ? "Попитайте за изборите…"
              : "Ask about the elections…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={busy || !input.trim()}
        >
          {lang === "bg" ? "Изпрати" : "Send"}
        </button>
      </form>
    </div>
  );
};
