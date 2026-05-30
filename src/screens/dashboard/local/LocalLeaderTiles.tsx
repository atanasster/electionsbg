// Country-dashboard leaderboards, all driven by the precomputed
// national_leaders.json (one fetch — no per-município fan-out):
//   LocalTopMayorsTile     — strongest mandates (elected mayors by vote share)
//   LocalClosestRacesTile  — tightest finishes by margin in the decisive round
//   LocalSplitControlTile  — mayor's party ≠ the party leading the council
// Each auto-hides when its slice is empty.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Crown, Scale, GitFork, LucideIcon } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalNationalLeaders } from "@/data/local/useLocalNationalLeaders";
import { titleCaseName } from "@/lib/utils";
import { StatCard } from "../StatCard";

const TileLabel: FC<{ icon: LucideIcon; text: ReactNode }> = ({
  icon: Icon,
  text,
}) => (
  <div className="flex items-center gap-2">
    <Icon className="h-4 w-4" />
    <span>{text}</span>
  </div>
);

const Dot: FC<{ color: string }> = ({ color }) => (
  <span
    aria-hidden
    className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
    style={{ backgroundColor: color }}
  />
);

const RoundBadge: FC<{ round: 1 | 2 }> = ({ round }) =>
  round === 2 ? (
    <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      II
    </span>
  ) : null;

export const LocalTopMayorsTile: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  const { data } = useLocalNationalLeaders(cycle);
  const rows = data?.topMayorsByPct ?? [];
  if (rows.length === 0) return null;
  return (
    <StatCard
      label={<TileLabel icon={Crown} text={t("local_top_mayors_title")} />}
      hint={t("local_top_mayors_hint")}
    >
      <ul className="flex flex-col divide-y">
        {rows.map((m) => (
          <li
            key={`${m.obshtinaCode}-${m.candidateName}`}
            className="flex items-center gap-2 py-2"
          >
            <MpAvatar
              name={m.candidateName}
              mpId={m.mpId}
              showPartyRing={false}
            />
            <div className="min-w-0 flex-1">
              <Link
                to={`/local/${cycle}/${m.obshtinaCode}`}
                className="block truncate font-medium hover:underline"
              >
                {titleCaseName(m.candidateName)}
              </Link>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                <Dot color={m.party.color} />
                <span className="truncate">
                  {m.obshtinaName} · {m.party.displayName}
                </span>
              </div>
            </div>
            <div className="text-right font-semibold tabular-nums shrink-0">
              {m.pctOfValid.toFixed(1)}%
            </div>
          </li>
        ))}
      </ul>
    </StatCard>
  );
};

export const LocalClosestRacesTile: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  const { data } = useLocalNationalLeaders(cycle);
  const rows = data?.closestRaces ?? [];
  if (rows.length === 0) return null;
  return (
    <StatCard
      label={<TileLabel icon={Scale} text={t("local_closest_races_title")} />}
      hint={t("local_closest_races_hint")}
    >
      <ul className="flex flex-col divide-y">
        {rows.map((r) => (
          <li key={r.obshtinaCode} className="py-2">
            <div className="flex items-center gap-2">
              <Link
                to={`/local/${cycle}/${r.obshtinaCode}`}
                className="font-medium hover:underline truncate"
              >
                {r.obshtinaName}
              </Link>
              <RoundBadge round={r.round} />
              <span className="ml-auto text-right font-semibold tabular-nums shrink-0">
                +{r.marginPct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
              <Dot color={r.winner.party.color} />
              <span className="truncate">{r.winner.party.displayName}</span>
              <span className="opacity-60">{t("local_closest_vs")}</span>
              <Dot color={r.runnerUp.party.color} />
              <span className="truncate">{r.runnerUp.party.displayName}</span>
            </div>
          </li>
        ))}
      </ul>
    </StatCard>
  );
};

export const LocalSplitControlTile: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  const { data } = useLocalNationalLeaders(cycle);
  const split = data?.splitControl;
  if (!split || split.count === 0) return null;
  return (
    <StatCard
      label={<TileLabel icon={GitFork} text={t("local_split_control_title")} />}
      hint={t("local_split_control_hint")}
    >
      <div className="text-xs text-muted-foreground">
        {t("local_split_control_count", { count: split.count })}
      </div>
      <ul className="mt-1 flex flex-col divide-y">
        {split.rows.map((r) => (
          <li
            key={r.obshtinaCode}
            className="flex items-center gap-2 py-2 text-sm"
          >
            <Link
              to={`/local/${cycle}/${r.obshtinaCode}`}
              className="font-medium hover:underline truncate w-28 shrink-0"
            >
              {r.obshtinaName}
            </Link>
            <span className="flex items-center gap-1.5 min-w-0">
              <Dot color={r.mayor.color} />
              <span className="truncate text-muted-foreground">
                {r.mayor.displayName}
              </span>
            </span>
            <span className="opacity-50 shrink-0">→</span>
            <span className="flex items-center gap-1.5 min-w-0">
              <Dot color={r.council.color} />
              <span className="truncate text-muted-foreground">
                {r.council.displayName}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </StatCard>
  );
};
