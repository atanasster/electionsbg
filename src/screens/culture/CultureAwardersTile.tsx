// "Културата като възложител" — the culture bodies as public buyers. Each
// funder/institute deep-links to its own /awarder/<eik> procurement dashboard, with a
// "с бюджетен разрез" badge on МК (the only one that carries a sector pack). The state
// institutes beyond the funders are collapsed behind a toggle (most procure sparsely)
// — plan §2/§5.1. Rendered by the shared AwarderListSection.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AwarderListSection,
  type AwarderRow,
} from "@/screens/components/procurement/AwarderListSection";
import {
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
  ART_SCHOOLS,
  DKI_CONFIRMED_INSTITUTES,
} from "@/lib/kulturaReferenceData";

export const CultureAwardersTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [expanded, setExpanded] = useState(false);

  const bodyRows: AwarderRow[] = CULTURE_BODIES.map((b) => ({
    eik: b.eik,
    name: bg ? b.bg : b.en,
    badge: b.hasPack ? (bg ? "с бюджетен разрез" : "with budget") : undefined,
    note: bg ? b.noteBg : b.noteEn,
  }));
  // The state institutes and the МК art schools beyond the headline bodies
  // (proper-noun names, shown as published; no separate EN form).
  //
  // ART_SCHOOLS is here because being in the roll-up is not the same as being
  // REACHABLE: the fifteen schools were added to CULTURE_GROUP_EIKS and to the
  // oblast map first, which fixed the totals and left them absent from the two
  // surfaces a reader actually clicks — this roster and the search box. They are
  // also the sector's worst-competing tier (48.6% single-bid against a 40.9%
  // national baseline), so omitting them hides exactly what a reader came for.
  const instituteRows: AwarderRow[] = [
    ...STATE_CULTURE_INSTITUTES,
    ...ART_SCHOOLS,
    ...DKI_CONFIRMED_INSTITUTES,
  ]
    .filter((i) => !CULTURE_BODIES.some((b) => b.eik === i.eik))
    .map((i) => ({ eik: i.eik, name: i.bg }));

  return (
    <AwarderListSection
      variant="roster"
      showEik
      title={bg ? "Културата като възложител" : "Culture as a public buyer"}
      rows={expanded ? [...bodyRows, ...instituteRows] : bodyRows}
      footnote={
        bg
          ? "Субсидиите за филми и грантове се плащат извън ЗОП; тук са само обществените поръчки на институциите (АОП/ЦАИС ЕОП)."
          : "Film subsidies and grants are paid outside procurement; this lists only the institutions' public tenders (АОП/ЦАИС ЕОП)."
      }
    >
      {instituteRows.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {expanded
            ? bg
              ? "Свий"
              : "Show less"
            : bg
              ? `Виж всички държавни културни институти (+${instituteRows.length})`
              : `Show all state cultural institutes (+${instituteRows.length})`}
        </button>
      )}
    </AwarderListSection>
  );
};
