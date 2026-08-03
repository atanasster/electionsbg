// /funds/programme/{code} — per-programme detail page. Drill-down for the
// rows on the TopProgramsTile. Reads a slim summary shard (~10-20 KB) so
// the page renders without loading the full per-programme contract list
// (45 MB for the Иновации programme). Layout: header with KPIs, status mix,
// top beneficiaries + top contracts + top муни — the same tiles the procedure
// page one level down renders, shared from ./summaryTiles.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers, ListTree } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsProgramSummary } from "@/data/funds/useFundsProgramSummary";
import { useFundsProgramProcedures } from "@/data/funds/useFundsProgramProcedures";
import { programmeNameEn } from "@/data/funds/programmeNamesEn";
import {
  HeaderKpis,
  StatusBreakdown,
  TopBeneficiaries,
  TopContracts,
  TopMunis,
} from "./summaryTiles";
import { compactEur, numFmt } from "./summaryFormat";

// The procedures this programme ran, biggest first. This is the drill-down the
// page was missing: a reader arriving on a programme code almost always wants
// one scheme under it, not the €2.23bn aggregate.
const ProgrammeProcedures: FC<{ programCode: string }> = ({ programCode }) => {
  const { t } = useTranslation();
  const { data } = useFundsProgramProcedures(programCode);
  const rows = data?.procedures ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ListTree className="h-4 w-4 text-sky-600" aria-hidden />
          {t("funds_program_procedures_section")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border/60">
          {rows.map((p, i) => (
            <li key={p.procedureCode}>
              <Link
                to={`/funds/procedure/${encodeURIComponent(p.procedureCode)}`}
                className="block rounded -mx-2 px-2 py-2 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-3 text-sm">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground pt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-2">
                      {p.procedureName ?? p.procedureCode}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {p.procedureCode} ·{" "}
                      {t("funds_program_procedures_row", {
                        count: p.beneficiaryCount,
                        contracts: numFmt.format(p.contractCount),
                        beneficiaries: numFmt.format(p.beneficiaryCount),
                      })}
                    </div>
                  </div>
                  <span className="shrink-0 w-20 text-right text-sm font-medium tabular-nums">
                    {compactEur(p.totalEur)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {data && data.procedureCount > rows.length && (
          <p className="pt-2 text-xs text-muted-foreground">
            {t("funds_program_procedures_more", {
              shown: numFmt.format(rows.length),
              total: numFmt.format(data.procedureCount),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export const FundsProgramScreen: FC = () => {
  const { code } = useParams();
  const { t, i18n } = useTranslation();
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

  // The name Google actually scraped its snippet from. Fixing only the
  // prerendered <title> would have left the rendered DOM Bulgarian on an
  // English page — which is the half of the duplication the SERP evidence was
  // about. Falls back to the Bulgarian name for the programmes with no
  // published English one; those pages canonicalise to BG anyway.
  const displayName =
    (i18n.language === "en" ? programmeNameEn(data.programCode) : null) ??
    data.programName;

  return (
    <>
      <Title title={displayName} description={displayName}>
        <span className="flex items-center gap-2 flex-wrap">
          <Layers className="h-5 w-5 text-amber-600" aria-hidden />
          <span>{displayName}</span>
        </span>
      </Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        current={displayName}
        className="mt-5"
      />
      <section aria-label={displayName} className="my-4 space-y-4">
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

        <ProgrammeProcedures programCode={data.programCode} />

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
