import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { StatCard } from "@/screens/dashboard/StatCard";
import type { LocalSectionShard } from "@/data/local/types";
import { LocalSectionsMap } from "./LocalSectionsMap";

// Council section map for a local município, wrapped in a StatCard. Mirrors the
// parliamentary SectionsMapTile. Self-hides when no section in the shard has a
// backfilled coordinate (e.g. a cycle/município whose stations didn't match the
// parliamentary archive), so the surrounding grid simply collapses to the
// top-sections tile.
export const LocalSectionsMapTile: FC<{
  shard: LocalSectionShard;
  cycle: string;
  obshtinaCode: string;
}> = ({ shard, cycle, obshtinaCode }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();

  const partyById = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const p of shard.parties)
      m.set(p.localPartyNum, { name: p.localPartyName, color: p.color });
    return m;
  }, [shard]);

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
  if (!hasCoords) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>{t("dashboard_settlement_map_sections")}</span>
        </div>
      }
      hint={t("local_sections_map_hint")}
    >
      <div ref={ref} className="w-full h-[360px] md:h-[420px]">
        {size && (
          <LocalSectionsMap
            sections={shard.sections}
            partyById={partyById}
            size={size}
            cycle={cycle}
            obshtinaCode={obshtinaCode}
          />
        )}
      </div>
    </StatCard>
  );
};
