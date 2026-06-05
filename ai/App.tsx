import { useContext, useMemo, useState } from "react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  return (
    <div className="flex min-h-screen flex-col bg-card text-foreground">
      <header className="sticky top-0 z-10 flex w-full flex-wrap items-center justify-between gap-2 border-b-2 bg-muted px-2 py-2.5 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <a
            href="https://electionsbg.com"
            className="flex shrink-0 items-center gap-2 text-xl text-primary"
            aria-label="electionsbg.com"
          >
            <Logo className="size-7" />
            <span className="font-title">
              <span className="text-popover-foreground">Наясно</span>
              <span className="pl-1 font-semibold uppercase text-primary">
                AI
              </span>
            </span>
          </a>
          <div aria-hidden className="hidden h-6 w-px bg-border/70 sm:block" />
          <Select value={providerId} onValueChange={selectProvider}>
            <SelectTrigger
              className="h-8 w-[11rem] rounded-full text-xs text-muted-foreground sm:w-[15rem]"
              title={t("Модел", "Model")}
              aria-label={t("Модел", "Model")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rules">
                {t("Правила (офлайн)", "Rules (offline)")}
              </SelectItem>
              {MODELS.map((m) => (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  disabled={!m.ready || !HAS_WEBGPU}
                >
                  {m.label[lang]}
                  {!m.ready
                    ? ` — ${m.sizeNote[lang]}`
                    : ` (${m.sizeNote[lang]})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <Select value={election} onValueChange={setElection}>
            <SelectTrigger
              className="h-9 w-auto gap-1 text-sm"
              title={t("Контекст: избор", "Election context")}
              aria-label={t("Контекст: избор", "Election context")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ELECTIONS.map((name) => (
                <SelectItem key={name} value={name}>
                  {electionFullLabel(name, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLang(lang === "bg" ? "en" : "bg")}
            aria-label={t("Език", "Language")}
          >
            {lang === "bg" ? "EN" : "BG"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setTheme(isDark ? themeLight : themeDark)}
            aria-label={t("Тема", "Theme")}
          >
            {isDark ? "☀" : "☾"}
          </Button>
        </div>
      </header>

      {load.phase === "loading" && (
        <div className="w-full bg-muted px-4 pb-2 text-xs text-muted-foreground">
          <div className="container mx-auto">
            <div className="mb-1 h-1 w-full overflow-hidden rounded bg-background">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${load.pct}%` }}
              />
            </div>
            {t("Зареждане на модела", "Loading model")} {load.pct}% ·{" "}
            {load.note}
          </div>
        </div>
      )}
      {load.phase === "unsupported" && (
        <div className="w-full bg-muted px-4 pb-2 text-xs text-destructive">
          <div className="container mx-auto">
            {t(
              "Този браузър няма WebGPU — локалните модели не са налични. Използвайте Chrome/Edge на компютър. Чатът работи с правила.",
              "This browser has no WebGPU — on-device models aren't available. Use desktop Chrome/Edge. The chat works on rules.",
            )}
          </div>
        </div>
      )}
      {load.phase === "error" && (
        <div className="w-full bg-muted px-4 pb-2 text-xs text-destructive">
          <div className="container mx-auto">
            {t("Грешка при зареждане: ", "Load error: ")}
            {load.note}
          </div>
        </div>
      )}

      <main className="flex-1">
        <div className="container mx-auto px-2 py-6 sm:px-4">
          <div className="mb-4 flex items-center gap-2">
            <Button
              variant={view === "chat" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("chat")}
            >
              {t("Чат", "Chat")}
            </Button>
            <Button
              variant={view === "tools" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("tools")}
            >
              {t("Инструменти", "Tools")}
            </Button>
          </div>

          {view === "chat" ? (
            <Chat provider={provider} lang={lang} election={election} />
          ) : (
            <Explorer lang={lang} />
          )}
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 bg-muted p-4 text-sm">
        <div className="hidden font-medium lowercase text-secondary-foreground sm:block">
          {`© ${new Date().getFullYear()}. ${t("всички права запазени", "all rights reserved")}.`}
        </div>
        <ul className="flex flex-wrap items-center gap-1">
          {[
            ["https://electionsbg.com", "electionsbg.com"],
            ["https://electionsbg.com/about", t("за нас", "about")],
            [
              "https://github.com/atanasster/electionsbg",
              t("отворен код", "open source"),
            ],
          ].map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                className="mx-2 font-medium lowercase text-secondary-foreground hover:text-primary"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
};
