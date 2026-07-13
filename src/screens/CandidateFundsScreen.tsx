// Standalone per-MP EU-funds detail page (/candidate/:id/funds). Reached from
// the "See all" link on the MpConnectedFundsTile. Lists every EU-funds
// beneficiary connected to this MP with the underlying relation(s) and totals.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Euro } from "lucide-react";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useMpConnectedFunds } from "@/data/funds/useMpConnectedFunds";
import { CandidateHeader } from "./components/candidates/CandidateHeader";
import { ErrorSection } from "./components/ErrorSection";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import { formatEur } from "@/lib/currency";

export const CandidateFundsScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { canonical } = useResolvedCandidate(id);
  const { isEn, nameForBg } = useCandidateName();
  const fallback =
    id && !id.startsWith("mp-") && !id.startsWith("c-")
      ? decodeURIComponent(id)
      : null;
  const lookupName = canonical?.name ?? fallback;
  const displayName = canonical
    ? isEn
      ? canonical.name_en
      : canonical.name
    : nameForBg(fallback);
  const { entries, summary, isLoading } = useMpConnectedFunds(lookupName);

  if (!lookupName) return null;

  if (!isLoading && entries.length === 0) {
    return (
      <ErrorSection
        title={displayName}
        description={
          t("funds_no_connected_long") ||
          "No EU-funds beneficiaries were found for companies connected to this candidate. Either the MP's known business graph doesn't intersect the ИСУН register, or no such company has signed an EU-funds contract."
        }
      />
    );
  }

  return (
    <>
      <CandidateHeader
        displayName={displayName}
        lookupName={lookupName}
        cikRows={canonical?.cikRows}
        subtitle={
          t("funds_page_title") || "Connected companies receiving EU funds"
        }
        seoDescription={`EU-funds beneficiaries connected to ${displayName}`}
      />
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-12">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t("funds_page_intro") ||
              "Each row is a company that received an EU-funds contract AND has a recorded business linkage (Commerce Registry role or property-declaration stake) to this MP."}
          </p>
          {entries.length > 0 ? (
            <p className="text-sm">
              <strong>{entries.length}</strong>{" "}
              {t("funds_page_companies") || "company/-ies"} ·{" "}
              <strong>{summary.contractCount}</strong>{" "}
              {t("funds_page_contracts") || "contract(s)"} ·{" "}
              <strong>{formatEur(summary.contractedEur)}</strong>{" "}
              {t("funds_page_contracted") || "contracted"} ·{" "}
              <strong>{formatEur(summary.paidEur)}</strong>{" "}
              {t("funds_page_paid") || "paid"}
            </p>
          ) : null}
        </header>

        <ul className="flex flex-col gap-3">
          {entries.map((e) => (
            <li
              key={e.beneficiaryEik}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Euro className="h-4 w-4 text-muted-foreground" />
                <Link
                  to={`/company/${e.beneficiaryEik}`}
                  className="text-base font-semibold hover:underline"
                >
                  {e.beneficiaryName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {t("eik")} {e.beneficiaryEik}
                </span>
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {formatEur(e.contractedEur)}
                </span>
              </div>
              <div className="mt-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  {t("funds_page_relation") || "Relation"}:
                </span>{" "}
                {summarizeFundsRelations(t, e.relations)}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {orgTypeLabel(e.orgType, i18n.language)} · {e.contractCount}{" "}
                {t("funds_page_contracts") || "contract(s)"} ·{" "}
                {formatEur(e.paidEur)} {t("funds_page_paid") || "paid"}
              </div>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-muted-foreground/80">
          {t("funds_page_source_hint") ||
            "Source: ИСУН 2020 public beneficiary register. MP linkages from cacbg property declarations and Commerce Registry filings. Connections describe what the MP has declared or is on record for — they are not in themselves an accusation of wrongdoing."}
        </p>
      </div>
    </>
  );
};
