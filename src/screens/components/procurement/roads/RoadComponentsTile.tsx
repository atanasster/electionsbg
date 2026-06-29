// "Видове работа" — what kind of work the money buys, broken down by component
// (tunnels, bridges, tolling/ITS, markings, safety barriers, roadway, design…).
// Each row pairs the spend with two capture signals: the single-bidder share
// and the largest contractor's share of that component — so a descriptive
// breakdown doubles as a per-market competition scan (recurring commodity works
// like markings / barriers / tolling are where capture shows up most).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type {
  ComponentAgg,
  WorkComponent,
} from "@/data/procurement/roadAttributes";

export const COMPONENT_LABEL: Record<
  WorkComponent,
  { bg: string; en: string }
> = {
  tunnel: { bg: "Тунели", en: "Tunnels" },
  bridge: { bg: "Мостове и съоръжения", en: "Bridges & structures" },
  tolling_its: { bg: "Тол и ИТС", en: "Tolling & ITS" },
  markings_signs: { bg: "Маркировка и знаци", en: "Markings & signs" },
  safety_barriers: { bg: "Ограничителни системи", en: "Safety barriers" },
  lighting: { bg: "Осветление", en: "Lighting" },
  drainage: { bg: "Отводняване", en: "Drainage" },
  retaining: { bg: "Подпорни стени", en: "Retaining walls" },
  winter_maint: { bg: "Зимно поддържане", en: "Winter maintenance" },
  roadway: { bg: "Пътно платно (строеж/ремонт)", en: "Roadway (build/repair)" },
  design_supervision: {
    bg: "Проектиране и надзор",
    en: "Design & supervision",
  },
  other: { bg: "Друго", en: "Other" },
};

const pct = (v: number | undefined, lang: string): string =>
  v == null
    ? "—"
    : (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 }) + "%";

export const RoadComponentsTile: FC<{ components: ComponentAgg[] }> = ({
  components,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const rows = components.filter((c) => c.totalEur > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((c) => c.totalEur));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" />
          {lang === "bg" ? "Видове работа" : "Kinds of work"}
          <span className="text-xs text-muted-foreground font-normal">
            {lang === "bg" ? "стойност и конкуренция" : "spend & competition"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
          <span className="w-40 shrink-0" />
          <span className="flex-1" />
          <span className="w-20 text-right">
            {lang === "bg" ? "стойност" : "value"}
          </span>
          <span className="w-12 text-right">
            {lang === "bg" ? "1 оф." : "1 bid"}
          </span>
          <span className="w-12 text-right">
            {lang === "bg" ? "топ изп." : "top"}
          </span>
        </div>
        <div className="space-y-1.5">
          {rows.map((c) => {
            const single = c.singleBidShare ?? 0;
            const capture = c.topContractorShare ?? 0;
            return (
              <div
                key={c.component}
                className="flex items-center gap-2 text-xs"
                title={
                  c.topContractorName
                    ? `${lang === "bg" ? "Топ изпълнител" : "Top contractor"}: ${c.topContractorName} (${pct(capture, lang)})`
                    : undefined
                }
              >
                <span className="w-40 shrink-0 truncate">
                  {lang === "bg"
                    ? COMPONENT_LABEL[c.component].bg
                    : COMPONENT_LABEL[c.component].en}
                </span>
                <span className="flex-1 h-2.5 rounded bg-muted overflow-hidden">
                  <span
                    className="block h-full bg-primary/60"
                    style={{
                      width: `${Math.max(2, Math.min(100, (c.totalEur / max) * 100))}%`,
                    }}
                  />
                </span>
                <span className="w-20 text-right tabular-nums">
                  {formatEur(c.totalEur)}
                </span>
                <span
                  className={`w-12 text-right tabular-nums ${single > 0.3 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}
                >
                  {pct(c.singleBidShare, lang)}
                </span>
                <span
                  className={`w-12 text-right tabular-nums ${capture > 0.6 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}
                >
                  {pct(c.topContractorShare, lang)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground/80 pt-2">
          {lang === "bg"
            ? "„1 оф.“ = дял на договорите с един участник; „топ изп.“ = дял на най-големия изпълнител в категорията. Класификация по ключови думи и CPV (CPV често липсва или е неточен); полагането на асфалт попада в „пътно платно“."
            : "“1 bid” = single-bidder share; “top” = the largest contractor's share of the category. Classified by keyword + CPV (CPV is often missing or mis-coded); resurfacing falls under “roadway”."}
        </p>
      </CardContent>
    </Card>
  );
};
