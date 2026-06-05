import { useContext, useMemo, useState } from "react";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { Chat } from "./app/Chat";
import { Explorer } from "./app/Explorer";
import { HeuristicProvider, type LLMProvider } from "./llm/provider";
import { MODELS, modelById } from "./llm/models";
import { WebLLMProvider, webgpuSupported } from "./llm/webllm";
import { electionNames, latestElection } from "./tools/dataset";
import { electionFullLabel } from "./tools/format";
import type { Lang } from "./tools/types";

const ELECTIONS = electionNames();
const HAS_WEBGPU = webgpuSupported();

type LoadState = {
  phase: "idle" | "loading" | "ready" | "error" | "unsupported";
  pct: number;
  note: string;
};

export const App = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const [lang, setLang] = useState<Lang>("bg");
  const [election, setElection] = useState<string>(latestElection());
  const [view, setView] = useState<"chat" | "tools">("chat");
  const isDark = theme === themeDark;

  const heuristic = useMemo(() => new HeuristicProvider(), []);
  const [provider, setProvider] = useState<LLMProvider>(heuristic);
  const [providerId, setProviderId] = useState("rules");
  const [load, setLoad] = useState<LoadState>({
    phase: "idle",
    pct: 0,
    note: "",
  });

  const selectProvider = async (id: string) => {
    setProviderId(id);
    if (id === "rules") {
      setProvider(heuristic);
      setLoad({ phase: "idle", pct: 0, note: "" });
      return;
    }
    const model = modelById(id);
    if (!model) return;
    if (!HAS_WEBGPU) {
      setLoad({ phase: "unsupported", pct: 0, note: "" });
      return;
    }
    const p = new WebLLMProvider(model);
    setProvider(p); // usable immediately (falls back to rules while weights load)
    setLoad({ phase: "loading", pct: 0, note: "" });
    try {
      await p.init((pct, note) => setLoad({ phase: "loading", pct, note }));
      setLoad({ phase: "ready", pct: 100, note: "" });
    } catch (e) {
      setLoad({
        phase: "error",
        pct: 0,
        note: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold">
              Наясно AI
            </span>
            <select
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              value={providerId}
              onChange={(e) => selectProvider(e.target.value)}
              title={lang === "bg" ? "Модел" : "Model"}
            >
              <option value="rules">
                {lang === "bg" ? "Правила (офлайн)" : "Rules (offline)"}
              </option>
              {MODELS.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  disabled={!m.ready || !HAS_WEBGPU}
                >
                  {m.label[lang]}
                  {!m.ready
                    ? ` — ${m.sizeNote[lang]}`
                    : ` (${m.sizeNote[lang]})`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={election}
              onChange={(e) => setElection(e.target.value)}
              title={lang === "bg" ? "Контекст: избор" : "Election context"}
            >
              {ELECTIONS.map((name) => (
                <option key={name} value={name}>
                  {electionFullLabel(name, lang)}
                </option>
              ))}
            </select>
            <button
              className="rounded-md border border-input px-2.5 py-1.5"
              onClick={() => setLang(lang === "bg" ? "en" : "bg")}
            >
              {lang === "bg" ? "EN" : "BG"}
            </button>
            <button
              className="rounded-md border border-input px-2.5 py-1.5"
              onClick={() => setTheme(isDark ? themeLight : themeDark)}
            >
              {isDark ? "☀" : "☾"}
            </button>
          </div>
        </div>
        {load.phase === "loading" && (
          <div className="mx-auto max-w-4xl px-4 pb-2 text-xs text-muted-foreground">
            <div className="mb-1 h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${load.pct}%` }}
              />
            </div>
            {lang === "bg" ? "Зареждане на модела" : "Loading model"} {load.pct}
            % · {load.note}
          </div>
        )}
        {load.phase === "unsupported" && (
          <div className="mx-auto max-w-4xl px-4 pb-2 text-xs text-destructive">
            {lang === "bg"
              ? "Този браузър няма WebGPU — локалните модели не са налични. Използвайте Chrome/Edge на компютър. Чатът работи с правила."
              : "This browser has no WebGPU — on-device models aren't available. Use desktop Chrome/Edge. The chat works on rules."}
          </div>
        )}
        {load.phase === "error" && (
          <div className="mx-auto max-w-4xl px-4 pb-2 text-xs text-destructive">
            {lang === "bg" ? "Грешка при зареждане: " : "Load error: "}
            {load.note}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <button
            className={`rounded-md px-3 py-1.5 ${view === "chat" ? "bg-primary text-primary-foreground" : "border border-input"}`}
            onClick={() => setView("chat")}
          >
            {lang === "bg" ? "Чат" : "Chat"}
          </button>
          <button
            className={`rounded-md px-3 py-1.5 ${view === "tools" ? "bg-primary text-primary-foreground" : "border border-input"}`}
            onClick={() => setView("tools")}
          >
            {lang === "bg" ? "Инструменти" : "Tools"}
          </button>
        </div>

        {view === "chat" ? (
          <Chat provider={provider} lang={lang} election={election} />
        ) : (
          <Explorer lang={lang} />
        )}
      </main>
    </div>
  );
};
