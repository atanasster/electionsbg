// "Приход (ГФО) срещу плащания от НЗОК" — the multi-year trend tile in the
// public/private band. Public/state hospitals report quarterly financials to МЗ
// (ЕЕОФ); private ones don't, so this reads each private hospital's annual ГФО
// revenue (recovered from the Търговски регистър, 2019-2024) and overlays the
// НЗОК payments for the years where a same-year share is known (2023+). The
// gap between the two lines is the private hospital's non-НЗОК (paid) business;
// the closer they run, the more the hospital is really a public contractor.
//
// Pure UI over one static blob: useNzokPublicPrivate — the per-hospital revenue
// series is folded into public_private.json, so no second fetch. Self-hides
// until it loads.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Command as CommandPrimitive } from "cmdk";
import { LineChart, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { ownershipColor } from "@/lib/nzokOwnership";
import { useNzokPublicPrivate } from "@/data/budget/useBudget";

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];
const NAVY = "hsl(var(--primary))";
const REVENUE = ownershipColor("private"); // amber
const W = 360;
const H = 148;
const PAD = { l: 8, r: 8, t: 14, b: 20 };

export const NzokRevenueTrendTile: FC = () => {
  const { i18n, t } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data: pp } = useNzokPublicPrivate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  // private hospitals that have a usable revenue series (≥3 years), ordered by НЗОК.
  // The series is folded into public_private.json, so no separate fetch.
  const options = useMemo(() => {
    if (!pp) return [];
    return pp.hospitals
      .filter((h) => h.series && Object.keys(h.series).length >= 3)
      .map((h) => ({ eik: h.eik, name: h.name }));
  }, [pp]);

  const eik = picked ?? options[0]?.eik ?? null;
  const eur = (v: number | null | undefined) => formatEurCompact(v, locale);

  if (!pp || !eik) return null;

  const ppRow = pp.hospitals.find((h) => h.eik === eik);
  const years = ppRow?.series ?? {};
  const series = YEARS.map((y) => {
    const c = years[String(y)];
    return {
      y,
      rev: c?.rev ?? null,
      nzok:
        c?.rev != null && c.nzokShare != null
          ? Math.round(c.rev * c.nzokShare)
          : null,
    };
  });
  const present = series.filter((p) => p.rev != null);
  const max = Math.max(...present.map((p) => p.rev as number), 1);
  const x = (y: number) => PAD.l + ((y - 2019) / 5) * (W - PAD.l - PAD.r);
  const yScale = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);

  const line = (key: "rev" | "nzok") => {
    const pts = series
      .filter((p) => p[key] != null)
      .map((p) => `${x(p.y)},${yScale(p[key] as number)}`);
    return pts.join(" ");
  };
  const revPts = series.filter((p) => p.rev != null);
  const areaPath =
    revPts.length > 1
      ? `M${x(revPts[0].y)},${yScale(revPts[0].rev as number)} ` +
        revPts
          .slice(1)
          .map((p) => `L${x(p.y)},${yScale(p.rev as number)}`)
          .join(" ") +
        ` L${x(revPts[revPts.length - 1].y)},${H - PAD.b} L${x(revPts[0].y)},${H - PAD.b} Z`
      : "";

  const latest = [...present].reverse()[0];
  const latestShareCell = [...YEARS]
    .reverse()
    .map((y) => years[String(y)])
    .find((c) => c?.nzokShare != null);
  const sharePct = latestShareCell
    ? Math.round(latestShareCell.nzokShare! * 100)
    : ppRow?.nzokShare != null
      ? Math.round(ppRow.nzokShare * 100)
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChart className="h-[15px] w-[15px] text-muted-foreground" />
          {bg
            ? "Приход (ГФО) срещу плащания от НЗОК"
            : "Revenue (ГФО) vs НЗОК payments"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={bg ? "Избери болница" : "Choose hospital"}
              className="h-8 w-full justify-between px-2 text-xs font-normal"
            >
              <span className="truncate">
                {decodeEntities(ppRow?.name ?? "—")}
              </span>
              <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[--radix-popover-trigger-width] min-w-[240px] p-0"
            align="start"
          >
            <CommandPrimitive shouldFilter={false}>
              <CommandInput
                placeholder={`${t("search")}...`}
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>{t("no_results")}</CommandEmpty>
                {options
                  .filter(
                    (o) =>
                      !query ||
                      decodeEntities(o.name)
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                  )
                  .slice(0, 200)
                  .map((o) => (
                    <CommandPrimitive.Item
                      key={o.eik}
                      value={o.eik}
                      onSelect={() => {
                        setPicked(o.eik);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="cursor-pointer px-2 py-1.5 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
                    >
                      <span className="block min-w-0 truncate">
                        {decodeEntities(o.name)}
                      </span>
                    </CommandPrimitive.Item>
                  ))}
              </CommandList>
            </CommandPrimitive>
          </PopoverContent>
        </Popover>

        <div className="grid items-center gap-4 sm:grid-cols-[1.5fr_1fr]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={
              bg ? "Приход и НЗОК по години" : "Revenue and НЗОК by year"
            }
          >
            {areaPath && (
              <path d={areaPath} fill={REVENUE} fillOpacity={0.13} />
            )}
            <polyline
              points={line("rev")}
              fill="none"
              stroke={REVENUE}
              strokeWidth={2.2}
            />
            {series.some((p) => p.nzok != null) && (
              <polyline
                points={line("nzok")}
                fill="none"
                stroke={NAVY}
                strokeWidth={2.2}
              />
            )}
            {series
              .filter((p) => p.nzok != null)
              .map((p) => (
                <circle
                  key={`n${p.y}`}
                  cx={x(p.y)}
                  cy={yScale(p.nzok as number)}
                  r={2.8}
                  fill={NAVY}
                />
              ))}
            {latest && (
              <circle
                cx={x(latest.y)}
                cy={yScale(latest.rev as number)}
                r={3.2}
                fill={REVENUE}
              />
            )}
            {YEARS.map((y) => (
              <text
                key={y}
                x={x(y)}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 9 }}
              >
                {y}
              </text>
            ))}
          </svg>

          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: REVENUE }}
              />
              <span>
                <span className="font-semibold text-foreground">
                  {bg ? "Приход (ГФО)" : "Revenue (ГФО)"}
                </span>{" "}
                — {eur(latest?.rev)}
                {latest ? ` (${latest.y})` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: NAVY }}
              />
              <span>
                <span className="font-semibold text-foreground">
                  {bg ? "Плащания от НЗОК" : "НЗОК payments"}
                </span>
              </span>
            </div>
            {sharePct != null && (
              <div className="pt-1">
                <div className="text-xl font-bold tabular-nums text-primary">
                  {sharePct}% {bg ? "публично" : "public"}
                </div>
                <div className="text-[11px] leading-snug">
                  {bg
                    ? "дял на НЗОК от приходите (последна година с данни)"
                    : "НЗОК share of revenue (latest year with data)"}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="border-t border-border/60 pt-2.5 text-[11px] leading-snug text-muted-foreground/80">
          {bg
            ? "Приход от годишния финансов отчет (ГФО) в Търговския регистър. НЗОК е показан за годините с изчислен дял (2023+)."
            : "Revenue from the annual ГФО in the Commerce Register. НЗОК shown for years with a computed share (2023+)."}
        </p>
      </CardContent>
    </Card>
  );
};
