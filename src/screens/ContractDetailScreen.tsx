// /procurement/contract/:id — single-contract share-friendly detail page.
// Only contracts in the bounded subset (top-N by amount + MP-tied) have a
// by-id file on disk; unknown keys render NotFound.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt, ExternalLink } from "lucide-react";
import { useContract } from "@/data/procurement/useContract";
import { useContractRiskFlags } from "@/data/procurement/useContractRiskFlags";
import { formatAmountEur } from "@/lib/currency";
import { resolveContractSource } from "./components/candidates/procurement/sourceUrl";
import { ErrorSection } from "./components/ErrorSection";
import { RiskBadges } from "./components/procurement/RiskBadges";

export const ContractDetailScreen: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { data: c, isLoading } = useContract(id);
  const { result: riskResult } = useContractRiskFlags(c);

  if (isLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-8" aria-hidden>
        <div className="min-h-[300px]" />
      </div>
    );
  }
  if (!c) {
    return (
      <ErrorSection
        title={t("contract_not_found_title") || "Contract not found"}
        description={
          t("contract_not_found_desc") ||
          "This contract is not in the shareable subset (top contracts + MP-tied) or the id is incorrect. Browse the full corpus on the procurement index page."
        }
      />
    );
  }

  const tagLabel =
    c.tag === "contractAmendment"
      ? t("contract_tag_amendment") || "Contract amendment"
      : c.tag === "contract"
        ? t("contract_tag_contract") || "Signed contract"
        : t("contract_tag_award") || "Award notice";

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-12 space-y-6">
      <header className="space-y-2 pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          {tagLabel}
          {c.dateSigned ? (
            <span>
              · {t("contract_signed") || "Signed"} {c.dateSigned}
            </span>
          ) : (
            <span>· {c.date}</span>
          )}
        </p>
        <h1 className="text-xl md:text-2xl font-semibold leading-snug">
          {c.title || t("contract_untitled") || "Untitled contract"}
        </h1>
        {c.amount != null
          ? (() => {
              const { primary, original } = formatAmountEur(
                c.amountEur,
                c.amount,
                c.currency,
                i18n.language,
              );
              return (
                <p className="text-2xl font-bold tabular-nums">
                  {primary}
                  {original ? (
                    <span className="block text-sm font-normal text-muted-foreground">
                      {t("contract_originally") || "originally"} {original}
                    </span>
                  ) : null}
                </p>
              );
            })()
          : null}
        {riskResult ? (
          <div className="pt-2">
            <RiskBadges result={riskResult} variant="full" />
          </div>
        ) : null}
      </header>

      <section className="rounded-xl border bg-card p-4 shadow-sm space-y-2 text-sm">
        <KvRow
          label={t("contract_awarder") || "Awarder"}
          value={
            <span>
              {c.awarderName}{" "}
              <span className="text-xs text-muted-foreground">
                EIK {c.awarderEik}
              </span>
            </span>
          }
        />
        <KvRow
          label={t("contract_contractor") || "Contractor"}
          value={
            <Link
              to={`/company/${c.contractorEik}`}
              className="hover:underline"
            >
              {c.contractorName}{" "}
              <span className="text-xs text-muted-foreground">
                EIK {c.contractorEik}
              </span>
            </Link>
          }
        />
        {c.cpv ? (
          <KvRow
            label={t("contract_cpv") || "CPV code"}
            value={<span className="font-mono">{c.cpv}</span>}
          />
        ) : null}
        {c.procurementMethod ? (
          <KvRow
            label={t("contract_method") || "Procedure"}
            value={c.procurementMethod}
          />
        ) : null}
        {c.category ? (
          <KvRow
            label={t("contract_category") || "Category"}
            value={c.category}
          />
        ) : null}
        <KvRow
          label={t("contract_date_published") || "Release date"}
          value={c.date}
        />
        {c.ocid ? (
          <KvRow
            label={t("contract_ocid") || "OCID"}
            value={<span className="font-mono text-xs">{c.ocid}</span>}
          />
        ) : null}
      </section>

      <div className="space-y-1 text-[11px] text-muted-foreground/80">
        {(() => {
          // The CAIS ЕОП procedure page is the journalism-quality source for
          // OCDS rows — full timeline, decisions, attached documents. For
          // legacy rows it doesn't exist; fall back to data.egov.bg.
          const src = resolveContractSource(c);
          if (src.label === "eop") {
            return (
              <p>
                {t("contract_source_hint_eop") ||
                  "Procurement record on the public registry (CAIS ЕОП):"}{" "}
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  {t("contract_view_eop") || "Open in CAIS ЕОП"}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            );
          }
          return (
            <p>
              {t("contract_source_hint_legacy") ||
                "Legacy contract — the per-record permalink isn't available; see the dataset:"}{" "}
              <a
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                data.egov.bg <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          );
        })()}
        <p>
          {t("contract_source_hint_release") ||
            "Raw OCDS release JSON (data.egov.bg bundle):"}{" "}
          <a
            href={c.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            {t("contract_view_source") || "View source"}{" "}
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
};

const KvRow: FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
    <dt className="text-xs uppercase tracking-wide text-muted-foreground min-w-[100px]">
      {label}
    </dt>
    <dd>{value}</dd>
  </div>
);
