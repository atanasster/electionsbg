// /tenders/:unp — single procedure (tender) detail. The "see the truthful full
// details" surface for a procurement claim: estimated (прогнозна) value, every
// lot, status, and the lineage to a signed contract. This is what a fact-check
// post links to for one procedure (the "мантинели за 1 млрд" case).
//
// Estimated value is a FORECAST, not money spent — labeled throughout.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ClipboardList,
  ChevronLeft,
  ExternalLink,
  Layers,
  Info,
} from "lucide-react";
import { useTender } from "@/data/procurement/useTender";
import { formatAmountEur } from "@/lib/currency";
import {
  displayProcurementMethod,
  contractCategoryLabel,
} from "@/lib/cpvSectors";
import { ErrorSection } from "../components/ErrorSection";
import { KvRow } from "../components/procurement/KvRow";

// Localized date-time for the submission deadline (BG "15 юни 2026 г., 14:30",
// EN "15 Jun 2026, 14:30"), falling back to the trimmed ISO if it won't parse.
const formatDeadline = (iso: string, lang: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const TenderDetailScreen: FC = () => {
  const { unp } = useParams<{ unp: string }>();
  const { t, i18n } = useTranslation();
  const { data: tender, isLoading } = useTender(unp);

  if (isLoading) {
    return (
      <section className="my-4" aria-hidden>
        <div className="min-h-[300px]" />
      </section>
    );
  }
  if (!tender) {
    return (
      <ErrorSection
        title={t("tender_not_found_title") || "Procedure not found"}
        description={
          t("tender_not_found_desc") ||
          "This procedure number isn't in the tender corpus, or the number is incorrect."
        }
      />
    );
  }

  const est =
    tender.estimatedValueEur != null
      ? formatAmountEur(
          tender.estimatedValueEur,
          tender.estimatedValueNative,
          tender.currency,
          i18n.language,
        )
      : null;
  const statusLabel = tender.isCancelled
    ? t("tender_status_cancelled") || "Cancelled"
    : t("tender_status_announced") || "Announced";

  return (
    <section className="my-4 space-y-6">
      <header className="space-y-2">
        <Link
          to="/procurement/tenders"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-3 w-3" />
          {t("procurement_tenders_nav") || "Tenders"}
        </Link>
        <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          {t("tender_kicker") || "Announced procedure (tender)"}
          <span>· {tender.publicationDate}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              tender.isCancelled
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            }`}
          >
            {statusLabel}
          </span>
          {tender.hasUnsecuredFunding ? (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">
              {t("tender_unsecured_funding") || "Unsecured funding"}
            </span>
          ) : null}
        </p>
        <h1 className="text-xl md:text-2xl font-semibold leading-snug">
          {tender.subject}
        </h1>
        {est ? (
          <div>
            <p className="text-2xl font-bold tabular-nums">
              {est.primary}
              {est.original ? (
                <span className="block text-sm font-normal text-muted-foreground">
                  {t("tender_originally") || "originally"} {est.original}
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Info className="h-3 w-3" />
              {t("tender_estimated_caption") ||
                "Estimated (announced) value — a forecast, not money spent."}
            </p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-xl border bg-card p-4 shadow-sm space-y-2 text-sm">
          <KvRow
            label={t("contract_awarder") || "Buyer"}
            value={
              <Link
                to={`/awarder/${tender.buyerEik}`}
                className="hover:underline"
              >
                {tender.buyerName}{" "}
                <span className="text-xs text-muted-foreground">
                  EIK {tender.buyerEik}
                </span>
              </Link>
            }
          />
          {tender.buyerMainActivity ? (
            <KvRow
              label={t("tender_label_buyer_activity") || "Buyer activity"}
              value={tender.buyerMainActivity}
            />
          ) : null}
          {tender.procedureType ? (
            <KvRow
              label={t("contract_method") || "Procedure"}
              value={displayProcurementMethod(
                tender.procedureType,
                i18n.language,
              )}
            />
          ) : null}
          {tender.noticeType ? (
            <KvRow
              label={t("tender_label_notice_type") || "Notice type"}
              value={tender.noticeType}
            />
          ) : null}
          {tender.legalBasis ? (
            <KvRow
              label={t("tender_label_legal_basis") || "Legal basis"}
              value={tender.legalBasis}
            />
          ) : null}
          {tender.awardMethod ? (
            <KvRow
              label={t("tender_label_award_method") || "Award method"}
              value={tender.awardMethod}
            />
          ) : null}
          {tender.cpv ? (
            <KvRow
              label={t("contract_cpv") || "CPV code"}
              value={
                <span>
                  <span className="font-mono">{tender.cpv}</span>
                  {tender.cpvDesc ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {tender.cpvDesc}
                    </span>
                  ) : null}
                </span>
              }
            />
          ) : null}
          {tender.contractType ? (
            <KvRow
              label={t("contract_category") || "Category"}
              value={contractCategoryLabel(tender.contractType, i18n.language)}
            />
          ) : null}
          {tender.isEuFunded ? (
            <KvRow
              label={t("contract_eu_funding") || "EU funding"}
              value={
                tender.euProgram ||
                t("tender_label_eu_cofinanced") ||
                "EU co-financed"
              }
            />
          ) : null}
          {tender.submissionDeadline ? (
            <KvRow
              label={
                t("tender_label_submission_deadline") || "Submission deadline"
              }
              value={formatDeadline(tender.submissionDeadline, i18n.language)}
            />
          ) : null}
          <KvRow
            label={t("tender_unp") || "Procedure no."}
            value={<span className="font-mono">{tender.unp}</span>}
          />
          {tender.ocid ? (
            <KvRow
              label={t("contract_ocid") || "OCID"}
              value={<span className="font-mono text-xs">{tender.ocid}</span>}
            />
          ) : null}
        </section>

        <div className="space-y-4">
          {tender.lots.length > 0 ? (
            <section className="rounded-xl border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                <Layers className="h-4 w-4 text-sky-600" />
                {t("tender_lots") || "Lots"} (
                {tender.lotsCount ?? tender.lots.length})
              </h2>
              <ul className="space-y-2 text-sm">
                {tender.lots.map((lot) => (
                  <li
                    key={lot.lotId}
                    className="border-t pt-2 first:border-0 first:pt-0"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {t("tender_lot_short") || "Lot"} {lot.lotId}
                      </span>
                      <span className="tabular-nums font-medium">
                        {lot.estimatedValueEur != null
                          ? formatAmountEur(
                              lot.estimatedValueEur,
                              lot.estimatedValueNative,
                              lot.currency,
                              i18n.language,
                            ).primary
                          : "—"}
                      </span>
                    </div>
                    {lot.name ? (
                      <p className="text-muted-foreground">
                        {lot.name.length > 120
                          ? lot.name.slice(0, 119) + "…"
                          : lot.name}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-1.5 text-[11px] text-muted-foreground/80">
            <p>
              {t("tender_source_hint") ||
                "Procedure record on the public registry (ЦАИС ЕОП open data):"}{" "}
              <a
                href={tender.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {t("contract_view_eop_data") || "ЦАИС ЕОП open data"}{" "}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            {tender.linkToOjEu ? (
              <p>
                <a
                  href={tender.linkToOjEu}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  {t("tender_view_ted") || "View on TED"}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};
