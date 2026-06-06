// Renders a tool Envelope into the site's own chart/table primitives.
// kind "series" -> line/bar chart; "table" -> data table; "scalar" -> stat list.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Column, Envelope, Lang } from "../tools/types";

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
      row[s.key] = s.points[i]?.y ?? null;
    });
    return row;
  });

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

  return (
    <ChartContainer config={config} className="max-h-[360px] w-full">
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
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
      </LineChart>
    </ChartContainer>
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

export const AnswerView = ({
  env,
  lang = "bg",
}: {
  env: Envelope;
  lang?: Lang;
}) => {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {env.title}
          </h3>
          {env.subtitle && (
            <p className="text-sm text-muted-foreground">{env.subtitle}</p>
          )}
        </div>
        {/* trust signal: every figure is computed deterministically, never
            generated by the language model */}
        <span
          className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
          title={
            lang === "bg"
              ? "Всички числа са изчислени от официалните данни, не са генерирани от езиков модел."
              : "Every figure is computed from official data, not generated by a language model."
          }
        >
          {lang === "bg"
            ? "изчислено, не генерирано"
            : "computed, not generated"}
        </span>
      </div>

      {env.kind === "series" && <SeriesChart env={env} lang={lang} />}
      {env.kind === "table" && <DataTable env={env} />}
      {env.kind === "scalar" && <Scalar env={env} />}

      <p className="flex flex-wrap items-center gap-x-1.5 pt-1 text-xs text-muted-foreground">
        {env.provenance.length > 0 && (
          <span>
            {lang === "bg" ? "Източник" : "Source"}: {env.provenance.join(", ")}{" "}
            ·
          </span>
        )}
        <a
          href="https://electionsbg.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          electionsbg.com
        </a>
      </p>
    </div>
  );
};
