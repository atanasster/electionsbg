import { useContext, useState } from "react";
import { Info } from "lucide-react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { Chat } from "./app/Chat";
import { Explorer } from "./app/Explorer";
import { useModelEngine } from "./llm/useModelEngine";
import { latestElection } from "./tools/dataset";
import type { Lang } from "./tools/types";

export const App = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const [lang, setLang] = useState<Lang>("bg");
  // The default election for questions that don't name one. No longer a user
  // control: a question names its own year (and a multi-election year fans out
  // into a comparison); anything unqualified means the latest election.
  const election = latestElection();
  const [view, setView] = useState<"chat" | "tools">("chat");
  // Slot in the fixed header where Chat portals its conversation actions (new
  // chat, share, export). Kept here so they stay reachable however far the
  // messages scroll — they used to live atop the scroll area and scrolled away.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const isDark = theme === themeDark;

  // The on-device model lifecycle (which provider answers, download/load
  // progress, what's cached, storage) lives in this hook so the composer's
  // ModelPicker and the chat share one source of truth.
  const engine = useModelEngine();

  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  return (
    // Fixed app shell: header + footer stay put, only <main> scrolls. Using an
    // inner scroll container (not the body) so opening a Radix Select — which
    // scroll-locks the body via react-remove-scroll — can't break a sticky header
    // or shove the dropdown off-screen. Also the correct mobile layout (h-dvh
    // handles the dynamic browser chrome).
    <div className="flex h-dvh flex-col overflow-hidden bg-card text-foreground">
      <header className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2 border-b-2 bg-muted px-2 py-2.5 shadow-sm sm:px-4">
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
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          {/* Chat fills this with the conversation actions (new chat, share,
              export) via a portal; empty:hidden drops the stray flex gap when
              there's no chat or we're in the tools view. */}
          <div
            ref={setActionSlot}
            className="flex items-center gap-2 empty:hidden"
          />
          <Button
            variant={view === "tools" ? "default" : "ghost"}
            size="icon"
            onClick={() => setView(view === "tools" ? "chat" : "tools")}
            aria-label={t("Инструменти и данни", "Tools & data")}
            aria-pressed={view === "tools"}
            title={t(
              "Инструменти и данни — какво може да отговори асистентът",
              "Tools & data — what the assistant can answer",
            )}
          >
            <Info />
          </Button>
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

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto flex min-h-full flex-col px-2 py-6 sm:px-4">
          {view === "chat" ? (
            <Chat
              engine={engine}
              lang={lang}
              election={election}
              actionSlot={actionSlot}
            />
          ) : (
            <Explorer lang={lang} onClose={() => setView("chat")} />
          )}
        </div>
      </main>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-muted p-4 text-sm">
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
