import { useChatNavigation } from "./navigation";
import { SITE_ORIGIN, SITE_HOST } from "@/lib/siteOrigin";
import { chatPath } from "./navigationPaths";
import { ToolGradSection } from "./ToolGradSection";
// Current production-router measurements; historical experiments stay explicitly separate.
import { useContext, useEffect, useState } from "react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { fetchData } from "../tools/dataClient";
import type { Lang } from "../tools/types";
import type { EvalCase, EvalScore } from "../llm/currentEval";
type Metrics = {
  n: number;
  toolAcc: number | null;
  callAcc: number | null;
  argN: number;
  argAcc: number | null;
  jsonValidRate: number | null;
  irrelevanceAcc: number | null;
  errors: number;
};
type Run = {
  label: string;
  model: string;
  provider: string;
  startedAt: string;
  finishedAt: string;
  toolCount: number;
  caseCount: number;
  retriedErrors?: number;
  promptHash: string;
  suiteHash: string;
  registryHash: string;
  scoringHash?: string;
  replaySource?: string;
  settings: {
    max_tokens: number;
    temperature: number;
    reasoning_effort: string;
  };
  metrics: Record<Lang, Metrics>;
  groups: Record<string, Record<Lang, Metrics>>;
  cases: EvalCase[];
  rows: EvalScore[];
};
type Legacy = {
  generatedAt: string;
  method: { toolCount: number; caseCount: number };
  models: {
    id: string;
    label: string;
    toolMode?: string;
    perLang: Record<Lang, { toolAcc: number }> | null;
  }[];
};
type Recall = {
  generatedAt: string;
  rows: {
    id: string;
    label: Record<Lang, string>;
    declined: Record<string, number>;
  }[];
};
const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;
export const EvalsScreen = ({
  integrated = false,
}: { integrated?: boolean } = {}) => {
  const navigation = useChatNavigation();
  const { theme, setTheme } = useContext(ThemeContext);
  const [localLang, setLang] = useState<Lang>(navigation.lang);
  const lang = integrated ? navigation.lang : localLang;
  const [run, setRun] = useState<Run | null>(null),
    [baseline, setBaseline] = useState<Run | null>(null);
  const [legacy, setLegacy] = useState<Legacy | null>(null),
    [recall, setRecall] = useState<Recall | null>(null);
  const [error, setError] = useState(false),
    [failuresOnly, setFailuresOnly] = useState(true);
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const Content = integrated ? "div" : "main";
  useEffect(() => {
    fetchData<Run>("/ai/evals/current_revised.json")
      .then(setRun)
      .catch(() => setError(true));
    fetchData<Run>("/ai/evals/current_baseline.json")
      .then(setBaseline)
      .catch(() => {});
    fetchData<Legacy>("/ai/evals/fc_eval.json")
      .then(setLegacy)
      .catch(() => {});
    fetchData<Recall>("/ai/evals/retriever_recall.json")
      .then(setRecall)
      .catch(() => {});
  }, []);
  const date = (s: string) =>
    new Date(s).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB");
  const groupLabel = (g: string) =>
    ({
      registry: t(
        "Прегледани примери от регистъра",
        "Reviewed registry examples",
      ),
      realistic: t("Ежедневни въпроси", "Everyday questions"),
      conversation: t("Разговорни продължения", "Conversation follow-ups"),
      clarification: t(
        "Уточнение / неподдържано действие",
        "Clarification / unsupported action",
      ),
      challenge: t(
        "Авторски задачи за диагностика",
        "Authored diagnostic cases",
      ),
      holdout: t("Отделени контролни задачи", "Held-out checks"),
      unsupported: t("Неподдържани заявки", "Unsupported requests"),
    })[g] ?? g;
  const comparable =
    baseline &&
    run &&
    baseline.suiteHash === run.suiteHash &&
    baseline.scoringHash === run.scoringHash;
  return (
    <div className="flex min-h-dvh flex-col bg-card text-foreground">
      {!integrated && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b-2 bg-muted px-4 py-2.5 shadow-sm">
          <a
            href={chatPath("chat", navigation.pathname)}
            className="flex items-center gap-2 text-xl text-primary"
          >
            <Logo className="size-7" />
            <span className="font-title">Наясно AI</span>
          </a>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = lang === "bg" ? "en" : "bg";
                if (!integrated) {
                  setLang(next);
                  return;
                }
                const path = navigation.pathname.replace(/^\/en/, "");
                window.location.assign(
                  `${next === "en" ? "/en" : ""}${path}${navigation.search}`,
                );
              }}
              aria-label={t("Език", "Language")}
            >
              {lang === "bg" ? "EN" : "BG"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setTheme(theme === themeDark ? themeLight : themeDark)
              }
              aria-label={t("Тема", "Theme")}
            >
              {theme === themeDark ? "☀" : "☾"}
            </Button>
          </div>
        </header>
      )}
      <Content className="container mx-auto flex-1 space-y-8 px-4 py-8">
        <div>
          <h1 className="font-title text-3xl font-semibold text-popover-foreground">
            {t(
              "Оценка на AI инструментите (EN/BG)",
              "AI tool evaluation (EN/BG)",
            )}
          </h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            {t(
              "Избира ли текущият модел правилния инструмент и подава ли използваеми аргументи? Измерваме Gemini 3.5 Flash-Lite с реалната подкана и валидатора на Наясно, на български и английски.",
              "Does the current model choose the right tool and supply usable arguments? We measure Gemini 3.5 Flash-Lite with Наясно’s actual prompt and validator, in Bulgarian and English.",
            )}
          </p>
        </div>
        <ToolGradSection lang={lang} />
        {error && (
          <p role="alert">
            {t(
              "Текущите резултати не можаха да се заредят.",
              "Current results could not be loaded.",
            )}
          </p>
        )}
        {!run && !error && <p>{t("Зареждане…", "Loading…")}</p>}
        {run && (
          <>
            <section aria-label={t("Текущ модел", "Current model")}>
              <h2 className="font-title text-2xl text-popover-foreground">
                Gemini 3.5 Flash-Lite
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {date(run.finishedAt)} · {run.toolCount}{" "}
                {t("инструмента", "tools")} · {run.caseCount}{" "}
                {t("двуезични задачи", "paired cases")} ·{" "}
                {run.caseCount * 2 + (run.retriedErrors ?? 0)}{" "}
                {t("реални API извиквания", "real API calls")}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b-2">
                      <th className="p-2">{t("Измерване", "Measurement")}</th>
                      <th className="p-2">
                        {t("Избор EN / BG", "Selection EN / BG")}
                      </th>
                      <th className="p-2">
                        {t(
                          "Използваемо извикване EN / BG",
                          "Usable call EN / BG",
                        )}
                      </th>
                      <th className="p-2">
                        {t("Аргументи EN / BG", "Arguments EN / BG")}
                      </th>
                      <th className="p-2">JSON EN / BG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(comparable ? [baseline!, run] : [run]).map((r) => (
                      <tr key={r.label} className="border-b">
                        <th className="p-2 font-medium">
                          {r.label === "baseline"
                            ? t("Предишна инструкция", "Earlier prompt")
                            : t("След корекциите", "After fixes")}
                        </th>
                        <td className="p-2 tabular-nums">
                          {pct(r.metrics.en.toolAcc)} /{" "}
                          {pct(r.metrics.bg.toolAcc)}
                        </td>
                        <td className="p-2 tabular-nums">
                          {pct(r.metrics.en.callAcc)} /{" "}
                          {pct(r.metrics.bg.callAcc)}
                        </td>
                        <td className="p-2 tabular-nums">
                          {pct(r.metrics.en.argAcc)} /{" "}
                          {pct(r.metrics.bg.argAcc)}
                        </td>
                        <td className="p-2 tabular-nums">
                          {pct(r.metrics.en.jsonValidRate)} /{" "}
                          {pct(r.metrics.bg.jsonValidRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
                {t(
                  "Избор = точно име на инструмента. Използваемо извикване = правилен инструмент след проверените поправки на обхвата и аргументите, приет от реалния валидатор, и правилни стойности при анотираните задачи. Аргументите се оценяват върху всички анотирани задачи, включително грешно избраните инструменти.",
                  "Selection = exact tool name. Usable call = correct tool after reviewed scope/argument normalization, accepted by the real validator, plus correct values on annotated cases. Arguments are scored over every annotated case, including wrong-tool selections.",
                )}{" "}
                {t(
                  "Анотирани задачи на език:",
                  "Annotated cases per language:",
                )}{" "}
                {run.metrics.en.argN}.
                {baseline?.replaySource && (
                  <span>
                    {" "}
                    {t(
                      "Отговорите от предишната инструкция са преоценени със същия текущ валидатор, без нови API извиквания.",
                      "Responses from the earlier prompt are re-scored with the same current validator, without new API calls.",
                    )}
                  </span>
                )}
              </p>
            </section>
            <section>
              <h2 className="font-title text-xl text-popover-foreground">
                {t("Покритие и ограничения", "Coverage and limits")}
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b-2">
                      <th className="p-2">{t("Група", "Group")}</th>
                      <th className="p-2">
                        {t("Задачи на език", "Cases per language")}
                      </th>
                      <th className="p-2">
                        {t("Използваемо извикване EN", "Usable call EN")}
                      </th>
                      <th className="p-2">
                        {t("Използваемо извикване BG", "Usable call BG")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(run.groups).map(([g, m]) => (
                      <tr key={g} className="border-b">
                        <th className="p-2 font-medium">{groupLabel(g)}</th>
                        <td className="p-2">{m.en.n}</td>
                        <td className="p-2">{pct(m.en.callAcc)}</td>
                        <td className="p-2">{pct(m.bg.callAcc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
                {t(
                  "Всички примери от регистъра са включени. Те са близки до описанията и не са независима оценка на реалния трафик. Авторските задачи проверяват аргументи, сходни инструменти, последващи въпроси и неподдържани действия. Малкият контролен набор не е използван за редактиране на описанията.",
                  "All registry examples are included. They are close to the descriptions and are not an independent estimate of real traffic. Authored cases test arguments, overlapping tools, follow-ups and unsupported actions. The small held-out set was not used to edit descriptions.",
                )}
              </p>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {t(
                  "Това е изолиран тест на маршрутизацията от модела: не изпълнява инструментите и не оценява крайния отговор или резервния маршрутизатор. При примери без анотации валидаторът проверява формата, но не доказва смисловата точност на аргументите. Едно измерване на вариант; разликите могат да включват вариация на модела.",
                  "This isolates model routing: it does not execute tools or evaluate final answers or the fallback router. On unannotated examples, validation checks argument shape, not semantic correctness. One run per variant; differences can include model variation.",
                )}
              </p>
            </section>
            <section>
              <h2 className="font-title text-xl text-popover-foreground">
                {t("Резултати по задачи", "Case results")}
              </h2>
              <label className="my-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={failuresOnly}
                  onChange={(e) => setFailuresOnly(e.target.checked)}
                />
                {t("Само неуспешните", "Failures only")}
              </label>
              <div className="max-h-[36rem] overflow-auto rounded border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted">
                      <th className="p-2">{t("Въпрос", "Question")}</th>
                      <th className="p-2">
                        {t("Очакван → избран", "Expected → selected")}
                      </th>
                      <th className="p-2">{t("Резултат", "Result")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.rows
                      .filter(
                        (r) => r.lang === lang && (!failuresOnly || !r.callOk),
                      )
                      .map((r) => (
                        <tr key={r.id} className="border-b align-top">
                          <td className="max-w-lg whitespace-pre-line p-2">
                            {run.cases.find((c) => c.id === r.id)?.[lang]}
                            {run.cases.find((c) => c.id === r.id)?.history && (
                              <details className="mt-1 text-xs text-muted-foreground">
                                <summary className="cursor-pointer">
                                  {t("Предишен контекст", "Previous context")}
                                </summary>
                                <pre className="whitespace-pre-wrap break-words">
                                  {JSON.stringify(
                                    run.cases.find((c) => c.id === r.id)
                                      ?.history?.[lang],
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            )}
                            {run.cases.find((c) => c.id === r.id)?.review && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {t(
                                  "Прегледан етикет / уточнен въпрос (v2)",
                                  "Reviewed label / clarified question (v2)",
                                )}
                              </div>
                            )}
                            <div className="mt-1 text-xs text-muted-foreground">
                              {groupLabel(r.group)} · {r.id}
                            </div>
                          </td>
                          <td className="p-2 font-mono text-xs">
                            {r.expectedTool ?? "∅"} → {r.selected ?? "∅"}
                            {r.parsed && r.parsed.tool !== r.selected && (
                              <div>
                                {t("След проверка", "After validation")}:{" "}
                                {r.parsed.tool}
                              </div>
                            )}
                          </td>
                          <td className="p-2">
                            <span>
                              {r.callOk
                                ? "✓"
                                : r.error
                                  ? t("API грешка", "API error")
                                  : !r.toolOk
                                    ? t(
                                        "Различен инструмент / без извикване",
                                        "Different tool / no call",
                                      )
                                    : t(
                                        "Аргументи / валидация",
                                        "Arguments / validation",
                                      )}
                            </span>
                            <details className="mt-1 text-xs">
                              <summary className="cursor-pointer">
                                {t("Отговор на модела", "Model response")}
                              </summary>
                              <pre className="max-w-md whitespace-pre-wrap break-words py-2">
                                {r.raw || r.error}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="max-w-3xl text-sm">
              <h2 className="font-title text-xl text-popover-foreground">
                {t(
                  "Обхват и оставащи ограничения",
                  "Coverage and remaining limitations",
                )}
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  {t(
                    "Версия 2 уточнява шест двусмислени въпроса и изисква уточнение при единадесет примера без посочено лице или фирма. Старите измервания са запазени отделно.",
                    "Version 2 narrows six ambiguous questions and expects clarification for eleven examples without a named person or company. Earlier measurements are preserved separately.",
                  )}
                </li>
                <li>
                  {t(
                    "Добавени са 40 двойки ръчно написани ежедневни въпроси, включително осем разговорни продължения. Това са симулирани въпроси, не реални потребителски разговори. Те не са независим тестов набор, след като се използват за диагностика.",
                    "Added 40 hand-written pairs of everyday questions, including eight conversation follow-ups. These simulate users; they are not collected user conversations or an independent holdout once used for diagnosis.",
                  )}
                </li>
                <li>
                  {t(
                    "Класациите приемат ограничен набор показатели; неподдържаният показател не се заменя с безработица. Има проверки за типовете на изборния цикъл и за календарна година срещу подвижен период.",
                    "Rankings use a closed set of metrics; unsupported metrics no longer become unemployment. Validation checks election-cycle types and calendar-year versus rolling-window scope.",
                  )}
                </li>
                <li>
                  {t(
                    "API оценките измерват избора и аргументите. Отделни автоматизирани тестове с фиксирани данни проверяват изпълнение, липсващи данни, източници и защита на числата. Те не доказват коректността на всички живи крайни точки или на всеки генериран отговор.",
                    "API scores measure routing and arguments. Separate automated tests with fixed data check execution, missing data, sources and number grounding. They do not establish correctness of every live endpoint or generated answer.",
                  )}
                </li>
              </ul>
            </section>
            <details className="rounded border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {t("Възпроизводимост", "Reproducibility")}
              </summary>
              <div className="mt-3 space-y-2 break-all text-xs text-muted-foreground">
                <p>{run.provider}</p>
                <p>
                  {run.model} · temperature {run.settings.temperature} ·
                  max_tokens {run.settings.max_tokens} · reasoning{" "}
                  {run.settings.reasoning_effort}
                </p>
                <p>
                  {t("Хеш на задачите", "Suite hash")}: {run.suiteHash}
                </p>
                <p>
                  {t("Хеш на подканите", "Prompt hash")}: {run.promptHash}
                </p>
                <p>
                  {t("Хеш на регистъра", "Registry hash")}: {run.registryHash}
                </p>
                <p>
                  {t("Грешки на API EN / BG", "API errors EN / BG")}:{" "}
                  {run.metrics.en.errors} / {run.metrics.bg.errors}
                </p>
                <p>
                  {t(
                    "Повторени временни API грешки",
                    "Retried transient API errors",
                  )}
                  : {run.retriedErrors ?? 0}.{" "}
                  {t(
                    "Първите отговори и грешки са запазени в архива.",
                    "Original responses and errors are retained in the run archive.",
                  )}
                </p>
                <p>ai/llm/currentEval.run.ts · data/ai/evals/runs/</p>
              </div>
            </details>
          </>
        )}
        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            {t(
              "Архив: предишни модели и ретривъри",
              "Archive: previous models and retrievers",
            )}
          </summary>
          <p className="my-3 max-w-3xl text-sm text-muted-foreground">
            {t(
              "Тези експерименти са с по-стар регистър и различни подкани. Не са пряко сравними с текущия тест. Моделите в браузъра и ретривърите не са текущият облачен маршрутизатор.",
              "These experiments used an older registry and different prompts. They are not directly comparable with the current test. Browser models and retrievers are not the current cloud router.",
            )}
          </p>
          {legacy && (
            <>
              <p className="text-sm">
                {date(legacy.generatedAt)} · {legacy.method.toolCount}{" "}
                {t("инструмента", "tools")} · {legacy.method.caseCount}{" "}
                {t("задачи", "cases")}
              </p>
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2">{t("Модел", "Model")}</th>
                      <th className="p-2">
                        {t("Исторически режим", "Historical mode")}
                      </th>
                      <th className="p-2">EN</th>
                      <th className="p-2">BG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacy.models.map((m) => (
                      <tr key={m.id} className="border-b">
                        <th className="p-2 font-medium">{m.label}</th>
                        <td className="p-2">{m.toolMode}</td>
                        <td className="p-2">{pct(m.perLang?.en.toolAcc)}</td>
                        <td className="p-2">{pct(m.perLang?.bg.toolAcc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {recall && (
            <details className="mt-4">
              <summary className="cursor-pointer">
                {t("Исторически recall@8", "Historical recall@8")} ·{" "}
                {date(recall.generatedAt)}
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {recall.rows.map((r) => (
                  <li key={r.id}>
                    {r.label[lang].replace(/ — current| — текущ/g, "")} —{" "}
                    {pct(r.declined["8"])}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {t(
                  "Въпроси, останали след правилата; синтетичен набор. Резултатите от дообучението споделят генератор с теста и могат да са оптимистични.",
                  "Queries left after rules; synthetic dataset. Fine-tuning and test data share a generator and may give optimistic results.",
                )}
              </p>
            </details>
          )}
        </details>
      </Content>
      {!integrated && (
        <footer className="border-t bg-muted p-4 text-center text-xs">
          <a href={chatPath("chat", navigation.pathname)}>
            {t("Към чата", "Back to chat")}
          </a>{" "}
          · <a href={SITE_ORIGIN}>{SITE_HOST}</a>
        </footer>
      )}
    </div>
  );
};
