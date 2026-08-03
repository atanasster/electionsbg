// /funds/procedure/{code} — per-procedure detail page. The grain between a
// programme and a single contract: `BG16RFOP002-2.089` is one support scheme,
// 4,356 contracts of the €2.23bn ОПИК programme above it.
//
// It exists because that is the grain people search. Every beneficiary of a
// scheme must publish a mandated-publicity page naming its procedure code, so
// the tail for these codes is thousands of pages deep and we only had the
// programme aggregate — which answers a question nobody asked.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ListTree } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent } from "@/ux/Card";
import { useFundsProcedureSummary } from "@/data/funds/useFundsProcedureSummary";
import {
  HeaderKpis,
  StatusBreakdown,
  TopBeneficiaries,
  TopContracts,
  TopMunis,
} from "./summaryTiles";
import { compactEur, numFmt } from "./summaryFormat";

export const FundsProcedureScreen: FC = () => {
  const { code } = useParams();
  const { t } = useTranslation();
  const { data, isLoading } = useFundsProcedureSummary(code);

  if (isLoading) {
    return (
      <>
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          current={code}
          className="mt-5"
        />
        <section className="my-4">
          <div className="h-32 rounded-xl border bg-card animate-pulse" />
        </section>
      </>
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
          {t("funds_procedure_not_found", { code })}
        </p>
      </section>
    );
  }

  // ИСУН publishes no procedure name. Only 22 of the 985 indexable procedures
  // have contracts uniform enough to derive one (the mass support schemes); the
  // other 963 have per-project titles, and borrowing one would be a fabrication.
  // Those pages lead with the code and carry the programme as the subtitle.
  const heading = data.procedureName ?? data.procedureCode;
  const subtitle = data.procedureName
    ? `${data.procedureCode} · ${data.programName}`
    : data.programName;

  return (
    <>
      {/* `title` is required, not optional: <Title> only emits <SEO> when it
          can resolve a title string, and `children` here is an element. Without
          it the page ships with no <title>, description or canonical — which on
          an SEO change would be the whole point missed. */}
      <Title
        title={heading}
        description={t("funds_procedure_meta_description", {
          code: data.procedureCode,
          programme: data.programName,
          contracts: numFmt.format(data.rollup.contractCount),
          beneficiaries: numFmt.format(data.rollup.beneficiaryCount),
          contracted: compactEur(data.rollup.totalEur),
          paid: compactEur(data.rollup.paidEur),
        })}
      >
        <span className="flex items-center gap-2 flex-wrap">
          <ListTree className="h-5 w-5 text-sky-600" aria-hidden />
          <span>{heading}</span>
        </span>
      </Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        current={heading}
        className="mt-5"
      />
      <section aria-label={heading} className="my-4 space-y-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <Link
            to={`/funds/programme/${encodeURIComponent(data.programCode)}`}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {subtitle}
          </Link>
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.procedureCode}
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

        <TopBeneficiaries rows={data.topBeneficiaries} />
        <TopContracts rows={data.topContracts} />

        <p className="text-[11px] text-muted-foreground">
          {t("funds_procedure_source_hint")}
        </p>
      </section>
    </>
  );
};
