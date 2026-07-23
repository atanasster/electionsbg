// The "По области" cut, with the trend folded in. Every oblast's matura average
// rose between 2022 and 2026, so the level alone says almost nothing — the
// information is in the spread around the national +0.36, which is why this
// table carries first year, latest year and the change rather than just today's
// number.
//
// The change column is paired with a dumbbell: a dot at the first year, a dot at
// the latest, a line between them, all on one scale shared by every row, with a
// tick marking where the country sits. That keeps level, change and rank legible
// at row height — a sparkline of the same series would be five points of shape
// with no readable value. Built from positioned divs rather than an SVG so there
// is no viewBox to scale and no intrinsic width to blow out a grid track.

import { FC, useMemo, useState } from "react";

export interface OblastRow {
  oblast: string;
  name: string;
  firstYear: number;
  firstAvg: number | null;
  latestYear: number;
  latestAvg: number;
  delta: number | null;
  examinees: number;
  schools: number;
}

type SortKey =
  | "name"
  | "latestAvg"
  | "firstAvg"
  | "delta"
  | "schools"
  | "examinees";

const num = (v: number, lang: string, digits = 2): string =>
  v.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** One row's first→latest span on the scale shared by the whole column. */
const Dumbbell: FC<{
  from: number;
  to: number;
  lo: number;
  hi: number;
  national: number | null;
}> = ({ from, to, lo, hi, national }) => {
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const a = pct(Math.min(from, to));
  const b = pct(Math.max(from, to));
  return (
    <div className="relative h-3 w-full min-w-[90px]">
      {/* the country's latest, so "above/below the national line" reads down the column */}
      {national != null && (
        <div
          className="absolute top-0 h-3 w-px bg-muted-foreground/40"
          style={{ left: `${pct(national)}%` }}
        />
      )}
      <div
        className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-muted-foreground/35"
        style={{ left: `${a}%`, width: `${Math.max(b - a, 0.5)}%` }}
      />
      <div
        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/45"
        style={{ left: `${pct(from)}%` }}
      />
      <div
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${pct(to)}%` }}
      />
    </div>
  );
};

export const OblastTrendTable: FC<{
  rows: OblastRow[];
  /** National average for the latest year — the tick on every dumbbell. */
  nationalLatest: number | null;
  lang: string;
}> = ({ rows, nationalLatest, lang }) => {
  const bg = lang === "bg";
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
    key: "latestAvg",
    asc: false,
  });

  const hasTrend = rows.some((r) => r.delta != null);
  const firstYear = rows[0]?.firstYear;
  const latestYear = rows[0]?.latestYear;

  // One scale for the whole column, padded so the end dots aren't flush.
  const [lo, hi] = useMemo(() => {
    const vals = rows.flatMap((r) =>
      r.firstAvg != null ? [r.firstAvg, r.latestAvg] : [r.latestAvg],
    );
    if (nationalLatest != null) vals.push(nationalLatest);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(0.05, (max - min) * 0.08);
    return [min - pad, max + pad];
  }, [rows, nationalLatest]);

  const sorted = useMemo(() => {
    const dir = sort.asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "name") return dir * a.name.localeCompare(b.name, "bg");
      const av = a[sort.key];
      const bv = b[sort.key];
      // Oblasts with no first-year reading sort last whichever way the column runs.
      if (av == null) return 1;
      if (bv == null) return -1;
      return (
        dir * (Number(av) - Number(bv)) || a.oblast.localeCompare(b.oblast)
      );
    });
  }, [rows, sort]);

  const th = (key: SortKey, label: string, cls = "") => (
    <th className={`py-1 pr-2 font-normal ${cls}`}>
      <button
        type="button"
        onClick={() =>
          setSort((s) =>
            s.key === key ? { key, asc: !s.asc } : { key, asc: key === "name" },
          )
        }
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label={`${bg ? "Подреди по" : "Sort by"} ${label}`}
      >
        {label}
        <span
          aria-hidden
          className={sort.key === key ? "opacity-100" : "opacity-0"}
        >
          {sort.asc ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {th("name", bg ? "Област" : "Province")}
              {th(
                "latestAvg",
                `${bg ? "Успех" : "Average"}${latestYear ? ` ${latestYear}` : ""}`,
                "text-right [&>button]:justify-end",
              )}
              {hasTrend && (
                <>
                  {th(
                    "firstAvg",
                    String(firstYear ?? ""),
                    "hidden text-right sm:table-cell",
                  )}
                  {th(
                    "delta",
                    bg ? "Промяна" : "Change",
                    "text-right [&>button]:justify-end",
                  )}
                  <th className="hidden py-1 pr-2 font-normal md:table-cell">
                    {firstYear} → {latestYear}
                  </th>
                </>
              )}
              {th("schools", bg ? "Училища" : "Schools", "text-right")}
              {th("examinees", bg ? "Зрелостници" : "Graduates", "text-right")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.oblast} className="border-t">
                <td className="py-1.5 pr-2">{o.name}</td>
                <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">
                  {num(o.latestAvg, lang)}
                </td>
                {hasTrend && (
                  <>
                    <td className="hidden py-1.5 pr-2 text-right tabular-nums text-muted-foreground sm:table-cell">
                      {o.firstAvg != null ? num(o.firstAvg, lang) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {o.delta != null
                        ? `${o.delta > 0 ? "+" : ""}${num(o.delta, lang)}`
                        : "—"}
                    </td>
                    <td className="hidden py-1.5 pr-2 md:table-cell">
                      {o.firstAvg != null && (
                        <Dumbbell
                          from={o.firstAvg}
                          to={o.latestAvg}
                          lo={lo}
                          hi={hi}
                          national={nationalLatest}
                        />
                      )}
                    </td>
                  </>
                )}
                <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                  {o.schools}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {o.examinees.toLocaleString(bg ? "bg-BG" : "en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasTrend && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/45" />
            {firstYear}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
            {latestYear}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-px bg-muted-foreground/40" />
            {bg ? "страната" : "the country"}
          </span>
        </div>
      )}
    </>
  );
};
