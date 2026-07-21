// /procurement/project — the "project file" (проектно досие) report. Reads a
// URL-encoded ProjectFileSpec from ?q=, resolves it (useProjectFile → the УНП
// spine over /api/db/table), and renders a document-style report: the honesty
// totals block + "как е възложено" method strip, a УНП-grouped vertical timeline
// with per-contract method badges, and a contractors table.
// See docs/plans/procurement-project-lifecycle-v1.md §4.2/§4.6.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { ProcurementBreadcrumb } from "@/screens/components/procurement/ProcurementBreadcrumb";
import { formatEurCompact } from "@/lib/currency";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  useProjectFile,
  useBroaderMatches,
  useCuratedProjectSpec,
  useCuratedProjectIndex,
  parseProjectSpec,
  type ProjectFileSpec,
  type ProjectTenderRow,
  type Claim,
  type FundProjectMember,
} from "@/data/procurement/useProjectFile";
import {
  classifyMethod,
  isSingleBid,
  annexDelta,
  roleKeyOf,
  roleLabel,
  foldByContractor,
  foldByPeriod,
  matchInhouseContractors,
  selectBroaderCandidates,
  siblingLotPolicy,
  withThreadTerms,
  withAddedThread,
  withoutThread,
  type PeriodAgg,
} from "@/data/procurement/projectFile";
import { saveProject, projectHref } from "@/data/procurement/projectStore";

// Only render a curated link when it is an http(s) URL — an untrusted ?q= could
// otherwise carry a javascript:/data: scheme.
const isHttpUrl = (u?: string): boolean => /^https?:\/\//i.test(u ?? "");

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
    category: { bg: "Здравеопазване", en: "Health" },
    label: "Национална детска болница",
    hint: {
      bg: "Най-проточилият се болничен строеж",
      en: "The most drawn-out hospital build",
    },
    spec: {
      title: { bg: "Национална детска болница" },
      search: [{ terms: "детска болница", distinctive: ["детска"] }],
    },
  },
  {
    category: { bg: "Еврофондове", en: "EU funds" },
    label: "Воден цикъл по ОПОС (ИСУН)",
    hint: {
      bg: "Финансиран от ЕС ВиК проект: договорено срещу изплатено",
      en: "An EU-funded water project: contracted vs paid",
    },
    // Carries a real ИСУН fund member so the «Европейско финансиране» block
    // (§4.2.3b) is exercised — договорено €105M / изплатено a fraction.
    spec: {
      title: { bg: "Воден цикъл по ОПОС (ИСУН)" },
      search: [{ terms: "вик инфраструктура", distinctive: ["вик"] }],
      includes: { fundContractNumbers: ["BG16FFPR002-1.002-0007"] },
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
  // A curated flagship file is addressed by /procurement/project/:slug and loads
  // a committed spec (§4.4 / Phase 3); the DIY builder uses ?q=. Curated files are
  // read-only + indexable.
  const { slug } = useParams<{ slug?: string }>();
  const curated = useCuratedProjectSpec(slug);
  const curatedMode = !!slug;
  const curatedIndex = useCuratedProjectIndex();
  const urlSpec = useMemo(() => parseProjectSpec(params.get("q")), [params]);
  const spec = curatedMode ? (curated.data ?? null) : urlSpec;
  const { data, isLoading, error } = useProjectFile(spec);
  const [editModeState, setEditModeState] = useState(false);
  const editMode = curatedMode ? false : editModeState; // no editing a committed file

  // robots: noindex for a resolved DIY/URL-built file (§4.4 — a user's search must
  // not read as a Наясно editorial finding) OR a curated slug that failed to
  // resolve (a soft-404 must not be indexed). A RESOLVED curated /project/:slug is
  // editorial + prerendered → stays indexable. The empty on-ramp stays indexable.
  // Flip the static robots meta (index.html ships "index, follow") in place,
  // restoring on leave. Best-effort for JS-executing crawlers.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) return;
    const shouldNoindex = curatedMode
      ? !curated.isLoading && !spec // curated slug that didn't resolve (soft-404)
      : !!spec; // a resolved DIY file
    if (!shouldNoindex) return;
    const prev = meta.content;
    meta.content = "noindex, follow";
    return () => {
      meta.content = prev;
    };
  }, [spec, curatedMode, curated.isLoading]);

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

  // Multi-thread search editing (§0f.2): each thread is a unioned OR-branch of
  // the search. The pure transforms (in projectFile.ts) keep a thread's non-terms
  // fields, ignore blank commits, and never drop the last thread.
  const setThreadTerms = (i: number, terms: string) =>
    mutateSpec((cur) => ({
      ...cur,
      search: withThreadTerms(cur.search, i, terms),
    }));

  const addThread = (terms: string) => {
    if (!terms.trim()) return; // skip the redundant no-op URL write
    mutateSpec((cur) => ({
      ...cur,
      search: withAddedThread(cur.search, terms),
    }));
  };

  const removeThread = (i: number) =>
    mutateSpec((cur) => ({ ...cur, search: withoutThread(cur.search, i) }));

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

  const includeMember = (key: string) =>
    mutateSpec((cur) => {
      const inc = cur.includes ?? {};
      const keys = inc.contractKeys ?? [];
      if (keys.includes(key)) return cur; // no duplicate keys in the spec/URL
      return { ...cur, includes: { ...inc, contractKeys: [...keys, key] } };
    });

  // Fund members are manual-add only (includes.fundContractNumbers) — removing
  // one just drops its contract_number (§4.2.3b).
  const removeFund = (contractNumber: string) =>
    mutateSpec((cur) => {
      const inc = cur.includes ?? {};
      return {
        ...cur,
        includes: {
          ...inc,
          fundContractNumbers: (inc.fundContractNumbers ?? []).filter(
            (n) => n !== contractNumber,
          ),
        },
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
      if ((c.tag ?? "contract") !== "contract") continue;
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

  // Contractors — aggregate the member contracts by contractor (§4.2.5).
  const byContractor = useMemo(
    () => (data ? foldByContractor(data.contracts) : []),
    [data],
  );

  // Subcontractor blind spot (§0g.2): which in-house state companies among the
  // members' contractors are where the ЦАИС money trail stops (their onward
  // awards aren't published). Empty unless the file declares inhouseAwarderEiks.
  const inhouseHit = useMemo(
    () =>
      data
        ? matchInhouseContractors(
            data.contracts,
            spec?.inhouseAwarderEiks ?? [],
          )
        : [],
    [data, spec],
  );

  // Recurring-project rollup (§4.2.2b) — only for a file that declares recurrence.
  const byPeriod = useMemo(
    () => (data && spec?.recurrence ? foldByPeriod(data.contracts) : []),
    [data, spec],
  );

  // Broader matches (§0f.3) — a looser (unscoped) search, run only in edit mode;
  // candidates = matches that aren't already members and aren't excluded.
  const { data: broader } = useBroaderMatches(spec, editMode);
  const candidates = useMemo(() => {
    if (!broader || !data) return [];
    return selectBroaderCandidates(
      broader,
      data.contracts.map((c) => c.key),
      spec?.excludes?.contractKeys ?? [],
      spec?.includes?.contractKeys ?? [],
    );
  }, [broader, data, spec]);

  const money = (n: number | null | undefined) =>
    formatEurCompact(n, loc) || "—";

  const body = () => {
    // Curated /project/:slug states: loading the committed file, or not found.
    if (curatedMode && curated.isLoading)
      return (
        <p className="text-muted-foreground">
          {bg ? "Зареждане…" : "Loading…"}
        </p>
      );
    if (curatedMode && !spec)
      return (
        <p className="text-muted-foreground">
          {bg ? "Досието не е намерено." : "Project file not found."}
        </p>
      );
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
          {(curatedIndex.data?.length ?? 0) > 0 && (
            <div className="mt-8">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {bg ? "Досиета на Наясно" : "Наясно files"}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {curatedIndex.data!.map((f) => (
                  <Link
                    key={f.slug}
                    to={`/procurement/project/${f.slug}`}
                    className="flex min-w-0 flex-col gap-1 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-muted"
                  >
                    <span className="text-sm font-medium leading-snug">
                      {bg
                        ? (f.title.bg ?? f.title.en)
                        : (f.title.en ?? f.title.bg)}
                    </span>
                    {f.summary && (
                      <span className="text-xs text-muted-foreground leading-snug">
                        {bg
                          ? (f.summary.bg ?? f.summary.en)
                          : (f.summary.en ?? f.summary.bg)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
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
    // Advance-vs-progress (§0g.3) — curated. The figure is the explicit amount,
    // else pctDeclared applied to the contracted total; the progress note is a
    // pull-quote. Absent → hidden.
    const adv = spec.advance;
    const advanceEur =
      adv?.amountEur ??
      (adv?.pctDeclared != null
        ? (fold.totalContractedEur * adv.pctDeclared) / 100
        : undefined);
    const advanceNote = bg
      ? adv?.physicalProgressNote?.bg
      : adv?.physicalProgressNote?.en;

    return (
      <>
        {/* key on the ?q= param so Saved/Copied feedback resets per project */}
        <Toolbar
          key={slug ?? params.get("q") ?? ""}
          spec={spec}
          bg={bg}
          editMode={editMode}
          onToggleEdit={() => setEditModeState((e) => !e)}
          curated={curatedMode}
        />
        {editMode && (
          <div className="no-print rounded-md border border-dashed p-3 mb-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              {bg ? "Думи за търсене (обединени)" : "Search terms (unioned)"}
            </div>
            <div className="flex flex-col gap-2">
              {spec.search.map((th, i) => (
                <ThreadRow
                  key={i}
                  initial={th.terms}
                  index={i}
                  removable={spec.search.length > 1}
                  onCommit={setThreadTerms}
                  onRemove={removeThread}
                  bg={bg}
                />
              ))}
              <ThreadAdder onAdd={addThread} bg={bg} />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {bg
                ? "Всеки ред е отделно търсене — резултатите се обединяват. Махни ред с ×."
                : "Each row is a separate search — results are unioned. Remove a row with ×."}
            </div>
            {candidates.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  {bg
                    ? "По-широко търсене — възможно пропуснати договори:"
                    : "Broader matches — possibly missed contracts:"}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {candidates.map((c) => (
                    <li
                      key={c.key}
                      className="flex items-start gap-2 text-sm leading-snug"
                    >
                      <button
                        type="button"
                        onClick={() => includeMember(c.key)}
                        className="shrink-0 rounded border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400"
                      >
                        {bg ? "+ добави" : "+ add"}
                      </button>
                      <span className="min-w-0 flex-1 truncate">
                        {c.contractorName ?? "—"}
                        {c.title ? ` — ${c.title}` : ""}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {money(c.amountEur ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {data.truncated && (
          <div className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 my-3 text-amber-700 dark:text-amber-400">
            {bg
              ? "Търсенето е твърде общо — показани се само част от резултатите. Прецизирай думите или добави име на възложител."
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
          {advanceEur != null && (
            <Figure
              label={
                (bg ? "Авансово изплатено" : "Advance paid") +
                // % suffix only when the figure IS the derived percentage (no
                // explicit amountEur) — else the label could contradict the value.
                (adv?.amountEur == null && adv?.pctDeclared != null
                  ? ` (${adv.pctDeclared}%)`
                  : "")
              }
              value={money(advanceEur)}
            />
          )}
        </div>

        {/* Advance progress pull-quote (§0g.3) — «35% платено, нищо построено»,
            the most citizen-legible number. Curated + sourced, never joined. */}
        {advanceNote && (
          <blockquote className="my-4 border-l-2 border-amber-500/60 pl-4 text-lg font-voice">
            {advanceNote}
            {(adv?.source || adv?.asOf || isHttpUrl(adv?.sourceUrl)) && (
              <span className="mt-1 block text-xs font-sans not-italic text-muted-foreground">
                {adv?.asOf}
                {/* separator only when a source label actually follows */}
                {adv?.asOf && (adv?.source || isHttpUrl(adv?.sourceUrl))
                  ? " · "
                  : ""}
                {isHttpUrl(adv?.sourceUrl) ? (
                  <a
                    href={adv?.sourceUrl}
                    className="underline"
                    rel="nofollow noopener"
                    target="_blank"
                  >
                    {adv?.source ?? (bg ? "източник" : "source")}
                  </a>
                ) : (
                  adv?.source
                )}
              </span>
            )}
          </blockquote>
        )}

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

        {/* Recurring-object per-period rollup (§4.2.2b) — above the timeline */}
        {byPeriod.length > 1 && (
          <RecurrenceRollup
            periods={byPeriod}
            label={
              (bg ? spec.recurrence?.label?.bg : spec.recurrence?.label?.en) ??
              (bg ? "По години" : "By year")
            }
            money={money}
            loc={loc}
            bg={bg}
          />
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
                {/* Link to the procedure page ONLY when we actually hold the
                    tender row — pre-2020 procedures exist as a contract.unp with
                    no tender in the corpus, so /tenders/:unp would 404. */}
                {r.tender ? (
                  <Link
                    to={`/tenders/${r.unp}`}
                    className={`flex-1 hover:underline ${r.tender.isCancelled ? "line-through text-muted-foreground" : ""}`}
                  >
                    {r.tender.subject}
                  </Link>
                ) : (
                  <span className="flex-1">{r.contracts[0]?.title}</span>
                )}
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
              {/* Procedure прогнозна (estimated) value vs Σ contracted of its
                  member contracts. The договорено-спрямо-прогнозна % shows ONLY when
                  ALL lots are included (siblingLotPolicy 'all'). For a many-lot
                  framework the whole-tender estimate covers lots this dossier didn't
                  include (АМ Хемус+Тракия+Марица+Струма maintenance, only the Хемус
                  lot in scope), so we LABEL it "(цялата процедура)" and show the
                  included contracted sum WITHOUT a %, which would mislead. */}
              {(() => {
                const est = r.tender?.estimatedValueEur;
                if (est == null || est <= 0) return null;
                const contracted = r.contracts.reduce(
                  (s, c) =>
                    (c.tag ?? "contract") === "contract"
                      ? s + (c.amountEur ?? 0)
                      : s,
                  0,
                );
                const allLots = siblingLotPolicy(r.tender?.lotsCount) === "all";
                const pct =
                  allLots && contracted > 0
                    ? Math.round((contracted / est) * 100)
                    : null;
                return (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {allLots
                      ? bg
                        ? "прогнозна "
                        : "estimated "
                      : bg
                        ? "прогнозна (цялата процедура) "
                        : "estimated (whole procedure) "}
                    {money(est)}
                    {contracted > 0 && (
                      <>
                        {" · "}
                        {bg ? "договорено " : "contracted "}
                        {money(contracted)}
                        {pct != null && ` (${pct}%)`}
                      </>
                    )}
                  </div>
                );
              })()}
              <div className="mt-2 flex flex-col gap-2 pl-3">
                {(() => {
                  const row = (c: ProcurementContract) => (
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
                  );
                  // Attach contracts to their обособена позиция (lot) under the
                  // procedure — the procedure→lot→contract tree (§4.2). The lot is
                  // the DB-recovered lot_name (migration 050, title-parsed → partial
                  // coverage). Group only when ≥2 distinct lots are present; else
                  // collapse the level. Contracts with no recoverable lot attach
                  // directly under the procedure (labelled honestly, §2).
                  const lots = [
                    ...new Set(
                      r.contracts.map((c) => c.lotName).filter(Boolean),
                    ),
                  ] as string[];
                  if (lots.length < 2) return r.contracts.map(row);
                  const noLot = r.contracts.filter((c) => !c.lotName);
                  return (
                    <>
                      {lots.map((lot) => (
                        <div
                          key={lot}
                          className="flex flex-col gap-2 border-l border-dashed border-border pl-3"
                        >
                          <div className="text-xs font-medium text-foreground/70">
                            <span className="text-muted-foreground">
                              {bg ? "ОП" : "Lot"}
                            </span>{" "}
                            {lot}
                          </div>
                          {r.contracts
                            .filter((c) => c.lotName === lot)
                            .map(row)}
                        </div>
                      ))}
                      {noLot.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <div className="text-xs text-muted-foreground">
                            {bg ? "без обособена позиция" : "no lot"}
                          </div>
                          {noLot.map(row)}
                        </div>
                      )}
                    </>
                  );
                })()}
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
                {isHttpUrl(spec.gap.sourceUrl) && (
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
          {/* Subcontractor blind spot (§0g.2) — the money trail stops at a state
              in-house head contractor; render the ABSENCE (like the gap node).
              The known sub-layer, if curated, is shown as a *known* blind spot. */}
          {(inhouseHit.length > 0 ||
            (spec.knownSubcontractors?.length ?? 0) > 0) && (
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
                  {bg ? "Подизпълнители" : "Subcontractors"}
                </span>{" "}
                —{" "}
                {bg
                  ? "паричната следа спира тук — подизпълнителите не се публикуват в ЦАИС"
                  : "the money trail stops here — subcontractors aren't published in CAIS"}
                {inhouseHit.length > 0 && (
                  <>
                    {" ("}
                    {bg ? "възложено на " : "awarded to "}
                    {inhouseHit.map((h, i) => (
                      <span key={h.eik}>
                        {i > 0 ? ", " : ""}
                        <Link
                          to={`/company/${h.eik}`}
                          className="text-primary hover:underline"
                        >
                          {h.name}
                        </Link>
                      </span>
                    ))}
                    {")"}
                  </>
                )}
                {(spec.knownSubcontractors?.length ?? 0) > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {spec.knownSubcontractors!.map((s, i) => (
                      <li
                        key={`${s.eik ?? "x"}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-xs"
                      >
                        {s.eik ? (
                          <Link
                            to={`/company/${s.eik}`}
                            className="text-primary hover:underline"
                          >
                            {s.name}
                          </Link>
                        ) : (
                          <span className="text-foreground">{s.name}</span>
                        )}
                        {s.amountEur ? (
                          <span className="tabular-nums">
                            {money(s.amountEur)}
                          </span>
                        ) : null}
                        {s.source && (
                          <span className="text-muted-foreground">
                            {isHttpUrl(s.sourceUrl) ? (
                              <a
                                href={s.sourceUrl}
                                className="underline"
                                rel="nofollow noopener"
                                target="_blank"
                              >
                                {s.source}
                              </a>
                            ) : (
                              s.source
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {/* EU funding annotation (§4.2.3b) — a single DATELESS node (ИСУН has no
              payment dates, §0d); the amounts live in the ИСУН block below. */}
          {data.funds.length > 0 && (
            <div className="relative">
              <span
                className="absolute -left-[27px] top-1 h-4 w-4 rounded-full border-2 border-dashed"
                style={{
                  borderColor: "#0F6E56",
                  background: "var(--background, #fff)",
                }}
              />
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {bg ? "Финансиране от ЕС" : "EU funding"}
                </span>{" "}
                —{" "}
                {bg
                  ? `${data.funds.length} проект${data.funds.length === 1 ? "" : "а"} по ИСУН (без дати на плащане — виж по-долу)`
                  : `${data.funds.length} ISUN project${data.funds.length === 1 ? "" : "s"} (no payment dates — see below)`}
              </div>
            </div>
          )}
        </div>

        {/* Contractors table (§4.2.5) — aggregated from the member contracts */}
        {byContractor.length > 0 && (
          <div className="my-8 max-w-3xl">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              {bg ? "Изпълнители" : "Contractors"}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-1 text-left font-normal">
                      {bg ? "изпълнител" : "contractor"}
                    </th>
                    <th className="py-1 pl-6 text-right font-normal">
                      {bg ? "договори" : "contracts"}
                    </th>
                    <th className="py-1 pl-8 text-right font-normal">
                      {bg ? "стойност" : "value"}
                    </th>
                    <th className="py-1 pl-6 text-right font-normal">
                      {bg ? "дял" : "share"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byContractor.map((r) => (
                    <tr
                      key={r.eik ?? r.name}
                      className="border-b border-border/50"
                    >
                      <td className="py-1.5">
                        {r.eik ? (
                          <Link
                            to={`/company/${r.eik}`}
                            className="text-primary"
                          >
                            {r.name}
                          </Link>
                        ) : (
                          r.name
                        )}
                      </td>
                      <td className="py-1.5 pl-6 text-right tabular-nums">
                        {r.count}
                      </td>
                      <td className="py-1.5 pl-8 text-right font-medium tabular-nums whitespace-nowrap">
                        {money(r.eur)}
                      </td>
                      <td className="py-1.5 pl-6 text-right tabular-nums text-muted-foreground">
                        {fold.totalContractedEur > 0
                          ? `${Math.round((r.eur / fold.totalContractedEur) * 100)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Европейско финансиране (ИСУН) block (§4.2.3b) — curated fund members */}
        {data.funds.length > 0 && (
          <FundsBlock
            funds={data.funds}
            money={money}
            bg={bg}
            editMode={editMode}
            onRemove={removeFund}
          />
        )}

        {/* Claims ledger (§4.2.6b) — public statements vs the file's own numbers.
            Gated on verifiedAt: the authoritative verdict pills must not appear on
            a casual DIY ?q= (§11 — a user claim must not read as a Наясно verdict).
            verifiedAt is the curator signal we have in v1; it is a proxy, not a
            cryptographic gate — real curated/DIY separation waits for auth (P3).
            Prints (it IS the report). */}
        {spec.verifiedAt && spec.claims && spec.claims.length > 0 && (
          <ClaimsLedger claims={spec.claims} bg={bg} />
        )}

        {/* Provenance footer (§4.2.7) — method transparency; doubles as the PDF
            footer, so it is NOT print-hidden. */}
        <ProvenanceFooter
          spec={spec}
          memberCount={data.contracts.length}
          loc={loc}
          bg={bg}
        />
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
  curated = false,
}: {
  spec: ProjectFileSpec;
  bg: boolean;
  editMode: boolean;
  onToggleEdit: () => void;
  /** A committed /project/:slug file — read-only, so no edit/save. */
  curated?: boolean;
}) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const btn = "no-print rounded-md border px-3 py-1.5 text-sm hover:bg-muted";
  return (
    <div className="no-print flex flex-wrap gap-2 mb-2">
      {!curated && (
        <button className={btn} onClick={onToggleEdit} aria-pressed={editMode}>
          {editMode ? (bg ? "Готово" : "Done") : bg ? "Редактирай" : "Edit"}
        </button>
      )}
      {!curated && (
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
      )}
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
      {c.date && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {c.date}
        </span>
      )}
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

// Recurring-object rollup (§4.2.2b) — a per-period trend table + a thin
// bar-per-period CSS strip (dataviz rule: CSS heroes, not Recharts). Renders
// above the timeline for a file that declares `recurrence`.
const RecurrenceRollup = ({
  periods,
  label,
  money,
  loc,
  bg,
}: {
  periods: PeriodAgg[];
  label: string;
  money: (n: number | null | undefined) => string;
  loc: string;
  bg: boolean;
}) => {
  const max = Math.max(...periods.map((p) => p.totalEur), 1);
  const nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  return (
    <div className="my-6 max-w-3xl">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {bg ? "Повтарящ се проект" : "Recurring project"} · {label}
      </h2>
      <div className="mb-4 flex items-end gap-1.5" style={{ height: 64 }}>
        {periods.map((p) => (
          <div
            key={p.period}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max(2, (p.totalEur / max) * 100)}%`,
                background: "#8a7734",
              }}
              title={`${p.period}: ${money(p.totalEur)}`}
            />
            <span className="text-[10px] text-muted-foreground">
              {p.period}
            </span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1 text-left font-normal">{label}</th>
              <th className="py-1 text-right font-normal">
                {bg ? "договорено" : "contracted"}
              </th>
              <th className="py-1 text-right font-normal">
                {bg ? "договори" : "contracts"}
              </th>
              <th className="py-1 pl-3 text-left font-normal">
                {bg ? "водещ изпълнител" : "top contractor"}
              </th>
              <th className="py-1 text-right font-normal">
                {bg ? "без открита" : "no open"}
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const share = (v: number) =>
                p.totalEur > 0 ? Math.round((v / p.totalEur) * 100) : 0;
              const noOpen = share(p.methodMix.nonCompetitive);
              // Blank-method awards (§11 — ~€2.66bn of АПИ) are `unspecified`, not
              // competitive; show them so a 0%-no-open period isn't misread as
              // fully-competitive when it's really all-unknown.
              const unknown = share(p.methodMix.unspecified);
              return (
                <tr key={p.period} className="border-b border-border/50">
                  <td className="py-1.5 font-medium">{p.period}</td>
                  <td className="py-1.5 text-right">{money(p.totalEur)}</td>
                  <td className="py-1.5 text-right">{p.contractCount}</td>
                  <td className="max-w-[16rem] truncate py-1.5 pl-3">
                    {p.topContractorName ?? "—"}
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground">
                    {nf.format(noOpen)}%
                    {unknown > 0 && (
                      <span className="ml-1 text-foreground/40">
                        ({nf.format(unknown)}% {bg ? "неуточн." : "unknown"})
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Verdict pill palette + labels — the good/bad/partial semantics reused from the
// method strip (green / coral / amber).
const VERDICT_STYLE: Record<
  NonNullable<Claim["verdict"]>,
  { bg: string; color: string; label: { bg: string; en: string } }
> = {
  confirms: {
    bg: "#E1F5EE",
    color: "#0F6E56",
    label: { bg: "потвърждава", en: "confirms" },
  },
  refutes: {
    bg: "#FAECE7",
    color: "#712B13",
    label: { bg: "опровергава", en: "refutes" },
  },
  partial: {
    bg: "#FAEEDA",
    color: "#854F0B",
    label: { bg: "частично", en: "partial" },
  },
};

// Европейско финансиране (ИСУН) block (§4.2.3b) — curated fund-project members.
// Each card: programme + contract_number, beneficiary → /company/:eik, a
// договорено/изплатено disbursement bar with усвоено %, status, a manual-add
// provenance chip and (edit mode) a × remove. ИСУН publishes contracted + paid
// sums but NO payment dates (§0d), so the honest note says exactly that — no
// dated tranches, and in the timeline this is one dateless annotation.
const FundsBlock = ({
  funds,
  money,
  bg,
  editMode,
  onRemove,
}: {
  funds: FundProjectMember[];
  money: (n: number | null | undefined) => string;
  bg: boolean;
  editMode: boolean;
  onRemove: (contractNumber: string) => void;
}) => (
  <section className="my-8 max-w-3xl">
    <h2 className="mb-1 text-sm font-medium text-muted-foreground">
      {bg ? "Европейско финансиране (ИСУН)" : "EU funding (ISUN)"}
    </h2>
    <p className="mb-3 text-xs text-muted-foreground">
      {bg
        ? "ИСУН публикува договорени и изплатени суми, но не и дати на плащане."
        : "ISUN publishes contracted and paid sums, but no payment dates."}
    </p>
    <div className="flex flex-col gap-3">
      {funds.map((f) => {
        const total = f.totalEur ?? 0;
        // Keep the raw % (over-100% over-disbursement is an honest signal); only
        // guard the negative/absent case. The bar clamps to [0,100] visually.
        const paidPct =
          total > 0 && f.paidEur != null && f.paidEur >= 0
            ? Math.round((f.paidEur / total) * 100)
            : null;
        return (
          <div key={f.contractNumber} className="rounded-md border p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {f.programName && (
                <span className="rounded-full bg-muted px-2 py-0.5">
                  {f.programName}
                </span>
              )}
              <span className="font-mono">{f.contractNumber}</span>
              <span className="rounded-full border px-1.5 py-0.5">
                {bg ? "добавен ръчно" : "manually added"}
              </span>
              {editMode && (
                <button
                  type="button"
                  onClick={() => onRemove(f.contractNumber)}
                  className="no-print text-muted-foreground hover:text-destructive"
                  aria-label={bg ? "махни проекта" : "remove project"}
                  title={bg ? "махни проекта" : "remove project"}
                >
                  ×
                </button>
              )}
            </div>
            <div className="text-sm font-medium leading-snug">{f.title}</div>
            {f.beneficiaryEik && (
              <Link
                to={`/company/${f.beneficiaryEik}`}
                className="text-xs text-primary hover:underline"
              >
                {f.beneficiaryName ?? f.beneficiaryEik}
              </Link>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">
                  {bg ? "договорено " : "contracted "}
                </span>
                {money(f.totalEur)}
              </span>
              <span>
                <span className="text-xs text-muted-foreground">
                  {bg ? "изплатено " : "paid "}
                </span>
                {money(f.paidEur)}
                {paidPct != null && (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    ({paidPct}% {bg ? "усвоено" : "absorbed"})
                  </span>
                )}
              </span>
              {f.status && (
                <span className="text-xs text-muted-foreground">
                  {f.status}
                </span>
              )}
            </div>
            {paidPct != null && (
              <div className="mt-1.5 h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.min(100, paidPct)}%`,
                    background: "#0F6E56",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  </section>
);

// Claims ledger (§4.2.6b / §0g.4) — public statements checked against the file's
// own numbers ("нашите данни"). обективност-срещу-заглавието made literal, and the
// sharpest differentiator vs SIGMA. Prints (it IS the report), so not print-hidden.
const ClaimsLedger = ({ claims, bg }: { claims: Claim[]; bg: boolean }) => (
  <section className="my-8 max-w-3xl">
    <h2 className="mb-3 text-sm font-medium text-muted-foreground">
      {bg ? "Проверка на твърдения" : "Claim check"}
    </h2>
    <div className="flex flex-col gap-4">
      {claims.map((c) => {
        const v = c.verdict ? VERDICT_STYLE[c.verdict] : null;
        const hasSource = isHttpUrl(c.sourceUrl);
        return (
          <div key={c.sourceUrl ?? c.text} className="border-l-2 pl-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {v && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: v.bg, color: v.color }}
                >
                  {bg ? v.label.bg : v.label.en}
                </span>
              )}
              {(c.byWhom || c.saidAt) && (
                <span className="text-xs text-muted-foreground">
                  {c.byWhom}
                  {c.byWhom && c.saidAt ? " · " : ""}
                  {c.saidAt}
                </span>
              )}
            </div>
            <blockquote className="text-base font-voice leading-snug">
              „{c.text}“
            </blockquote>
            {c.ourNumber && (
              <p className="mt-1.5 text-sm">
                <span className="font-medium">
                  {bg ? "Нашите данни: " : "Our data: "}
                </span>
                {c.ourNumber}
              </p>
            )}
            {(c.note?.bg || c.note?.en) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {(bg ? c.note?.bg : c.note?.en) ?? c.note?.bg ?? c.note?.en}
              </p>
            )}
            {hasSource && (
              <a
                href={c.sourceUrl}
                className="mt-1 inline-block text-xs text-primary underline"
                rel="nofollow noopener"
                target="_blank"
              >
                {bg ? "източник" : "source"}
              </a>
            )}
          </div>
        );
      })}
    </div>
  </section>
);

// Provenance footer (§4.2.7) — the search string(s), member/include/exclude
// counts, curator verification date, sourced links for any curated figure, and
// the DIY disclaimer (§4.4/§11 — a user's search must not read as an editorial
// Наясно finding). Method transparency; prints as the PDF footer, not print-hidden.
const ProvenanceFooter = ({
  spec,
  memberCount,
  loc,
  bg,
}: {
  spec: ProjectFileSpec;
  memberCount: number;
  loc: string;
  bg: boolean;
}) => {
  const nf = new Intl.NumberFormat(loc);
  const terms = [...new Set(spec.search.map((t) => t.terms).filter(Boolean))];
  const countIds = (m?: {
    contractKeys?: string[];
    tenderUnps?: string[];
    fundContractNumbers?: string[];
  }) =>
    (m?.contractKeys?.length ?? 0) +
    (m?.tenderUnps?.length ?? 0) +
    (m?.fundContractNumbers?.length ?? 0);
  const incCount = countIds(spec.includes);
  const excCount = countIds(spec.excludes);
  const sources = [
    {
      label: bg ? "обявен бюджет" : "announced budget",
      url: spec.announcedBudget?.sourceUrl,
    },
    { label: bg ? "аванс" : "advance", url: spec.advance?.sourceUrl },
    { label: bg ? "празнина" : "gap", url: spec.gap?.sourceUrl },
  ].filter((s) => isHttpUrl(s.url));
  return (
    <footer className="mt-10 max-w-3xl border-t pt-4 text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground/70">
        {bg ? "Метод и източници" : "Method & sources"}
      </div>
      <div className="flex flex-col gap-0.5">
        <div>
          <span className="text-foreground/60">
            {bg ? "Търсене: " : "Search: "}
          </span>
          {terms.length
            ? terms.map((t) => `„${t}“`).join(bg ? " или " : " or ")
            : "—"}
        </div>
        <div>
          {bg ? "Членове: " : "Members: "}
          {nf.format(memberCount)}
          {incCount > 0 &&
            ` · ${bg ? "ръчно добавени" : "added"} ${nf.format(incCount)}`}
          {excCount > 0 &&
            ` · ${bg ? "премахнати" : "removed"} ${nf.format(excCount)}`}
        </div>
        {spec.verifiedAt && (
          <div>
            {bg ? "Проверено на: " : "Verified: "}
            {spec.verifiedAt}
          </div>
        )}
        {spec.authority && (
          <div>
            {bg ? "Възложител: " : "Authority: "}
            {spec.authority}
          </div>
        )}
        {sources.length > 0 && (
          <div>
            {bg ? "Източници: " : "Sources: "}
            {sources.map((s, i) => (
              <span key={s.label}>
                {i > 0 && " · "}
                <a
                  href={s.url}
                  className="text-primary underline"
                  rel="nofollow noopener"
                  target="_blank"
                >
                  {s.label}
                </a>
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="mt-3 italic">
        {bg
          ? "Изготвено от потребител чрез търсене в обществените поръчки — не е редакционен анализ на Наясно."
          : "Assembled by a user from a procurement search — not a Наясно editorial analysis."}
      </p>
    </footer>
  );
};

const BuildForm = ({
  onSubmit,
  bg,
  cta,
}: {
  onSubmit: (terms: string) => void;
  bg: boolean;
  cta: string;
}) => {
  const [terms, setTerms] = useState("");
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

// One editable search thread (§0f.2). Commits on Enter or blur; the × removes it
// (hidden for the last remaining thread — a file needs at least one search).
const ThreadRow = ({
  initial,
  index,
  removable,
  onCommit,
  onRemove,
  bg,
}: {
  initial: string;
  index: number;
  removable: boolean;
  onCommit: (i: number, terms: string) => void;
  onRemove: (i: number) => void;
  bg: boolean;
}) => {
  const [terms, setTerms] = useState(initial);
  // Re-sync when the committed value changes externally (e.g. a sibling row was
  // removed and indices shifted). Keying by index keeps focus on Enter-commit.
  useEffect(() => setTerms(initial), [initial]);
  // Blank is not a valid commit (setThreadTerms ignores it) — revert the box to
  // the committed term instead of leaving it misleadingly empty.
  const commit = () => {
    if (!terms.trim()) setTerms(initial);
    else onCommit(index, terms);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 rounded-md border px-3 py-1.5 text-sm bg-background"
        aria-label={
          bg ? `Дума за търсене ${index + 1}` : `Search term ${index + 1}`
        }
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {removable && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label={bg ? "Махни реда" : "Remove row"}
          className="shrink-0 rounded-md border px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          ×
        </button>
      )}
    </div>
  );
};

// The "add another search thread" row — clears itself after each add.
const ThreadAdder = ({
  onAdd,
  bg,
}: {
  onAdd: (terms: string) => void;
  bg: boolean;
}) => {
  const [terms, setTerms] = useState("");
  const submit = () => {
    onAdd(terms);
    setTerms("");
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 rounded-md border border-dashed px-3 py-1.5 text-sm bg-background"
        aria-label={bg ? "Добави дума за търсене" : "Add a search term"}
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        placeholder={
          bg ? "+ добави дума за търсене…" : "+ add another search term…"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!terms.trim()}
        className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
      >
        {bg ? "Добави" : "Add"}
      </button>
    </div>
  );
};
