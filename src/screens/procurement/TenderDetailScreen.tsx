// /tenders/:unp — single procedure (tender) detail. The "see the truthful full
// details" surface for a procurement claim: estimated (прогнозна) value, every
// lot, the procedure lifecycle, the signed contract(s) it produced, and a
// data-transparency score. This is what a fact-check post links to for one
// procedure (the "мантинели за 1 млрд" case).
//
// Estimated value is a FORECAST, not money spent — labeled throughout. The
// awarded totals below use only signed contracts (tag "contract").

import { FC, ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ClipboardList,
  ExternalLink,
  Layers,
  Info,
  CheckCircle2,
  Circle,
  XCircle,
  Clock,
  Gavel,
  ShieldCheck,
  Scale,
} from "lucide-react";
import {
  useTenderDetail,
  TenderAward,
  TenderAppeal,
} from "@/data/procurement/useTender";
import type { Tender } from "@/lib/tenderTypes";
import type { ProcurementContract } from "@/data/dataTypes";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { RiskBadges } from "@/screens/components/procurement/RiskBadges";
import { ProcurementBreadcrumb } from "@/screens/components/procurement/ProcurementBreadcrumb";
import { TenderNormalcyPanel } from "@/screens/components/procurement/TenderNormalcyPanel";
import { TenderRiskPanel } from "@/screens/components/procurement/TenderRiskPanel";
import { formatAmountEur } from "@/lib/currency";
import {
  projectFromTender,
  projectHref,
} from "@/data/procurement/projectStore";
import { TrackAsProjectFileLink } from "@/screens/components/procurement/TrackAsProjectFileLink";
import {
  displayProcurementMethod,
  contractCategoryLabel,
} from "@/lib/cpvSectors";
import { nuts3Name } from "@/data/procurement/bgNuts3";
import { computeTenderTransparency } from "@/lib/tenderTransparency";
import {
  kzkStatusLabel,
  kzkOutcomeLabel,
  isUpheldOutcome,
} from "@/lib/kzkLabels";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatDate } from "@/lib/formatDate";
import { AppealChip } from "@/screens/components/procurement/AppealChip";
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

// A signed contract is one tagged "contract" — awards ("award") and amendments
// ("contractAmendment") are excluded from the awarded-spend sum, mirroring the
// corpus-wide contracted-total rule (quarantine: never mix forecast with spend).
const isSignedContract = (a: TenderAward): boolean => a.tag === "contract";

type LifecycleState = "done" | "current" | "upcoming" | "cancelled";

const StepNode: FC<{
  state: LifecycleState;
  label: string;
  sub?: ReactNode;
}> = ({ state, label, sub }) => {
  const { t } = useTranslation();
  // Icon is decorative (aria-hidden) — the state is conveyed to screen readers by
  // the sr-only label below, not colour alone.
  const icon =
    state === "cancelled" ? (
      <XCircle className="h-5 w-5 text-amber-600" />
    ) : state === "done" ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
    ) : state === "current" ? (
      <Clock className="h-5 w-5 text-sky-600" />
    ) : (
      <Circle className="h-5 w-5 text-muted-foreground/40" />
    );
  const stateLabel =
    state === "done"
      ? t("tender_lc_state_done") || "completed"
      : state === "current"
        ? t("tender_lc_state_current") || "in progress"
        : state === "cancelled"
          ? t("tender_lc_state_cancelled") || "cancelled"
          : t("tender_lc_state_upcoming") || "upcoming";
  return (
    <div className="flex flex-1 min-w-[72px] flex-col items-center text-center gap-1">
      <span aria-hidden="true">{icon}</span>
      <span
        className={`text-xs font-medium ${
          state === "upcoming" ? "text-muted-foreground" : ""
        }`}
      >
        {label}
      </span>
      <span className="sr-only">{stateLabel}</span>
      {sub ? (
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      ) : null}
    </div>
  );
};

// Announced → Offers due → Outcome. Every state is derived from data we already
// hold: publication date, submission deadline (open/closed vs now), the cancel
// flag, and whether the OCID resolved a signed contract. No new ingest.
const TenderLifecycle: FC<{ tender: Tender; awards: TenderAward[] }> = ({
  tender,
  awards,
}) => {
  const { t, i18n } = useTranslation();
  const signed = awards.filter(isSignedContract);
  const hasAward = awards.length > 0;

  const deadline = tender.submissionDeadline
    ? new Date(tender.submissionDeadline)
    : null;
  // Distinguish "no deadline published" (deadlineMs === null) from "deadline
  // passed" — an unknown deadline must NOT render as a completed step.
  const deadlineMs =
    deadline && !Number.isNaN(deadline.getTime()) ? deadline.getTime() : null;
  const deadlinePast = deadlineMs != null && deadlineMs < Date.now();

  // Outcome node.
  let outcomeLabel: string;
  let outcomeState: LifecycleState;
  let outcomeSub: ReactNode = null;
  if (tender.isCancelled) {
    outcomeLabel = t("tender_status_cancelled") || "Cancelled";
    outcomeState = "cancelled";
  } else if (signed.length > 0) {
    outcomeLabel = t("tender_lc_awarded") || "Awarded";
    outcomeState = "done";
    outcomeSub =
      signed.length === 1
        ? decodeEntities(signed[0].contractorName)
        : `${signed.length} ${t("tender_lc_contracts") || "contracts"}`;
  } else if (hasAward) {
    outcomeLabel = t("tender_lc_awarded") || "Awarded";
    outcomeState = "done";
  } else {
    outcomeLabel = t("tender_lc_pending") || "Awaiting outcome";
    outcomeState = "upcoming";
  }

  const dueState: LifecycleState = tender.isCancelled
    ? // cancelled: "done" only if the deadline had already passed; otherwise the
      // window never closed normally → show cancelled, not a green check.
      deadlinePast
      ? "done"
      : "cancelled"
    : deadlineMs != null
      ? deadlinePast
        ? "done"
        : "current"
      : // unknown deadline: only "done" once an award exists, else still upcoming
        hasAward
        ? "done"
        : "upcoming";

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Gavel className="h-4 w-4 text-indigo-600" />
        {t("tender_lc_title") || "Procedure status"}
      </h2>
      <div className="flex items-start justify-between gap-2">
        <StepNode
          state="done"
          label={t("tender_lc_announced") || "Announced"}
          sub={formatDate(tender.publicationDate, i18n.language)}
        />
        <div className="mt-2.5 h-px flex-1 min-w-[12px] bg-border" />
        <StepNode
          state={dueState}
          label={t("tender_lc_offers_due") || "Offers due"}
          sub={
            deadline && !Number.isNaN(deadline.getTime())
              ? formatDeadline(
                  tender.submissionDeadline as string,
                  i18n.language,
                )
              : "—"
          }
        />
        <div className="mt-2.5 h-px flex-1 min-w-[12px] bg-border" />
        <StepNode state={outcomeState} label={outcomeLabel} sub={outcomeSub} />
      </div>
      {tender.changeNoticeCount && tender.changeNoticeCount > 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Info className="h-3 w-3" />
          {(
            t("tender_change_notices") || "{{n}} change notice(s) published"
          ).replace("{{n}}", String(tender.changeNoticeCount))}
        </p>
      ) : null}
    </section>
  );
};

// Estimated (forecast) vs. actually signed. Only rendered once at least one
// signed contract resolved via the OCID lineage. The gap is the honest story:
// what the procedure was announced at vs. what it was signed for.
const TenderForecastActual: FC<{ tender: Tender; awards: TenderAward[] }> = ({
  tender,
  awards,
}) => {
  const { t, i18n } = useTranslation();
  const signed = awards.filter(isSignedContract);
  if (signed.length === 0) return null;
  // Sum only contracts with a published amount — a signed contract with a null
  // amount would otherwise count as €0 and understate "Actually signed".
  const withAmount = signed.filter((a) => a.amountEur != null);
  const actual = withAmount.reduce((s, a) => s + (a.amountEur as number), 0);
  const undisclosed = signed.length - withAmount.length;
  const est = tender.estimatedValueEur ?? null;
  // Only a real signed total (≥1 disclosed amount) yields a "signed"/share figure
  // — undisclosed ≠ €0, so all-null awards must NOT read as "signed €0 / 0%".
  const hasSigned = withAmount.length > 0;
  const share =
    hasSigned && est && est > 0 ? Math.round((100 * actual) / est) : null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Scale className="h-4 w-4 text-emerald-600" />
        {t("tender_fa_title") || "Forecast vs. signed"}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("tender_fa_forecast") || "Estimated (forecast)"}
          </p>
          <p className="text-lg font-bold tabular-nums">
            {est != null
              ? formatAmountEur(est, null, "EUR", i18n.language).primary
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("tender_fa_signed") || "Actually signed"}
          </p>
          <p className="text-lg font-bold tabular-nums">
            {hasSigned
              ? formatAmountEur(actual, null, "EUR", i18n.language).primary
              : "—"}
          </p>
        </div>
      </div>
      {share != null ? (
        <p className="text-[11px] text-muted-foreground">
          {(
            t("tender_fa_share") || "Signed for {{p}}% of the forecast."
          ).replace("{{p}}", String(share))}
        </p>
      ) : null}
      {undisclosed > 0 ? (
        <p className="text-[11px] text-muted-foreground/80">
          {(
            t("tender_fa_undisclosed") ||
            "{{n}} signed contract(s) without a published amount are not counted."
          ).replace("{{n}}", String(undisclosed))}
        </p>
      ) : null}
    </section>
  );
};

const TAG_LABEL: Record<string, string> = {
  contract: "tender_award_tag_contract",
  award: "tender_award_tag_award",
  contractAmendment: "tender_award_tag_amendment",
};

// Shape one signed award (the slim TenderAward the API returns) into the full
// ProcurementContract the risk scorer expects, filling the buyer + procedure
// context from the parent tender. Only the connection/method/amendment checks
// can fire here — bid count and tender-window aren't on the award, so the
// scorer marks those unavailable (excluded from the CRI, not scored 0).
const awardToContract = (
  tender: Tender,
  a: TenderAward,
  appealUpheld: boolean,
): ProcurementContract => ({
  key: a.key,
  ocid: tender.ocid ?? "",
  releaseId: "",
  tag: a.tag,
  date: a.dateSigned ?? tender.publicationDate,
  dateSigned: a.dateSigned ?? undefined,
  awarderEik: tender.buyerEik,
  awarderName: tender.buyerName,
  contractorEik: a.contractorEik ?? "",
  contractorName: a.contractorName,
  amountEur: a.amountEur ?? undefined,
  title: a.title,
  cpv: tender.cpv,
  procurementMethod: tender.procedureType,
  category: tender.contractType,
  // Known from the tender's own appeals — feeds the appeal-upheld risk chip.
  appealUpheld,
  bundleUuid: "",
  sourceUrl: tender.sourceUrl,
});

// The signed contract(s) the procedure produced — the "who actually won" answer
// the tender page never rendered (the awards array was fetched and discarded).
// Guard: returns null (and mounts no risk-index fetches) when there's no award.
const TenderAwards: FC<{
  tender: Tender;
  awards: TenderAward[];
  appeals: TenderAppeal[];
}> = ({ tender, awards, appeals }) => {
  if (awards.length === 0) return null;
  // The procedure was found improper if КЗК upheld any appeal against it. Uses
  // the shared isUpheldOutcome (уважена only; частично excluded) so the FE, SQL
  // upheld_ocids and buyer_appeal_stats can't drift apart.
  const appealUpheld = appeals.some((a) => isUpheldOutcome(a.outcome));
  return (
    <TenderAwardsCard
      tender={tender}
      awards={awards}
      appealUpheld={appealUpheld}
    />
  );
};

// Split out so the risk-index bundles (concentration ~1MB, debarred, MP/official
// connections, CPV baseline) load only for procedures that actually reached an
// award — never on the many announced-only tenders. Each award is scored with
// the shared engine and carries the same red-flag chips as the contract browser.
const TenderAwardsCard: FC<{
  tender: Tender;
  awards: TenderAward[];
  appealUpheld: boolean;
}> = ({ tender, awards, appealUpheld }) => {
  const { t, i18n } = useTranslation();
  const { scoreRow, isLoading } = useContractRiskScorer();
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        {t("tender_awards_title") || "Awarded contracts"} ({awards.length})
      </h2>
      <ul className="space-y-2 text-sm">
        {awards.map((a) => {
          const risk = isLoading
            ? null
            : scoreRow(awardToContract(tender, a, appealUpheld));
          return (
            <li key={a.key} className="border-t pt-2 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-2">
                {a.contractorEik ? (
                  <Link
                    to={`/company/${a.contractorEik}`}
                    className="font-medium hover:underline"
                  >
                    {decodeEntities(a.contractorName)}
                  </Link>
                ) : (
                  <span className="font-medium">
                    {decodeEntities(a.contractorName) || "—"}
                  </span>
                )}
                <span className="tabular-nums font-medium whitespace-nowrap">
                  {a.amountEur != null
                    ? formatAmountEur(a.amountEur, null, "EUR", i18n.language)
                        .primary
                    : "—"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5">
                  {t(TAG_LABEL[a.tag] || "") || a.tag}
                </span>
                {a.dateSigned ? <span>{a.dateSigned}</span> : null}
                <Link to={`/contract/${a.key}`} className="hover:underline">
                  {t("tender_award_view") || "View contract"}
                </Link>
              </p>
              {risk && risk.hasFlag ? (
                <div className="mt-1">
                  <RiskBadges result={risk} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const TRANSPARENCY_LABELS: Record<string, string> = {
  estimatedValue: "tender_tp_estimated_value",
  cpv: "tender_tp_cpv",
  category: "tender_tp_category",
  procedureType: "tender_tp_procedure_type",
  awardCriteria: "tender_tp_award_criteria",
  legalBasis: "tender_tp_legal_basis",
  submissionDeadline: "tender_tp_submission_deadline",
  placeOfPerformance: "tender_tp_place",
  fundingInfo: "tender_tp_funding",
  lotBreakdown: "tender_tp_lots",
};

const TRANSPARENCY_FALLBACK: Record<string, string> = {
  estimatedValue: "Estimated value",
  cpv: "CPV classification",
  category: "Contract category",
  procedureType: "Procedure type",
  awardCriteria: "Award criteria",
  legalBasis: "Legal basis",
  submissionDeadline: "Submission deadline",
  placeOfPerformance: "Place of performance",
  fundingInfo: "Funding information",
  lotBreakdown: "Lot breakdown",
};

// Data-completeness score (OpenTender-style). Not a corruption signal — it
// measures how much of the procedure the buyer disclosed.
const TenderTransparency: FC<{ tender: Tender }> = ({ tender }) => {
  const { t } = useTranslation();
  const tp = computeTenderTransparency(tender);
  // 700/300 (not 600) so the large bold score stays legible on dark backgrounds.
  const tone =
    tp.score >= 80
      ? "text-emerald-700 dark:text-emerald-300"
      : tp.score >= 50
        ? "text-amber-700 dark:text-amber-300"
        : "text-red-700 dark:text-red-300";
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-sky-600" />
        {t("tender_tp_title") || "Transparency score"}
      </h2>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${tone}`}>
          {tp.score}
        </span>
        <span className="text-xs text-muted-foreground">
          / 100 ·{" "}
          {(t("tender_tp_count") || "{{n}} of {{m}} fields published")
            .replace("{{n}}", String(tp.presentCount))
            .replace("{{m}}", String(tp.total))}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-2">
        {tp.indicators.map((ind) => (
          <li key={ind.key} className="flex items-center gap-1.5">
            {ind.present ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
            ) : (
              <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={
                ind.present ? "" : "text-muted-foreground line-through"
              }
            >
              {t(TRANSPARENCY_LABELS[ind.key] || "") ||
                TRANSPARENCY_FALLBACK[ind.key]}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground/80">
        {t("tender_tp_hint") ||
          "How much of the procedure the buyer published — a documentation measure, not a corruption signal."}
      </p>
    </section>
  );
};

// Full lot table — per-lot name (untruncated), CPV, place of performance and
// estimated value. Data we already store on every lot but never surfaced.
const TenderLots: FC<{ tender: Tender }> = ({ tender }) => {
  const { t, i18n } = useTranslation();
  if (tender.lots.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
        <Layers className="h-4 w-4 text-sky-600" />
        {t("tender_lots") || "Lots"} ({tender.lotsCount ?? tender.lots.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {tender.lots.map((lot) => (
              <tr key={lot.lotId} className="border-t first:border-0 align-top">
                <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
                  {t("tender_lot_short") || "Lot"} {lot.lotId}
                </td>
                <td className="py-2 pr-2">
                  {lot.name ? <p>{lot.name}</p> : null}
                  <p className="text-[11px] text-muted-foreground">
                    {lot.cpv ? (
                      <span className="font-mono">{lot.cpv}</span>
                    ) : null}
                    {/* Only a real NUTS3 (BGxxx oblast) is meaningful — a bare
                        "BG" country code is noise, so it's dropped. */}
                    {lot.nuts && /^BG\d{3}$/.test(lot.nuts) ? (
                      <span>
                        {lot.cpv ? " · " : null}
                        {nuts3Name(lot.nuts, i18n.language)}
                      </span>
                    ) : null}
                  </p>
                </td>
                <td className="py-2 tabular-nums font-medium text-right whitespace-nowrap">
                  {lot.estimatedValueEur != null
                    ? formatAmountEur(
                        lot.estimatedValueEur,
                        lot.estimatedValueNative,
                        lot.currency,
                        i18n.language,
                      ).primary
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// An appeal is "open" until a merits outcome is recorded (tier-2 backfill).
// A КЗК terminal proceeding status — the case is closed even without a recorded
// merits outcome (the tier-2 outcome backfill is partial). Without this, nearly
// every historically-appealed procedure would wear "Under appeal" forever.
const TERMINAL_APPEAL_STATUS = /прекрат|приключ|отказ|оставено без движение/i;
const isAppealOpen = (a: TenderAppeal): boolean =>
  !a.outcome && !(a.status != null && TERMINAL_APPEAL_STATUS.test(a.status));

// КЗК appeals against this procedure, joined by УНП (exact). Shows the complaint
// number, complainant, the suspended chip, and the merits outcome (with its
// decision date) once backfilled — else the current proceeding status. Honest:
// an appeal is a review, not proof of wrongdoing.
const TenderAppeals: FC<{ appeals: TenderAppeal[] }> = ({ appeals }) => {
  const { t, i18n } = useTranslation();
  if (appeals.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-300/60 dark:border-amber-800/60 bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
        <Gavel className="h-4 w-4 text-amber-600" />
        {t("tender_appeals_title") || "КЗК appeals"} ({appeals.length})
      </h2>
      <ul className="space-y-2 text-sm">
        {appeals.map((a) => (
          <li
            key={a.complaintNo}
            className="border-t pt-2 first:border-0 first:pt-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs">{a.complaintNo}</span>
              {a.suspension ? (
                <AppealChip
                  suspended
                  pill
                  label={t("tender_appeal_suspended") || "Procedure suspended"}
                />
              ) : null}
            </div>
            {a.complainant ? (
              <p className="text-xs">
                <span className="text-muted-foreground">
                  {t("tender_appeal_complainant") || "Complainant"}:{" "}
                </span>
                {decodeEntities(a.complainant)}
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2">
              {a.outcome ? (
                <span className="font-medium text-foreground">
                  {kzkOutcomeLabel(a.outcome, i18n.language)}
                </span>
              ) : (
                <span>
                  {kzkStatusLabel(a.status, i18n.language) ||
                    t("tender_appeal_open") ||
                    "In review"}
                </span>
              )}
              {/* Next to a merits outcome, show the DECISION date (the ruling),
                  not the complaint's filing date; fall back to the filing date. */}
              {a.outcome && a.decisionDate ? (
                <span>· {a.decisionDate}</span>
              ) : a.complaintDate ? (
                <span>· {a.complaintDate}</span>
              ) : null}
              {a.sourceUrl ? (
                <a
                  href={a.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  {t("tender_appeal_view") || "КЗК record"}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground/80">
        {t("tender_appeals_hint") ||
          "Appeals are heard by the CPC (КЗК). An appeal is a review of the procedure, not proof of wrongdoing."}
      </p>
    </section>
  );
};

export const TenderDetailScreen: FC = () => {
  const { unp } = useParams<{ unp: string }>();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useTenderDetail(unp);
  const tender = data?.tender ?? null;
  const awards = data?.awards ?? [];
  const appeals = data?.appeals ?? [];
  const underAppeal = appeals.some(isAppealOpen);

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
      <ProcurementBreadcrumb
        section={{
          labelKey: "procurement_tenders_nav",
          to: "/procurement/tenders",
        }}
        current={tender.subject}
      />
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground flex flex-wrap items-center gap-2">
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
          {underAppeal ? (
            <AppealChip
              pill
              label={t("tender_under_appeal") || "Under appeal (КЗК)"}
            />
          ) : null}
        </p>
        <h1 className="text-lg md:text-xl font-semibold leading-snug max-w-[70ch]">
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
        {/* "Проследи като досие" on-ramp (§4.3b) — seed a project file from this
            procedure; its lineage (sibling lots + contracts) resolves. */}
        <TrackAsProjectFileLink
          to={projectHref(
            projectFromTender({
              unp: tender.unp,
              titleSeed: tender.subject || "",
            }),
          )}
        />
      </header>

      <TenderLifecycle tender={tender} awards={awards} />

      <TenderNormalcyPanel unp={tender.unp} />

      <TenderRiskPanel tender={tender} awards={awards} />

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
                  {t("eik")} {tender.buyerEik}
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
          {tender.nuts ? (
            <KvRow
              label={t("tender_label_place") || "Place of performance"}
              value={nuts3Name(tender.nuts, i18n.language)}
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
          <TenderForecastActual tender={tender} awards={awards} />
          <TenderAwards tender={tender} awards={awards} appeals={appeals} />
          <TenderAppeals appeals={appeals} />
          <TenderTransparency tender={tender} />

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
            {/* Review body is КЗК for every BG procurement — a static, honest
                pointer to where appeals are heard. Shown only when we have no
                ingested appeal for this procedure (the appeals tile supersedes
                it); see docs/plans/kzk-appeals-ingest-v1.md. */}
            {appeals.length === 0 ? (
              <p>
                {t("tender_review_body") ||
                  "Appeals are heard by the CPC (КЗК):"}{" "}
                <a
                  href="https://reg.cpc.bg/AllComplaints.aspx?dt=2"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  {t("tender_review_link") || "search the appeals register"}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <TenderLots tender={tender} />
    </section>
  );
};
