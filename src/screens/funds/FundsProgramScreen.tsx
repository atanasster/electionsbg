// /funds/programme/{code} — per-programme detail page. Drill-down for the
// rows on the TopProgramsTile. Reads a slim summary shard (~10-20 KB) so
// the page renders without loading the full per-programme contract list
// (45 MB for the Иновации programme). Layout: header with KPIs, status mix,
// top beneficiaries + top contracts + top муни — same status palette and
// disbursement-badge grammar as the rest of /funds.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Coins,
  Layers,
  MapPin,
  Users,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsProgramSummary } from "@/data/funds/useFundsProgramSummary";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import type {
  FundsProjectsProgramSummaryFile,
  FundsProjectsRollup,
} from "@/data/funds/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};
const numFmt = new Intl.NumberFormat("bg-BG");

const STATUS_STYLES: Array<{
  key: string;
  i18nKey: string;
  barClass: string;
}> = [
  {
    key: "completed",
    i18nKey: "funds_tile_status_completed",
    barClass: "bg-emerald-400",
  },
  {
    key: "in-progress",
    i18nKey: "funds_tile_status_in_progress",
    barClass: "bg-sky-400",
  },
  {
    key: "signed",
    i18nKey: "funds_tile_status_signed",
    barClass: "bg-slate-400",
  },
  {
    key: "terminated",
    i18nKey: "funds_tile_status_terminated",
    barClass: "bg-rose-400",
  },
];

const statusChipClass = (status: string): string => {
  if (status.startsWith("Приключен"))
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100";
  if (status.startsWith("В изпълнение"))
    return "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100";
  if (status === "Сключен")
    return "bg-slate-100 text-slate-900 dark:bg-slate-900/40 dark:text-slate-100";
  if (status.startsWith("Прекратен"))
    return "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100";
  return "bg-muted text-muted-foreground";
};

const statusChipI18nKey = (status: string): string => {
  if (status.startsWith("Приключен")) return "funds_tile_status_completed";
  if (status.startsWith("В изпълнение")) return "funds_tile_status_in_progress";
  if (status === "Сключен") return "funds_tile_status_signed";
  if (status.startsWith("Прекратен")) return "funds_tile_status_terminated";
  return "funds_tile_status_other";
};

const StatusChip: FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap ${statusChipClass(status)}`}
      title={status}
    >
      {t(statusChipI18nKey(status))}
    </span>
  );
};

const HeaderKpis: FC<{ rollup: FundsProjectsRollup }> = ({ rollup }) => {
  const { t } = useTranslation();
  const rate =
    rollup.totalEur > 0 ? (rollup.paidEur / rollup.totalEur) * 100 : 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <div className="text-xs text-muted-foreground">
          {t("funds_program_kpi_contracts")}
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {numFmt.format(rollup.contractCount)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t("funds_program_kpi_beneficiaries", {
            count: rollup.beneficiaryCount,
          })}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">
          {t("funds_program_kpi_contracted")}
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {compactEur(rollup.totalEur)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {compactEur(rollup.grantEur)} {t("funds_program_kpi_grant")}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">
          {t("funds_program_kpi_paid")}
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {compactEur(rollup.paidEur)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t("funds_program_kpi_of_contracted")}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">
          {t("funds_program_kpi_disbursement")}
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {rate.toFixed(0)}%
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t("funds_status_tile_disbursement_short")}
        </div>
      </div>
    </div>
  );
};

const StatusBreakdown: FC<{
  rows: FundsProjectsProgramSummaryFile["statusBreakdown"];
}> = ({ rows }) => {
  const { t } = useTranslation();
  const max = Math.max(...rows.map((r) => r.rollup.totalEur), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-600" aria-hidden />
          {t("funds_program_status_section")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {rows.map(({ status, rollup }) => {
          const style = STATUS_STYLES.find((s) => s.key === status);
          const totalPct = (rollup.totalEur / max) * 100;
          const paidPct =
            rollup.totalEur > 0 ? (rollup.paidEur / rollup.totalEur) * 100 : 0;
          return (
            <div key={status} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">
                  {style ? t(style.i18nKey) : status}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {numFmt.format(rollup.contractCount)}{" "}
                  {t("funds_status_tile_contracts")}
                </span>
              </div>
              <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className={`absolute inset-y-0 left-0 ${style?.barClass ?? "bg-muted-foreground/60"} opacity-40`}
                  style={{ width: `${totalPct}%` }}
                />
                <div
                  className={`absolute inset-y-0 left-0 ${style?.barClass ?? "bg-muted-foreground"}`}
                  style={{ width: `${(totalPct * paidPct) / 100}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground tabular-nums">
                <span>
                  {compactEur(rollup.totalEur)}{" "}
                  {t("funds_status_tile_contracted")} ·{" "}
                  {compactEur(rollup.paidEur)} {t("funds_status_tile_paid")}
                </span>
                <span className="font-medium">{paidPct.toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

const TopBeneficiaries: FC<{
  rows: FundsProjectsProgramSummaryFile["topBeneficiaries"];
}> = ({ rows }) => {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-600" aria-hidden />
          {t("funds_program_top_beneficiaries_section")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border/60">
          {rows.map((b, i) => {
            const body = (
              <div className="flex items-baseline gap-3 py-2 text-sm">
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 line-clamp-1 font-medium">
                  {b.beneficiaryName}
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground line-clamp-1">
                  {orgTypeLabel(b.orgType, i18n.language)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {numFmt.format(b.contractCount)}
                </span>
                <span className="shrink-0 w-20 text-right text-sm font-medium tabular-nums">
                  {compactEur(b.totalEur)}
                </span>
              </div>
            );
            return (
              <li key={b.beneficiaryEik ?? `name:${b.beneficiaryName}`}>
                {b.beneficiaryEik ? (
                  <Link
                    to={`/company/${b.beneficiaryEik}`}
                    className="block rounded -mx-2 px-2 hover:bg-muted/50 transition-colors"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="-mx-2 px-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};

const TopContracts: FC<{
  rows: FundsProjectsProgramSummaryFile["topContracts"];
}> = ({ rows }) => {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-600" aria-hidden />
          {t("funds_program_top_contracts_section")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border/60">
          {rows.map((c, i) => (
            <li key={c.contractNumber}>
              <Link
                to={`/funds/contract/${encodeURIComponent(c.contractNumber)}`}
                className="block rounded -mx-2 px-2 py-2 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-3 text-sm">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground pt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-2">{c.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {c.beneficiaryName} · {c.locationRaw}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="text-sm font-medium tabular-nums">
                      {compactEur(c.totalEur)}
                    </div>
                    <StatusChip status={c.status} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

const TopMunis: FC<{
  rows: FundsProjectsProgramSummaryFile["topMunis"];
}> = ({ rows }) => {
  const { t, i18n } = useTranslation();
  const { findMunicipality } = useMunicipalities();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-emerald-600" aria-hidden />
          {t("funds_program_top_munis_section")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border/60">
          {rows.map((m, i) => {
            // Sofia (S22 synthetic anchor) and Sofia districts (S2[3-5]xx)
            // all roll up to a single "Sofia (city)" display label so the
            // programme detail page mirrors the choropleth's Sofia handling.
            const isSofia = /^S2[2-5]\d{0,2}$/.test(m.muni);
            const info = findMunicipality(m.muni);
            const name = isSofia
              ? i18n.language === "bg"
                ? "София (столица)"
                : "Sofia (city)"
              : info
                ? i18n.language === "bg"
                  ? info.long_name || info.name
                  : info.long_name_en || info.name_en
                : m.muni;
            return (
              <li key={m.muni} className="py-2">
                <Link
                  to={`/settlement/${m.muni}`}
                  className="flex items-baseline gap-3 -mx-2 px-2 rounded text-sm hover:bg-muted/50 transition-colors"
                >
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0 line-clamp-1 font-medium">
                    {name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {numFmt.format(m.contractCount)}
                  </span>
                  <span className="shrink-0 w-20 text-right text-sm font-medium tabular-nums">
                    {compactEur(m.totalEur)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};

export const FundsProgramScreen: FC = () => {
  const { code } = useParams();
  const { t } = useTranslation();
  const { data, isLoading } = useFundsProgramSummary(code);

  if (isLoading) {
    return (
      <section className="my-4">
        <div className="h-32 rounded-xl border bg-card animate-pulse" />
      </section>
    );
  }
  if (!data) {
    return (
      <section className="my-4 space-y-3">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          className="mt-5"
        />
        <p className="text-sm text-muted-foreground">
          {t("funds_program_not_found", { code })}
        </p>
      </section>
    );
  }

  return (
    <>
      <Title description={data.programName}>
        <span className="flex items-center gap-2 flex-wrap">
          <Layers className="h-5 w-5 text-amber-600" aria-hidden />
          <span>{data.programName}</span>
        </span>
      </Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        current={data.programName}
        className="mt-5"
      />
      <section aria-label={data.programName} className="my-4 space-y-4">
        <div className="flex items-baseline justify-end">
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.programCode}
          </span>
        </div>

        <Card>
          <CardContent className="p-3 md:p-4">
            <HeaderKpis rollup={data.rollup} />
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <StatusBreakdown rows={data.statusBreakdown} />
          <TopMunis rows={data.topMunis} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <TopBeneficiaries rows={data.topBeneficiaries} />
          <TopContracts rows={data.topContracts} />
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t("funds_program_source_hint")}
        </p>
      </section>
    </>
  );
};
