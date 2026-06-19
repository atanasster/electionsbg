import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { StatCard } from "@/screens/dashboard/StatCard";
import type { LocalSectionShard, LocalSectionResult } from "@/data/local/types";
import { LocalSectionsMap } from "./LocalSectionsMap";

// Per-station section map for a local município, wrapped in a StatCard. Mirrors
// the parliamentary SectionsMapTile. Plots either ballot:
//   - metric 'council' (default): coloured by the leading council party.
//   - metric 'mayor': coloured by the leading mayoral candidate — the caller
//     passes the candidate legend (from the bundle's mayor.round1) and which
//     per-section field to read (mayorVotes / rayonMayorVotes).
// Self-hides when no station has a backfilled coordinate, or (for the mayor
// metric) when no station carries the requested mayor-vote field — so the
// surrounding grid collapses to the tile alone.
export const LocalSectionsMapTile: FC<{
  shard: LocalSectionShard;
  cycle: string;
  obshtinaCode: string;
  metric?: "council" | "mayor";
  mayorLegend?: Map<number, { name: string; color: string }>;
  mayorVoteField?: "mayorVotes" | "rayonMayorVotes";
}> = ({
  shard,
  cycle,
  obshtinaCode,
  metric = "council",
  mayorLegend,
  mayorVoteField = "mayorVotes",
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const isMayor = metric === "mayor";

  const partyById = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const p of shard.parties)
      m.set(p.localPartyNum, { name: p.localPartyName, color: p.color });
    return m;
  }, [shard]);

  const legend = isMayor ? (mayorLegend ?? new Map()) : partyById;
  const validField =
    mayorVoteField === "rayonMayorVotes" ? "rayonMayorValid" : "mayorValid";
  const selectVotes = (s: LocalSectionResult) =>
    (isMayor ? s[mayorVoteField] : s.partyVotes) ?? [];
  const total = (s: LocalSectionResult) =>
    isMayor
      ? (s[validField] ?? selectVotes(s).reduce((a, v) => a + v.votes, 0))
      : s.numValidVotes;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasCoords = shard.sections.some(
    (s) => typeof s.longitude === "number" && typeof s.latitude === "number",
  );
  // Mayor metric also needs the mayor-vote field on at least one station —
  // absent for cycles whose mayor CSV wasn't ingested (older / by-elections).
  const hasMayorData =
    !isMayor ||
    shard.sections.some((s) => (s[mayorVoteField]?.length ?? 0) > 0);
  if (!hasCoords || !hasMayorData) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>
            {isMayor
              ? t("local_sections_map_mayor")
              : t("dashboard_settlement_map_sections")}
          </span>
        </div>
      }
      hint={
        isMayor
          ? t("local_sections_map_mayor_hint")
          : t("local_sections_map_hint")
      }
    >
      <div ref={ref} className="w-full h-[360px] md:h-[420px]">
        {size && (
          <LocalSectionsMap
            sections={shard.sections}
            legend={legend}
            selectVotes={selectVotes}
            total={total}
            size={size}
            cycle={cycle}
            obshtinaCode={obshtinaCode}
          />
        )}
      </div>
    </StatCard>
  );
};
