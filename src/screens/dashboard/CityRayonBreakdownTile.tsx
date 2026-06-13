// Ranked район list for an община с районно деление (Plovdiv-city PDV22,
// Varna-city VAR06) — the numeric companion to the район choropleth that the
// main map slot now renders (CityRayonMapTile), mirroring the Sofia МИР page's
// map + "Топ райони" pairing. Each row expands to the per-район party tally
// (votes + % of valid votes) — the drill-down issue #17 asked for. Self-hides
// when there is no район data for the município.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { formatPct, formatThousands } from "@/data/utils";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import {
  useCityRayonResults,
  type CityRayonResult,
} from "@/data/rayon/useCityRayons";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { StatCard } from "./StatCard";

type Props = { municipalityCode: string };

export const CityRayonBreakdownTile: FC<Props> = ({ municipalityCode }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data } = useCityRayonResults(municipalityCode);
  // NB: usePartyInfo().parties is the raw ARRAY, not a number-keyed map — use
  // findParty(num) to look a party up by its ballot number.
  const { findParty } = usePartyInfo();
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!data?.rayons?.length) return [];
    return data.rayons
      .map((r: CityRayonResult) => {
        const valid = r.results.votes.reduce((s, v) => s + v.totalVotes, 0);
        const sorted = [...r.results.votes]
          .filter((v) => v.totalVotes > 0)
          .sort((a, b) => b.totalVotes - a.totalVotes);
        return {
          key: r.key,
          name: lang === "bg" ? r.name : r.name_en,
          voters: r.results.protocol.totalActualVoters,
          valid,
          winner: sorted[0],
          sorted,
        };
      })
      .sort((a, b) => b.voters - a.voters);
  }, [data, lang]);

  const colorOf = (partyNum?: number) =>
    (partyNum != null ? findParty(partyNum)?.color : undefined) ?? "#9aa3ad";
  const nickOf = (partyNum?: number) => {
    const p = partyNum != null ? findParty(partyNum) : undefined;
    return (lang === "bg" ? p?.nickName : p?.nickName_en || p?.nickName) ?? "";
  };

  if (!rows.length) return null;
  const maxVoters = rows[0]?.voters || 1;

  return (
    <StatCard
      label={
        <Hint text={t("city_rayon_breakdown_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>{t("city_rayon_breakdown")}</span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-1 text-sm mt-1">
        {rows.map((r) => {
          const isSel = selected === r.key;
          const winPct = (100 * (r.winner?.totalVotes ?? 0)) / (r.valid || 1);
          return (
            <div key={r.key}>
              <button
                type="button"
                onClick={() => setSelected((s) => (s === r.key ? null : r.key))}
                className={`w-full grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.4fr)_auto] gap-x-3 items-center rounded px-1.5 py-1.5 text-left ${isSel ? "bg-accent/60" : "hover:bg-accent/40"}`}
                aria-expanded={isSel}
              >
                <span className="truncate font-medium">{r.name}</span>
                <span className="tabular-nums text-xs text-muted-foreground text-right">
                  {formatThousands(r.voters)}
                </span>
                <span className="h-2 rounded-full bg-muted overflow-hidden">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(3, (r.voters / maxVoters) * 100)}%`,
                      backgroundColor: colorOf(r.winner?.partyNum),
                    }}
                  />
                </span>
                <span className="tabular-nums text-xs font-semibold text-right whitespace-nowrap">
                  {nickOf(r.winner?.partyNum)} {formatPct(winPct, 0)}
                </span>
              </button>
              {isSel ? (
                <div className="mt-1 mb-2 ml-1.5 border-l-2 border-muted pl-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("party")}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                    {t("votes")}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                    % {t("valid_votes_short")}
                  </span>
                  {r.sorted.slice(0, 8).map((v) => (
                    <div key={v.partyNum} className="contents">
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: colorOf(v.partyNum) }}
                        />
                        <span className="truncate">{nickOf(v.partyNum)}</span>
                      </span>
                      <span className="tabular-nums text-xs text-right">
                        {formatThousands(v.totalVotes)}
                      </span>
                      <span className="tabular-nums text-xs text-right text-muted-foreground">
                        {formatPct((100 * v.totalVotes) / (r.valid || 1), 1)}
                      </span>
                    </div>
                  ))}
                  <Link
                    to={`/settlement/${municipalityCode}-${r.key}`}
                    underline
                    className="col-span-3 text-xs text-primary mt-1"
                  >
                    {t("city_rayon_open_page", { name: r.name })}
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
        {data?.mobile?.voters ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("city_rayon_mobile_note", { count: data.mobile.voters })}
          </p>
        ) : null}
      </div>
    </StatCard>
  );
};
