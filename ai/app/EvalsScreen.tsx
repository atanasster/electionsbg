// Benchmark page (ai.electionsbg.com/evals) — the published EN/BG function-calling
// eval. A standalone page (the chat app has no router); it fetches the artifact
// data/ai/evals/fc_eval.json (shipped to the GCS data bucket) and renders the
// headline table + methodology + per-model detail. Bilingual via a local toggle,
// matching App.tsx (no i18next in this app).

import { useContext, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { fetchData } from "../tools/dataClient";
import type { Lang } from "../tools/types";

type LangMetrics = {
  toolAcc: number;
  argAcc: number;
  jsonValidRate: number;
  irrelevanceAcc: number | null;
};
type PerCase = {
  id: string;
  expectedTool: string | null;
  en?: { toolOk: boolean; argsOk: boolean; got: string | null };
  bg?: { toolOk: boolean; argsOk: boolean; got: string | null };
};
type ModelResult = {
  id: string;
  label: string;
  runtime: "cloud" | "webllm";
  params: string;
  via?: string;
  note?: string;
  reason?: string;
  status: "measured" | "unavailable" | "missing-capture";
  perLang: { en: LangMetrics; bg: LangMetrics } | null;
  degradation: { toolAcc: number; argAcc: number } | null;
  perCase: PerCase[];
};
type Artifact = {
  generatedAt: string;
  harness: string;
  method: {
    candidateSetK: number;
    caseCount: number;
    toolCount: number;
    promptStrategy: { cloud: string; webllm: string };
    scoring: string;
    candidateSetNote: string;
  };
  tools: { name: string; description: string; params: string[] }[];
  cases: { id: string; en: string; bg: string; expectedTool: string | null }[];
  models: ModelResult[];
};

const pct = (x: number | null | undefined) =>
  x == null ? "—" : `${Math.round(x * 100)}%`;

const runtimeLabel = (r: string, lang: Lang) =>
  r === "webllm"
    ? lang === "bg"
      ? "в браузъра"
      : "in-browser"
    : lang === "bg"
      ? "облак"
      : "cloud";

export const EvalsScreen = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const [lang, setLang] = useState<Lang>("bg");
  const [data, setData] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDark = theme === themeDark;
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);

  useEffect(() => {
    fetchData<Artifact>("/ai/evals/fc_eval.json")
      .then(setData)
      .catch((e) => setError(String(e)));
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
          <a href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 size-4" />
              {t("Към чата", "Back to chat")}
            </Button>
          </a>
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="font-title text-2xl font-semibold text-popover-foreground sm:text-3xl">
          {t(
            "Оценка на инструментно извикване (EN/BG)",
            "Function-calling evaluation (EN/BG)",
          )}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {t(
            "Може ли малък/отворен модел да управлява инструментите на Наясно — и влошава ли се изборът на инструмент, когато въпросът е на български вместо на английски? Всеки модел получава едни и същи задачи на двата езика.",
            "Can a small/open model drive Наясно's tools — and does tool selection degrade when the question is in Bulgarian rather than English? Each model gets the same tasks in both languages.",
          )}
        </p>

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
                      {t("Тип", "Type")}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">EN</th>
                    <th className="px-2 py-2 text-right font-medium">BG</th>
                    <th className="px-2 py-2 text-right font-medium">
                      {t("Аргументи", "Args")}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">JSON</th>
                    <th className="px-2 py-2 text-right font-medium">
                      {t("Влошаване BG", "BG drop")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.id} className="border-b align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-popover-foreground">
                          {m.label}
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
                            {runtimeLabel(m.runtime, lang)}
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
                  "EN/BG = дял на правилно избрания инструмент (вкл. разпознаване кога никой инструмент не е подходящ). Влошаване BG = разлика EN−BG (положително = по-зле на български).",
                  "EN/BG = share of correctly selected tools (incl. recognising when no tool fits). BG drop = EN−BG (positive = worse in Bulgarian).",
                )}
              </p>
            </section>

            {/* ---- takeaway ---- */}
            <section className="mt-8 rounded-lg border bg-muted/40 p-4 text-sm">
              <h2 className="mb-2 font-semibold text-popover-foreground">
                {t("Какво показва това", "What this shows")}
              </h2>
              <p className="text-muted-foreground">
                {t(
                  "При способните модели българският не влошава инструментното извикване — резултатите EN и BG са еднакви. Малък модел без дообучение (FunctionGemma 270M) не е годен за нашите инструменти на нито един език: емитира формата на извикване, но измисля имена на инструменти и поврежда JSON-а. И на двата езика се проваля еднакво — тоест ограничението е в капацитета, не в езика. Пътят напред е дообучение върху нашите инструменти + ограничено декодиране (XGrammar) + извличане на малък набор инструменти.",
                  "For capable models, Bulgarian does not degrade function-calling — EN and BG are identical. A small untuned model (FunctionGemma 270M) is not usable on our tools in either language: it emits the call format but invents tool names and malforms the JSON. It fails equally in both languages — the limit is capacity, not language. The path forward is fine-tuning on our tools + constrained decoding (XGrammar) + retrieving a small tool set.",
                )}
              </p>
            </section>

            {/* ---- per-model detail ---- */}
            <section className="mt-8">
              <h2 className="mb-3 font-semibold text-popover-foreground">
                {t("Детайли по задача", "Per-case detail")}
              </h2>
              {data.models
                .filter((m) => m.perLang)
                .map((m) => (
                  <details key={m.id} className="mb-2 rounded-md border">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                      {m.label}
                    </summary>
                    <div className="overflow-x-auto px-3 pb-3">
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
                            const mark = (r?: {
                              toolOk: boolean;
                              argsOk: boolean;
                            }) =>
                              !r
                                ? "—"
                                : r.toolOk
                                  ? r.argsOk
                                    ? "✓"
                                    : "≈"
                                  : "✗";
                            return (
                              <tr key={c.id} className="border-b last:border-0">
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
                          "✓ инструмент+аргументи · ≈ инструмент без аргументи · ✗ грешен/липсва",
                          "✓ tool+args · ≈ tool only · ✗ wrong/missing",
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
                    `${data.method.caseCount} двойки въпроси (EN+BG), всеки тестван срещу ${data.method.candidateSetK} инструмента-кандидати от каталог от ${data.method.toolCount}.`,
                    `${data.method.caseCount} paired questions (EN+BG), each tested against ${data.method.candidateSetK} candidate tools from a catalogue of ${data.method.toolCount}.`,
                  )}
                </li>
                <li>{data.method.candidateSetNote}</li>
                <li>
                  {t("Модели в облака: ", "Cloud models: ")}
                  {data.method.promptStrategy.cloud}
                  {t("; в браузъра: ", "; in-browser: ")}
                  {data.method.promptStrategy.webllm}
                </li>
                <li>
                  {t("Оценяване: ", "Scoring: ")}
                  {data.method.scoring}
                </li>
                <li>
                  {t("Генерирано на ", "Generated ")}
                  {generated} · {data.harness}
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
                        {c.expectedTool ?? t("(никой инструмент)", "(no tool)")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </>
        )}
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
