import { lazy, Suspense, useState } from "react";
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
  const [selection, setSelection] = useState<{
    name: string;
    args: ToolArgs;
    key: number;
  } | null>(null);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceState>>(
    {},
  );
  const [recent, setRecent] = useState<string[]>([]);
  const [sql, setSql] = useState(false);
  const select = (name: string, args?: ToolArgs) => {
    setSql(false);
    if (args)
      setWorkspaces((w) => ({ ...w, [name]: { ...w[name], draft: args } }));
    setSelection((s) => ({ name, args: args ?? {}, key: (s?.key ?? 0) + 1 }));
    setRecent((r) => [name, ...r.filter((n) => n !== name)].slice(0, 8));
  };
  return (
    <div className="space-y-6">
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
      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ToolLibrary
          lang={lang}
          selected={selection?.name}
          recent={recent}
          onSelect={select}
          sql={sql}
          onSql={() => setSql(true)}
        />
        <div className="min-w-0">
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
              key={selection.name}
              lang={lang}
              name={selection.name}
              state={workspaces[selection.name] ?? { draft: {} }}
              onChange={(state) =>
                setWorkspaces((w) => ({ ...w, [selection.name]: state }))
              }
              onOpenChat={onOpenChat}
            />
          ) : (
            <WelcomeGallery lang={lang} onSelect={select} />
          )}
        </div>
      </div>
    </div>
  );
};
