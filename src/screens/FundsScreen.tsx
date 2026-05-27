// /funds — EU-funds (ИСУН) landing page. Corpus totals, the public-law vs
// private-law split, top beneficiaries, and the MP cross-reference. The data
// is an all-time per-organisation rollup (no election-date dimension), so
// unlike /procurement there is no per-NS scope toggle.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Banknote, Building2, Coins, ExternalLink, Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { useFundsIndex } from "@/data/funds/useFundsIndex";
import { useFundsMpConnectedFile } from "@/data/funds/useMpConnectedFunds";
import { useFundsProjectsIndex } from "@/data/funds/useFundsProjectsIndex";
import { ProjectsStatusMixTile } from "./funds/ProjectsStatusMixTile";
import { TopProgramsTile } from "./funds/TopProgramsTile";
import { GeographyMixTile } from "./funds/GeographyMixTile";
import { FundsMuniMapTile } from "./funds/FundsMuniMapTile";
import { orgFormLabel, orgTypeLabel } from "@/data/funds/orgLabels";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import { formatEur } from "@/lib/currency";
import type {
  FundsBreakdownRow,
  FundsIndexFile,
  FundsMpConnectedFile,
  FundsTopRow,
} from "@/data/funds/types";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[140px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

const BreakdownRow: FC<{
  label: string;
  row: FundsBreakdownRow;
  max: number;
}> = ({ label, row, max }) => {
  const { t } = useTranslation();
  const pct = Math.max(2, Math.round((row.contractedEur / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {formatEur(row.contractedEur)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {numFmt.format(row.beneficiaries)}{" "}
        {t("funds_breakdown_beneficiaries") || "beneficiaries"} ·{" "}
        {numFmt.format(row.contractCount)}{" "}
        {t("funds_breakdown_contracts") || "contracts"}
      </div>
    </div>
  );
};

const BreakdownCard: FC<{ index: FundsIndexFile }> = ({ index }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const formMax = Math.max(...index.byOrgForm.map((r) => r.contractedEur), 1);
  const typeMax = Math.max(...index.byOrgType.map((r) => r.contractedEur), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t("funds_breakdown_title") || "Where the money goes"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-3 md:p-4">
        <div className="space-y-2.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("funds_breakdown_by_form") || "By legal form"}
          </div>
          {index.byOrgForm.map((r) => (
            <BreakdownRow
              key={r.key}
              label={orgFormLabel(r.key, lang)}
              row={r}
              max={formMax}
            />
          ))}
        </div>
        <div className="space-y-2.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("funds_breakdown_by_type") || "By organisation type"}
          </div>
          {index.byOrgType.map((r) => (
            <BreakdownRow
              key={r.key}
              label={orgTypeLabel(r.key, lang)}
              row={r}
              max={typeMax}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

const TopBeneficiariesCard: FC<{ rows: FundsTopRow[] }> = ({ rows }) => {
  const { t, i18n } = useTranslation();
  const visible = rows.slice(0, 15);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t("funds_top_title") || "Top beneficiaries by funds contracted"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((r, i) => (
            <li
              key={r.eik ?? `${r.name}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              {r.eik ? (
                <Link
                  to={`/company/${r.eik}`}
                  className="font-medium hover:underline"
                >
                  {r.name}
                </Link>
              ) : (
                <span className="font-medium">{r.name}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {orgTypeLabel(r.orgType, i18n.language)}
              </span>
              {r.mpTied ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {t("funds_mp_badge") || "MP-connected"}
                </span>
              ) : null}
              <span className="ml-auto text-sm font-medium tabular-nums">
                {formatEur(r.contractedEur)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

const MpConnectedCard: FC<{ file: FundsMpConnectedFile }> = ({ file }) => {
  const { t } = useTranslation();
  const visible = file.entries.slice(0, 12);
  return (
    <Card className="ring-1 ring-amber-200/60 dark:ring-amber-800/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Users className="h-4 w-4 text-amber-600" />
          {t("funds_mp_title") || "MP-connected beneficiaries"}
          <span className="text-xs font-normal text-muted-foreground">
            {file.mpCount} {t("funds_mp_mps") || "MPs"} ·{" "}
            {file.beneficiaryCount} {t("funds_mp_companies") || "companies"} ·{" "}
            {formatEur(file.contractedEur)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-2 text-xs text-muted-foreground">
          {t("funds_mp_intro") ||
            "Beneficiary companies in which a sitting or former MP has a declared ownership stake or a Commerce Registry management role."}
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((e) => (
            <li
              key={`${e.mpId}-${e.beneficiaryEik}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <MpAvatar mpId={e.mpId} name={e.mpName} />
              <Link
                to={`/candidate/mp-${e.mpId}/funds`}
                className="font-medium hover:underline"
              >
                {e.mpName}
              </Link>
              <span className="text-xs text-muted-foreground">
                → {e.beneficiaryName}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {summarizeFundsRelations(t, e.relations)}
              </span>
              <span className="ml-auto text-sm font-medium tabular-nums">
                {formatEur(e.contractedEur)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[11px] text-muted-foreground/80">
          {t("funds_mp_source_hint") ||
            "MP linkages from Court-of-Audit declarations and Commerce Registry filings. A connection describes what the MP is on record for — not in itself an accusation of wrongdoing."}
        </div>
      </CardContent>
    </Card>
  );
};

const SourceFooter: FC = () => {
  const { t } = useTranslation();
  return (
    <p className="mt-4 text-[11px] text-muted-foreground/80">
      {t("funds_index_source_hint") ||
        "Source: ИСУН 2020 public beneficiary register."}{" "}
      <a
        href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 text-primary hover:underline"
      >
        2020.eufunds.bg <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
};

export const FundsScreen: FC = () => {
  const { t } = useTranslation();
  const { data: index, isLoading } = useFundsIndex();
  const { data: mpFile } = useFundsMpConnectedFile();
  const { data: projectsIndex } = useFundsProjectsIndex();

  const title = t("funds_index_title") || "EU funds";
  const description =
    "EU-funds beneficiaries from the ИСУН 2020 public register — funds contracted and paid, and the MP cross-reference.";

  if (isLoading) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section aria-label={title} className="my-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </>
    );
  }

  if (!index) return null;

  const { totals } = index;
  const cr = index.crossReference;
  const absorption =
    totals.contractedEur > 0
      ? Math.round((totals.paidEur / totals.contractedEur) * 100)
      : 0;
  const eikPct =
    totals.beneficiaries > 0
      ? Math.round((totals.withEik / totals.beneficiaries) * 100)
      : 0;

  return (
    <>
      <Title description={description}>{title}</Title>
      <section aria-label={title} className="my-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("funds_index_intro") ||
            "Every organisation that has signed an EU-funds contract recorded in ИСУН 2020 — the 2014-2020 and 2021-2027 programmes plus the Recovery Plan."}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("funds_index_beneficiaries") || "Beneficiaries"}
            hint={
              t("funds_index_beneficiaries_hint") ||
              "Distinct organisations with at least one EU-funds contract."
            }
          >
            <div className="flex items-baseline gap-2">
              <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(totals.beneficiaries)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {numFmt.format(totals.contractCount)}{" "}
              {t("funds_index_contracts") || "contracts"} · {eikPct}%{" "}
              {t("funds_index_with_eik") || "with EIK"}
            </div>
          </StatCard>

          <StatCard
            label={t("funds_index_contracted") || "Funds contracted"}
            hint={
              t("funds_index_contracted_hint") ||
              "Total value of signed EU-funds contracts (Договорени средства)."
            }
          >
            <div className="flex items-baseline gap-2">
              <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="break-words text-base font-bold tabular-nums md:text-lg">
                {formatEur(totals.contractedEur)}
              </span>
            </div>
          </StatCard>

          <StatCard
            label={t("funds_index_paid") || "Funds paid"}
            hint={
              t("funds_index_paid_hint") ||
              "Total actually disbursed to beneficiaries (Реално изплатени суми)."
            }
          >
            <div className="flex items-baseline gap-2">
              <Banknote className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="break-words text-base font-bold tabular-nums md:text-lg">
                {formatEur(totals.paidEur)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {absorption}% {t("funds_index_disbursed") || "of contracted"}
            </div>
          </StatCard>

          <StatCard
            label={t("funds_index_mp_tied") || "MP-connected"}
            hint={
              t("funds_index_mp_hint") ||
              "MPs whose declared business interests intersect EU-funds beneficiaries."
            }
            className="ring-1 ring-amber-200/60 dark:ring-amber-800/40"
          >
            <div className="flex items-baseline gap-2">
              <Users className="h-5 w-5 shrink-0 text-amber-600" />
              <span className="text-2xl font-bold tabular-nums">
                {cr ? numFmt.format(cr.mpCount) : "—"}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("funds_index_mp_count") || "MPs"}
              </span>
            </div>
            {cr ? (
              <>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {numFmt.format(cr.beneficiaryCount)}{" "}
                  {t("funds_index_mp_companies") || "companies"}
                </div>
                <div className="text-xs font-medium tabular-nums">
                  {formatEur(cr.contractedEur)}
                </div>
              </>
            ) : null}
          </StatCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <BreakdownCard index={index} />
          <TopBeneficiariesCard rows={index.topByContracted} />
        </div>

        {projectsIndex ? (
          <>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {t("funds_projects_section_title")}
              </h2>
              <span className="text-xs text-muted-foreground">
                {t("funds_projects_section_subtitle", {
                  contracts: numFmt.format(projectsIndex.totals.contractCount),
                })}
              </span>
            </div>
            <FundsMuniMapTile />
            <div className="grid gap-4 xl:grid-cols-2">
              <ProjectsStatusMixTile index={projectsIndex} />
              <GeographyMixTile index={projectsIndex} />
            </div>
            <TopProgramsTile index={projectsIndex} />
          </>
        ) : null}

        {mpFile && mpFile.entries.length > 0 ? (
          <MpConnectedCard file={mpFile} />
        ) : null}

        <SourceFooter />
      </section>
    </>
  );
};
