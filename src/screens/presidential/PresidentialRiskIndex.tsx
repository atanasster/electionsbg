// „Индекс на изборния риск" for one presidential round — the parliamentary Anomalies-section pair,
// the composite ribbon and the section-risk card, fed from the presidential artifacts.
//
// ⚠ SELF-CONTAINED: it fetches its own inputs and renders NOTHING when the round has no risk score
// (a cycle not yet re-ingested) or while loading, so it can be mounted on the cycle page with one
// line and no gate of its own.
//
// ⚠ THE PROCEDURAL SUB-SCORE IS SHOWN BESIDE EVERY NAMED SECTION, because it is the only figure
// that does not read who won — the one a reader may use for a question about a candidate.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { usePresidentialRiskIndex } from "@/data/presidential/usePresidentialRiskComposite";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { formatDecimal } from "@/lib/currency";
import { CompositeIndexRibbonView } from "@/screens/components/riskAnalysis/CompositeIndexRibbonView";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { PresidentialPersonName } from "./PresidentialPersonName";

const SHOWN = 5;

export const PresidentialRiskIndex: FC<{ cycle: string; round: 1 | 2 }> = ({
  cycle,
  round,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const state = usePresidentialRiskIndex(cycle, round);
  const tickets = useTicketsByNumber(cycle);
  if (state.status !== "ready") return null;
  const { risk, composite } = state;
  const total = risk.coverage.scored;
  const flaggedPct = (100 * risk.elevatedShare).toLocaleString(
    lang === "bg" ? "bg-BG" : "en-GB",
    { maximumFractionDigits: 1 },
  );

  return (
    <div className="flex flex-col gap-3">
      {composite ? (
        <CompositeIndexRibbonView
          composite={composite}
          hint={t("presidential_risk_index_hint")}
        />
      ) : null}
      <StatCard
        label={
          <Hint text={t("presidential_risk_score_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("presidential_risk_score_title")}</span>
            </div>
          </Hint>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
          {(["critical", "high", "elevated"] as const).map((b) => (
            <span key={b} className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">
                {risk.counts[b].toLocaleString(
                  lang === "bg" ? "bg-BG" : "en-GB",
                )}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                {t(`presidential_risk_band_${b}`)}
              </span>
            </span>
          ))}
          <span className="text-xs text-muted-foreground">
            {t("presidential_risk_scored", {
              total: total.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB"),
              pct: flaggedPct,
            })}
          </span>
        </div>
        {risk.top.length ? (
          <ul className="flex flex-col gap-1.5 text-sm mt-3">
            {risk.top.slice(0, SHOWN).map((r) => {
              const ticket = r.winner
                ? tickets.get(r.winner.number)
                : undefined;
              const href = presidentialUrl(cycle, "section", r.code);
              return (
                <li
                  key={r.code}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: ticket?.color ?? "#888" }}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate text-xs">
                    {href ? (
                      <Link
                        to={href}
                        className="font-mono"
                        underline={false}
                        title={r.code}
                      >
                        {r.code}
                      </Link>
                    ) : (
                      <span className="font-mono">{r.code}</span>
                    )}
                    {r.placeName ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {r.placeName}
                      </span>
                    ) : null}
                    {ticket ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · <PresidentialPersonName
                          name={ticket.president}
                        />{" "}
                        {formatDecimal(r.winner?.pct ?? 0, i18n.language, 1)}%
                      </span>
                    ) : null}
                  </span>
                  <Hint
                    text={t("presidential_risk_procedural_hint")}
                    underline={false}
                  >
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {t("presidential_risk_procedural_short")}{" "}
                      {r.proceduralScore === null
                        ? "—"
                        : Math.round(r.proceduralScore)}
                    </span>
                  </Hint>
                  <RiskBandBadge
                    band={r.band}
                    score={r.score}
                    signalsAvailable={r.signalsAvailable}
                    signalsTotal={risk.signals.used.length}
                    size="sm"
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground mt-2">
            {t("presidential_risk_none_named")}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          {lang === "bg" ? risk.basis : risk.basisEn}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("presidential_risk_unavailable", {
            list: risk.signals.unavailable
              .map((u) => (lang === "bg" ? u.reason : u.reasonEn))
              .join(" "),
          })}
          {risk.signals.concentratedFloor > 80
            ? ` ${t("presidential_risk_concentrated_floor", {
                floor: formatDecimal(
                  risk.signals.concentratedFloor,
                  i18n.language,
                  1,
                ),
              })}`
            : ""}
        </p>
      </StatCard>
    </div>
  );
};
