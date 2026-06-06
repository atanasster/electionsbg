// The chat surface. Provider-agnostic: it calls provider.respond() and renders
// the returned narration + Envelope. Swapping HeuristicProvider for a WebLLM
// provider requires no change here.

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  Facebook,
  FileDown,
  FileText,
  ImageDown,
  Loader2,
  Mic,
  Plus,
  Share2,
  Sparkles,
  Square,
  Table,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ModelEngine } from "../llm/useModelEngine";
import { distill } from "../orchestrator/memory";
import { AnswerView } from "../render/AnswerView";
import type { Lang, ToolArgs } from "../tools/types";
import {
  conversationToMarkdown,
  downloadAnswerImage,
  downloadAnswerMarkdown,
  downloadAnswerPdf,
  downloadCsv,
  downloadMarkdown,
  downloadPdf,
  type ChatMsg,
} from "./export";
import { followUps } from "./followups";
import { ModelPicker } from "./ModelPicker";
import { matchSuggestions } from "./suggestions";
import { useSpeech } from "./useSpeech";
import { useVoiceInput } from "./voice";

// detail = which narration length this answer is currently showing (the
// кратко/подробно toggle).
type Msg = ChatMsg & { id: number; detail?: "brief" | "full" };

// The previous answer's tool + args, used to resolve a follow-on ("а ДПС?").
// Scans backwards from `beforeIndex` for the nearest assistant turn that ran a
// tool (skips clarify/error turns, which carry no tool).
const prevContext = (
  msgs: Msg[],
  beforeIndex: number,
): { tool: string; args: ToolArgs } | undefined => {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && m.tool)
      return { tool: m.tool, args: m.args ?? {} };
  }
  return undefined;
};

const STORAGE_KEY = "naiasno.chat.v1";

// Remembers the response-eloquence preference (the concise/elaborate toggle)
// across reloads.
const ELOQUENCE_KEY = "naiasno.eloquence.v1";

// A pool of starter prompts. Deliberately larger than STARTER_COUNT so that
// after dropping the ones the user has already asked there are still enough
// fresh prompts to fill the row. Each is phrased to route to a real tool.
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
  { bg: "Какъв е държавният бюджет?", en: "What is the state budget?" },
  { bg: "За какво се харчи бюджетът?", en: "What is the budget spent on?" },
  { bg: "Кои депутати са най-богати?", en: "Which MPs are richest?" },
  {
    bg: "Кои са най-големите инвестиционни проекти?",
    en: "What are the biggest investment projects?",
  },
  {
    bg: "Коя социологическа агенция е най-точна?",
    en: "Which polling agency is most accurate?",
  },
  { bg: "Кои са правителствата от 2005?", en: "Governments since 2005?" },
  {
    bg: "Кой спечели общинските съвети?",
    en: "Who won the municipal councils?",
  },
  {
    bg: "Имаше ли нередности на последните избори?",
    en: "Were there irregularities in the latest election?",
  },
];

// How many starter chips to show under the composer.
const STARTER_COUNT = 5;

const normPrompt = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

// Fisher-Yates; returns a new shuffled copy (never mutates the input).
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Nearest scrollable ancestor of `el` (the element that actually scrolls). Used
// to auto-scroll the conversation: we scroll the scrollport itself to its foot
// rather than scrollIntoView the end-marker, because the marker sits above the
// sticky composer in the DOM — aligning it to the scrollport bottom would leave
// the composer overlaying the tail of the answer + the follow-up chips. Matched
// by overflow style alone (not current overflow) so it resolves before the
// content has grown tall enough to scroll.
const scrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
};

// Per-response export menu, rendered in the answer panel's header band. Image
// rasterizes the live card (via cardRef); md/pdf/csv serialize this one answer.
const AnswerExportMenu = ({
  cardRef,
  msg,
  question,
  lang,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  msg: Msg;
  question: string;
  lang: Lang;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const env = msg.env;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground"
        >
          <Download /> {t("Изтегли", "Export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            const el = cardRef.current;
            if (el) void downloadAnswerImage(el, question, lang);
          }}
        >
          <ImageDown /> {t("Изображение", "Image")} (PNG)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => downloadAnswerMarkdown(msg, question, lang)}
        >
          <FileText /> Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void downloadAnswerPdf(msg, question, lang)}
        >
          <FileDown /> PDF (.pdf)
        </DropdownMenuItem>
        {env && (env.kind === "table" || env.kind === "series") && (
          <DropdownMenuItem onSelect={() => downloadCsv(env)}>
            <Table /> CSV (.csv)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// A small control rendered under the answer prose: read-aloud (TTS) + the
// кратко/подробно (brief/detailed) toggle. The toggle only appears when a model
// wrote the prose — the rules engine has only its fixed template, so it can't
// elaborate. `data-export-omit` keeps these buttons out of the PNG/PDF capture.
const AnswerControls = ({
  msg,
  lang,
  busy,
  speech,
  onSetDetail,
}: {
  msg: Msg;
  lang: Lang;
  busy: boolean;
  speech: ReturnType<typeof useSpeech>;
  onSetDetail: (id: number, detail: "brief" | "full") => void;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const id = String(msg.id);
  const speaking = speech.speakingId === id;
  const canSpeak = speech.supported && !!msg.text;
  const canDetail = msg.meta?.narratedBy === "model";
  if (!canSpeak && !canDetail) return null;
  const detailed = msg.detail === "full";
  const btn =
    "inline-flex items-center gap-1 rounded-full border border-input px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";
  return (
    <div data-export-omit="">
      {canSpeak && (
        <button
          type="button"
          className={btn}
          onClick={() => speech.speak(id, msg.text)}
          aria-label={
            speaking
              ? t("Спри четенето", "Stop")
              : t("Чети на глас", "Read aloud")
          }
        >
          {speaking ? (
            <Square className="size-3 fill-current" />
          ) : (
            <Volume2 className="size-3.5" />
          )}
          {speaking ? t("Спри", "Stop") : t("Чети", "Listen")}
        </button>
      )}
      {canDetail && (
        <button
          type="button"
          className={`${btn} ml-1.5`}
          disabled={busy}
          onClick={() => onSetDetail(msg.id, detailed ? "brief" : "full")}
        >
          {detailed ? (
            <AlignLeft className="size-3.5" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {detailed ? t("Кратко", "Brief") : t("Подробно", "Detailed")}
        </button>
      )}
    </div>
  );
};

// Global response-eloquence toggle, shown next to the model picker. It sets the
// DEFAULT narration length for new answers — "brief" (concise) leads with the
// headline in 1–2 sentences, "full" (elaborate) expands to a short paragraph.
// The per-answer Кратко/Подробно button (AnswerControls) still overrides a
// single answer. Only meaningful when a model narrates, so the caller hides it
// for the offline rules engine.
const EloquenceToggle = ({
  value,
  onChange,
  lang,
  disabled,
}: {
  value: "brief" | "full";
  onChange: (v: "brief" | "full") => void;
  lang: Lang;
  disabled: boolean;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const seg = (v: "brief" | "full", bg: string, en: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      className={cn(
        "rounded-full px-2 py-0.5 transition-colors disabled:opacity-50",
        value === v
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {t(bg, en)}
    </button>
  );
  return (
    <div
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-input bg-card p-0.5 text-[11px]"
      title={t("Дължина на отговора", "Response length")}
      aria-label={t("Дължина на отговора", "Response length")}
    >
      {seg("brief", "Кратко", "Concise")}
      {seg("full", "Подробно", "Elaborate")}
    </div>
  );
};

// A subtle indicator that the assistant remembers the conversation: how many
// prior exchanges are in context, and whether older ones have been compacted
// into a summary. Shown once a thread exists so a user understands a follow-up
// ("compare that to 2024") will be read in context. `mr-auto` pushes it to the
// left of the toolbar's action buttons.
const MEMORY_COMPACT_AT = 6; // matches the cloud window cap (memory.ts)
const MemoryPill = ({ turns, lang }: { turns: number; lang: Lang }) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  if (turns < 1) return null;
  const compacted = turns > MEMORY_COMPACT_AT;
  return (
    <span
      className="mr-auto inline-flex items-center gap-1.5 rounded-full border border-input bg-card px-2.5 py-1 text-[11px] text-muted-foreground"
      title={t(
        "Асистентът помни последните въпроси; по-старите се събират в кратко резюме.",
        "The assistant remembers recent turns; older ones are compacted into a short summary.",
      )}
    >
      <span className="size-1.5 rounded-full bg-primary/70" />
      {t("Контекст", "Context")}: {turns}
      {compacted ? ` · ${t("съкратен", "compacted")}` : ""}
    </span>
  );
};

// One assistant turn. While the answer is still streaming (or it's a plain
// clarify/error with no Envelope) the narration shows in a bubble; once an
// Envelope lands the bubble is folded into the answer panel as its lead line.
const AssistantMessage = ({
  msg,
  lang,
  question,
  streaming,
  busy,
  speech,
  onSetDetail,
}: {
  msg: Msg;
  lang: Lang;
  question: string;
  streaming: boolean;
  busy: boolean;
  speech: ReturnType<typeof useSpeech>;
  onSetDetail: (id: number, detail: "brief" | "full") => void;
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <div data-msg="" className="w-full max-w-[95%] space-y-2 self-start">
      {!msg.env && (msg.text || streaming) && (
        <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm text-foreground">
          {msg.text || "…"}
        </div>
      )}
      {msg.env && (
        <div data-answer-card="" ref={cardRef}>
          <AnswerView
            env={msg.env}
            lang={lang}
            meta={msg.meta}
            narration={msg.text}
            controls={
              <AnswerControls
                msg={msg}
                lang={lang}
                busy={busy}
                speech={speech}
                onSetDetail={onSetDetail}
              />
            }
            actions={
              <AnswerExportMenu
                cardRef={cardRef}
                msg={msg}
                question={question}
                lang={lang}
              />
            }
          />
        </div>
      )}
    </div>
  );
};

export const Chat = ({
  engine,
  lang,
  election,
  actionSlot,
}: {
  engine: ModelEngine;
  lang: Lang;
  election: string;
  actionSlot: HTMLElement | null;
}) => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  // default narration length for new answers (the concise/elaborate toggle)
  const [eloquence, setEloquence] = useState<"brief" | "full">(() => {
    try {
      return localStorage.getItem(ELOQUENCE_KEY) === "full" ? "full" : "brief";
    } catch {
      return "brief";
    }
  });
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ranInitial = useRef(false);
  const firstPersist = useRef(true);
  // whatever was typed before dictation started — the transcript is appended to it
  const voiceBase = useRef("");
  // are we following the foot of the conversation? Set true whenever the user
  // sends/regenerates; cleared if they scroll up to re-read mid-answer.
  const pinned = useRef(true);
  const nextId = () => (idRef.current += 1);

  // Track whether the user is following the foot. A scroll away from the bottom
  // (to re-read a long answer mid-stream) clears the pin; sending/regenerating
  // re-arms it. A ResizeObserver re-pins when the answer's table/chart finishes
  // laying out a frame or two after React commits — belt-and-suspenders on top of
  // the per-message scroll below (RO delivery is tied to paint, so it can't be
  // the only mechanism). Both scroll the scrollport itself to its foot, never
  // endRef into view: endRef sits above the sticky composer, so aligning it to
  // the scrollport bottom would leave the answer tail + follow-ups behind it.
  useEffect(() => {
    const scroller = scrollParent(endRef.current);
    if (!scroller) return;
    const FOLLOW_SLACK = 80; // px from the foot that still counts as "following"
    const onScroll = () => {
      pinned.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
        FOLLOW_SLACK;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const content = scroller.firstElementChild ?? scroller;
    const ro = new ResizeObserver(() => {
      if (pinned.current)
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
    });
    ro.observe(content);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  // Catch the conversation up to the foot whenever it grows (a new turn, each
  // streaming token, the кратко/подробно re-narration). This passive effect runs
  // after the browser has painted the new content, so scrollHeight is already
  // final here — we jump straight to it (instant, not smooth: smooth would
  // perpetually chase the still-growing content as tokens stream). Skipped while
  // the user has scrolled up to re-read; the ResizeObserver above re-pins for any
  // table/chart that finishes laying out a frame later in a real browser.
  useEffect(() => {
    if (!pinned.current) return;
    const scroller = scrollParent(endRef.current);
    if (scroller)
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
  }, [messages, busy]);

  // grow the textarea with its content (capped), and shrink back when cleared.
  // Runs on every input change so programmatic sets (voice, send) resize too.
  // When empty we clear the inline height and let the CSS min-height govern,
  // rather than measure — measuring at mount can race the (JS-injected, in dev)
  // stylesheet and momentarily report a too-tall scrollHeight.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // focus the composer on first load so the user can type straightaway
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const speech = useSpeech(lang);

  const voice = useVoiceInput({
    lang,
    onStart: () => {
      voiceBase.current = input;
    },
    onResult: (text) => {
      setInput(voiceBase.current ? `${voiceBase.current} ${text}` : text);
    },
  });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    speech.stop();
    pinned.current = true; // a fresh question always follows to the foot
    setInput("");
    // the prior answer's tool becomes the context for a follow-on ("а ДПС?");
    // the full prior conversation is distilled so the model can resolve richer
    // references ("show the same for Plovdiv", "compare that to 2024")
    const prev = prevContext(messages, messages.length);
    const history = distill(messages);
    const uId = nextId();
    const aId = nextId();
    setMessages((m) => [
      ...m,
      { id: uId, role: "user", text: q },
      { id: aId, role: "assistant", text: "", env: null },
    ]);
    setBusy(true);
    // stream the narration into the placeholder assistant message; the env
    // (chart/table) is attached when the answer is finalized
    const res = await engine.provider.respond(
      q,
      { lang, election },
      (partial) =>
        setMessages((m) =>
          m.map((x) => (x.id === aId ? { ...x, text: partial } : x)),
        ),
      { prev, detail: eloquence, history },
    );
    setMessages((m) =>
      m.map((x) =>
        x.id === aId
          ? {
              ...x,
              text: res.text,
              env: res.env,
              meta: res.meta,
              tool: res.tool,
              args: res.args,
              detail: eloquence,
            }
          : x,
      ),
    );
    setBusy(false);
    taRef.current?.focus();
  };

  // Re-narrate one existing answer at a different length (the кратко/подробно
  // toggle). Re-runs the same question — with the same follow-on context that
  // produced it — so the tool + figures are unchanged; only the prose differs.
  const setDetail = async (aId: number, detail: "brief" | "full") => {
    if (busy) return;
    const idx = messages.findIndex((m) => m.id === aId);
    if (idx < 1) return;
    const question = messages[idx - 1]?.text;
    if (!question) return;
    const prev = prevContext(messages, idx - 1);
    // distil everything before this answer's own question, so re-narration sees
    // the same conversation context that produced it
    const history = distill(messages.slice(0, idx - 1));
    speech.stop();
    pinned.current = true; // re-narration regrows the answer — follow it down
    setBusy(true);
    const res = await engine.provider.respond(
      question,
      { lang, election },
      (partial) =>
        setMessages((m) =>
          m.map((x) => (x.id === aId ? { ...x, text: partial } : x)),
        ),
      { detail, prev, history },
    );
    setMessages((m) =>
      m.map((x) =>
        x.id === aId
          ? {
              ...x,
              text: res.text,
              env: res.env,
              meta: res.meta,
              tool: res.tool,
              args: res.args,
              detail,
            }
          : x,
      ),
    );
    setBusy(false);
  };

  // Enter sends; Shift+Enter inserts a newline. Ignore Enter mid-IME-composition
  // (Bulgarian/other input methods) so it doesn't fire while picking a candidate.
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  // on load: a ?q=<question> deep-link wins; otherwise restore the saved chat
  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      void send(q);
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const arr = saved ? (JSON.parse(saved) as Msg[]) : [];
      if (Array.isArray(arr) && arr.length) {
        idRef.current = arr.reduce((mx, m) => Math.max(mx, m.id), 0);
        setMessages(arr);
      }
    } catch {
      /* corrupt storage — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist the conversation across reloads (skip the initial empty render so a
  // restore isn't clobbered)
  useEffect(() => {
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* quota — ignore */
    }
  }, [messages]);

  // remember the eloquence preference across reloads
  useEffect(() => {
    try {
      localStorage.setItem(ELOQUENCE_KEY, eloquence);
    } catch {
      /* quota — ignore */
    }
  }, [eloquence]);

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

  // Permalink that re-asks the last question on load (?q=…). Prefers the native
  // share sheet on mobile, falling back to copying the link.
  const permalink = () =>
    `${window.location.origin}${window.location.pathname}?q=${encodeURIComponent(lastUserText ?? "")}`;

  const share = async () => {
    if (!lastUserText) return;
    const url = permalink();
    const nav = navigator as Navigator & {
      share?: (d: {
        title?: string;
        text?: string;
        url?: string;
      }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ title: "Наясно", text: lastUserText, url });
        return;
      } catch {
        /* user dismissed or unsupported — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  // Open the Facebook share dialog for the permalink (Наясно is FB-first).
  const shareFacebook = () => {
    if (!lastUserText) return;
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(permalink())}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const last = messages[messages.length - 1];
  const followups =
    !busy && last?.role === "assistant" && last.env ? followUps(last.env) : [];

  const suggestions = busy ? [] : matchSuggestions(input, lang);
  const hasChat = messages.length > 0;
  // how many prior exchanges the assistant is carrying as context (for the pill)
  const memoryTurns = useMemo(() => distill(messages).length, [messages]);
  // a non-rules provider that has finished loading is the only case where the
  // eloquence preference changes the output — the offline rules engine emits a
  // fixed template, so hide the toggle for it.
  const canNarrate =
    engine.providerId !== "rules" && engine.load.phase === "ready";

  // Stable key of every question the user has already asked. Recomputed each
  // render but yields the same string while the conversation's questions don't
  // change — so the starters memo below only reshuffles when a new prompt is
  // actually sent, not on every keystroke or streaming token.
  const askedKey = useMemo(
    () =>
      [
        ...new Set(
          messages
            .filter((m) => m.role === "user")
            .map((m) => normPrompt(m.text)),
        ),
      ]
        .sort()
        .join("|"),
    [messages],
  );

  // Randomized starter chips with already-asked prompts dropped, so a just-used
  // suggestion doesn't reappear. Fresh (unasked) prompts come first; if every
  // prompt has been asked we top up with the asked ones rather than show none.
  const starters = useMemo(() => {
    const asked = new Set(askedKey ? askedKey.split("|") : []);
    const isAsked = (s: { bg: string; en: string }) =>
      asked.has(normPrompt(s.bg)) || asked.has(normPrompt(s.en));
    const fresh = shuffle(STARTERS.filter((s) => !isAsked(s)));
    const stale = shuffle(STARTERS.filter(isAsked));
    return [...fresh, ...stale].slice(0, STARTER_COUNT);
  }, [askedKey]);

  return (
    <div className="flex flex-col gap-4">
      {/* Conversation actions live in the fixed header (portaled into actionSlot)
          so they stay reachable however far the messages scroll — they used to
          sit atop the scroll area and scrolled out of reach in a long chat.
          New chat stays a standalone control; the share/export family collapses
          into one labelled dropdown to keep the header compact. */}
      {actionSlot &&
        hasChat &&
        createPortal(
          <>
            <MemoryPill turns={memoryTurns} lang={lang} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessages([])}
              title={t("Нов разговор", "New chat")}
            >
              <Plus />
              <span className="hidden sm:inline">
                {t("Нов разговор", "New chat")}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  title={t(
                    "Сподели или изтегли разговора",
                    "Share or export the chat",
                  )}
                >
                  {copied || shared ? <Check /> : <Share2 />}
                  <span className="hidden sm:inline">
                    {copied
                      ? t("Копирано", "Copied")
                      : shared
                        ? t("Връзката е копирана", "Link copied")
                        : t("Сподели", "Share")}
                  </span>
                  <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copyAll()}>
                  <Copy /> {t("Копирай текста", "Copy text")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void share()}>
                  <Share2 /> {t("Сподели връзка", "Share link")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={shareFacebook}>
                  <Facebook /> Facebook
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => downloadMarkdown(messages, lang)}
                >
                  <FileText /> Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void downloadPdf(messages, lang)}
                >
                  <Download /> PDF (.pdf)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>,
          actionSlot,
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
            <AssistantMessage
              key={m.id}
              msg={m}
              lang={lang}
              question={messages[i - 1]?.text ?? ""}
              streaming={busy && i === messages.length - 1}
              busy={busy}
              speech={speech}
              onSetDetail={setDetail}
            />
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
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-2 bg-card/85 px-2 pb-3 pt-2 backdrop-blur sm:-mx-4 sm:px-4">
        {suggestions.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-lg border border-input bg-popover text-sm shadow-md">
            {suggestions.map((s) => (
              <button
                key={s.en}
                // onMouseDown (not onClick) fires before the input blur so the
                // suggestion list doesn't close first
                onMouseDown={(e) => {
                  e.preventDefault();
                  void send(s[lang]);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
              >
                {s[lang]}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="flex items-end gap-1.5 rounded-2xl border border-input bg-background px-2 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <textarea
              ref={taRef}
              rows={1}
              className="max-h-40 min-h-[2.25rem] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none"
              placeholder={t(
                "Попитайте за изборите…",
                "Ask about the elections…",
              )}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
            />
            {voice.supported && (
              <button
                type="button"
                onClick={voice.toggle}
                aria-label={
                  voice.listening
                    ? t("Спри диктовката", "Stop dictation")
                    : t("Гласово въвеждане", "Voice input")
                }
                title={
                  voice.listening
                    ? t("Спри диктовката", "Stop dictation")
                    : t("Гласово въвеждане", "Voice input")
                }
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                  voice.listening
                    ? "animate-pulse border-destructive bg-destructive/10 text-destructive"
                    : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {voice.listening ? (
                  <Square className="size-3.5 fill-current" />
                ) : (
                  <Mic className="size-4" />
                )}
              </button>
            )}
            <button
              type="submit"
              aria-label={t("Изпрати", "Send")}
              title={t("Изпрати", "Send")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              disabled={busy || !input.trim()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </form>
        {/* Composer toolbar: the response-length toggle + model picker sit on
            their own row directly under the input; the model picker stays at
            the right edge (under the send button) via ml-auto so it holds that
            position whether or not the toggle is shown. */}
        <div className="mt-2 flex items-center gap-2">
          {canNarrate && (
            <EloquenceToggle
              value={eloquence}
              onChange={setEloquence}
              lang={lang}
              disabled={busy}
            />
          )}
          <div className="ml-auto">
            <ModelPicker engine={engine} lang={lang} />
          </div>
        </div>
        {/* sample prompts live under the composer so they persist after the
            first question (don't vanish like an empty-state) — on the row
            below the toolbar, label-free */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {starters.map((s) => (
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
