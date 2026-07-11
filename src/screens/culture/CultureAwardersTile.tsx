// "Културата като възложител" — the culture bodies as public buyers. Mirrors the
// judiciary JudicialAwardersTile: each funder/institute deep-links to its own
// /awarder/<eik> procurement dashboard, with a "с бюджетен разрез" badge on МК
// (the only one that carries a sector pack). The state institutes beyond the
// funders are counted, not all listed (most procure sparsely) — plan §2/§5.1.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
} from "@/lib/kulturaReferenceData";

interface RosterRow {
  eik: string;
  name: string;
  hasPack?: boolean;
  note?: string;
}

export const CultureAwardersTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [expanded, setExpanded] = useState(false);

  const bodyRows: RosterRow[] = CULTURE_BODIES.map((b) => ({
    eik: b.eik,
    name: bg ? b.bg : b.en,
    hasPack: b.hasPack,
    note: bg ? b.noteBg : b.noteEn,
  }));
  // The state institutes beyond the headline bodies (proper-noun names, shown as
  // published; no separate EN form).
  const instituteRows: RosterRow[] = STATE_CULTURE_INSTITUTES.filter(
    (i) => !CULTURE_BODIES.some((b) => b.eik === i.eik),
  ).map((i) => ({ eik: i.eik, name: i.bg }));

  const rows = expanded ? [...bodyRows, ...instituteRows] : bodyRows;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg ? "Културата като възложител" : "Culture as a public buyer"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border/60">
          {rows.map((b) => (
            <li key={b.eik}>
              <Link
                to={`/awarder/${b.eik}`}
                className="group flex items-center gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium group-hover:text-primary">
                      {b.name}
                    </span>
                    {b.hasPack && (
                      <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {bg ? "с бюджетен разрез" : "with budget"}
                      </span>
                    )}
                  </div>
                  {b.note && (
                    <div className="truncate text-xs text-muted-foreground">
                      {b.note}
                    </div>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {b.eik}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
        {instituteRows.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
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
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? "Субсидиите за филми и грантове се плащат извън ЗОП; тук са само обществените поръчки на институциите (АОП/ЦАИС ЕОП)."
            : "Film subsidies and grants are paid outside procurement; this lists only the institutions' public tenders (АОП/ЦАИС ЕОП)."}
        </p>
      </CardContent>
    </Card>
  );
};
