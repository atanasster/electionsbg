// Flex-wrapped chip grid of Sofia райони. Only renders when the resolved
// area is itself a Sofia район (obshtina code S2xxx); helps users jump
// between райони without bouncing through the global search.
//
// Sofia is one град split into 24 райони — administratively each район
// is its own община (S23xx, S24xx, S25xx codes spanning three oblast
// shells). When the user is anchored on any of them we show the full
// grid with the active one highlighted.
//
// Earlier shipped with `overflow-x-auto` which left a visible scrollbar
// on every viewport that couldn't fit all 24 chips on one line — switched
// to `flex-wrap` so chips wrap to a second/third line cleanly with no
// scrollbar artifact.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { Card } from "@/components/ui/card";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSetAreaAnchor } from "@/data/area/areaAnchor";

type Props = {
  activeObshtina: string;
};

// Sofia райони all sit in oblast codes S23/S24/S25. Identifying them by
// the obshtina prefix is robust to the data evolving — anything matching
// /^S2\d/ today is a Sofia район.
const isSofiaRaion = (obshtina: string): boolean => /^S2\d/.test(obshtina);

export const MyAreaSofiaRaionStrip: FC<Props> = ({ activeObshtina }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { municipalities } = useMunicipalities();
  const setAnchor = useSetAreaAnchor();

  const raioni = useMemo(() => {
    if (!municipalities) return [];
    return municipalities
      .filter((m) => isSofiaRaion(m.obshtina))
      .slice()
      .sort((a, b) =>
        (lang === "bg" ? a.name : a.name_en).localeCompare(
          lang === "bg" ? b.name : b.name_en,
          lang === "bg" ? "bg" : "en",
        ),
      );
  }, [municipalities, lang]);

  if (!isSofiaRaion(activeObshtina) || raioni.length === 0) return null;

  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        {lang === "bg" ? "Други столични райони" : "Other Sofia districts"}
      </div>
      <nav
        aria-label={lang === "bg" ? "Столични райони" : "Sofia districts"}
        className="flex flex-wrap gap-1.5"
      >
        {raioni.map((r) => {
          const active = r.obshtina === activeObshtina;
          const display = lang === "bg" ? r.name : r.name_en;
          return (
            <Link
              key={r.obshtina}
              to={`/my-area/${r.obshtina}`}
              underline={false}
              onClick={() => setAnchor(r.obshtina)}
              className={`shrink-0 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary/15 text-primary font-semibold border border-primary/40"
                  : "border border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {display}
            </Link>
          );
        })}
      </nav>
    </Card>
  );
};
