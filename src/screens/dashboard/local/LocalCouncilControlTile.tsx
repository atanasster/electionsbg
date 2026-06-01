// Council-control tally — the municipal-system headline a parliamentary
// dashboard has no equivalent for: how many councils does a single party
// actually control outright, vs. how many are hung ("No Overall Control",
// needing a coalition)? Computed client-side from national_municipalities.json
// (each row carries the município's total council seats + its leading party's
// seat count), so no extra fetch and no pipeline change.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { useNationalMunicipalities } from "@/data/local/useNationalMunicipalities";
import { StatCard } from "../StatCard";

const isSofiaShard = (code: string): boolean => /^S2\d{3}$/.test(code);

export const LocalCouncilControlTile: FC<{
  cycle: string;
  // When set, restrict the tally to one oblast (region dashboard); otherwise
  // it's the national tally.
  oblast?: string;
  bodyMaxHeight?: string;
}> = ({ cycle, oblast, bodyMaxHeight }) => {
  const { t } = useTranslation();
  const { data } = useNationalMunicipalities(cycle);

  const { majority, noc } = useMemo(() => {
    let majority = 0;
    let noc = 0;
    for (const m of data?.municipalities ?? []) {
      if (isSofiaShard(m.obshtinaCode)) continue;
      if (oblast && m.oblast !== oblast) continue;
      if (!m.topCouncil || m.councilSeats <= 0) continue;
      const threshold = Math.floor(m.councilSeats / 2) + 1;
      if (m.topCouncil.seats >= threshold) majority++;
      else noc++;
    }
    return { majority, noc };
  }, [data, oblast]);

  const total = majority + noc;
  if (total === 0) return null;
  const majorityPct = (majority / total) * 100;

  return (
    <StatCard
      titleCase
      bodyMaxHeight={bodyMaxHeight}
      label={
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4" />
          <span>{t("local_council_control_title")}</span>
        </div>
      }
      hint={t("local_council_control_hint")}
    >
      {/* Headline: the No-Overall-Control count. */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{noc}</span>
        <span className="text-xs text-muted-foreground">
          {t("local_council_control_noc_label")}
        </span>
      </div>

      {/* Majority vs NOC proportion. */}
      <div
        className="mt-2 flex h-3 overflow-hidden rounded ring-1 ring-border"
        role="img"
        aria-label={t("local_council_control_aria", { majority, noc })}
      >
        <div
          className="bg-primary"
          style={{ width: `${majorityPct}%` }}
          title={t("local_council_control_majority", { count: majority })}
        />
        <div
          className="bg-muted"
          style={{ width: `${100 - majorityPct}%` }}
          title={t("local_council_control_noc", { count: noc })}
        />
      </div>

      <ul className="mt-2 space-y-1 text-sm">
        <li className="flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full bg-primary ring-1 ring-border" />
          <span className="text-muted-foreground">
            {t("local_council_control_majority", { count: majority })}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full bg-muted ring-1 ring-border" />
          <span className="text-muted-foreground">
            {t("local_council_control_noc", { count: noc })}
          </span>
        </li>
      </ul>
    </StatCard>
  );
};
