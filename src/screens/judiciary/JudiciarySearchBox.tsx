// The body finder on /judiciary — all 283 courts, prosecution offices and
// investigation services.
//
// This is the page SectorEntitySearch's own header cites as its motivating
// case: it maps 283 bodies and, until /court/:bodyCode landed, had no way to
// reach any one of them. The map stays; this is the jump.
//
// Server-indexed rather than static (the dimension is a PG table, not a curated
// array) but NOT a typeahead: 283 rows is one small request on arm, after which
// every keystroke is local. Only /subsidies, at 16,702, needs a query per
// keystroke.

import { FC, useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { useJudicialBodyIndex } from "@/data/judiciary/useCourt";

const KIND_BG: Record<string, string> = {
  court: "съд",
  prosecution: "прокуратура",
  investigation: "следствен отдел",
  council: "съвет",
};

export const JudiciarySearchBox: FC = () => {
  const [armed, setArmed] = useState(false);
  const { data } = useJudicialBodyIndex(armed);

  const index = useMemo(() => {
    if (!data?.length) return null;
    return buildEntityIndex(
      data,
      (b) => ({
        id: b.bodyCode,
        label: b.name,
        sub: [b.tier, b.place].filter(Boolean).join(" · "),
        href: `/court/${b.bodyCode}`,
      }),
      // The kind word too ("прокуратура"), which is how a reader narrows to a
      // whole category rather than a named body.
      (b) => [b.name, b.place, b.tier, KIND_BG[b.kind], b.bodyCode],
      // Magistrate count: "софия" should reach Софийски районен съд before the
      // smallest office that happens to sit there.
      (b) => b.magistrates,
    );
  }, [data]);

  const groups = useMemo(
    () => [
      entityGroup(
        "court",
        "Съдилища и прокуратури",
        "Courts & prosecution",
        index,
        {
          loading: armed && !data,
          icon: Scale,
        },
      ),
    ],
    [index, armed, data],
  );

  return (
    <SectorEntitySearch
      idPrefix="judiciary-search"
      groups={groups}
      onArm={() => setArmed(true)}
      title={{
        bg: "Намери съд или прокуратура",
        en: "Find a court or prosecution office",
      }}
      placeholder={{
        bg: "съд, прокуратура, град…",
        en: "court, prosecution office, town…",
      }}
      hint={{
        bg: "Търси по име, град, ниво или вид — приема и изписване на латиница.",
        en: "Search by name, town, tier or kind — Latin-typed queries work too.",
      }}
    />
  );
};
