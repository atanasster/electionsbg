// Renders a tool Envelope into the site's own chart/table primitives.
// kind "series" -> line/bar chart; "table" -> data table; "scalar" -> stat list.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Info } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResponseMeta } from "../llm/provider";
import type { Column, Envelope, Lang, SeriesPoint } from "../tools/types";
import { siteLinks } from "./links";

// Lazy so leaflet (and the geojson fetch) only ship when an answer has a map.
const GeoChoropleth = lazy(() => import("./GeoChoropleth"));

const CHART_VARS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const fmtCell = (value: string | number | null, col: Column): string => {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (col.format === "pct") return `${value.toLocaleString()}%`;
    return value.toLocaleString();
  }
  return value;
};

// Compact y-axis ticks so euro charts read "2,9 млрд" / "€2.9B" instead of
// "2900000000"; small numbers (percentages) pass through normally.
const tickFmt =
  (lang: Lang) =>
  (v: number): string => {
    const locale = lang === "bg" ? "bg-BG" : "en-US";
    return Math.abs(v) >= 10000
      ? new Intl.NumberFormat(locale, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(v)
      : new Intl.NumberFormat(locale).format(v);
  };

// Auto peak/trough markers for a single-line trend (≥3 points). These tell the
// chart's story at a glance — "highest here, lowest there" — without any tool
// change. Bars (rankings) and multi-series charts are left unmarked unless the
// envelope supplies explicit `markers`.
const autoMarkers = (
  env: Envelope,
  lang: Lang,
): { x: string | number; y: number; label: string; kind: string }[] => {
  if (env.viz !== "line" || (env.series?.length ?? 0) !== 1) return [];
  const pts = (env.series![0].points ?? []).filter(
    (p): p is { x: string | number; y: number } => p.y != null,
  );
  if (pts.length < 3) return [];
  let hi = pts[0];
  let lo = pts[0];
  for (const p of pts) {
    if (p.y > hi.y) hi = p;
    if (p.y < lo.y) lo = p;
  }
  if (hi.x === lo.x) return [];
  return [
    { x: hi.x, y: hi.y, label: lang === "bg" ? "връх" : "peak", kind: "peak" },
    { x: lo.x, y: lo.y, label: lang === "bg" ? "дъно" : "low", kind: "trough" },
  ];
};

const SeriesChart = ({ env, lang }: { env: Envelope; lang: Lang }) => {
  const series = env.series ?? [];
  const categories = env.categories ?? [];

  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.key,
      { label: s.label, color: s.color || CHART_VARS[i % CHART_VARS.length] },
    ]),
  );

  // shape: [{ x, <key1>, <key2>, ... }]
  const data = categories.map((x, i) => {
    const row: Record<string, string | number | null> = { x };
    series.forEach((s) => {
      row[s.key] = (s.points[i] as SeriesPoint | undefined)?.y ?? null;
    });
    return row;
  });

  const bands = env.bands ?? [];

  if (env.viz === "bar") {
    const s0 = series[0];
    return (
      <ChartContainer config={config} className="max-h-[360px] w-full">
        <BarChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="x"
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tickFmt(lang)}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey={s0.key} radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={`var(--color-${s0.key})`} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    );
  }

  const markers = env.markers?.length
    ? env.markers.map((m) => ({
        x: m.x,
        // y from the first series at that x, when not given
        y:
          (series[0]?.points.find((p) => p.x === m.x)?.y as number | null) ??
          null,
        label: m.label ?? "",
        kind: m.kind ?? "peak",
      }))
    : autoMarkers(env, lang);

  return (
    <ChartContainer config={config} className="max-h-[360px] w-full">
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        {bands.map((b, i) => (
          <ReferenceArea
            key={`band-${i}`}
            x1={b.fromX}
            x2={b.toX}
            fill={b.color ?? "hsl(var(--muted-foreground))"}
            fillOpacity={0.08}
            label={{ value: b.label, position: "insideTop", fontSize: 10 }}
          />
        ))}
        <XAxis
          dataKey="x"
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={tickFmt(lang)}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {/* Multi-line charts (e.g. seats per party over time) need a legend to
            tell the lines apart; a single trend line doesn't. */}
        {series.length > 1 && (
          <ChartLegend
            content={<ChartLegendContent />}
            verticalAlign="bottom"
          />
        )}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        ))}
        {markers
          .filter((m) => m.y != null)
          .map((m, i) => (
            <ReferenceDot
              key={`mark-${i}`}
              x={m.x}
              y={m.y as number}
              r={4}
              fill={
                m.kind === "trough"
                  ? "hsl(var(--chart-4))"
                  : "hsl(var(--chart-2))"
              }
              stroke="hsl(var(--background))"
              strokeWidth={1.5}
              label={{
                value: m.label,
                position: m.kind === "trough" ? "bottom" : "top",
                fontSize: 10,
                fill: "hsl(var(--muted-foreground))",
              }}
            />
          ))}
      </LineChart>
    </ChartContainer>
  );
};

// --- hemicycle (parliament seat composition) -------------------------------
// Lay out `n` seats in a 180° arc across a sensible number of rows, in unit
// coords (x ∈ [-1,1], y ∈ [-1,0]) ordered left → right so the party fill sweeps
// across the arc. Adapted from the site's LocalCouncilHemicycleTile geometry.
type HemiSeat = { x: number; y: number; angle: number };

const hemicycleSeats = (n: number): HemiSeat[] => {
  if (n <= 0) return [];
  const rows = Math.max(2, Math.min(8, Math.round(Math.sqrt(n / 2.2))));
  const r0 = 0.42; // inner-row radius (outer row = 1)
  const radii = Array.from({ length: rows }, (_, i) =>
    rows === 1 ? 1 : r0 + ((1 - r0) * i) / (rows - 1),
  );
  const radiusSum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((n * r) / radiusSum)));
  // Reconcile rounding so the row counts sum to exactly n.
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (
    let i = counts.length - 1;
    diff !== 0 && i >= 0;
    i = i === 0 ? counts.length - 1 : i - 1
  ) {
    if (diff > 0) {
      counts[i]++;
      diff--;
    } else if (counts[i] > 1) {
      counts[i]--;
      diff++;
    }
  }
  const seats: HemiSeat[] = [];
  radii.forEach((r, rowIdx) => {
    const c = counts[rowIdx];
    for (let s = 0; s < c; s++) {
      const angle = c === 1 ? Math.PI / 2 : Math.PI - (Math.PI * s) / (c - 1);
      seats.push({ x: r * Math.cos(angle), y: -r * Math.sin(angle), angle });
    }
  });
  // Left → right around the arc (high angle = left).
  return seats.sort((a, b) => b.angle - a.angle);
};

const HemicycleChart = ({ env, lang }: { env: Envelope; lang: Lang }) => {
  const parties = (env.rows ?? []).map((r, i) => ({
    name: String(r.party ?? ""),
    seats: Number(r.seats ?? 0),
    color: (typeof r.color === "string" && r.color) || CHART_VARS[i % 5],
  }));
  const total = parties.reduce((a, p) => a + p.seats, 0);
  if (total === 0) return null;
  const majority = Math.floor(total / 2) + 1;

  // one colour entry per seat, in the same left → right order as hemicycleSeats
  const seatColors: string[] = [];
  parties.forEach((p) => {
    for (let i = 0; i < p.seats; i++) seatColors.push(p.color);
  });
  const seats = hemicycleSeats(total);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        viewBox="-1.12 -1.16 2.24 1.3"
        className="w-full max-w-[460px]"
        role="img"
        aria-label={env.title}
      >
        {seats.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={0.034}
            fill={seatColors[i] ?? "hsl(var(--muted-foreground))"}
            stroke="hsl(var(--background))"
            strokeWidth={0.006}
          />
        ))}
        {/* Total seats centred in the well of the arc. */}
        <text
          x={0}
          y={-0.16}
          textAnchor="middle"
          className="fill-foreground"
          style={{ font: "700 0.22px var(--font-sans, sans-serif)" }}
        >
          {total}
        </text>
        <text
          x={0}
          y={-0.04}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ font: "500 0.08px var(--font-sans, sans-serif)" }}
        >
          {lang === "bg" ? `мнозинство ${majority}` : `majority ${majority}`}
        </text>
      </svg>

      {/* Legend: party → seats. */}
      <ul className="grid w-full max-w-[460px] grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {parties.map((p) => (
          <li key={p.name} className="flex min-w-0 items-center gap-2 text-sm">
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-border"
              style={{ backgroundColor: p.color }}
            />
            <span className="truncate" title={p.name}>
              {p.name}
            </span>
            <span className="ml-auto shrink-0 font-semibold tabular-nums">
              {p.seats}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const DataTable = ({ env }: { env: Envelope }) => {
  const cols = env.columns ?? [];
  const rows = env.rows ?? [];
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.key} className={c.numeric ? "text-right" : ""}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell
                  key={c.key}
                  className={
                    c.numeric ? "text-right font-mono tabular-nums" : ""
                  }
                >
                  {fmtCell(r[c.key], c)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

const Scalar = ({ env }: { env: Envelope }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    {Object.entries(env.facts).map(([k, v]) => (
      <div key={k} className="contents">
        <dt className="text-muted-foreground">{k}</dt>
        <dd className="font-medium">{String(v)}</dd>
      </div>
    ))}
  </dl>
);

const fmtDuration = (ms: number, lang: Lang): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-US";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const unit = lang === "bg" ? "с" : "s";
  return `${(ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`;
};

// Compact "how this was produced" line: model · time. Token counts (model only)
// move into the hover tooltip — voters don't need the token math, but it stays
// available. The tooltip also carries the trust assurance that the numbers are
// computed from official data, not generated.
const MetaLine = ({ meta, lang }: { meta: ResponseMeta; lang: Lang }) => {
  const locale = lang === "bg" ? "bg-BG" : "en-US";
  const n = (v: number) => v.toLocaleString(locale);
  const model = meta.model[lang];
  const inline = `${model} · ${fmtDuration(meta.durationMs, lang)}`;
  const trust =
    lang === "bg"
      ? "Числата са изчислени от официалните данни, не са генерирани."
      : "Figures are computed from official data, not generated.";
  const title =
    (lang === "bg"
      ? `Модел: ${model}\nВреме: ${fmtDuration(meta.durationMs, lang)}`
      : `Model: ${model}\nTime: ${fmtDuration(meta.durationMs, lang)}`) +
    (meta.inputTokens != null
      ? lang === "bg"
        ? `\nТокени: ${n(meta.inputTokens)} вход / ${n(meta.outputTokens ?? 0)} изход`
        : `\nTokens: ${n(meta.inputTokens)} in / ${n(meta.outputTokens ?? 0)} out`
      : "") +
    `\n\n${trust}`;
  return (
    <span
      className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
      title={title}
    >
      {inline}
    </span>
  );
};

// Real electionsbg.com pages backing the answer, plus the raw data-source
// filenames tucked behind an info tooltip (transparency without clutter).
const SourceLinks = ({ env, lang }: { env: Envelope; lang: Lang }) => {
  const links = siteLinks(env);
  const prov = env.provenance ?? [];
  // nothing to attribute (no page links and no source files) — render nothing
  if (links.length === 0 && prov.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">
      {links.length > 0 && (
        <span>{lang === "bg" ? "Виж в сайта:" : "See on the site:"}</span>
      )}
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-input bg-card px-2 py-0.5 text-foreground/80 underline-offset-2 hover:bg-muted hover:text-foreground"
        >
          {l.label[lang]} ↗
        </a>
      ))}
      {prov.length > 0 && (
        <span
          className="inline-flex items-center gap-1 opacity-70"
          title={
            (lang === "bg" ? "Източник на данните: " : "Data source: ") +
            prov.join(", ")
          }
        >
          <Info className="size-3" />
          {lang === "bg" ? "данни" : "data"}
        </span>
      )}
    </p>
  );
};

export const AnswerView = ({
  env,
  lang = "bg",
  meta,
  narration,
  actions,
  controls,
}: {
  env: Envelope;
  lang?: Lang;
  meta?: ResponseMeta;
  // the answer sentence, folded into the panel as a lead paragraph
  narration?: string;
  // per-response export controls, rendered in the header band (right)
  actions?: ReactNode;
  // per-response interaction controls (read-aloud), under the prose
  controls?: ReactNode;
}) => {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {/* header band: how-produced meta (left), export (right) */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {meta && <MetaLine meta={meta} lang={lang} />}
        </div>
        {actions && (
          <div data-export-actions="" className="shrink-0">
            {actions}
          </div>
        )}
      </div>

      {narration && (
        <p className="text-sm leading-relaxed text-foreground">{narration}</p>
      )}

      {controls && (
        <div
          data-answer-controls=""
          className="flex flex-wrap items-center gap-2"
        >
          {controls}
        </div>
      )}

      <div>
        <h3 className="text-base font-semibold text-foreground">{env.title}</h3>
        {env.subtitle && (
          <p className="text-sm text-muted-foreground">{env.subtitle}</p>
        )}
      </div>

      {/* Optional geographic map. The numbers stay in the table/chart below, so
          this is additive; data-export-omit keeps the tile-backed map out of the
          PNG capture (raster tiles taint the export canvas). */}
      {env.geo && (
        <div data-export-omit="">
          <Suspense
            fallback={
              <div className="h-[320px] w-full animate-pulse rounded-lg border border-border bg-muted" />
            }
          >
            <GeoChoropleth geo={env.geo} lang={lang} />
          </Suspense>
        </div>
      )}

      {env.viz === "hemicycle" ? (
        <HemicycleChart env={env} lang={lang} />
      ) : (
        <>
          {env.kind === "series" && <SeriesChart env={env} lang={lang} />}
          {env.kind === "table" && <DataTable env={env} />}
          {env.kind === "scalar" && <Scalar env={env} />}
        </>
      )}

      <SourceLinks env={env} lang={lang} />
    </div>
  );
};
