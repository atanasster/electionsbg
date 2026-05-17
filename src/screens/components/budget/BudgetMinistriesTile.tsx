// Ministry breakdown for the selected fiscal year — every first-level spending
// unit ranked by the expenditure the State Budget Law appropriated to it, with
// a proportional bar. Rows whose ministry has an ingested execution report
// also surface executed vs amended (unspent and execution %); the others stay
// plan-only. Each row carries the unit's public-procurement footprint (Phase 4
// cross-link) and an MP-connected flag, and links to the ministry detail
// screen. Renders nothing when the selected year has no law-dimension data.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark, Receipt, Users, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { formatEur } from "@/lib/currency";
import {
  useBudgetAdminReconciliation,
  useBudgetProgramReconciliation,
  useBudgetProgramFacts,
} from "@/data/budget/useBudgetReconciliation";
import { useMinistryProcurement } from "@/data/budget/useBudget";
import type { ReconciliationRow } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  return formatEur(v);
};

// Program rows nested under a ministry row when expanded. Joins the raw
// facts (which carry the admin → program edge) with the program reconciliation
// (which carries amended + executed). Renders nothing when no programs exist
// for this admin id.
const ProgramSublist: FC<{
  adminNodeId: string;
  lang: "bg" | "en";
  programFacts: ReturnType<typeof useBudgetProgramFacts>["data"];
  programRecon: ReconciliationRow[] | null | undefined;
}> = ({ adminNodeId, lang, programFacts, programRecon }) => {
  const { t } = useTranslation();
  const reconById = useMemo(() => {
    const m = new Map<string, ReconciliationRow>();
    for (const r of programRecon ?? []) m.set(r.nodeId, r);
    return m;
  }, [programRecon]);

  const programs = useMemo(() => {
    if (!programFacts) return [];
    return programFacts
      .filter(
        (f) =>
          f.classification.admin === adminNodeId &&
          f.classification.program &&
          f.kind === "expenditure",
      )
      .map((f) => {
        const programId = f.classification.program as string;
        const recon = reconById.get(programId);
        const planned = f.money.amountEur;
        return {
          nodeId: programId,
          label:
            (lang === "bg"
              ? recon?.nodeNameBg
              : recon?.nodeNameEn || recon?.nodeNameBg) || f.sourceRef.rowLabel,
          planned,
          amended: recon?.amended?.amountEur ?? null,
          executed: recon?.executed?.amountEur ?? null,
        };
      })
      .sort((a, b) => b.planned - a.planned);
  }, [programFacts, adminNodeId, reconById, lang]);

  if (programs.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground italic">
        {t("budget_ministries_no_programs") ||
          "Program breakdown not published for this unit."}
      </p>
    );
  }

  const maxProg = Math.max(...programs.map((p) => p.planned), 1);

  return (
    <ul className="mt-2 space-y-1 border-l-2 border-primary/20 pl-3">
      {programs.map((p) => {
        const baseline = p.amended ?? p.planned;
        const baseWidth = (baseline / maxProg) * 100;
        const execShare =
          p.executed != null && baseline > 0
            ? Math.min(100, (p.executed / baseline) * 100)
            : 0;
        const execPct =
          p.executed != null && p.amended && p.amended > 0
            ? (p.executed / p.amended) * 100
            : null;
        return (
          <li key={p.nodeId} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-muted-foreground" title={p.label}>
                {p.label}
              </span>
              <span className="tabular-nums shrink-0 font-medium">
                {formatEur(p.planned)}
              </span>
            </div>
            <div className="mt-0.5 h-1 rounded bg-muted overflow-hidden">
              <div
                className="h-full rounded bg-primary/20"
                style={{ width: `${baseWidth}%` }}
              >
                {p.executed != null ? (
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${execShare}%` }}
                  />
                ) : null}
              </div>
            </div>
            {p.executed != null && execPct != null ? (
              <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                {t("budget_ministries_executed") || "executed"}{" "}
                {formatEur(p.executed)} ({execPct.toFixed(1)}%)
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

export const BudgetMinistriesTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data: rows } = useBudgetAdminReconciliation(fiscalYear);
  const { data: procFile } = useMinistryProcurement();
  const { data: programFacts } = useBudgetProgramFacts(fiscalYear);
  const { data: programRecon } = useBudgetProgramReconciliation(fiscalYear);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const adminsWithPrograms = useMemo(() => {
    const set = new Set<string>();
    for (const f of programFacts ?? []) {
      if (f.classification.admin && f.kind === "expenditure")
        set.add(f.classification.admin);
    }
    return set;
  }, [programFacts]);

  if (!rows || rows.length === 0) return null;

  const procByNode = new Map(
    (procFile?.entries ?? []).map((e) => [e.nodeId, e]),
  );

  const expenditure = rows
    .filter((r) => r.kind === "expenditure" && r.planned)
    .map((r) => ({
      nodeId: r.nodeId,
      name: lang === "bg" ? r.nodeNameBg : r.nodeNameEn || r.nodeNameBg,
      planned: r.planned!.amountEur,
      amended: r.amended?.amountEur ?? null,
      executed: r.executed?.amountEur ?? null,
      procurement: procByNode.get(r.nodeId) ?? null,
    }))
    .sort((a, b) => b.planned - a.planned);
  if (expenditure.length === 0) return null;

  const max =
    Math.max(
      expenditure[0].planned,
      ...expenditure.map((m) => m.amended ?? 0),
      ...expenditure.map((m) => m.executed ?? 0),
    ) || 1;

  // When any unit has execution data, surface the snapshot date so users know
  // when the executed figures were last reported. The execution-report's
  // reporting period for a full year is `${fiscalYear}-12-31`; partial-year
  // reports would carry an earlier date (none ingested today).
  const hasAnyExecution = expenditure.some((m) => m.executed != null);
  const execAsOf = `${fiscalYear}-12-31`;

  return (
    <Card className="my-4" data-og="budget-ministries">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {t("budget_ministries_title") || "By spending unit"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_ministries_subtitle") ||
            "Expenditure appropriated by the State Budget Law for fiscal year") +
            " " +
            fiscalYear}
          {hasAnyExecution ? (
            <>
              {" · "}
              {t("budget_ministries_asof") || "execution as of"} {execAsOf}
            </>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {expenditure.map((m) => {
            // Bar baseline is the amended appropriation when present, else the
            // law-planned figure; the foreground bar is the executed share of
            // that baseline. Falls back to the original plan-only bar when no
            // execution report has been ingested for this unit yet.
            const baseline = m.amended ?? m.planned;
            const baseWidth = (baseline / max) * 100;
            const execShare =
              m.executed != null && baseline > 0
                ? Math.min(100, (m.executed / baseline) * 100)
                : 0;
            const execPct =
              m.executed != null && m.amended && m.amended > 0
                ? (m.executed / m.amended) * 100
                : null;
            const unspentEur =
              m.executed != null && m.amended != null
                ? m.amended - m.executed
                : null;
            const hasPrograms = adminsWithPrograms.has(m.nodeId);
            const isOpen = expanded.has(m.nodeId);
            return (
              <li key={m.nodeId} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">
                    {hasPrograms ? (
                      <button
                        type="button"
                        onClick={() => toggle(m.nodeId)}
                        aria-expanded={isOpen}
                        aria-label={
                          isOpen
                            ? t("budget_ministries_collapse") || "Hide programs"
                            : t("budget_ministries_expand") || "Show programs"
                        }
                        className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                      </button>
                    ) : (
                      <span className="inline-block h-4 w-4 shrink-0" />
                    )}
                    <Link
                      to={`/budget/ministry/${m.nodeId}`}
                      className="truncate text-primary hover:underline"
                    >
                      {m.name}
                    </Link>
                  </span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {formatEur(m.planned)}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full rounded bg-primary/25"
                    style={{ width: `${baseWidth}%` }}
                  >
                    {m.executed != null ? (
                      <div
                        className="h-full rounded bg-primary/80"
                        style={{ width: `${execShare}%` }}
                      />
                    ) : null}
                  </div>
                </div>
                {m.executed != null && execPct != null ? (
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>
                      {t("budget_ministries_executed") || "executed"}{" "}
                      {formatEur(m.executed)} ({execPct.toFixed(1)}%{" "}
                      <span className="opacity-70">
                        {t("budget_ministries_of_amended") || "of amended"}
                      </span>
                      )
                    </span>
                    {unspentEur != null && unspentEur !== 0 ? (
                      <span
                        className={
                          unspentEur < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : ""
                        }
                      >
                        {unspentEur > 0
                          ? `${t("budget_ministries_unspent") || "unspent"} ${compactEur(unspentEur)}`
                          : `${t("budget_ministries_over") || "over"} ${compactEur(-unspentEur)}`}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {m.procurement ? (
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Receipt className="h-3 w-3" />
                      {compactEur(m.procurement.totalEur)}{" "}
                      {t("budget_ministries_procurement") || "procurement"}
                    </span>
                    {m.procurement.mpConnectedContractorCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <Users className="h-3 w-3" />
                        {m.procurement.mpConnectedContractorCount}{" "}
                        {t("budget_ministries_mp_flag") || "MP-connected"}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {isOpen && hasPrograms ? (
                  <ProgramSublist
                    adminNodeId={m.nodeId}
                    lang={lang}
                    programFacts={programFacts}
                    programRecon={programRecon}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
