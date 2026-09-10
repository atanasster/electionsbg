import { useChatNavigation } from "./navigation";
import { ChatPolicy } from "./ChatPolicy";
import { Button } from "@/components/ui/button";
import { parseToolsLocation, toolsHref, recentIds } from "./explorer/urlState";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
import type { Lang, ToolArgs } from "../tools/types";
import { ToolLibrary } from "./explorer/ToolLibrary";
import { WelcomeGallery } from "./explorer/WelcomeGallery";
import { ToolWorkspace } from "./explorer/ToolWorkspace";
import type { ToolIntent, WorkspaceState } from "./explorer/workspace";
const SqlLibrary = lazy(() => import("./explorer/SqlLibrary"));
export const Explorer = ({
  lang,
  onOpenChat,
}: {
  lang: Lang;
  onOpenChat: (intent: ToolIntent) => void;
}) => {
  const navigation = useChatNavigation();
  const initial = useRef(parseToolsLocation(window.location.search));
  const [selection, setSelection] = useState<string | undefined>(
    initial.current.tool,
  );
  const [linkError, setLinkError] = useState(!!initial.current.error);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceState>>(
    () =>
      initial.current.tool && initial.current.args
        ? { [initial.current.tool]: { draft: initial.current.args } }
        : {},
  );
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return recentIds(
        JSON.parse(localStorage.getItem("naiasno.tools.recent.v1") ?? "[]"),
      );
    } catch {
      return [];
    }
  });
  const [sql, setSql] = useState(false);
  const [area, setArea] = useState(
    () => new URLSearchParams(window.location.search).get("area") ?? undefined,
  );
  const root = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const previous = useRef<string | undefined>(undefined);
  const focusDetail = () =>
    requestAnimationFrame(() => detail.current?.focus());
  const select = (name: string, args?: ToolArgs) => {
    setSql(false);
    setLinkError(false);
    if (args)
      setWorkspaces((w) => ({ ...w, [name]: { ...w[name], draft: args } }));
    setSelection(name);
    previous.current = name;
    setRecent((r) => [name, ...r.filter((n) => n !== name)].slice(0, 8));
    navigation.navigate(
      toolsHref(name, lang, navigation.search, args, navigation.pathname),
    );
    focusDetail();
  };
  useEffect(() => {
    try {
      localStorage.setItem("naiasno.tools.recent.v1", JSON.stringify(recent));
    } catch {
      /* Storage disabled */
    }
  }, [recent]);
  useEffect(() => {
    const restore = () => {
      const parsed = parseToolsLocation(window.location.search);
      setArea(
        new URLSearchParams(window.location.search).get("area") ?? undefined,
      );
      setSelection(parsed.tool);
      setLinkError(!!parsed.error);
      setSql(false);
      if (parsed.tool && parsed.args) {
        const name = parsed.tool;
        const draft = parsed.args;
        setWorkspaces((w) => ({ ...w, [name]: { ...w[name], draft } }));
      }
    };
    restore();
  }, [navigation.search]);
  const back = () => {
    setSelection(undefined);
    setSql(false);
    navigation.navigate(
      toolsHref(
        undefined,
        lang,
        navigation.search,
        undefined,
        navigation.pathname,
      ),
    );
    requestAnimationFrame(() => {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-tool-id]",
      );
      const button = Array.from(buttons ?? []).find(
        (b) => b.dataset.toolId === previous.current,
      );
      (
        button ?? root.current?.querySelector<HTMLInputElement>("input")
      )?.focus();
    });
  };
  return (
    <div ref={root} className="space-y-6">
      <ChatPolicy lang={lang} id="privacy" />
      <header>
        <h1 className="font-title text-3xl">
          {lang === "bg" ? "Инструменти и данни" : "Tools & data"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {lang === "bg"
            ? "Изберете въпрос и проверете данните зад отговора."
            : "Choose a question and explore the data behind the answer."}
        </p>
      </header>
      {linkError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm"
        >
          {lang === "bg"
            ? "Връзката съдържа невалидни настройки. Изберете инструмент от каталога."
            : "This link contains invalid settings. Choose a tool from the library."}
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div
          className={`${selection || sql ? "hidden lg:block" : ""} lg:sticky lg:top-4 order-2 lg:order-1 min-w-0`}
        >
          <ToolLibrary
            lang={lang}
            selected={selection}
            recent={recent}
            onSelect={select}
            sql={sql}
            onSql={() => {
              setSql(true);
              focusDetail();
            }}
          />
        </div>
        <div
          ref={detail}
          tabIndex={-1}
          className="min-w-0 order-1 lg:order-2 focus-visible:outline-none"
        >
          {(selection || sql) && (
            <Button className="mb-4 lg:hidden" variant="outline" onClick={back}>
              {lang === "bg" ? "← Каталог инструменти" : "← Tool library"}
            </Button>
          )}
          {sql ? (
            <Suspense
              fallback={
                <p role="status">{lang === "bg" ? "Зареждане…" : "Loading…"}</p>
              }
            >
              <SqlLibrary lang={lang} />
            </Suspense>
          ) : selection ? (
            <ToolWorkspace
              key={selection}
              lang={lang}
              name={selection}
              area={area}
              state={workspaces[selection] ?? { draft: {} }}
              onChange={(state) =>
                setWorkspaces((w) => ({ ...w, [selection]: state }))
              }
              onOpenChat={onOpenChat}
            />
          ) : (
            <>
              <div className="hidden lg:block">
                <WelcomeGallery lang={lang} onSelect={select} />
              </div>
              <details className="rounded-xl border bg-background p-4 lg:hidden">
                <summary className="cursor-pointer font-medium">
                  {lang === "bg"
                    ? "Започнете от примерен въпрос"
                    : "Start with an example question"}
                </summary>
                <div className="pt-4">
                  <WelcomeGallery lang={lang} onSelect={select} />
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
