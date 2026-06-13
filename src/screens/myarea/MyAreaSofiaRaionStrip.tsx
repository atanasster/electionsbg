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
import { findCityRayon, cityRayonsOf } from "@/data/local/cityRayonCatalog";

type Props = {
  activeObshtina: string;
};

// Sofia райони all sit in oblast codes S23/S24/S25. Identifying them by
// the obshtina prefix is robust to the data evolving — anything matching
// /^S2\d/ today is a Sofia район.
const isSofiaRaion = (obshtina: string): boolean => /^S2\d/.test(obshtina);

// Flex-wrapped jump chips for the sibling районите of the град the active place
// belongs to. Two families: Sofia's 24 районите are real obshtini (S2xxx, in
// municipalities.json); Пловдив/Варна районите are catalog entries ("PDV22-01")
// whose siblings come from the shared catalog. Renders nothing when the active
// place isn't a район.
export const MyAreaSofiaRaionStrip: FC<Props> = ({ activeObshtina }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { municipalities } = useMunicipalities();
  const setAnchor = useSetAreaAnchor();

  // A Пловдив/Варна район resolves in the catalog; Sofia районите do not (they
  // live in municipalities.json instead).
  const cityRayon = findCityRayon(activeObshtina);

  const items = useMemo<{ id: string; label: string }[]>(() => {
    const collator = lang === "bg" ? "bg" : "en";
    if (cityRayon) {
      return cityRayonsOf(cityRayon.obshtina)
        .map((r) => ({
          id: r.id,
          label: lang === "bg" ? r.labelBg : r.labelEn,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, collator));
    }
    if (isSofiaRaion(activeObshtina) && municipalities) {
      return municipalities
        .filter((m) => isSofiaRaion(m.obshtina))
        .map((m) => ({
          id: m.obshtina,
          label: lang === "bg" ? m.name : m.name_en,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, collator));
    }
    return [];
  }, [cityRayon, activeObshtina, municipalities, lang]);

  if (items.length === 0) return null;

  const heading = cityRayon
    ? lang === "bg"
      ? `Други райони в Община ${cityRayon.cityBg}`
      : `Other districts in ${cityRayon.cityEn} municipality`
    : lang === "bg"
      ? "Други столични райони"
      : "Other Sofia districts";

  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        {heading}
      </div>
      <nav aria-label={heading} className="flex flex-wrap gap-1.5">
        {items.map((r) => {
          const active = r.id === activeObshtina;
          return (
            <Link
              key={r.id}
              to={`/governance/${r.id}`}
              underline={false}
              onClick={() => setAnchor(r.id)}
              className={`shrink-0 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary/15 text-primary font-semibold border border-primary/40"
                  : "border border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {r.label}
            </Link>
          );
        })}
      </nav>
    </Card>
  );
};
