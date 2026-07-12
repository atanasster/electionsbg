// "Големите програми" — the flagship acquisition programs the procurement corpus
// can't show (F-16, Stryker, patrol ships, the ammunition JV): value, timeline,
// status and the controversy markers. These run through US FMS / inter-
// governmental deals, so this curated board is the only place they surface. This
// is the marquee narrative tile of the /defense screen.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Rocket, Plane, Truck, Ship, Factory } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type {
  DefenseProgram,
  ProgramDomain,
  ProgramStatus,
  ProgramsFile,
} from "@/data/defense/useDefenseData";

const DOMAIN_ICON: Record<ProgramDomain, LucideIcon> = {
  air: Plane,
  land: Truck,
  sea: Ship,
  industry: Factory,
};
const DOMAIN_LABEL: Record<ProgramDomain, { bg: string; en: string }> = {
  air: { bg: "Въздух", en: "Air" },
  land: { bg: "Суша", en: "Land" },
  sea: { bg: "Море", en: "Sea" },
  industry: { bg: "Индустрия", en: "Industry" },
};
const STATUS: Record<ProgramStatus, { bg: string; en: string; cls: string }> = {
  planned: {
    bg: "Планирано",
    en: "Planned",
    cls: "bg-muted text-muted-foreground",
  },
  build: {
    bg: "Строеж",
    en: "Building",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/25 dark:text-amber-400",
  },
  in_progress: {
    bg: "В доставка",
    en: "In delivery",
    cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/25 dark:text-sky-400",
  },
  delivery: {
    bg: "Доставя се",
    en: "Delivering",
    cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/25 dark:text-sky-400",
  },
  delay: {
    bg: "Забавяне",
    en: "Delayed",
    cls: "bg-red-100 text-red-700 dark:bg-red-900/25 dark:text-red-400",
  },
  done: {
    bg: "Завършено",
    en: "Completed",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-400",
  },
};

const ProgramCard: FC<{
  p: DefenseProgram;
  lang: string;
  axisMin: number;
  axisMax: number;
}> = ({ p, lang, axisMin, axisMax }) => {
  const bg = lang === "bg";
  const Icon = DOMAIN_ICON[p.domain];
  const st = STATUS[p.status];
  const value =
    p.currency === "USD"
      ? `≈${(p.value / 1e9).toLocaleString(lang, { maximumFractionDigits: 1 })} млрд $`
      : `≈${formatEurCompact(p.value, lang)}`;
  // Lifecycle span on the shared axis: contract year → last milestone year.
  // A program with no milestones has no bar to draw — skip it rather than emit
  // NaN geometry from Math.min/max over an empty array.
  const yrs = p.timeline.map((m) => m.year);
  if (!yrs.length) return null;
  const span = axisMax - axisMin || 1;
  const pos = (y: number) => ((y - axisMin) / span) * 100;
  const startY = Math.min(...yrs);
  const endY = Math.max(...yrs);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {bg ? DOMAIN_LABEL[p.domain].bg : DOMAIN_LABEL[p.domain].en}
          </div>
          <div className="mt-0.5 font-semibold leading-tight">{p.name}</div>
        </div>
        <div className="text-right">
          <div className="whitespace-nowrap text-lg font-bold tabular-nums">
            {value}
          </div>
          <div className="text-[10.5px] text-muted-foreground">{p.units}</div>
        </div>
      </div>
      <div>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}
        >
          {bg ? st.bg : st.en}
        </span>
      </div>
      {/* Lifecycle Gantt bar on the shared axis — the program's span with a dot
          per milestone (coloured by kind), so overlap across programs reads. */}
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-muted" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-primary/40"
          style={{
            left: `${pos(startY)}%`,
            width: `${pos(endY) - pos(startY)}%`,
          }}
        />
        {p.timeline.map((m, i) => (
          <div
            key={i}
            title={`${m.year} · ${m.label}`}
            className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${
              m.kind === "delivery"
                ? "bg-emerald-500"
                : m.kind === "contract"
                  ? "bg-primary"
                  : "bg-muted-foreground/50"
            }`}
            style={{ left: `${pos(m.year)}%` }}
          />
        ))}
      </div>
      {/* Milestone spine */}
      <ol className="space-y-1">
        {p.timeline.map((m, i) => (
          <li key={i} className="flex items-baseline gap-2 text-[11.5px]">
            <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
              {m.year}
            </span>
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                m.kind === "delivery"
                  ? "bg-emerald-500"
                  : m.kind === "contract"
                    ? "bg-primary"
                    : "bg-muted-foreground/40"
              }`}
            />
            <span className="text-muted-foreground">{m.label}</span>
          </li>
        ))}
      </ol>
      {p.flags.length > 0 && (
        <ul className="space-y-1 border-t pt-2">
          {p.flags.map((f, i) => (
            <li
              key={i}
              className="flex items-baseline gap-2 text-[11px] text-muted-foreground"
            >
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const DefenseProgramsTile: FC<{ data: ProgramsFile }> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  // Shared lifecycle axis across every program's milestones. Guard the empty
  // case (a curated set with no milestones) so the legend never reads
  // "Infinity — -Infinity" and the bars don't get NaN geometry.
  const allYears = data.programs.flatMap((p) => p.timeline.map((m) => m.year));
  const axisMin = allYears.length
    ? Math.min(...allYears)
    : new Date().getUTCFullYear();
  const axisMax = allYears.length ? Math.max(...allYears) : axisMin;

  return (
    <Card id="defense-programs">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          {bg ? "Големите програми" : "The flagship programs"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="max-w-[64ch] text-xs text-muted-foreground">
          {bg
            ? "Стойност, жизнен цикъл и състояние на водещите проекти, на обща времева ос. Тези сделки минават по US FMS или междуправителствено — затова липсват в регистъра на поръчките и се поддържат отделно тук."
            : "Value, lifecycle and status of the flagship projects on a shared timeline. These run through US FMS or inter-governmental deals — so they are absent from the procurement register and tracked here separately."}
        </p>
        {/* Shared-axis legend: contract · delivery · planned, plus the span. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {axisMin} — {axisMax}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-primary" />
            {bg ? "договор" : "contract"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-emerald-500" />
            {bg ? "доставка" : "delivery"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-muted-foreground/50" />
            {bg ? "планирано" : "planned"}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {data.programs.map((p) => (
            <ProgramCard
              key={p.id}
              p={p}
              lang={lang}
              axisMin={axisMin}
              axisMax={axisMax}
            />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">{data.source}</p>
      </CardContent>
    </Card>
  );
};
