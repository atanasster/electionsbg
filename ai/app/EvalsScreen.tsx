// Benchmark page (ai.electionsbg.com/evals) — the published EN/BG function-calling
// eval. A standalone page (the chat app has no router); it fetches the artifact
// data/ai/evals/fc_eval.json (shipped to the GCS data bucket) and renders the
// headline table + methodology + per-model detail. Bilingual via a local toggle,
// matching App.tsx (no i18next in this app).

import { useContext, useEffect, useMemo, useState } from "react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { fetchData } from "../tools/dataClient";
import type { Lang } from "../tools/types";

type LangMetrics = {
  toolAcc: number;
  argAcc: number | null;
  jsonValidRate: number;
  irrelevanceAcc: number | null;
};
type PerCase = {
  id: string;
  domain?: string;
  expectedTool: string | null;
  en?: { toolOk: boolean; got: string | null };
  bg?: { toolOk: boolean; got: string | null };
};
type ModelResult = {
  id: string;
  label: string;
  runtime: "cloud" | "webllm";
  params: string;
  via?: string;
  toolMode?: string;
  note?: string;
  reason?: string;
  status: "measured" | "unavailable" | "missing-capture";
  perLang: { en: LangMetrics; bg: LangMetrics } | null;
  degradation: { toolAcc: number; argAcc: number | null } | null;
  perCase: PerCase[];
};
type Artifact = {
  generatedAt: string;
  harness: string;
  method: {
    toolCount: number;
    caseCount: number;
    relevantCases: number;
    irrelevanceCases: number;
    promptStrategy: { cloud: string; gemini: string; webllm: string };
    scoring: string;
    coverageNote: string;
  };
  tools: {
    name: string;
    domain?: string;
    description: string;
    params: string[];
  }[];
  cases: {
    id: string;
    domain?: string;
    en: string;
    bg: string;
    expectedTool: string | null;
  }[];
  models: ModelResult[];
};

// Companion artifact: the retriever-recall comparison (data/ai/evals/retriever_recall.json,
// built by ai/llm/retrieverEval.artifact.ts). The constrained in-browser router
// routes among the tools the RETRIEVER supplies, so retriever recall is the ceiling.
type RecallRow = {
  id: string;
  label: Record<Lang, string>;
  runtime: "cloud" | "webllm";
  size: Record<Lang, string>;
  method: Record<Lang, string>;
  ours?: boolean;
  shipped?: boolean;
  all: Record<string, number>;
  declined: Record<string, number>;
};
type RetrieverArtifact = {
  generatedAt: string;
  queries: { total: number; declined: number; langs: string[] };
  method: Record<Lang, string>;
  caveat: Record<Lang, string>;
  rows: RecallRow[];
};

const pct = (x: number | null | undefined) =>
  x == null ? "—" : `${Math.round(x * 100)}%`;

const runtimeLabel = (r: string, lang: Lang) =>
  r === "webllm"
    ? lang === "bg"
      ? "в браузъра"
      : "in-browser"
    : lang === "bg"
      ? "облачен"
      : "cloud";

// BG labels for the model rows (the artifact's labels are English-only). Falls
// back to the English label for any id not listed (e.g. Gemini, the baseline).
const MODEL_LABEL_BG: Record<string, string> = {
  "google/gemma-4-31b-it": "Gemma 4 31B (бюджет: 640 токена)",
  "google/gemma-4-31b-it-1536": "Gemma 4 31B (бюджет: 1536 токена)",
  "functiongemma-270m-it-q4f32_1-MLC.k3-free":
    "FunctionGemma 270M — облекчена подкана (k=3, свободно декодиране)",
  "functiongemma-270m-it-q4f32_1-MLC.k3-grammar":
    "FunctionGemma 270M — с граматика (k=3)",
  "functiongemma-270m-it-q4f32_1-MLC.k8-compact-grammar":
    "FunctionGemma 270M — избор измежду 8 (k=8, сбита подкана + граматика)",
};

const modelLabel = (m: { id: string; label: string }, lang: Lang) =>
  lang === "bg" ? (MODEL_LABEL_BG[m.id] ?? m.label) : m.label;

export const EvalsScreen = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const [lang, setLang] = useState<Lang>("bg");
  const [data, setData] = useState<Artifact | null>(null);
  const [retr, setRetr] = useState<RetrieverArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDark = theme === themeDark;
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  useEffect(() => {
    fetchData<Artifact>("/ai/evals/fc_eval.json")
      .then(setData)
      .catch((e) => setError(String(e)));
    fetchData<RetrieverArtifact>("/ai/evals/retriever_recall.json")
      .then(setRetr)
      .catch(() => {});
  }, []);

  const generated = useMemo(() => {
    if (!data) return "";
    try {
      return new Date(data.generatedAt).toLocaleDateString(
        lang === "bg" ? "bg-BG" : "en-GB",
        { year: "numeric", month: "long", day: "numeric" },
      );
    } catch {
      return data.generatedAt.slice(0, 10);
    }
  }, [data, lang]);

  return (
    <div className="flex min-h-dvh flex-col bg-card text-foreground">
      <header className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2 border-b-2 bg-muted px-2 py-2.5 shadow-sm sm:px-4">
        <a
          href="/"
          className="flex shrink-0 items-center gap-2 text-xl text-primary"
          aria-label="Наясно AI"
        >
          <Logo className="size-7" />
          <span className="font-title">
            <span className="text-popover-foreground">Наясно</span>
            <span className="pl-1 font-semibold uppercase text-primary">
              AI
            </span>
          </span>
        </a>
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
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
          <h1 className="font-title text-2xl font-semibold text-popover-foreground sm:text-3xl">
            {t(
              "Оценка на извикването на функции (EN/BG)",
              "Function-calling evaluation (EN/BG)",
            )}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {t(
              "Може ли малък отворен модел сам да задвижва инструментите на Наясно (tool calling)? И влошава ли се изборът на инструмент, когато въпросът е на български, а не на английски? Всеки модел решава едни и същи задачи и на двата езика.",
              "Can a small/open model drive Наясно's tools — and does tool selection degrade when the question is in Bulgarian rather than English? Each model gets the same tasks in both languages.",
            )}
          </p>

          {/* ---- retriever-recall comparison (the binding ceiling) ---- */}
          {retr && (
            <section className="mt-8">
              <h2 className="font-title text-xl font-semibold text-popover-foreground">
                {t(
                  "Извличане на инструменти (recall)",
                  "Tool retrieval recall",
                )}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {t(
                  "В браузъра малкият модел избира само измежду шепата инструменти, които му подава РЕТРИВЪРЪТ. Ако правилният не е сред тях, никой модел не може да го открие — затова обхватът (recall) на ретривъра опъва тавана на цялата система. По-долу е делът на въпросите, при които правилният инструмент попада сред първите k — пресметнат върху това, което реално стига до модела.",
                  "In-browser, the small model picks among the few tools the RETRIEVER hands it. If the right one isn't there, no model can recover it — so retriever recall is the ceiling on the whole system. Below: share of queries whose correct tool is in the top-k, over the model's real input.",
                )}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">
                        {t("Ретривър", "Retriever")}
                      </th>
                      <th className="px-2 py-2 font-medium">
                        {t("Режим", "Mode")}
                      </th>
                      <th className="px-2 py-2 text-right font-medium">@1</th>
                      <th className="px-2 py-2 text-right font-medium">@3</th>
                      <th className="px-2 py-2 text-right font-medium">@5</th>
                      <th className="px-2 py-2 text-right font-medium">@8</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retr.rows.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b align-top ${row.ours ? "bg-primary/5" : ""}`}
                      >
                        <td className="py-2 pr-3">
                          <div className="font-medium text-popover-foreground">
                            {row.label[lang]}
                            {row.ours && (
                              <span className="ml-1.5 rounded bg-primary/15 px-1 text-[10px] font-semibold uppercase text-primary">
                                {t("наш", "ours")}
                              </span>
                            )}
                            {row.shipped && (
                              <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-semibold uppercase text-muted-foreground">
                                {t("активен", "live")}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.size[lang]} · {row.method[lang]}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">
                          {runtimeLabel(row.runtime, lang)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {pct(row.declined["1"])}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {pct(row.declined["3"])}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {pct(row.declined["5"])}
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums text-popover-foreground">
                          {pct(row.declined["8"])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {retr.method[lang]}
              </p>
              <p className="mt-1 text-xs italic text-muted-foreground">
                {t("Уточнение: ", "Caveat: ")}
                {retr.caveat[lang]}
              </p>
            </section>
          )}

          {error && (
            <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {t("Грешка при зареждане: ", "Failed to load: ")}
              {error}
            </p>
          )}
          {!data && !error && (
            <p className="mt-6 text-muted-foreground">
              {t("Зареждане…", "Loading…")}
            </p>
          )}

          {data && (
            <>
              {/* ---- headline table ---- */}
              <section className="mt-8 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">
                        {t("Модел", "Model")}
                      </th>
                      <th className="px-2 py-2 font-medium">
                        {t("Режим", "Mode")}
                      </th>
                      <th className="px-2 py-2 text-right font-medium">EN</th>
                      <th className="px-2 py-2 text-right font-medium">BG</th>
                      <th className="px-2 py-2 text-right font-medium">
                        {t("Аргументи", "Args")}
                      </th>
                      <th className="px-2 py-2 text-right font-medium">JSON</th>
                      <th className="px-2 py-2 text-right font-medium">
                        {t("Разлика (EN vs BG)", "BG drop")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((m) => (
                      <tr key={m.id} className="border-b align-top">
                        <td className="py-2 pr-3">
                          <div className="font-medium text-popover-foreground">
                            {modelLabel(m, lang)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {m.params !== "—" ? `${m.params} · ` : ""}
                            {runtimeLabel(m.runtime, lang)}
                            {m.via ? ` · ${m.via}` : ""}
                          </div>
                        </td>
                        {m.perLang ? (
                          <>
                            <td className="px-2 py-2 text-xs text-muted-foreground">
                              {m.toolMode ?? runtimeLabel(m.runtime, lang)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {pct(m.perLang.en.toolAcc)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {pct(m.perLang.bg.toolAcc)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                              {pct(m.perLang.bg.argAcc)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                              {pct(m.perLang.bg.jsonValidRate)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {m.degradation
                                ? `${Math.round(m.degradation.toolAcc * 100)} pt`
                                : "—"}
                            </td>
                          </>
                        ) : (
                          <td
                            className="px-2 py-2 text-xs italic text-muted-foreground"
                            colSpan={6}
                          >
                            {t("не е измерено — ", "not measured — ")}
                            {m.reason}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(
                    "EN/BG = дял на правилно избраните инструменти (вкл. случаите, в които моделът разпознава, че никой инструмент не подхожда). Разлика (EN vs BG) = EN − BG (положителна стойност = по-слабо представяне на български).",
                    "EN/BG = share of correctly selected tools (incl. recognising when no tool fits). BG drop = EN−BG (positive = worse in Bulgarian).",
                  )}
                </p>
              </section>

              {/* ---- takeaway ---- */}
              <section className="mt-8 rounded-lg border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 font-semibold text-popover-foreground">
                  {t("Какво показват резултатите?", "What this shows")}
                </h2>
                <p className="text-muted-foreground">
                  {t(
                    "Облачните модели се справят отлично с избора измежду всички налични инструменти: Gemini 3.1 Flash-Lite (в JSON-режим) познава правилния инструмент в ~96–97% от случаите и на двата езика, без никакъв спад при българския. Отвореният 31B модел (Gemma 4) през Gemini API стига едва до ~55% при таван от 640 изходни токена — но виновна е орязаната верига от разсъждения (chain of thought), а не самият модел: вдигнем ли тавана до 1536 токена, точността скача до ~82% (EN 81% / BG 83%) с ~87% валиден JSON, а изоставането при българския дори се обръща. Тоест начинът на извикване (бюджетът за изход, ограниченото декодиране) тежи колкото размера на модела.",
                    "A capable cloud model handles selection among all the tools: Gemini 3.1 Flash-Lite (with JSON mode) picks the right tool ~96–97% in both languages, with no Bulgarian degradation. An open 31B model (Gemma 4) via the Gemini API scores ~55% at a 640-token output budget — but that's chain-of-thought truncation, not the model: raise the budget to 1536 and it jumps to ~82% (EN 81% / BG 83%), valid JSON ~87%, with the Bulgarian gap reversing. So the calling method (output budget / constrained decoding) can matter as much as model size.",
                  )}
                </p>
                <p className="mt-3 text-muted-foreground">
                  {t(
                    "Малкият FunctionGemma 270M (в браузъра, без дообучение) е показан като стълбица от варианти на ЕДИН и същ модел. Базовият ред е 0% — но не защото моделът не умее да насочва заявките: при k=8 пълните декларации на функциите запушват ~68% от случаите, защото подканата прелива контекстния прозорец от 512 токена („KV cache is full“) още преди моделът да е изписал и един токен. Свиването до k=3 премахва тези технически засичания; а ограниченото декодиране (XGrammar — изходът ЗАДЪЛЖИТЕЛНО е един от кандидатите) вдига разпознаването до 37% при k=3 (срещу ~33% на случаен принцип) и 18% при k=8 (срещу ~12,5%). Тоест публикуваните „0%“ бяха дефект на инфраструктурата, не на модела; с побираща се подкана и ограничено декодиране дори необученият модел вече бие случайния избор — а дообучението за домейна е пътят към реална употреба.",
                    "The small FunctionGemma 270M (in-browser, untuned) is shown as a LADDER of variants of the SAME model. The baseline row is 0% — but not because it can't route: at k=8 with full declarations the wasm traps ~68% of the time ('KV cache is full' — the prompt overflows the 512-token context window) before the model emits a single token. Shrinking to k=3 removes the traps; adding constrained decoding (XGrammar — the output MUST be one of the candidates) lifts routing to 37% at k=3 (vs ~33% chance) and 18% at k=8 (vs ~12.5%). So the published '0%' was an infrastructure artifact; with a fitting prompt + constrained decoding the untuned model already beats chance — and a domain fine-tune is the path to usable.",
                  )}
                </p>
              </section>

              {/* ---- per-model detail ---- */}
              <section className="mt-8">
                <h2 className="mb-3 font-semibold text-popover-foreground">
                  {t("Детайли по задачите", "Per-case detail")}
                </h2>
                {data.models
                  .filter((m) => m.perLang)
                  .map((m) => (
                    <details key={m.id} className="mb-2 rounded-md border">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                        {modelLabel(m, lang)}
                      </summary>
                      <div className="overflow-x-auto px-3 pb-3">
                        {(m.note || m.reason) && (
                          <p className="mb-2 mt-1 text-xs text-muted-foreground">
                            {m.note ? <span>{m.note} </span> : null}
                            {m.reason}
                          </p>
                        )}
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-1 pr-2 font-medium">
                                {t("Задача", "Case")}
                              </th>
                              <th className="px-2 py-1 font-medium">
                                {t("Очакван инструмент", "Expected tool")}
                              </th>
                              <th className="px-2 py-1 text-center font-medium">
                                EN
                              </th>
                              <th className="px-2 py-1 text-center font-medium">
                                BG
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.perCase.map((c) => {
                              const mark = (r?: { toolOk: boolean }) =>
                                !r ? "—" : r.toolOk ? "✓" : "✗";
                              return (
                                <tr
                                  key={c.id}
                                  className="border-b last:border-0"
                                >
                                  <td className="py-1 pr-2 font-mono text-[11px]">
                                    {c.id}
                                  </td>
                                  <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
                                    {c.expectedTool ?? t("(никой)", "(none)")}
                                  </td>
                                  <td className="px-2 py-1 text-center">
                                    {mark(c.en)}
                                  </td>
                                  <td className="px-2 py-1 text-center">
                                    {mark(c.bg)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t(
                            "✓ правилен инструмент · ✗ грешен/липсва",
                            "✓ correct tool · ✗ wrong/missing",
                          )}
                        </p>
                      </div>
                    </details>
                  ))}
              </section>

              {/* ---- methodology ---- */}
              <section className="mt-8 text-sm">
                <h2 className="mb-2 font-semibold text-popover-foreground">
                  {t("Методология", "Methodology")}
                </h2>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  <li>
                    {t(
                      `${data.method.relevantCases} реални инструмента, всеки с двуезичен пример (EN+BG) от регистъра — точността на избора се мери спрямо всичките ${data.method.toolCount}.`,
                      `${data.method.relevantCases} real tools, each with a bilingual example (EN+BG) from the registry — tool selection is scored against all ${data.method.toolCount}.`,
                    )}
                  </li>
                  <li>
                    {t(
                      "Задачите са първият двуезичен пример (EN+BG) за всеки инструмент от регистъра. Облачните модели виждат ЦЕЛИЯ списък с инструменти в контекста (избор измежду всички възможности), докато малките модели в браузъра получават само предварително отсят набор от кандидати (реалистичната двустъпкова схема).",
                      data.method.coverageNote,
                    )}
                  </li>
                  <li>
                    {t("Облачни модели: ", "Cloud models: ")}
                    {t(
                      "JSON-режим + системна подкана със списъка на инструментите (точно като маршрутизатора в реалния продукт)",
                      data.method.promptStrategy.cloud,
                    )}
                    {t("; в браузъра: ", "; in-browser: ")}
                    {t(
                      "вградените токени на FunctionGemma за деклариране на функции",
                      data.method.promptStrategy.webllm,
                    )}
                  </li>
                  <li>
                    {t("Оценяване: ", "Scoring: ")}
                    {t(
                      "точност на ИЗБОРА на инструмент — точното име на инструмента от регистъра (приведено към обща форма); ако никой инструмент не подхожда, правилно е да няма извикване. Примерите в регистъра нямат описани аргументи, затова точността на аргументите не се мери (n/a).",
                      data.method.scoring,
                    )}
                  </li>
                  <li>
                    {t("Генерирано на ", "Generated ")}
                    {generated} ·{" "}
                    {t(
                      data.harness.replace(
                        "suite derived from",
                        "комплектът е изведен от",
                      ),
                      data.harness,
                    )}
                  </li>
                </ul>
              </section>

              {/* ---- catalogue ---- */}
              <details className="mt-6 rounded-md border text-sm">
                <summary className="cursor-pointer px-3 py-2 font-medium">
                  {t(
                    `Инструменти (${data.tools.length}) и задачи (${data.cases.length})`,
                    `Tools (${data.tools.length}) and cases (${data.cases.length})`,
                  )}
                </summary>
                <div className="px-3 pb-3">
                  <h3 className="mb-1 mt-2 font-medium text-popover-foreground">
                    {t("Инструменти", "Tools")}
                  </h3>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {data.tools.map((tool) => (
                      <li key={tool.name}>
                        <span className="font-mono text-popover-foreground">
                          {tool.name}
                        </span>
                        {tool.params.length
                          ? `(${tool.params.join(", ")})`
                          : "()"}{" "}
                        — {tool.description}
                      </li>
                    ))}
                  </ul>
                  <h3 className="mb-1 mt-3 font-medium text-popover-foreground">
                    {t("Задачи", "Cases")}
                  </h3>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {data.cases.map((c) => (
                      <li key={c.id}>
                        <span className="font-mono">{c.id}</span>:{" "}
                        {lang === "bg" ? c.bg : c.en}{" "}
                        <span className="opacity-70">
                          →{" "}
                          {c.expectedTool ??
                            t("(никой инструмент)", "(no tool)")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </>
          )}
        </div>
      </main>

      <footer className="border-t bg-muted px-4 py-4 text-center text-xs text-muted-foreground">
        <a href="https://electionsbg.com" className="hover:text-primary">
          electionsbg.com
        </a>
        {" · "}
        <a href="/" className="hover:text-primary">
          {t("Наясно AI", "Наясно AI")}
        </a>
      </footer>
    </div>
  );
};
