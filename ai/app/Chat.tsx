// The chat surface. Provider-agnostic: it calls provider.respond() and renders
// the returned narration + Envelope. Swapping HeuristicProvider for a WebLLM
// provider requires no change here.

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
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
import { runToolChoice } from "../llm/provider";
import { CLOUD_BUDGET, countExchanges, distill } from "../orchestrator/memory";
import { AnswerView } from "../render/AnswerView";
import type {
  ClarifyOption,
  ClarifyRequest,
  Lang,
  ToolArgs,
} from "../tools/types";
import { ClarifyDialog } from "./ClarifyDialog";
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
import { EmptyHero } from "./hero/EmptyHero";
import { ModelPicker } from "./ModelPicker";
import { STARTERS } from "./starters";
import { matchSuggestions } from "./suggestions";
import { useSpeech } from "./useSpeech";
import { useVoiceInput } from "./voice";

type Msg = ChatMsg & { id: number };

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

// Shell-style recall of past prompts (Up/Down in the composer). Kept separate
// from the conversation so it survives "New chat", deduped against the newest
// entry, and capped to the most recent few dozen.
const PROMPT_HISTORY_KEY = "naiasno.chat.history.v1";
const PROMPT_HISTORY_MAX = 50;

// How many starter chips to show under the composer.
const STARTER_COUNT = 5;

// Shared suggestion-chip styling (starters + follow-ups). A comfortable ~40px
// tap target on a phone (min-h), compacting to a denser pill from sm up where a
// pointer is likelier and vertical room is scarcer.
const CHIP =
  "inline-flex min-h-[40px] items-center rounded-full border border-input bg-card px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px]";

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

// A small control rendered under the answer prose: read-aloud (TTS).
// `data-export-omit` keeps the button out of the PNG/PDF capture.
const AnswerControls = ({
  msg,
  lang,
  speech,
}: {
  msg: Msg;
  lang: Lang;
  speech: ReturnType<typeof useSpeech>;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const id = String(msg.id);
  const speaking = speech.speakingId === id;
  const canSpeak = speech.supported && !!msg.text;
  if (!canSpeak) return null;
  const btn =
    "inline-flex items-center gap-1 rounded-full border border-input px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";
  return (
    <div data-export-omit="">
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
    </div>
  );
};

// A subtle indicator that the assistant remembers the conversation: how many
// prior exchanges are in context, and whether older ones have been compacted
// into a summary. Shown once a thread exists so a user understands a follow-up
// ("compare that to 2024") will be read in context. `mr-auto` pushes it to the
// left of the toolbar's action buttons.
// Past the recent-window cap the older turns are folded into the summary digest.
const MEMORY_COMPACT_AT = CLOUD_BUDGET.recentTurns;
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
      {/* On a phone the word + "compacted" suffix are dropped to just the dot +
          count, so this chip can't push the toolbar onto a second row when a
          cloud model is active. */}
      <span className="hidden sm:inline">{t("Памет", "Memory")}: </span>
      {turns}
      {compacted ? (
        <span className="hidden sm:inline">{` · ${t("обобщена", "compacted")}`}</span>
      ) : (
        ""
      )}
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
  speech,
  onClarify,
}: {
  msg: Msg;
  lang: Lang;
  question: string;
  streaming: boolean;
  speech: ReturnType<typeof useSpeech>;
  onClarify: (req: ClarifyRequest) => void;
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
            onClarify={onClarify}
            controls={<AnswerControls msg={msg} lang={lang} speech={speech} />}
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
  // Past prompts the user submitted, newest first, for Up/Down recall.
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  // Position within promptHistory while browsing: -1 = live draft (not
  // browsing), 0 = newest. histDraft holds what was typed before browsing began
  // so Down past the newest restores it.
  const histIdx = useRef(-1);
  const histDraft = useRef("");
  const firstHistPersist = useRef(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  // the active disambiguation chooser (a tool needs the user to pick which
  // same-name entity they meant), shown as a modal; null when none is pending.
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null);
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
    // record the prompt for Up/Down recall (skip a consecutive duplicate) and
    // reset the browse cursor back to the live draft.
    setPromptHistory((h) =>
      h[0] === q ? h : [q, ...h].slice(0, PROMPT_HISTORY_MAX),
    );
    histIdx.current = -1;
    histDraft.current = "";
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
      { prev, history },
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
              lang,
            }
          : x,
      ),
    );
    setBusy(false);
    // the tool couldn't resolve to one entity — pop the chooser modal
    if (res.env?.clarify) setClarify(res.env.clarify);
    taRef.current?.focus();
  };

  // The user picked one option from a disambiguation chooser: re-run the tool
  // with the pinned id (no routing — the entity is now unambiguous). Mirrors
  // `send`, but goes straight to the provider's runChoice (falls back to a
  // template-narrated run for any provider that doesn't implement it). A pick can
  // itself need another choice (e.g. comparing two same-name places), so a fresh
  // `clarify` env re-opens the modal.
  const choose = async (opt: ClarifyOption) => {
    setClarify(null);
    if (busy) return;
    speech.stop();
    pinned.current = true;
    const aId = nextId();
    setMessages((m) => [
      ...m,
      { id: nextId(), role: "user", text: opt.label },
      { id: aId, role: "assistant", text: "", env: null },
    ]);
    setBusy(true);
    const provider = engine.provider;
    const onDelta = (partial: string) =>
      setMessages((m) =>
        m.map((x) => (x.id === aId ? { ...x, text: partial } : x)),
      );
    const res = provider.runChoice
      ? await provider.runChoice(
          opt.tool,
          opt.args,
          { lang, election },
          onDelta,
        )
      : await runToolChoice(
          { bg: "Без AI (офлайн)", en: "Basic (offline)" },
          opt.tool,
          opt.args,
          { lang, election },
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
              lang,
            }
          : x,
      ),
    );
    setBusy(false);
    if (res.env?.clarify) setClarify(res.env.clarify);
    taRef.current?.focus();
  };

  // Drop the caret at the very end after a programmatic value change (one frame
  // later, once React has committed the new value to the DOM).
  const caretToEnd = () => {
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  // Recall promptHistory[idx] into the composer and remember where we are.
  const recallPrompt = (idx: number) => {
    histIdx.current = idx;
    setInput(promptHistory[idx]);
    caretToEnd();
  };

  // Enter sends; Shift+Enter inserts a newline. Ignore Enter mid-IME-composition
  // (Bulgarian/other input methods) so it doesn't fire while picking a candidate.
  // Up/Down walk the prompt history (shell-style), but only at the text edges so
  // they still move the caret within a multi-line draft: Up recalls an older
  // prompt when the caret is on the first line, Down a newer one (eventually the
  // saved draft) when it's on the last line.
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
      return;
    }
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (e.key === "ArrowUp") {
      const atFirstLine =
        el.value.slice(0, el.selectionStart).indexOf("\n") === -1;
      if (!atFirstLine) return;
      const next = histIdx.current + 1;
      if (next >= promptHistory.length) return; // already at the oldest
      if (histIdx.current === -1) histDraft.current = input; // stash the draft
      e.preventDefault();
      recallPrompt(next);
    } else if (e.key === "ArrowDown") {
      if (histIdx.current === -1) return; // not browsing — let the caret move
      const atLastLine = el.value.slice(el.selectionEnd).indexOf("\n") === -1;
      if (!atLastLine) return;
      e.preventDefault();
      const next = histIdx.current - 1;
      if (next < 0) {
        histIdx.current = -1; // back to the live draft
        setInput(histDraft.current);
        caretToEnd();
      } else {
        recallPrompt(next);
      }
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

  // restore the prompt-recall history once on load
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PROMPT_HISTORY_KEY);
      const arr = saved ? (JSON.parse(saved) as unknown) : [];
      if (Array.isArray(arr) && arr.length)
        setPromptHistory(arr.filter((s): s is string => typeof s === "string"));
    } catch {
      /* corrupt storage — ignore */
    }
  }, []);

  // persist the prompt-recall history (skip the first render so the restore
  // above isn't clobbered before it lands)
  useEffect(() => {
    if (firstHistPersist.current) {
      firstHistPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(promptHistory));
    } catch {
      /* quota — ignore */
    }
  }, [promptHistory]);

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
    !busy && last?.role === "assistant" && last.env && !last.env.clarify
      ? followUps(last.env)
      : [];

  const suggestions = busy ? [] : matchSuggestions(input, lang);
  const hasChat = messages.length > 0;
  // how many prior exchanges the assistant is carrying as context (for the pill)
  const memoryTurns = useMemo(() => countExchanges(messages), [messages]);
  // a non-rules provider that has finished loading is the only case where the
  // assistant carries conversational context — the offline rules engine routes
  // on keywords alone, so the memory pill is meaningful only for a live model.
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
    <div className="flex flex-1 flex-col gap-4">
      <ClarifyDialog
        request={clarify}
        lang={lang}
        onPick={choose}
        onClose={() => setClarify(null)}
      />
      {/* Conversation actions live in the fixed header (portaled into actionSlot)
          so they stay reachable however far the messages scroll — they used to
          sit atop the scroll area and scrolled out of reach in a long chat.
          New chat stays a standalone control; the share/export family collapses
          into one labelled dropdown to keep the header compact. */}
      {actionSlot &&
        hasChat &&
        createPortal(
          <>
            {canNarrate && <MemoryPill turns={memoryTurns} lang={lang} />}
            <Button
              variant="outline"
              size="sm"
              // h-9 to match the App header's icon buttons (Info/EN/theme) so
              // the portaled chat actions line up as one even-height toolbar.
              className="h-9"
              onClick={() => setMessages([])}
              title={t("Нов чат", "New chat")}
            >
              <Plus />
              <span className="hidden sm:inline">
                {t("Нов чат", "New chat")}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
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

      {!hasChat && <EmptyHero lang={lang} onPick={send} />}

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
              speech={speech}
              onClarify={setClarify}
            />
          ),
        )}
        {followups.length > 0 && (
          // Same treatment as the starters: a single horizontally scrollable
          // row on a phone (so several follow-ups can't stack into many rows),
          // wrapping normally from sm up. Label-free at every width.
          <div
            className={cn(
              "flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible sm:pb-0",
              "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
          >
            {followups.map((s) => (
              <button
                key={s.en}
                onClick={() => send(s[lang])}
                className={cn(CHIP, "shrink-0 whitespace-nowrap")}
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
                className="block w-full px-3 py-2.5 text-left hover:bg-muted sm:py-1.5"
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
              onChange={(e) => {
                // typing leaves history-browsing; the edit becomes the new draft
                histIdx.current = -1;
                setInput(e.target.value);
              }}
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
        {/* Composer toolbar: the model picker sits on its own row directly
            under the input, held at the right edge (under the send button)
            via ml-auto. */}
        <div className="mt-2 flex items-center gap-2">
          <div className="ml-auto">
            <ModelPicker engine={engine} lang={lang} />
          </div>
        </div>
        {/* Sample prompts under the composer — only once a chat has begun. In
            the empty state the hero's mini answer-cards already serve as
            starters, so a second chip row there is redundant. On the row below
            the toolbar, label-free. On a phone they're a single horizontally
            scrollable row (so 5 long prompts can't balloon into 5 stacked rows
            and eat the screen); they wrap normally from sm up. Hidden on a phone
            once an answer offers follow-ups, since those carry the next steps
            there and two chip zones around the composer is clutter. */}
        {hasChat && (
          <div
            className={cn(
              "mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible sm:pb-0",
              "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              followups.length > 0 && "hidden sm:flex",
            )}
          >
            {starters.map((s) => (
              <button
                key={s.en}
                onClick={() => send(s[lang])}
                disabled={busy}
                className={cn(CHIP, "shrink-0 whitespace-nowrap")}
              >
                {s[lang]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
