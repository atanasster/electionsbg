// /procurement/project — the "project file" (проектно досие) report. Reads a
// URL-encoded ProjectFileSpec from ?q=, resolves it (useProjectFile → the УНП
// spine over /api/db/table), and renders a document-style report: the honesty
// totals block + "как е възложено" method strip, a УНП-grouped vertical timeline
// with per-contract method badges, and a contractors table.
// See docs/plans/procurement-project-lifecycle-v1.md §4.2/§4.6.

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { ProcurementBreadcrumb } from "@/screens/components/procurement/ProcurementBreadcrumb";
import { formatEurCompact } from "@/lib/currency";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  useProjectFile,
  parseProjectSpec,
  type ProjectFileSpec,
  type ProjectTenderRow,
} from "@/data/procurement/useProjectFile";
import {
  classifyMethod,
  isSingleBid,
  annexDelta,
  roleKeyOf,
  roleLabel,
} from "@/data/procurement/projectFile";
import { saveProject, projectHref } from "@/data/procurement/projectStore";

// Uncurated starter seeds — a researcher must not face a blank box (§0f.1).
// Publicly-discussed 2023–2026 Bulgarian procurement topics, spread across
// domains. Only АПИ (000695089) and МО (000695324) EIKs are confirmed; the
// others are search-only (no buyer scope). Labels are BG proper nouns; category
// + hint are bilingual-inline.
interface Starter {
  category: { bg: string; en: string };
  label: string;
  hint: { bg: string; en: string };
  spec: ProjectFileSpec;
}
const API_EIK = ["000695089"]; // Агенция „Пътна инфраструктура"
const MO_EIK = ["000695324"]; // Министерство на отбраната

const STARTERS: Starter[] = [
  {
    category: { bg: "Пътища", en: "Roads" },
    label: "Софийски околовръстен — Западна дъга",
    hint: {
      bg: "Последните км от околовръстното: обявено срещу договорено",
      en: "The ring road's last km: announced vs contracted",
    },
    spec: {
      title: { bg: "Софийски околовръстен — Западна дъга" },
      search: [
        { terms: "западна дъга", distinctive: ["дъга"], buyerEik: API_EIK },
      ],
      benchmark: {
        unit: "eur_per_km",
        impliedLow: 116000000,
        impliedHigh: 400000000,
      },
    },
  },
  {
    category: { bg: "Пътища", en: "Roads" },
    label: "Магистрала „Хемус“",
    hint: {
      bg: "2+ млрд. лв на „Автомагистрали“ без конкурс",
      en: "€1bn+ to state „Avtomagistrali“ without a tender",
    },
    spec: {
      title: { bg: "Магистрала „Хемус“" },
      search: [{ terms: "хемус", distinctive: ["хемус"], buyerEik: API_EIK }],
    },
  },
  {
    category: { bg: "Пътища", en: "Roads" },
    label: "АМ „Струма“ (Кресна)",
    hint: {
      bg: "Спорният лот 3.2 през Кресненското дефиле",
      en: "The contested lot 3.2 through the Kresna gorge",
    },
    spec: {
      title: { bg: "АМ „Струма“ — Кресненско дефиле" },
      search: [{ terms: "струма", distinctive: ["струма"], buyerEik: API_EIK }],
    },
  },
  {
    category: { bg: "Транспорт", en: "Transport" },
    label: "Софийско метро",
    hint: {
      bg: "Разширението на третия лъч",
      en: "The third-line extension",
    },
    spec: {
      title: { bg: "Софийско метро" },
      search: [{ terms: "метро", distinctive: ["метро"] }],
    },
  },
  {
    category: { bg: "Железници", en: "Rail" },
    label: "жп „Елин Пелин – Костенец“",
    hint: {
      bg: "Най-голямата жп поръчка по ОПТТИ",
      en: "The biggest rail job under OPTTI",
    },
    spec: {
      title: { bg: "жп „Елин Пелин – Костенец“" },
      search: [{ terms: "костенец", distinctive: ["костенец"] }],
    },
  },
  {
    category: { bg: "Енергетика", en: "Energy" },
    label: "Газов интерконектор с Гърция",
    hint: {
      bg: "Тръбата IGB и договорът с „Боташ“",
      en: "The IGB pipeline and the Botas deal",
    },
    spec: {
      title: { bg: "Газов интерконектор с Гърция" },
      search: [{ terms: "интерконектор", distinctive: ["интерконектор"] }],
    },
  },
  {
    category: { bg: "Отбрана", en: "Defense" },
    label: "Авиобаза „Граф Игнатиево“ (F-16)",
    hint: {
      bg: "Инфраструктурата за новите изтребители",
      en: "The base infrastructure for the new jets",
    },
    spec: {
      title: { bg: "Авиобаза „Граф Игнатиево“" },
      search: [
        {
          terms: "граф игнатиево",
          distinctive: ["игнатиево"],
          buyerEik: MO_EIK,
        },
      ],
    },
  },
  {
    category: { bg: "Еврофондове", en: "EU funds" },
    label: "Саниране на сгради",
    hint: {
      bg: "Националната програма за енергийна ефективност",
      en: "The national energy-efficiency program",
    },
    spec: {
      title: { bg: "Саниране на жилищни сгради" },
      search: [{ terms: "саниране", distinctive: ["саниране"] }],
    },
  },
  {
    category: { bg: "Води", en: "Water" },
    label: "Воден цикъл (ВиК)",
    hint: {
      bg: "ВиК проектите по ОПОС",
      en: "Water-cycle projects under OPOS",
    },
    spec: {
      title: { bg: "Воден цикъл" },
      search: [{ terms: "воден цикъл", distinctive: ["цикъл"] }],
    },
  },
  {
    category: { bg: "Избори", en: "Elections" },
    label: "Машинно гласуване (СУЕМГ)",
    hint: {
      bg: "Договорите със „Сиела Норма“",
      en: "The contracts with „Ciela Norma“",
    },
    spec: {
      title: { bg: "Машинно гласуване (СУЕМГ)" },
      search: [{ terms: "суемг", distinctive: ["суемг"] }],
    },
  },
];

const methodLabel = (
  method: string | null | undefined,
  bg: boolean,
): string => {
  const cls = classifyMethod(method);
  if (cls === "nonCompetitive")
    return bg ? "без открита процедура" : "no open tender";
  if (cls === "unspecified") return bg ? "неуточнен метод" : "method n/a";
  return bg ? "открита" : "open";
};

// Per-method pill colours — the same good/bad/unknown semantics as the "как е
// възложено" strip, so открита (competitive) no longer reads identical to
// неуточнен (unknown): green / coral / grey.
const METHOD_PILL: Record<
  ReturnType<typeof classifyMethod>,
  { bg: string; color: string }
> = {
  competitive: { bg: "#E1F5EE", color: "#0F6E56" }, // green — open procedure
  nonCompetitive: { bg: "#FAECE7", color: "#712B13" }, // coral — no open tender
  unspecified: { bg: "#F1EFE8", color: "#5F5E5A" }, // grey — method not stated
};

/** КЗК-appeal badge. `has_appeal`/`appeal_upheld` are PROCEDURE-level flags, so
 *  render this once at the procedure node (not per sibling-lot contract). */
const AppealBadge = ({ upheld, bg }: { upheld?: boolean; bg: boolean }) => (
  <span
    className="rounded-full px-1.5 py-0.5 text-[11px]"
    style={
      upheld
        ? { background: "#FAECE7", color: "#712B13" }
        : { background: "#FAEEDA", color: "#854F0B" }
    }
    title={bg ? "жалба пред КЗК" : "KZK appeal"}
  >
    {bg ? "обжалване" : "appeal"}
  </span>
);

export const ProjectFileScreen = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const [params, setParams] = useSearchParams();
  const spec = useMemo(() => parseProjectSpec(params.get("q")), [params]);
  const { data, isLoading, error } = useProjectFile(spec);
  const [editMode, setEditMode] = useState(false);

  // Spec mutations write straight to the ?q= param (so Save/Copy capture the edit
  // and the timeline re-resolves live — the §4.3b full-page builder), PRESERVING
  // sibling params (?elections=, ?pscope=). `mutateSpec` uses the functional
  // setParams form, re-reading the freshest spec from the URL so rapid edits
  // (e.g. several × clicks) don't clobber each other via a stale closure.
  const setQ = (next: ProjectFileSpec) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("q", JSON.stringify(next));
      return p;
    });

  const mutateSpec = (fn: (cur: ProjectFileSpec) => ProjectFileSpec) =>
    setParams(
      (prev) => {
        const cur = parseProjectSpec(prev.get("q"));
        if (!cur) return prev;
        const p = new URLSearchParams(prev);
        p.set("q", JSON.stringify(fn(cur)));
        return p;
      },
      { replace: true },
    );

  const buildFromTerms = (terms: string) => {
    const t = terms.trim();
    if (t) setQ({ title: { bg: t }, search: [{ terms: t }] });
  };

  const refineTerms = (terms: string) => {
    const t = terms.trim();
    if (!t) return;
    if (!spec) return buildFromTerms(t);
    // Only the first thread's terms are editable here — keep the rest intact.
    mutateSpec((cur) => ({
      ...cur,
      search: [{ ...cur.search[0], terms: t }, ...cur.search.slice(1)],
    }));
  };

  const excludeMember = (kind: "contract" | "tender", id: string) =>
    mutateSpec((cur) => {
      const ex = cur.excludes ?? {};
      return kind === "contract"
        ? {
            ...cur,
            excludes: { ...ex, contractKeys: [...(ex.contractKeys ?? []), id] },
          }
        : {
            ...cur,
            excludes: { ...ex, tenderUnps: [...(ex.tenderUnps ?? []), id] },
          };
    });

  const title =
    (bg ? spec?.title?.bg : spec?.title?.en) ??
    spec?.title?.bg ??
    (bg ? "Проектно досие" : "Project file");

  // Group members into procedure threads for the timeline.
  const threads = useMemo(() => {
    const empty = { rows: [], noUnp: [] } as {
      rows: Array<{
        unp: string;
        tender?: ProjectTenderRow;
        contracts: ProcurementContract[];
      }>;
      noUnp: ProcurementContract[];
    };
    if (!data) return empty;
    const byUnp = new Map<string, ProcurementContract[]>();
    const noUnp: ProcurementContract[] = [];
    for (const c of data.contracts) {
      if (c.unp) {
        const arr = byUnp.get(c.unp) ?? [];
        arr.push(c);
        byUnp.set(c.unp, arr);
      } else {
        noUnp.push(c);
      }
    }
    const tenderByUnp = new Map<string, ProjectTenderRow>(
      data.tenders.map((t) => [t.unp, t]),
    );
    const unps = new Set<string>([...byUnp.keys(), ...tenderByUnp.keys()]);
    const rows = [...unps].map((unp) => ({
      unp,
      tender: tenderByUnp.get(unp),
      contracts: byUnp.get(unp) ?? [],
    }));
    const dateOf = (r: (typeof rows)[number]): string =>
      r.tender?.publicationDate ?? r.contracts[0]?.date ?? "9999";
    rows.sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    return { rows, noUnp };
  }, [data]);

  // Money by role — curated `nature` first, CPV-division fallback (§4.2.4).
  const byRole = useMemo(() => {
    if (!data) return [] as Array<{ key: string; eur: number }>;
    const map = new Map<string, number>();
    for (const c of data.contracts) {
      const key = roleKeyOf(
        spec?.nature?.[c.key] ?? (c.unp ? spec?.nature?.[c.unp] : undefined),
        c.cpv,
      );
      map.set(key, (map.get(key) ?? 0) + (c.amountEur ?? 0));
    }
    return [...map.entries()]
      .map(([key, eur]) => ({ key, eur }))
      .sort((a, b) => b.eur - a.eur);
  }, [data, spec]);

  const money = (n: number | null | undefined) =>
    formatEurCompact(n, loc) || "—";

  const body = () => {
    if (!spec) {
      return (
        <div className="mt-4">
          <div className="max-w-2xl">
            <p className="text-muted-foreground mb-3">
              {bg
                ? "Търси предмет на договор или процедура, за да сглобиш досие на един проект — или започни от публично обсъждана тема."
                : "Search a contract or tender subject to assemble a project's file — or start from a publicly-debated topic."}
            </p>
            <BuildForm
              onSubmit={buildFromTerms}
              bg={bg}
              cta={bg ? "Създай досие" : "Create file"}
            />
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mt-6 mb-2">
            {bg ? "Или започни от тема" : "Or start from a topic"}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {STARTERS.map((s) => (
              <Link
                key={s.label}
                to={projectHref(s.spec)}
                className="flex min-w-0 flex-col gap-1 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-muted"
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {bg ? s.category.bg : s.category.en}
                </span>
                <span className="text-sm font-medium leading-snug">
                  {s.label}
                </span>
                <span className="text-xs text-muted-foreground leading-snug">
                  {bg ? s.hint.bg : s.hint.en}
                </span>
              </Link>
            ))}
          </div>
          <div className="mt-6">
            <Link to="/procurement/projects" className="text-sm text-primary">
              {bg ? "Моите досиета →" : "My project files →"}
            </Link>
          </div>
        </div>
      );
    }
    if (isLoading)
      return (
        <p className="text-muted-foreground">
          {bg ? "Зареждане…" : "Loading…"}
        </p>
      );
    if (error || !data)
      return (
        <p className="text-destructive">
          {bg ? "Грешка при зареждане." : "Failed to load."}
        </p>
      );

    const { fold } = data;
    const mix = fold.methodMix;
    const mixTotal =
      mix.competitive + mix.nonCompetitive + mix.unspecified || 1;
    const pct = (n: number) => `${Math.round((n / mixTotal) * 100)}%`;
    const announced = spec.announcedBudget?.amountEur;
    const thesis = bg ? spec.thesis?.bg : spec.thesis?.en;

    return (
      <>
        {/* key on the ?q= param so Saved/Copied feedback resets per project */}
        <Toolbar
          key={params.get("q") ?? ""}
          spec={spec}
          bg={bg}
          editMode={editMode}
          onToggleEdit={() => setEditMode((e) => !e)}
        />
        {editMode && (
          <div className="no-print rounded-md border border-dashed p-3 mb-3">
            <BuildForm
              initial={spec.search[0]?.terms}
              onSubmit={refineTerms}
              bg={bg}
              cta={bg ? "Обнови търсенето" : "Update search"}
            />
            <div className="text-xs text-muted-foreground">
              {bg
                ? "Смени думите за търсене, или махни отделен ред с ×."
                : "Change the search terms, or remove a row with ×."}
            </div>
          </div>
        )}
        {data.truncated && (
          <div className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 my-3 text-amber-700 dark:text-amber-400">
            {bg
              ? "Търсенето е широко — показва се само част от резултатите. Стесни думите или добави възложител."
              : "The search is broad — only a slice is shown. Narrow the terms or add a buyer."}
          </div>
        )}
        {/* Honesty block — big totals */}
        <div className="flex flex-wrap gap-x-10 gap-y-5 border-y py-5 my-6">
          <Figure
            label={bg ? "Договорено (ЗОП)" : "Contracted"}
            value={money(fold.totalContractedEur)}
            emphasis
          />
          {announced != null && (
            <Figure
              label={bg ? "Обявено" : "Announced"}
              value={money(announced)}
              muted
            />
          )}
          {spec.benchmark && (
            <Figure
              label={bg ? "Еталон" : "Benchmark"}
              value={
                spec.benchmark.impliedLow != null &&
                spec.benchmark.impliedHigh != null
                  ? `${money(spec.benchmark.impliedLow)}–${money(spec.benchmark.impliedHigh)}`
                  : "—"
              }
              muted
            />
          )}
        </div>

        {/* Announced vs contracted vs benchmark — one scale + the gap sentence.
            Only when there's a real comparator (announced, or a benchmark range);
            договорено alone is nothing to compare against. */}
        {(announced != null ||
          (spec.benchmark?.impliedLow != null &&
            spec.benchmark?.impliedHigh != null)) &&
          (() => {
            const contracted = fold.totalContractedEur;
            const bLow = spec.benchmark?.impliedLow;
            const bHigh = spec.benchmark?.impliedHigh;
            const max = Math.max(announced ?? 0, bHigh ?? 0, contracted, 1);
            const w = (v: number) => `${Math.round((v / max) * 100)}%`;
            const gapPct =
              announced != null && announced > 0
                ? Math.round((contracted / announced) * 100)
                : null;
            return (
              <div className="my-6 max-w-3xl">
                <div className="flex flex-col gap-2">
                  {announced != null && (
                    <ComparisonBar
                      label={bg ? "обявено" : "announced"}
                      width={w(announced)}
                      color="#CECBF6"
                    />
                  )}
                  {bLow != null && bHigh != null && (
                    <ComparisonBar
                      label={bg ? "еталон" : "benchmark"}
                      left={w(bLow)}
                      width={`${Math.max(2, Math.round(((bHigh - bLow) / max) * 100))}%`}
                      color="#FAC775"
                    />
                  )}
                  <ComparisonBar
                    label={bg ? "договорено" : "contracted"}
                    width={w(contracted)}
                    color="#1D9E75"
                  />
                </div>
                {gapPct != null && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {bg
                      ? `От обявените ${money(announced)} са договорени ${gapPct}%.`
                      : `${gapPct}% of the announced ${money(announced)} is contracted.`}
                  </p>
                )}
              </div>
            );
          })()}

        {/* "Как е възложено" method strip */}
        <div className="my-6">
          <div className="text-sm text-muted-foreground mb-2">
            {bg ? "Как е възложено" : "How it was awarded"}
          </div>
          <div className="flex h-4 rounded overflow-hidden bg-muted">
            {mix.competitive > 0 && (
              <div
                style={{ width: pct(mix.competitive), background: "#1D9E75" }}
                title={`${bg ? "открита" : "open"} ${pct(mix.competitive)}`}
              />
            )}
            {mix.nonCompetitive > 0 && (
              <div
                style={{
                  width: pct(mix.nonCompetitive),
                  background: "#D85A30",
                }}
                title={`${bg ? "без открита процедура" : "no open tender"} ${pct(mix.nonCompetitive)}`}
              />
            )}
            {mix.unspecified > 0 && (
              <div
                style={{ width: pct(mix.unspecified), background: "#B4B2A9" }}
                title={`${bg ? "неуточнен" : "unspecified"} ${pct(mix.unspecified)}`}
              />
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {bg ? "открита" : "open"} {pct(mix.competitive)} ·{" "}
            {bg ? "без открита процедура" : "no open tender"}{" "}
            {pct(mix.nonCompetitive)}
            {mix.unspecified > 0 &&
              ` · ${bg ? "неуточнен" : "unspecified"} ${pct(mix.unspecified)}`}
          </div>
        </div>

        {/* Money by role (§4.2.4) — nature-first, CPV-division fallback */}
        {byRole.length > 1 && (
          <div className="my-6 max-w-3xl">
            <div className="text-sm text-muted-foreground mb-2">
              {bg ? "Разпределение по вид" : "By role"}
            </div>
            <div className="flex flex-col gap-1.5">
              {byRole.map(({ key, eur }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-xs">
                    {roleLabel(key, bg)}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="absolute h-full rounded"
                      style={{
                        width: `${Math.round((eur / (byRole[0].eur || 1)) * 100)}%`,
                        background: "#8a7734",
                      }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                    {money(eur)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {thesis && (
          <blockquote className="border-l-2 pl-4 my-6 text-lg font-voice">
            {thesis}
          </blockquote>
        )}

        {/* Timeline */}
        <h2 className="text-sm font-medium text-muted-foreground mt-8 mb-3">
          {bg ? "Хронология" : "Timeline"}
        </h2>
        <div className="border-l-2 ml-1 pl-5 flex flex-col gap-5">
          {threads.rows.map((r) => (
            <div key={r.unp} className="relative">
              <span
                className="absolute -left-[26px] top-1 w-3.5 h-3.5 rounded-full border-2"
                style={{
                  borderColor: r.tender?.isCancelled ? "#B4B2A9" : "#185FA5",
                  background: "var(--background, #fff)",
                }}
              />
              <div className="text-xs text-muted-foreground">
                {r.tender?.publicationDate ?? r.contracts[0]?.date} ·{" "}
                {bg ? "процедура" : "procedure"}{" "}
                {r.tender?.isCancelled && (
                  <span className="text-muted-foreground">
                    ({bg ? "отменена" : "cancelled"})
                  </span>
                )}
              </div>
              <div className="text-sm flex items-start gap-2">
                <span
                  className={`flex-1 ${r.tender?.isCancelled ? "line-through text-muted-foreground" : ""}`}
                >
                  {r.tender?.subject ?? r.contracts[0]?.title}
                </span>
                {r.contracts.some((c) => c.hasAppeal) && (
                  <AppealBadge
                    upheld={r.contracts.some((c) => c.appealUpheld)}
                    bg={bg}
                  />
                )}
                {editMode && (
                  <button
                    className="no-print text-xs text-muted-foreground hover:text-destructive"
                    title={bg ? "махни процедурата" : "remove procedure"}
                    onClick={() => excludeMember("tender", r.unp)}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-2 pl-3">
                {r.contracts.map((c) => (
                  <ContractRow
                    key={c.key}
                    c={c}
                    bg={bg}
                    money={money}
                    showAppeal={false}
                    onRemove={
                      editMode
                        ? () => excludeMember("contract", c.key)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {threads.noUnp.map((c) => (
            <div key={c.key} className="relative">
              <span
                className="absolute -left-[24px] top-1.5 w-2.5 h-2.5 rounded-full"
                style={{ background: "#1D9E75" }}
              />
              <ContractRow
                c={c}
                bg={bg}
                money={money}
                onRemove={
                  editMode ? () => excludeMember("contract", c.key) : undefined
                }
              />
            </div>
          ))}
          {spec.gap && (
            <div className="relative">
              <span
                className="absolute -left-[27px] top-1 h-4 w-4 rounded-full border-2 border-dashed"
                style={{
                  borderColor: "#B4B2A9",
                  background: "var(--background, #fff)",
                }}
              />
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {bg ? "Липсваща стъпка" : "Missing stage"}
                </span>{" "}
                —{" "}
                {(bg ? spec.gap.note?.bg : spec.gap.note?.en) ??
                  spec.gap.note?.bg ??
                  spec.gap.note?.en ??
                  (bg
                    ? "очаквана процедура, която все още липсва"
                    : "an expected stage still missing")}
                {spec.gap.authority
                  ? ` (${bg ? "по" : "by"} ${spec.gap.authority})`
                  : ""}
                {/^https?:\/\//i.test(spec.gap.sourceUrl ?? "") && (
                  <>
                    {" · "}
                    <a
                      href={spec.gap.sourceUrl}
                      className="text-primary underline"
                      rel="nofollow noopener"
                      target="_blank"
                    >
                      {bg ? "източник" : "source"}
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      <Title
        description={
          bg
            ? "Проследи един публичен проект през обществените поръчки."
            : "Track one public project across procurement."
        }
      >
        {title}
      </Title>
      <ProcurementBreadcrumb
        current={spec ? title : bg ? "Проектни досиета" : "Project files"}
        className="my-3"
      />
      {body()}
    </>
  );
};

const Toolbar = ({
  spec,
  bg,
  editMode,
  onToggleEdit,
}: {
  spec: ProjectFileSpec;
  bg: boolean;
  editMode: boolean;
  onToggleEdit: () => void;
}) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const btn = "no-print rounded-md border px-3 py-1.5 text-sm hover:bg-muted";
  return (
    <div className="no-print flex flex-wrap gap-2 mb-2">
      <button className={btn} onClick={onToggleEdit} aria-pressed={editMode}>
        {editMode ? (bg ? "Готово" : "Done") : bg ? "Редактирай" : "Edit"}
      </button>
      <button
        className={btn}
        onClick={() => {
          saveProject(spec);
          setSaved(true);
        }}
      >
        {saved
          ? bg
            ? "Запазено ✓"
            : "Saved ✓"
          : bg
            ? "Запази досие"
            : "Save file"}
      </button>
      <button
        className={btn}
        onClick={() => {
          // Only claim success once the write actually resolves; on failure the
          // URL is still in the address bar, so leave the label unchanged.
          navigator.clipboard
            ?.writeText(window.location.href)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied
          ? bg
            ? "Копирано ✓"
            : "Copied ✓"
          : bg
            ? "Копирай връзка"
            : "Copy link"}
      </button>
      <button className={btn} onClick={() => window.print()}>
        {bg ? "Изтегли PDF" : "Download PDF"}
      </button>
      <Link to="/procurement/project" className={btn}>
        {bg ? "Ново досие" : "New file"}
      </Link>
      <Link to="/procurement/projects" className={btn}>
        {bg ? "Моите досиета" : "My files"}
      </Link>
    </div>
  );
};

const ComparisonBar = ({
  label,
  width,
  left,
  color,
}: {
  label: string;
  width: string;
  left?: string;
  color: string;
}) => (
  <div className="flex items-center gap-3">
    <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
    <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-muted">
      <div
        className="absolute top-0 h-full rounded"
        style={{ left: left ?? 0, width, background: color }}
      />
    </div>
  </div>
);

const Figure = ({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) => (
  <div>
    <div className="text-xs text-muted-foreground mb-1">{label}</div>
    <div
      className={`text-3xl leading-none font-medium ${muted ? "text-muted-foreground" : ""} ${emphasis ? "" : ""}`}
    >
      {value}
    </div>
  </div>
);

const ContractRow = ({
  c,
  bg,
  money,
  onRemove,
  showAppeal = true,
}: {
  c: ProcurementContract;
  bg: boolean;
  money: (n: number | null | undefined) => string;
  onRemove?: () => void;
  /** false when the appeal badge is shown once at the procedure node above. */
  showAppeal?: boolean;
}) => {
  const pill = METHOD_PILL[classifyMethod(c.procurementMethod)];
  const delta = annexDelta(c.signingAmountEur, c.amountEur);
  const hasAnnex = delta != null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: "#1D9E75" }}
      />
      {c.contractorEik ? (
        <Link
          to={`/company/${c.contractorEik}`}
          className="text-sm text-primary"
        >
          {c.contractorName}
        </Link>
      ) : (
        <span className="text-sm">{c.contractorName}</span>
      )}
      <span
        className="text-[11px] px-1.5 py-0.5 rounded-full"
        style={{ background: pill.bg, color: pill.color }}
      >
        {methodLabel(c.procurementMethod, bg)}
      </span>
      {isSingleBid(c.numberOfTenderers) && (
        <span
          className="text-[11px] px-1.5 py-0.5 rounded-full"
          style={{ background: "#FAECE7", color: "#712B13" }}
        >
          {bg ? "единствен участник" : "single bidder"}
        </span>
      )}
      {showAppeal && c.hasAppeal && (
        <AppealBadge upheld={c.appealUpheld} bg={bg} />
      )}
      <span className="ml-auto flex items-baseline gap-1.5">
        <span className="text-sm font-medium">{money(c.amountEur)}</span>
        {hasAnnex && (
          <span
            className="text-[11px]"
            style={{ color: delta! > 0 ? "#993C1D" : "#5F5E5A" }}
            title={
              bg ? "анекс промени стойността" : "an annex changed the value"
            }
          >
            {delta! > 0 ? "↑" : "↓"}
            {money(Math.abs(delta!))}
          </span>
        )}
      </span>
      {onRemove && (
        <button
          className="no-print text-xs text-muted-foreground hover:text-destructive"
          title={bg ? "махни договора" : "remove contract"}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  );
};

const BuildForm = ({
  initial,
  onSubmit,
  bg,
  cta,
}: {
  initial?: string;
  onSubmit: (terms: string) => void;
  bg: boolean;
  cta: string;
}) => {
  const [terms, setTerms] = useState(initial ?? "");
  return (
    <form
      className="no-print flex gap-2 my-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(terms);
      }}
    >
      <input
        className="flex-1 rounded-md border px-3 py-1.5 text-sm bg-background"
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        placeholder={
          bg
            ? "напр. западна дъга, ремонт улици Пловдив…"
            : "e.g. western arc, street repair Plovdiv…"
        }
      />
      <button
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        type="submit"
      >
        {cta}
      </button>
    </form>
  );
};
