import { toolsHref } from "./urlState";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  validateArguments,
  validateClarification,
  type ArgumentIssue,
} from "../../orchestrator/validateArguments";
import { latestElection } from "../../tools/dataset";
import { runTool } from "../../tools/registry";
import type {
  ClarifyRequest,
  Lang,
  ToolArgs,
  ToolContext,
} from "../../tools/types";
import { AnswerView } from "../../render/AnswerView";
import { siteLinks } from "../../render/links";
import { ClarifyDialog } from "../ClarifyDialog";
import { toChatQuestionIntent } from "../questionAdapter";
import { LIBRARY, QUESTION_CATEGORIES } from "./library";
import { ParameterForm } from "./ParameterForm";
import { ReturnShape } from "./ReturnShape";
import {
  draftKey,
  resultIsStale,
  emptyEnvelope,
  toolIntent,
  type ToolIntent,
  type WorkspaceState,
} from "./workspace";
const SqlAlternative = lazy(() => import("./SqlAlternative"));
export const ToolWorkspace = ({
  name,
  area = new URLSearchParams(window.location.search).get("area") ?? undefined,
  lang,
  state,
  onChange,
  onOpenChat,
}: {
  name: string;
  area?: string;
  lang: Lang;
  state: WorkspaceState;
  onChange: (state: WorkspaceState) => void;
  onOpenChat: (intent: ToolIntent) => void;
}) => {
  const entry = LIBRARY.find((e) => e.tool.name === name)!;
  const [errors, setErrors] = useState<Record<string, ArgumentIssue>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null);
  const [share, setShare] = useState("");
  const [tab, setTab] = useState("result");
  const generation = useRef(0);
  const current = useRef(state);
  current.current = state;
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const edit = (draft: ToolArgs) => {
    setErrors({});
    onChange({ ...state, draft });
  };
  const execute = async (
    tool: string,
    args: ToolArgs,
    submittedKey: string,
    originalContext?: ToolContext,
  ) => {
    const request = ++generation.current;
    const context = originalContext ?? {
      lang,
      election: latestElection(),
      area,
    };
    const requestedAt = new Date().toISOString();
    setRunning(true);
    setError(null);
    setClarify(null);
    setTab("result");
    try {
      const envelope = await runTool(tool, args, context);
      if (request !== generation.current) return;
      changed.current({
        ...current.current,
        result: {
          tool,
          args: structuredClone(args),
          context,
          requestedAt,
          envelope,
          draftKey: submittedKey,
        },
      });
      if (envelope.clarify) setClarify(envelope.clarify);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === generation.current) setRunning(false);
    }
  };
  const validate = () => {
    const result = validateArguments(name, state.draft, { defaults: true });
    setErrors(result.errors);
    return Object.keys(result.errors).length ? null : result.args;
  };
  const run = () => {
    const args = validate();
    if (args) void execute(name, args, draftKey(state.draft));
  };
  const result = state.result;
  const stale = !!result && resultIsStale(result, state.draft, lang, area);
  return (
    <section className="min-w-0 space-y-5" aria-label={entry.title[lang]}>
      <header>
        <p className="text-xs font-medium text-primary">
          {
            QUESTION_CATEGORIES.find((c) => c.id === entry.categoryId)?.label[
              lang
            ]
          }
        </p>
        <h2 className="mt-1 font-title text-2xl">{entry.title[lang]}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {entry.tool.description[lang]}
        </p>
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {t("Идентификатор", "Identifier")}
          </summary>
          <code className="select-all">{name}</code>
        </details>
      </header>
      <form
        className="space-y-4 rounded-xl border border-border bg-background p-4 sm:p-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <ParameterForm
          tool={entry.tool}
          lang={lang}
          draft={state.draft}
          errors={errors}
          onChange={edit}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={running}>
            {running
              ? t("Зареждане…", "Loading…")
              : t("Покажи данните", "Show data")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (validate()) {
                const intent = toolIntent(name, state.draft, lang);
                if (intent) onOpenChat(intent);
              }
            }}
          >
            {t("Отвори в чата", "Open in chat")}
          </Button>
        </div>
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-destructive">
            {t(
              "Проверете отбелязаните полета.",
              "Check the highlighted fields.",
            )}
          </p>
        )}
      </form>
      <Button
        variant="ghost"
        onClick={() => {
          const args = validate();
          if (args) {
            try {
              setShare(
                window.location.origin +
                  toolsHref(name, lang, window.location.search, args),
              );
              setError(null);
            } catch {
              setShare("");
              setError(
                t(
                  "Настройките са твърде дълги за връзка. Съкратете въведения текст.",
                  "These settings are too long for a link. Shorten the entered text.",
                ),
              );
            }
          }
        }}
      >
        {t("Сподели текущите настройки", "Share current settings")}
      </Button>
      {share && (
        <div className="space-y-2 rounded-lg border p-3">
          <label htmlFor="tool-share" className="text-sm">
            {t(
              "Копирайте връзката — включва въведените настройки.",
              "Copy this link — it includes the entered settings.",
            )}
          </label>
          <Input
            id="tool-share"
            readOnly
            value={share}
            onFocus={(e) => e.target.select()}
          />
          <Button variant="ghost" onClick={() => setShare("")}>
            {t("Затвори", "Close")}
          </Button>
        </div>
      )}
      {entry.questions
        .filter((q) => q.sql.status === "ready")
        .map((q) => (
          <Suspense key={q.id} fallback={null}>
            <SqlAlternative id={q.id} lang={lang} />
          </Suspense>
        ))}
      <details>
        <summary className="cursor-pointer py-2 text-sm font-medium">
          {t("Примерни въпроси", "Example questions")} ({entry.questions.length}
          )
        </summary>
        <div className="flex flex-wrap gap-2">
          {entry.questions.map((q) => (
            <Button
              className="h-auto whitespace-normal text-left"
              type="button"
              variant="outline"
              key={q.id}
              onClick={() => edit(toChatQuestionIntent(q.id, lang).args)}
            >
              {q.question[lang]}
            </Button>
          ))}
        </div>
      </details>
      <p role="status" className="text-sm text-muted-foreground">
        {running
          ? t("Извличане на данните…", "Retrieving data…")
          : stale
            ? t(
                "Настройките са променени. Показаният резултат е от предишното изпълнение.",
                "Settings changed. The displayed result is from the previous run.",
              )
            : result
              ? t("Резултатът е готов.", "Result ready.")
              : t(
                  "Изберете настройки и покажете данните.",
                  "Choose settings and show the data.",
                )}
      </p>
      {error && (
        <div role="alert" className="rounded-lg border border-destructive p-4">
          <p className="break-words text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={run}>
            {t("Опитай отново", "Retry")}
          </Button>
        </div>
      )}
      {result && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={t("Детайли на резултата", "Result details")}>
            <TabsTrigger value="result">{t("Резултат", "Result")}</TabsTrigger>
            <TabsTrigger value="sources">
              {t("Източници", "Sources")}
            </TabsTrigger>
            <TabsTrigger value="technical">
              {t("Технически", "Technical")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="result">
            {emptyEnvelope(result.envelope) && (
              <p className="py-3 text-sm">
                {t(
                  "Няма върнати данни за тези настройки. Проверете обхвата в отговора.",
                  "No data returned for these settings. Check the coverage in the answer.",
                )}
              </p>
            )}
            <AnswerView
              env={result.envelope}
              lang={result.context.lang}
              onClarify={setClarify}
            />
          </TabsContent>
          <TabsContent
            value="sources"
            className="space-y-3 rounded-xl border p-4"
          >
            <h3 className="font-medium">
              {t("Източници на това изпълнение", "Sources for this run")}
            </h3>
            {result.envelope.provenance.length ? (
              <ul className="space-y-2 text-sm">
                {result.envelope.provenance.map((p, i) => (
                  <li className="break-words" key={`${p}-${i}`}>
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                {t("Няма посочени източници.", "No sources supplied.")}
              </p>
            )}
            {siteLinks(result.envelope).map((l) => (
              <a
                className="mr-3 inline-block text-sm text-primary underline"
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
              >
                {l.label[lang]} ↗
              </a>
            ))}
          </TabsContent>
          <TabsContent value="technical">
            <details className="mb-3 rounded-lg border p-3">
              <summary className="cursor-pointer text-sm">
                {t("Точна заявка", "Exact request")}
              </summary>
              <pre className="max-w-full overflow-auto p-2 text-xs">
                {JSON.stringify(
                  {
                    tool: result.tool,
                    args: result.args,
                    context: result.context,
                    requestedAt: result.requestedAt,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            <ReturnShape env={result.envelope} lang={lang} />
          </TabsContent>
        </Tabs>
      )}
      <ClarifyDialog
        request={clarify}
        lang={result?.context.lang ?? lang}
        onClose={() => setClarify(null)}
        onPick={(option) => {
          if (!clarify) return;
          const checked = validateClarification(clarify, option);
          if (Object.keys(checked.errors).length) {
            setError(t("Невалиден избор.", "Invalid choice."));
            return;
          }
          if (!result) return;
          void execute(
            option.tool,
            checked.args,
            result.draftKey,
            result.context,
          );
        }}
      />
    </section>
  );
};
