import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Sparkles, AlertTriangle } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  Agency,
  AgencyProfile,
  AgencyTake,
  BlocId,
} from "@/data/polls/pollsTypes";
import { BLOC_COLORS, BLOC_LABELS } from "./blocColors";

type Props = {
  profile: AgencyProfile;
  agency?: Agency;
  take?: AgencyTake;
};

export const AgencyProfileCard: FC<Props> = ({ profile, agency, take }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const name = agency
    ? isBg
      ? agency.name_bg
      : agency.name_en
    : profile.agencyId;

  // Bloc lean diverging bar — most-significant bloc first
  const blocs = (
    Object.entries(profile.blocLean) as [
      BlocId,
      { meanError: number; samples: number },
    ][]
  )
    .filter(([, v]) => v.samples > 0)
    .sort((a, b) => Math.abs(b[1].meanError) - Math.abs(a[1].meanError));

  // Top 5 party biases (already sorted by abs(meanError) in the analyzer output)
  const partyBias = profile.partyBias.slice(0, 5);
  const maxAbsBias = Math.max(
    0.01,
    ...profile.partyBias.map((b) => Math.abs(b.meanError)),
  );
  const maxAbsBloc = Math.max(
    0.01,
    ...blocs.map(([, v]) => Math.abs(v.meanError)),
  );

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-base font-semibold text-foreground truncate">
              {name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {profile.agencyId}
            </span>
          </div>
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
      }
    >
      <div className="grid grid-cols-3 gap-2 mt-1">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            MAE
          </div>
          <div className="tabular-nums text-lg font-semibold">
            {profile.overallMAE.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("polls_elections")}
          </div>
          <div className="tabular-nums text-lg font-semibold">
            {profile.electionsCovered.length}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("polls_total")}
          </div>
          <div className="tabular-nums text-lg font-semibold">
            {profile.totalPolls}
          </div>
        </div>
      </div>

      {/* Bloc lean diverging bars */}
      {blocs.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("polls_bloc_lean")}
          </div>
          <div className="flex flex-col gap-1">
            {blocs.map(([bloc, v]) => {
              const widthPct = Math.min(
                50,
                (Math.abs(v.meanError) / maxAbsBloc) * 50,
              );
              const sign = v.meanError > 0 ? "+" : "";
              return (
                <div
                  key={bloc}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 items-center text-xs"
                >
                  <span className="truncate">
                    {isBg ? BLOC_LABELS[bloc].bg : BLOC_LABELS[bloc].en}
                  </span>
                  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                    <div
                      className="absolute top-0 bottom-0 rounded-full"
                      style={{
                        backgroundColor: BLOC_COLORS[bloc],
                        ...(v.meanError >= 0
                          ? { left: "50%", width: `${widthPct}%` }
                          : { right: "50%", width: `${widthPct}%` }),
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-xs font-semibold w-10 text-right">
                    {sign}
                    {v.meanError.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Top 5 party biases */}
      {partyBias.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("polls_party_bias")}
          </div>
          <div className="flex flex-col gap-1">
            {partyBias.map((b) => {
              const widthPct = Math.min(
                50,
                (Math.abs(b.meanError) / maxAbsBias) * 50,
              );
              const sign = b.meanError > 0 ? "+" : "";
              const color =
                b.meanError > 0 ? "rgb(16 185 129)" : "rgb(244 63 94)";
              return (
                <div
                  key={b.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 items-center text-xs"
                >
                  <span className="truncate">
                    {b.key}{" "}
                    <span className="text-muted-foreground">
                      (n={b.samples})
                    </span>
                  </span>
                  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                    <div
                      className="absolute top-0 bottom-0 rounded-full"
                      style={{
                        backgroundColor: color,
                        ...(b.meanError >= 0
                          ? { left: "50%", width: `${widthPct}%` }
                          : { right: "50%", width: `${widthPct}%` }),
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-xs font-semibold w-10 text-right">
                    {sign}
                    {b.meanError.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* AI take */}
      {take ? (
        <div className="mt-3 pt-3 border-t flex flex-col gap-2 text-xs leading-relaxed">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>{isBg ? take.summary.bg : take.summary.en}</span>
          </div>
          {(isBg ? take.lean.bg : take.lean.en) ? (
            <div className="text-muted-foreground italic">
              {isBg ? take.lean.bg : take.lean.en}
            </div>
          ) : null}
          {(isBg ? take.warning.bg : take.warning.en) ? (
            <div className="flex items-start gap-2 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{isBg ? take.warning.bg : take.warning.en}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </StatCard>
  );
};
