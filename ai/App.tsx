import { navigateView } from "./app/explorer/urlState";
import { useChatNavigation } from "./app/navigation";
import { chatPath } from "./app/navigationPaths";
import { useContext, useState } from "react";
import { Database, Info, Target, Wrench } from "lucide-react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { Chat } from "./app/Chat";
import type { ToolIntent } from "./app/explorer/workspace";
import { Explorer } from "./app/Explorer";
import { useModelEngine } from "./llm/useModelEngine";
import { latestElection } from "./tools/dataset";
import { GROUP_URL } from "./app/community";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

export const App = ({
  integrated = false,
}: {
  initialView?: "chat" | "tools";
  integrated?: boolean;
} = {}) => {
  const { theme, setTheme } = useContext(ThemeContext);
  const navigation = useChatNavigation();
  const lang = navigation.lang;
  // The default election for questions that don't name one. No longer a user
  // control: a question names its own year (and a multi-election year fans out
  // into a comparison); anything unqualified means the latest election.
  const election = latestElection();
  const [handoff, setHandoff] = useState<ToolIntent | null>(null);
  const view = /\/tools\/?$/.test(navigation.pathname) ? "tools" : "chat";
  // The standalone header hosts conversation actions; integrated sharing and
  // memory use a conversation-local slot below the site-owned toolbar.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const isDark = theme === themeDark;

  // The on-device model lifecycle (which provider answers, download/load
  // progress, what's cached, storage) lives in this hook so the composer's
  // ModelPicker and the chat share one source of truth.
  const engine = useModelEngine();

  // The Tools & data reference is also a standalone, shareable, indexable page
  // at /tools (mirrors /evals). Keep the URL in sync as the user toggles, and
  // reflect browser back/forward, so deep-links stay coherent. /tools mounts
  // this component with initialView="tools" (see main.tsx); prod serves a
  // per-page <head> from tools.html.
  const navigate = (next: "chat" | "tools") => {
    navigateView(view, next, navigation);
  };

  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  return (
    // Fixed app shell: header + footer stay put, only <main> scrolls. Using an
    // inner scroll container (not the body) so opening a Radix Select — which
    // scroll-locks the body via react-remove-scroll — can't break a sticky header
    // or shove the dropdown off-screen. Also the correct mobile layout (h-dvh
    // handles the dynamic browser chrome).
    <div
      className={`flex ${integrated ? "h-[calc(100dvh-var(--header-height,70px)-48px)]" : "h-dvh"} flex-col overflow-hidden bg-card text-foreground`}
    >
      {!integrated && (
        <header className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2 border-b-2 bg-muted px-2 py-2.5 shadow-sm sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <a
              href={chatPath("chat", navigation.pathname)}
              onClick={(e) => {
                e.preventDefault();
                navigate("chat");
              }}
              className="flex shrink-0 items-center gap-2 text-xl text-primary"
              aria-label="Наясно AI"
            >
              <Logo className="size-7" />
              {/* Wordmark drops below sm so the toolbar (with the chat's New
                chat + Share actions) stays on one row on a phone; the logo
                icon carries the brand there. */}
              <span className="hidden font-title sm:inline">
                <span className="text-popover-foreground">Наясно</span>
                <span className="pl-1 font-semibold uppercase text-primary">
                  AI
                </span>
              </span>
            </a>
          </div>
          <nav
            aria-label={t("Основна навигация", "Main navigation")}
            className="flex items-center gap-1"
          >
            <Button
              variant={view === "chat" ? "secondary" : "ghost"}
              aria-current={view === "chat" ? "page" : undefined}
              onClick={() => navigate("chat")}
            >
              {t("Чат", "Chat")}
            </Button>
            <Button
              variant={view === "tools" ? "secondary" : "ghost"}
              aria-current={view === "tools" ? "page" : undefined}
              onClick={() => navigate("tools")}
            >
              {t("Инструменти", "Tools")}
            </Button>
          </nav>
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            {/* Chat fills this with the conversation actions (new chat, share,
              export) via a portal; empty:hidden drops the stray flex gap when
              there's no chat or we're in the tools view. */}
            <div
              ref={setActionSlot}
              className="flex items-center gap-2 empty:hidden"
            />
            {/* "About the assistant" menu: one entry point to the meta pages —
              the Tools & data reference (/tools, an in-app view) and the model
              Accuracy benchmark (/evals, a standalone page). Replaces the old
              chat↔tools toggle here and the "models" footer link. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={view === "tools" ? "default" : "ghost"}
                  size="icon"
                  aria-label={t("За асистента", "About the assistant")}
                  title={t(
                    "За асистента — инструменти, данни и точност",
                    "About the assistant — tools, data and accuracy",
                  )}
                >
                  <Info />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  {t("За асистента", "About the assistant")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("tools")}>
                  <Wrench />
                  {t("Инструменти", "Tools")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={chatPath("evals", navigation.pathname)}>
                    <Target />
                    {t("Точност на моделите", "Models accuracy")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={
                      integrated
                        ? `${lang === "en" ? "/en" : ""}/data/sources`
                        : `${SITE_ORIGIN}/data/sources`
                    }
                  >
                    <Database />
                    {t("Данни", "Data")}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              // h-9 to match the icon buttons either side so the toolbar reads
              // as one even-height row.
              className="h-9"
              onClick={() => {
                const next = lang === "bg" ? "en" : "bg";
                const url = new URL(window.location.href);
                url.searchParams.set("lang", next);
                if (integrated) {
                  url.pathname =
                    next === "en"
                      ? `/en${url.pathname.replace(/^\/en/, "")}`
                      : url.pathname.replace(/^\/en/, "");
                  url.searchParams.delete("lang");
                  window.location.assign(url);
                } else navigation.navigate(url.pathname + url.search);
              }}
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
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto flex min-h-full flex-col px-2 py-6 sm:px-4">
          {integrated && (
            <div
              ref={setActionSlot}
              className="mb-3 flex items-center justify-end gap-2 empty:hidden"
            />
          )}
          {view === "chat" ? (
            <Chat
              engine={engine}
              lang={lang}
              election={election}
              actionSlot={actionSlot}
              showNewChatAction={!integrated}
              initialIntent={handoff}
              onIntentConsumed={() => setHandoff(null)}
            />
          ) : null}
          <div hidden={view !== "tools"}>
            <Explorer
              lang={lang}
              onOpenChat={(intent) => {
                setHandoff(intent);
                navigate("chat");
              }}
            />
          </div>
        </div>
      </main>

      {!integrated && (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-muted p-4 text-sm">
          <div className="hidden font-medium lowercase text-secondary-foreground sm:block">
            {`© ${new Date().getFullYear()}. ${t("всички права запазени", "all rights reserved")}.`}
          </div>
          <ul className="flex flex-wrap items-center gap-1">
            {[
              [
                integrated ? (lang === "en" ? "/en" : "/") : SITE_ORIGIN,
                t("Начало", "Home"),
              ],
              [
                integrated
                  ? `${lang === "en" ? "/en" : ""}/about`
                  : `${SITE_ORIGIN}/about`,
                t("за нас", "about"),
              ],
              [
                "https://github.com/atanasster/electionsbg",
                t("отворен код", "open source"),
              ],
              [GROUP_URL, t("общност", "community")],
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
      )}
    </div>
  );
};
