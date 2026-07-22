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
import { formatAmountEur, formatEur } from "@/lib/currency";
import { splitContractTitle } from "@/lib/contractTitle";
import {
  projectFromContract,
  projectHref,
} from "@/data/procurement/projectStore";
import { ProcurementBreadcrumb } from "./components/procurement/ProcurementBreadcrumb";
import { TrackAsProjectFileLink } from "./components/procurement/TrackAsProjectFileLink";
import { ProjectFileUpLink } from "./components/procurement/ProjectFileUpLink";
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
      <ProcurementBreadcrumb
        section={{
          labelKey: "procurement_contracts_title",
          to: "/procurement/contracts",
        }}
        current={
          splitContractTitle(c.title).main ||
          c.title ||
          t("contract_untitled") ||
          "Untitled contract"
        }
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
        {c.consortiumRole === "member" && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            Този договор е спечелен от <strong>обединение</strong>. Пълната
            стойност на договора е{" "}
            <strong>
              {formatEur(c.consortiumFullEur ?? 0, i18n.language)}
            </strong>
            , записана при водещото обединение
            {c.consortiumEik ? (
              <>
                {" — "}
                <Link
                  to={`/company/${c.consortiumEik}`}
                  className="text-primary hover:underline"
                >
                  виж обединението
                </Link>
              </>
            ) : null}
            . Този запис е за фирма-участник (затова стойността по-долу е 0) —
            реалният дял на всеки член не е публичен.
          </div>
        )}
        {c.jointKind === "framework" && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <strong>Рамково споразумение</strong> с няколко изпълнители —
            показаната стойност е споделен таван, а не гарантиран приход за този
            изпълнител.
          </div>
        )}
        <ContractValueBases contract={c} />
        {riskResult ? (
          <div className="pt-2">
            <RiskBadges result={riskResult} variant="full" />
          </div>
        ) : null}
        {/* Member→file up-link (§10 Phase 3) — a curated dossier that includes this
            contract, if any. */}
        <ProjectFileUpLink id={c.key} />
        {/* "Проследи като досие" on-ramp (§4.3b) — seed a project file from this
            contract (title + this row force-included, plus its procedure). */}
        <TrackAsProjectFileLink
          to={projectHref(
            projectFromContract({
              key: c.key,
              unp: c.unp,
              titleSeed: splitContractTitle(c.title).main || c.title || "",
            }),
          )}
        />
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
            {c.tenderSourceUrl ? (
              <p>
                {t("contract_source_hint_tender") ||
                  "The originating procedure in the open-data feed:"}{" "}
                <a
                  href={c.tenderSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  {t("contract_view_tender_source") ||
                    "Поръчки — storage.eop.bg (пълни данни за деня)"}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            ) : null}
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

// The value bases as a visual ladder: прогнозна → при сключване → текуща, each a
// bar scaled to the largest so the annex-driven growth reads at a glance. This
// replaced an inline "текуща стойност · при сключване €X (+Δ)" run that read as a
// contradiction (текуща = current) and repeated the same figure + delta twice.
// Only the bases that exist are shown:
//   • прогнозна  — the procedure estimate (estimatedValueEur), whole-procedure
//   • при сключване — the at-signing value (signingAmountEur); present ONLY when
//     an annex later moved the value, so current ≠ signed
//   • текуща     — the current (post-annex) value (amountEur), the emphasised row
const ContractValueBases: FC<{ contract: ProcurementContract }> = ({
  contract: c,
}) => {
  const { t, i18n } = useTranslation();
  if (c.amount == null) return null;
  const { primary, original } = formatAmountEur(
    c.amountEur,
    c.amount,
    c.currency,
    i18n.language,
  );
  const current = c.amountEur;
  const signed = c.signingAmountEur ?? null;
  const estimated = c.estimatedValueEur ?? null;
  const fmt = (v: number) =>
    formatAmountEur(v, undefined, "EUR", i18n.language).primary;

  type Stage = {
    key: string;
    label: string;
    // Normal-case suffix printed after the uppercase label (e.g. the procedure
    // scope on прогнозна) — kept out of the label so it doesn't read as SHOUTING.
    qualifier?: string;
    value: number;
    emphasis?: boolean;
  };
  const stages: Stage[] = [];
  if (current != null) {
    if (estimated != null)
      stages.push({
        key: "estimated",
        label: t("contract_estimated_short") || "estimated",
        qualifier: t("contract_estimated_qualifier") || "(whole procedure)",
        value: estimated,
      });
    if (signed != null)
      stages.push({
        key: "signed",
        label: t("contract_signed_at") || "at signing",
        value: signed,
      });
    stages.push({
      key: "current",
      label: t("contract_current_value") || "current value",
      value: current,
      emphasis: true,
    });
  }

  // A foreign-currency row with no EUR conversion, or a single lone basis → keep
  // the plain headline (the ladder needs ≥2 comparable EUR figures to be worth it).
  if (current == null || stages.length < 2) {
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
  }

  const max = Math.max(...stages.map((st) => st.value), 1);
  // Growth of the current value over its baseline — the signed value when an
  // annex moved it, else the procedure estimate. Positive = the value grew past
  // the baseline (cost overrun), surfaced red to mirror the risk convention.
  const baseline = signed ?? estimated;
  const showDelta =
    baseline != null && baseline > 0 && Math.abs(current - baseline) >= 0.005;
  const deltaPct = showDelta ? ((current - baseline) / baseline) * 100 : 0;
  // Read the note as natural language: "{p} над/под {baseline}" where p is the
  // ABSOLUTE percentage (the sign lives in the над/под word, not a "-" prefix).
  const over = deltaPct >= 0;
  const p = `${Math.abs(deltaPct).toFixed(1)}%`;
  const growthNote = !showDelta
    ? null
    : signed != null
      ? over
        ? t("contract_value_over_signed", {
            p,
            defaultValue:
              "Current value is {{p}} above the signed value (annexes).",
          })
        : t("contract_value_under_signed", {
            p,
            defaultValue:
              "Current value is {{p}} below the signed value (annexes).",
          })
      : over
        ? t("contract_value_over_estimated", {
            p,
            defaultValue:
              "Current value is {{p}} above the procedure estimate.",
          })
        : t("contract_value_under_estimated", {
            p,
            defaultValue:
              "Current value is {{p}} below the procedure estimate.",
          });

  return (
    <div className="space-y-2 max-w-xl">
      <div className="space-y-2.5">
        {stages.map((st) => (
          <div key={st.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {st.label}
                {st.qualifier ? (
                  <span className="normal-case text-muted-foreground/70">
                    {" "}
                    {st.qualifier}
                  </span>
                ) : null}
              </span>
              <span
                className={
                  "tabular-nums " +
                  (st.emphasis
                    ? "text-2xl font-bold"
                    : "text-sm font-medium text-muted-foreground")
                }
              >
                {fmt(st.value)}
                {st.emphasis && showDelta ? (
                  <span
                    className={
                      "ml-2 text-sm font-semibold " +
                      (deltaPct >= 0 ? "text-red-600" : "text-emerald-600")
                    }
                  >
                    {deltaPct >= 0 ? "+" : ""}
                    {deltaPct.toFixed(1)}%
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={
                  "h-full rounded-full " +
                  (st.emphasis ? "bg-primary" : "bg-muted-foreground/40")
                }
                style={{ width: `${Math.max((st.value / max) * 100, 2)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {growthNote ? (
        <p className="text-[11px] text-muted-foreground">{growthNote}</p>
      ) : null}
      {original ? (
        <p className="text-[11px] text-muted-foreground/80">
          {t("contract_originally") || "originally"} {original}
        </p>
      ) : null}
    </div>
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
