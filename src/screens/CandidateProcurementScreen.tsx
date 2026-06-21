// Standalone per-MP procurement detail page (/candidate/:id/procurement).
// Reached from the "See all" link on the MpConnectedContractsTile on the
// candidate dashboard. Lists every contractor connected to this MP with the
// underlying relation(s), totals, byYear, and the top awarders that paid
// each contractor.

import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useMps } from "@/data/parliament/useMps";
import { useMpConnectedContracts } from "@/data/parliament/useMpConnectedContracts";
import { CandidateHeader } from "./components/candidates/CandidateHeader";
import { ErrorSection } from "./components/ErrorSection";
import { summarizeRelations } from "./components/candidates/procurement/relationLabel";
import { ConnectedContractorCard } from "./components/candidates/procurement/ConnectedContractorCard";
import { formatEurWithOther } from "@/lib/currency";

export const CandidateProcurementScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { canonical } = useResolvedCandidate(id);
  const { isEn, nameForBg } = useCandidateName();
  const { findMpById } = useMps();

  // The election-scoped resolver above only knows candidates on the *selected*
  // ballot. This page is reached from the procurement scanner for any MP with
  // declared business ties — many of whom aren't on the current ballot, so
  // their by-slug shard 404s and `canonical` is null. Fall back to the global,
  // election-independent parliament roster keyed by the `mp-<id>` param.
  const mpIdParam = id && /^mp-(\d+)$/.test(id) ? Number(id.slice(3)) : null;
  const rosterMp = mpIdParam != null ? findMpById(mpIdParam) : undefined;

  const fallback =
    id && !id.startsWith("mp-") && !id.startsWith("c-")
      ? decodeURIComponent(id)
      : null;
  const lookupName = canonical?.name ?? rosterMp?.name ?? fallback;
  const displayName = canonical
    ? isEn
      ? canonical.name_en
      : canonical.name
    : rosterMp
      ? isEn
        ? rosterMp.name_en
        : rosterMp.name
      : nameForBg(fallback);
  const { entries, summary, isLoading } = useMpConnectedContracts(lookupName);

  // Min/max year across every company's by-year breakdown — surfaces a period
  // qualifier on the stats line ("за периода 2011–2026") so the totals aren't
  // read as current-parliament-only.
  let minYear: string | null = null;
  let maxYear: string | null = null;
  for (const e of entries) {
    for (const r of e.byYear) {
      if (!minYear || r.year < minYear) minYear = r.year;
      if (!maxYear || r.year > maxYear) maxYear = r.year;
    }
  }

  if (!lookupName) return null;

  if (!isLoading && entries.length === 0) {
    return (
      <ErrorSection
        title={displayName}
        description={
          t("procurement_no_connected_long") ||
          "No public-procurement contracts were found for companies connected to this candidate. Either the MP's known business graph doesn't intersect the АОП dataset yet, or no such company won a contract during the ingested period."
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
          t("procurement_page_title") ||
          "Connected companies with public-procurement contracts"
        }
        seoDescription={`Public-procurement contracts awarded to companies connected to ${displayName}`}
      />
      <div className="w-full pb-8 space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t("procurement_page_intro") ||
              "Each row is a company that received a public-procurement contract AND has a recorded business linkage (Commerce Registry role or property-declaration stake) to this MP."}
          </p>
          {entries.length > 0 ? (
            <p className="text-sm">
              <strong>{entries.length}</strong>{" "}
              {t("procurement_page_companies") || "company/-ies"} ·{" "}
              <strong>{summary.contractCount}</strong>{" "}
              {t("procurement_page_contracts") || "contract(s)"} ·{" "}
              <strong>
                {formatEurWithOther(
                  summary.totalEur,
                  summary.totalOther,
                  i18n.language,
                )}
              </strong>{" "}
              {t("procurement_page_total_awarded") || "total awarded"}
              {minYear && maxYear ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {minYear === maxYear ? minYear : `${minYear}–${maxYear}`}{" "}
                  <span className="text-xs">
                    (
                    {t("procurement_page_period_hint") ||
                      "across the full available period"}
                    )
                  </span>
                </span>
              ) : null}
            </p>
          ) : null}
        </header>

        <ul className="flex flex-col gap-3">
          {entries.map((e) => (
            <ConnectedContractorCard
              key={e.contractorEik}
              entry={e}
              relationSummary={summarizeRelations(t, e.relations)}
            />
          ))}
        </ul>

        <p className="text-[11px] text-muted-foreground/80">
          {t("procurement_page_source_hint") ||
            "Source: data.egov.bg (АОП OCDS). MP linkages from cacbg property declarations and Commerce Registry filings. Connections describe what the MP has declared or is on record for — they are not in themselves an accusation of wrongdoing."}
        </p>
      </div>
    </>
  );
};
