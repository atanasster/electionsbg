// The presidential twin of `AgencyProfileCard` — same layout (header with registry links, a
// four-figure strip, the MAE-by-election line, signed bias bars), built from the round-one
// grades `presidentialAgencyProfile` derives.
//
// ⚠ NO GRADE BADGE AND NO „corrected MAE". The parliamentary card's A–F grade and shrunk MAE
// come from an analyzer that pools many elections; a presidential agency has at most three
// graded cycles, and a letter grade on that would claim a track record it does not have.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import type { Agency } from "@/data/polls/pollsTypes";
import type { PresidentialAgencyProfile } from "@/data/presidential/presidentialPollAccuracy";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";
import { AgencyMaeHistory } from "./AgencyMaeHistory";

const TOP_BIAS = 5;

const Figure: FC<{
  label: string;
  value: string;
  sub?: string;
  className?: string;
}> = ({ label, value, sub, className }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className={`tabular-nums text-lg font-semibold ${className ?? ""}`}>
      {value}
    </div>
    {sub ? (
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {sub}
      </div>
    ) : null}
  </div>
);

export const PresidentialAgencyHeader: FC<{
  agency?: Agency;
  agencyId: string;
}> = ({ agency, agencyId }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const name = agency ? (isBg ? agency.name_bg : agency.name_en) : agencyId;
  return (
    <div className="flex items-center justify-between w-full gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base font-semibold text-foreground truncate">
          {name}
        </span>
        <span className="text-[10px] text-muted-foreground">{agencyId}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {agency?.eik ? (
          <Link
            to={`/company/${agency.eik}`}
            className="text-[10px] font-medium text-primary hover:underline"
            title={t("polls_public_money_hint")}
            aria-label={t("polls_public_money_hint")}
          >
            {isBg ? "ТР" : "TR"}
          </Link>
        ) : null}
        {agency?.website ? (
          <a
            href={agency.website}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
            title={agency.website}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
};

export const PresidentialAgencyProfileCard: FC<{
  profile: PresidentialAgencyProfile;
  agency?: Agency;
  pollCount: number;
}> = ({ profile, agency, pollCount }) => {
  const { t } = useTranslation();
  const bias = profile.candidateBias.slice(0, TOP_BIAS);
  const maxAbs = Math.max(
    0.01,
    ...profile.candidateBias.map((b) => Math.abs(b.meanError)),
  );
  const pm = profile.plusMinus;

  return (
    <StatCard
      label={
        <PresidentialAgencyHeader agency={agency} agencyId={profile.agencyId} />
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
        <Figure
          label="MAE"
          value={profile.meanMae.toFixed(2)}
          sub={t("presidential_agency_mae_sub")}
        />
        <Figure
          label={t("polls_plus_minus")}
          value={pm === null ? "—" : `${pm > 0 ? "+" : ""}${pm.toFixed(2)}`}
          className={
            pm === null
              ? "text-muted-foreground"
              : pm > 0
                ? "text-emerald-600"
                : "text-rose-600"
          }
        />
        <Figure
          label={t("presidential_agency_leader_called")}
          value={
            profile.leaderCalledRate === null
              ? "—"
              : `${Math.round(profile.leaderCalledRate * 100)}%`
          }
          sub={`n=${profile.leaderCalledTotal}`}
        />
        <Figure
          label={t("polls_elections")}
          value={String(profile.cycles)}
          sub={`${pollCount} ${t("polls_total").toLowerCase()}`}
        />
      </div>

      <AgencyMaeHistory
        history={profile.history}
        consensusMAE={profile.consensusMae}
      />

      {bias.length ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("presidential_agency_candidate_bias")}
          </div>
          <div className="flex flex-col gap-1">
            {bias.map((b) => {
              const widthPct = Math.min(
                50,
                (Math.abs(b.meanError) / maxAbs) * 50,
              );
              const isPerson = b.key !== "none" && b.key !== "други";
              return (
                <div
                  key={b.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 items-center text-xs"
                >
                  <span className="truncate">
                    {isPerson ? (
                      <PresidentialPersonName name={b.name_bg} />
                    ) : (
                      b.name_bg
                    )}{" "}
                    <span className="text-muted-foreground">
                      (n={b.samples})
                    </span>
                  </span>
                  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                    <div
                      className="absolute top-0 bottom-0 rounded-full"
                      style={{
                        backgroundColor:
                          b.meanError > 0
                            ? "rgb(16 185 129)"
                            : "rgb(244 63 94)",
                        ...(b.meanError >= 0
                          ? { left: "50%", width: `${widthPct}%` }
                          : { right: "50%", width: `${widthPct}%` }),
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-xs font-semibold w-10 text-right">
                    {b.meanError > 0 ? "+" : ""}
                    {b.meanError.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </StatCard>
  );
};
