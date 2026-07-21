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
import { classifyMethod, isSingleBid } from "@/data/procurement/projectFile";
import { saveProject, projectHref } from "@/data/procurement/projectStore";

// Uncurated starter seeds — a researcher must not face a blank box (§0f.1).
const STARTERS: Array<{ label: string; spec: ProjectFileSpec }> = [
  {
    label: "Софийски околовръстен — Западна дъга",
    spec: {
      title: { bg: "Софийски околовръстен — Западна дъга" },
      search: [
        {
          terms: "западна дъга",
          distinctive: ["дъга"],
          buyerEik: ["000695089"],
          threshold: 0.6,
        },
      ],
      benchmark: {
        unit: "eur_per_km",
        impliedLow: 116000000,
        impliedHigh: 400000000,
      },
    },
  },
  {
    label: "Магистрала Хемус",
    spec: {
      title: { bg: "Магистрала Хемус" },
      search: [
        { terms: "хемус", distinctive: ["хемус"], buyerEik: ["000695089"] },
      ],
    },
  },
  {
    label: "Избори — машини срещу хартия",
    spec: {
      title: { bg: "Избори — машини срещу хартия" },
      search: [
        { terms: "бюлетин", distinctive: ["бюлетин"] },
        { terms: "суемг", distinctive: ["суемг"] },
      ],
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

const isRedMethod = (method: string | null | undefined): boolean =>
  classifyMethod(method) === "nonCompetitive";

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

  const money = (n: number | null | undefined) =>
    formatEurCompact(n, loc) || "—";

  const body = () => {
    if (!spec) {
      return (
        <div>
          <p className="text-muted-foreground mb-2">
            {bg
              ? "Търси предмет на договор или процедура, за да създадеш досие — или започни от готов пример."
              : "Search a contract or tender subject to build a file — or start from a template."}
          </p>
          <BuildForm
            onSubmit={buildFromTerms}
            bg={bg}
            cta={bg ? "Създай досие" : "Create file"}
          />
          <div className="text-xs text-muted-foreground mb-2">
            {bg ? "Готови примери" : "Templates"}
          </div>
          <div className="flex flex-col gap-2">
            {STARTERS.map((s) => (
              <Link
                key={s.label}
                to={projectHref(s.spec)}
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                {s.label}
              </Link>
            ))}
          </div>
          <div className="mt-4">
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
                <span className="flex-1">
                  {r.tender?.subject ?? r.contracts[0]?.title}
                </span>
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
            ? "Запази проект"
            : "Save project"}
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
      <Link to="/procurement/projects" className={btn}>
        {bg ? "Моите досиета" : "My files"}
      </Link>
    </div>
  );
};

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
}: {
  c: ProcurementContract;
  bg: boolean;
  money: (n: number | null | undefined) => string;
  onRemove?: () => void;
}) => (
  <div className="flex items-center gap-2 flex-wrap">
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ background: "#1D9E75" }}
    />
    {c.contractorEik ? (
      <Link to={`/company/${c.contractorEik}`} className="text-sm text-primary">
        {c.contractorName}
      </Link>
    ) : (
      <span className="text-sm">{c.contractorName}</span>
    )}
    <span
      className="text-[11px] px-1.5 py-0.5 rounded-full"
      style={{
        background: isRedMethod(c.procurementMethod) ? "#FAECE7" : "#F1EFE8",
        color: isRedMethod(c.procurementMethod) ? "#712B13" : "#5F5E5A",
      }}
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
    <span className="ml-auto text-sm font-medium">{money(c.amountEur)}</span>
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
