// The ИСУН grants of a sector's institutions by programme — the list on the
// edu and health money pages. Marks the non-EU programmes (national fund,
// EEA/Norway/Swiss, unknown) so a reader never takes them for EU money.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";
import { formatEurCompact, formatInt } from "@/lib/currency";
import {
  fundProgrammeKind,
  type FundProgrammeKind,
  type FundsByProgrammeRow,
} from "@/lib/fundProgrammes";

const KIND_LABEL: Record<
  Exclude<FundProgrammeKind, "eu">,
  { bg: string; en: string }
> = {
  national: { bg: "национален фонд", en: "national fund" },
  eeaNorwaySwiss: {
    bg: "ЕИП / Норвегия / Швейцария",
    en: "EEA / Norway / Swiss",
  },
  unknown: { bg: "друг източник", en: "other source" },
};

/** The same € by ИСУН programme, from the hub blob. */
export const ProgrammeList: FC<{
  rows: readonly FundsByProgrammeRow[];
}> = ({ rows }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const max = Math.max(...rows.map((r) => r.grantEur), 1);
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const kind = fundProgrammeKind(r.code);
        return (
          <li key={r.code} className="space-y-0.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="min-w-0">
                {r.name || r.code}
                {kind !== "eu" ? (
                  <span className="ml-1.5 text-muted-foreground">
                    ({bg ? KIND_LABEL[kind].bg : KIND_LABEL[kind].en})
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatEurCompact(r.grantEur, lang)} ·{" "}
                {formatInt(r.projects, lang)}
              </span>
            </div>
            <div className="h-1.5 rounded bg-muted">
              <div
                className="h-1.5 rounded bg-primary/70"
                style={{ width: `${(r.grantEur / max) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};
