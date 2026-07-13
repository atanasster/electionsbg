// /procurement/contract/:id — single-contract dashboard detail page.
// Only contracts in the bounded subset (top-N by amount + MP-tied) have a
// by-id file on disk; unknown keys render NotFound. Dashboard layout: fills the
// Layout container (no narrow max-w cap), header full width, then a 2/3 + 1/3
// grid of cards on wide screens.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Receipt,
  ExternalLink,
  Users,
  Landmark,
  Download,
  ClipboardList,
  Layers,
  GitPullRequest,
  Gavel,
  ArrowRight,
} from "lucide-react";
import { useContract } from "@/data/procurement/useContract";
import { useTenderLineage } from "@/data/procurement/useTenderLineage";
import type { ProcurementContract } from "@/data/dataTypes";
import { useContractRiskFlags } from "@/data/procurement/useContractRiskFlags";
import { useProcurementMpConnectedByEik } from "@/data/procurement/useMpConnectedByEik";
import { usePepConnectedByEik } from "@/data/procurement/usePepConnectedByEik";
import { formatAmountEur } from "@/lib/currency";
import { splitContractTitle } from "@/lib/contractTitle";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import {
  displayProcurementMethod,
  contractCategoryLabel,
} from "@/lib/cpvSectors";
import { resolveContractSource } from "./components/candidates/procurement/sourceUrl";
import { summarizeRelations } from "./components/candidates/procurement/relationLabel";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { ErrorSection } from "./components/ErrorSection";
import { RiskBadges } from "./components/procurement/RiskBadges";
import { FollowStar } from "./components/procurement/FollowStar";
import { KvRow } from "./components/procurement/KvRow";
import { ContractNormalcyPanel } from "./components/procurement/ContractNormalcyPanel";

const officialRoleLabel = (role: string, t: (k: string) => string): string => {
  const key = `official_role_${role}`;
  const translated = t(key);
  return translated === key ? role.replace(/_/g, " ") : translated;
};

export const ContractDetailScreen: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { data: c, isLoading } = useContract(id);
  const { result: riskResult } = useContractRiskFlags(c);

  if (isLoading) {
    return (
      <section className="my-4" aria-hidden>
        <div className="min-h-[300px]" />
      </section>
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
    <section className="my-4 space-y-6">
      <Breadcrumbs
        items={[
          { label: t("nav_governance"), to: "/governance" },
          { label: t("procurement_index_title"), to: "/procurement" },
          {
            label: t("procurement_contracts_title"),
            to: "/procurement/contracts",
          },
          {
            label:
              splitContractTitle(c.title).main ||
              c.title ||
              t("contract_untitled") ||
              "Untitled contract",
          },
        ]}
      />
      <header className="space-y-2">
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
        {(() => {
          const fullTitle =
            c.title || t("contract_untitled") || "Untitled contract";
          const { main, lotLabel, lotDetail } = splitContractTitle(fullTitle);
          // Prefer the DB-recovered lot name (fuller than the АОП-truncated tail
          // in the title); fall back to whatever the title split yielded.
          const lotText = c.lotName || lotDetail;
          // Full title always visible (no truncation) — readability comes from
          // splitting off the lot qualifier and holding a sane line measure.
          return (
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <h1 className="text-lg md:text-xl font-semibold leading-snug max-w-[70ch]">
                  {main}
                </h1>
                {lotLabel && lotText ? (
                  <p className="mt-1.5 text-sm text-muted-foreground leading-snug max-w-[80ch]">
                    <span className="font-medium text-foreground">
                      {lotLabel}:
                    </span>{" "}
                    {lotText}
                  </p>
                ) : null}
              </div>
              {id ? (
                <FollowStar
                  kind="contract"
                  id={id}
                  label={fullTitle}
                  size="md"
                  className="mt-1 shrink-0"
                />
              ) : null}
            </div>
          );
        })()}
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

      <ContractNormalcyPanel contractKey={id} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-xl border bg-card p-4 shadow-sm space-y-2 text-sm">
          <KvRow
            label={t("contract_awarder") || "Awarder"}
            value={
              <Link to={`/company/${c.awarderEik}`} className="hover:underline">
                {c.awarderName}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("eik")} {c.awarderEik}
                </span>
              </Link>
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
                  {t("eik")} {c.contractorEik}
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
              value={displayProcurementMethod(
                c.procurementMethod,
                i18n.language,
              )}
            />
          ) : null}
          {c.procurementMethodRationale ? (
            <KvRow
              label={t("contract_rationale") || "Procedure rationale"}
              value={
                <span className="text-sm">{c.procurementMethodRationale}</span>
              }
            />
          ) : null}
          {typeof c.numberOfTenderers === "number" ? (
            <KvRow
              label={t("contract_bids") || "Bids"}
              value={
                <span className="tabular-nums">
                  {c.numberOfTenderers}
                  {c.numberOfTenderers === 1 ? (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      ·{" "}
                      {t("contract_bids_single") ||
                        "the sole bidder is the contractor"}
                    </span>
                  ) : null}
                </span>
              }
            />
          ) : null}
          {(() => {
            // Tender open window — the short-deadline ("rushed") red flag is
            // anything below the EU 14-day open-procedure reference. Surface the
            // span + day count so the risk chip is explainable here.
            if (!c.tenderPeriodStartDate || !c.tenderPeriodEndDate) return null;
            const start = Date.parse(c.tenderPeriodStartDate);
            const end = Date.parse(c.tenderPeriodEndDate);
            const days =
              Number.isFinite(start) && Number.isFinite(end) && end >= start
                ? Math.round((end - start) / 86_400_000)
                : null;
            return (
              <KvRow
                label={t("contract_tender_window") || "Tender window"}
                value={
                  <span className="tabular-nums">
                    {c.tenderPeriodStartDate} – {c.tenderPeriodEndDate}
                    {days != null ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {days} {t("contract_tender_days") || "days"}
                        {days < 14
                          ? ` · ${t("contract_tender_short") || "below the 14-day open-procedure reference"}`
                          : ""}
                      </span>
                    ) : null}
                  </span>
                }
              />
            );
          })()}
          {c.category ? (
            <KvRow
              label={t("contract_category") || "Category"}
              value={contractCategoryLabel(c.category, i18n.language)}
            />
          ) : null}
          {c.euFunded ? (
            <KvRow
              label={t("contract_eu_funding") || "EU funding"}
              value={
                <span className="text-sm">
                  {c.euProgram ||
                    t("contract_eu_funded_yes") ||
                    "EU co-financed"}
                </span>
              }
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

        <div className="space-y-4">
          <ContractTenderLineage contract={c} />
          <ContractConnectedPeople eik={c.contractorEik} />

          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-1.5 text-[11px] text-muted-foreground/80">
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
              if (src.label === "eop-data") {
                return (
                  <p>
                    {t("contract_source_hint_eop_data") ||
                      "From the ЦАИС ЕОП open-data feed (the daily contract file this record was published in):"}{" "}
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      {t("contract_view_eop_data") || "ЦАИС ЕОП open data"}{" "}
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
              {/* This record as clean JSON — mirrors SIGMA's per-contract JSON
                  download. Serialises the on-disk by-id row exactly. The raw
                  data.egov.bg bundle isn't linked: the host serves a site-wide
                  403, so any link there is dead — ЦАИС ЕОП above is the
                  authoritative public source. */}
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(c, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `contract-${c.key}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {i18n.language === "bg"
                  ? "Свали записа (JSON)"
                  : "Download this record (JSON)"}{" "}
                <Download className="h-3 w-3" />
              </button>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

// Lineage tile: the originating PROCEDURE (tender) this signed contract came
// from, resolved by the shared ocid. Surfaces the procedure's estimated
// (прогнозна) value, lot structure and status — the tender-stage facts the
// contracts-only corpus could never show (the "мантинели за 1 млрд" case).
// Renders nothing for legacy / non-OCDS contracts whose ocid has no tender.
const ContractTenderLineage: FC<{ contract: ProcurementContract }> = ({
  contract: c,
}) => {
  const { t, i18n } = useTranslation();
  const { data: lineage } = useTenderLineage(c.ocid);
  if (!lineage) return null;
  const est =
    lineage.estimatedValueEur != null
      ? formatAmountEur(
          lineage.estimatedValueEur,
          lineage.estimatedValueNative,
          lineage.currency,
          i18n.language,
        ).primary
      : null;

  // Forecast-vs-actual: sum the signed contracts sharing this procedure (mirrors
  // the tender page's TenderForecastActual) and express as a share of the forecast.
  const signedEur = lineage.awards
    .filter((a) => a.tag === "contract" && a.amountEur != null)
    .reduce((s, a) => s + (a.amountEur ?? 0), 0);
  const sharePct =
    lineage.estimatedValueEur && signedEur > 0
      ? Math.round((signedEur / lineage.estimatedValueEur) * 100)
      : null;

  const amendmentCount = lineage.awards.filter(
    (a) => a.tag === "contractAmendment",
  ).length;
  const underAppeal = Boolean(c.hasAppeal) || lineage.appeals.length > 0;
  const lotNum = splitContractTitle(c.title).lotLabel?.match(/\d+/)?.[0];
  const bids = c.numberOfTenderers;
  const href = `/tenders/${encodeURIComponent(lineage.unp)}`;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-indigo-600" />
        {t("tender_lineage_title") || "Originating procedure"}
      </h2>

      {est ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("tender_estimated_value") || "Estimated value (forecast)"}
          </p>
          <p className="text-lg font-bold tabular-nums">{est}</p>
          {sharePct != null ? (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(sharePct, 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("tender_fa_share", {
                  p: sharePct,
                  defaultValue: "Signed for {{p}}% of the forecast.",
                })}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <dl className="space-y-2 text-sm border-t pt-3">
        {lineage.lotsCount && lineage.lotsCount > 1 ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Layers className="h-4 w-4" />
              {t("tender_lots") || "Lots"}
            </span>
            <span className="tabular-nums">
              {lineage.lotsCount}
              {lotNum ? (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {t("tender_lineage_this_lot", {
                    n: lotNum,
                    defaultValue: "this is №{{n}}",
                  })}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        {bids != null ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4" />
              {t("contract_bids") || "Bids"}
            </span>
            <span className="tabular-nums">
              {bids === 1 ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                  {bids} · {t("contract_bids_single_short") || "single bidder"}
                </span>
              ) : (
                bids
              )}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <GitPullRequest className="h-4 w-4" />
            {t("tender_lineage_amendments") || "Amendments"}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {amendmentCount}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Gavel className="h-4 w-4" />
            {t("tender_appeals_title") || "КЗК appeals"}
          </span>
          {underAppeal ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              {t("tender_under_appeal") || "Under appeal (КЗК)"}
            </span>
          ) : (
            <span className="tabular-nums text-muted-foreground">
              {lineage.appeals.length}
            </span>
          )}
        </div>
      </dl>

      <Link
        to={href}
        className="flex items-center justify-center gap-1.5 rounded-md border border-primary/40 py-2 text-sm font-medium text-primary hover:bg-primary/5"
      >
        {t("tender_lineage_view") || "View procedure"}
        <ArrowRight className="h-4 w-4" />
      </Link>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
        <span>
          {t("tender_announced") || "Announced"} {lineage.publicationDate}
        </span>
        {lineage.linkToOjEu ? (
          <a
            href={lineage.linkToOjEu}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            {t("tender_view_ted") || "View on TED"}{" "}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </section>
  );
};

// The people behind the "MP-tied" / "official-tied" chips, made actionable —
// the parliamentarians and public officials declared as officers/owners of the
// winning contractor, with links to their pages. Renders nothing when none.
const ContractConnectedPeople: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { entries: mps } = useProcurementMpConnectedByEik(eik);
  const { entries: officials } = usePepConnectedByEik(eik);
  if (mps.length === 0 && officials.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Users className="h-4 w-4 text-amber-600" />
        {t("contract_connected_title") || "Connected people"}
      </h2>
      <ul className="space-y-2 text-sm">
        {mps.map((e) => (
          <li key={`mp-${e.mpId}`} className="flex items-start gap-2 flex-wrap">
            <Link
              to={`/candidate/mp-${e.mpId}/procurement`}
              className="font-medium hover:underline inline-flex items-center gap-2"
            >
              <MpAvatar mpId={e.mpId} name={e.mpName} />
              {e.mpName}
            </Link>
            {e.relations.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                — {summarizeRelations(t, e.relations)}
              </span>
            ) : null}
          </li>
        ))}
        {officials.map((e) => (
          <li
            key={`off-${e.slug}`}
            className="flex items-center gap-2 flex-wrap"
          >
            <Landmark className="h-4 w-4 shrink-0 text-teal-600" />
            <Link
              to={`/officials/${e.slug}`}
              className="font-medium hover:underline"
            >
              {e.name}
            </Link>
            <span className="text-xs text-muted-foreground">
              — {officialRoleLabel(e.role, t)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground/80">
        {t("contract_connected_hint") ||
          "Declared ties from public registers — not an accusation."}
      </p>
    </section>
  );
};
