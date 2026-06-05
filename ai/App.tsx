import { useContext, useMemo, useState } from "react";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { Chat } from "./app/Chat";
import { Explorer } from "./app/Explorer";
import { HeuristicProvider } from "./llm/provider";
import { electionNames, latestElection } from "./tools/dataset";
import { electionFullLabel } from "./tools/format";
import type { Lang } from "./tools/types";

const ELECTIONS = electionNames();

export const App = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const [lang, setLang] = useState<Lang>("bg");
  const [election, setElection] = useState<string>(latestElection());
  const [view, setView] = useState<"chat" | "tools">("chat");
  const provider = useMemo(() => new HeuristicProvider(), []);
  const isDark = theme === themeDark;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold">
              Наясно AI
            </span>
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              title={
                lang === "bg"
                  ? "Локален модел (BgGPT/EuroLLM) предстои — засега детерминистични правила."
                  : "On-device model (BgGPT/EuroLLM) coming — deterministic rules for now."
              }
            >
              {provider.label[lang]}
            </span>
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
