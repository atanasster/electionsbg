// "Бюджети по кабинети" — a fiscal scorecard for the public debate over which
// Prime-Minister / Finance-Minister duo ran the budget best.
//
// Rows are calendar years (the grain the data has), GROUPED into cabinet eras:
// each era (a run of consecutive years with the same dominant cabinet) shows the
// cabinet + finance minister(s) ONCE, with a party-coloured spine and the era's
// average balance — so the eye groups years by who governed and reads "which
// duo was best" without a separate ranking. Transition years note the other
// cabinets that shared them. Clicking a column header re-sorts the eras (by
// year, or by average balance / arrears / reserve). Hovering an era highlights
// it. A "regular cabinets only" filter drops the short caretaker eras.
//
// Per-year figures: budget balance (deficit/surplus, % of GDP) and the year-end
// overdue obligations (просрочени задължения, €M) + fiscal reserve (€B). Balance
// is Eurostat ESA; arrears + reserve are Ministry of Finance. We do NOT split a
// year's figures between cabinets that shared it — the annual data can't.

import {
  useMemo,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Government } from "@/data/governments/useGovernments";
import { FinanceMinister } from "@/data/governments/useFinanceMinisters";
import { BudgetLaw } from "@/data/governments/useBudgetLaws";
import { MacroPayload } from "@/data/macro/useMacro";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { colorForGovernmentSolid } from "@/screens/components/governments/governmentColors";
import { cabinetShortLabel } from "@/data/governments/cabinetLabel";
import { formatEurCompact } from "@/lib/currency";
import { useTooltip } from "@/ux/useTooltip";

const START_YEAR = 2005;

const DEFICIT_COLOR = "#dc2626"; // red — deficit
const SURPLUS_COLOR = "#059669"; // emerald — surplus
const ARREARS_COLOR = "#d97706"; // amber — overdue obligations (less = better)
const RESERVE_COLOR = "#0d9488"; // teal — fiscal reserve (more = better)

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.436875;

// Context markers for the hero chart — the shocks behind the big swings.
const EVENTS: { year: number; bg: string; en: string }[] = [
  { year: 2008, bg: "Криза 2008", en: "2008 crisis" },
  { year: 2014, bg: "КТБ", en: "KTB collapse" },
  { year: 2020, bg: "COVID", en: "COVID" },
  { year: 2022, bg: "Енергийна криза", en: "Energy crisis" },
];

// Institutional regime milestones (distinct from crisis shocks). `x` is a
// fractional year so mid-year events (ERM II, July 2020) sit correctly.
const REGIMES: { x: number; bg: string; en: string }[] = [
  { x: 2007, bg: "ЕС", en: "EU" },
  { x: 2020.54, bg: "ERM II", en: "ERM II" },
  { x: 2026, bg: "Еврозона", en: "Eurozone" },
];
const EU_YEAR = 2007;

type Duo = {
  key: string;
  cabinet: Government | null;
  fm: FinanceMinister;
  monthsInYear: number;
  defended: boolean; // defended (got adopted) this year's budget
  revised: boolean; // revised this year's budget mid-year
};

type BudgetCredit = { fm: FinanceMinister | null; date: string };
type YearBudget = {
  defender: BudgetCredit | null;
  revisions: BudgetCredit[];
  note?: "no_budget" | "interim";
};

type YearRow = {
  year: number;
  balancePct: number | null; // Eurostat ESA balance, % of GDP (accrual)
  cashPct: number | null; // Ministry of Finance КФП balance, % of GDP (cash)
  arrears: number | null;
  reserve: number | null;
  duos: Duo[]; // every cabinet+FM in office that year, chronological
  dominant: Duo | null; // the one in office the longest that year
  budget: YearBudget | null;
};

type Era = {
  key: string;
  cabinet: Government | null;
  fmNames: string[]; // distinct dominant FM names across the era, in order
  fromYear: number;
  toYear: number;
  years: YearRow[];
  avgBalance: number | null;
  avgCash: number | null;
  avgArrears: number | null;
  avgReserve: number | null;
  budgetCredits: { name: string; role: "defended" | "revised"; year: number }[];
};

type SortKey = "year" | "balancePct" | "cashPct" | "arrears" | "reserve";

const overlapMs = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

const fmName = (fm: FinanceMinister, lang: "bg" | "en"): string =>
  lang === "bg" ? fm.bg : fm.en;

const surname = (fm: FinanceMinister, lang: "bg" | "en"): string => {
  const n = fmName(fm, lang);
  return n.split(" ").pop() ?? n;
};

const fmKey = (fm: FinanceMinister): string =>
  `${fm.cabinetId}|${fm.startDate}`;

const fmAtDate = (
  fms: FinanceMinister[],
  iso: string,
): FinanceMinister | null => {
  const ts = Date.parse(iso);
  for (const fm of fms) {
    const s = Date.parse(fm.startDate);
    const e = fm.endDate ? Date.parse(fm.endDate) : Number.MAX_SAFE_INTEGER;
    if (ts >= s && ts < e) return fm;
  }
  return null;
};

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

// ISO date → fractional calendar year (2021-05-12 → 2021.36), so a cabinet /
// finance-minister tenure can be drawn as a span on the hero's year axis and
// mid-year handovers (caretaker swaps, ERM II) land in the right slot.
const fracYear = (iso: string): number => {
  const d = Date.parse(iso);
  const y = new Date(d).getUTCFullYear();
  const s = Date.UTC(y, 0, 1);
  const e = Date.UTC(y + 1, 0, 1);
  return y + (d - s) / (e - s);
};

// "2021-05" style month label for tooltips.
const monthLabel = (iso: string): string => iso.slice(0, 7);

export const CabinetBudgetScorecard = ({
  governments,
  financeMinisters,
  budgetLaws,
  macro,
}: {
  governments: Government[];
  financeMinisters: FinanceMinister[];
  budgetLaws: BudgetLaw[];
  macro: MacroPayload | undefined;
}) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { colorFor } = useCanonicalParties();
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "year",
    dir: "asc",
  });
  const [hoverCab, setHoverCab] = useState<string | null>(null);
  const [regularOnly, setRegularOnly] = useState(false);
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip({
    maxHeight: 280,
    maxWidth: 300,
  });

  const rows = useMemo<YearRow[]>(() => {
    if (!macro) return [];
    const nowMs = Date.now();
    const cabinetById = new Map(governments.map((g) => [g.id, g]));
    const gdp = new Map<number, number>(
      (macro.series.nominalGdp ?? []).map((p) => [p.year, p.value]),
    );
    const arrears = new Map<number, number>(
      (macro.series.arrears ?? []).map((p) => [p.year, p.value]),
    );
    const cash = new Map<number, number>(
      (macro.series.cashBalance ?? []).map((p) => [p.year, p.value]),
    );
    const balByYear = new Map<number, number>();
    for (const p of macro.series.budgetBalanceNominal ?? [])
      balByYear.set(p.year, (balByYear.get(p.year) ?? 0) + p.value);
    const reserveByYear = new Map<number, number>();
    {
      const tmp = new Map<number, { q: number; v: number }>();
      for (const p of macro.series.fiscalReserve ?? []) {
        const cur = tmp.get(p.year);
        const q = p.quarter ?? 0;
        if (!cur || q > cur.q) tmp.set(p.year, { q, v: p.value });
      }
      for (const [y, { v }] of tmp) reserveByYear.set(y, v);
    }

    const tenures = financeMinisters.map((fm, i) => ({
      fm,
      i,
      startMs: Date.parse(fm.startDate),
      endMs: fm.endDate ? Date.parse(fm.endDate) : nowMs,
    }));
    const budgetByYear = new Map(budgetLaws.map((b) => [b.year, b]));
    const budgetFor = (year: number): YearBudget | null => {
      const law = budgetByYear.get(year);
      if (!law) return null;
      if (law.note) return { defender: null, revisions: [], note: law.note };
      return {
        defender: law.adopted
          ? { fm: fmAtDate(financeMinisters, law.adopted), date: law.adopted }
          : null,
        revisions: (law.revisions ?? []).map((d) => ({
          fm: fmAtDate(financeMinisters, d),
          date: d,
        })),
      };
    };

    const maxYear = (macro.series.budgetBalanceNominal ?? []).reduce(
      (m, p) => Math.max(m, p.year),
      START_YEAR,
    );
    const out: YearRow[] = [];
    for (let year = START_YEAR; year <= maxYear; year++) {
      const yStart = Date.UTC(year, 0, 1);
      const yEnd = Date.UTC(year + 1, 0, 1);
      const budget = budgetFor(year);
      const defKey = budget?.defender?.fm ? fmKey(budget.defender.fm) : null;
      const revKeys = new Set(
        (budget?.revisions ?? [])
          .map((r) => (r.fm ? fmKey(r.fm) : null))
          .filter((k): k is string => k != null),
      );
      const duos: Duo[] = tenures
        .map((tn) => ({
          tn,
          ov: overlapMs(tn.startMs, tn.endMs, yStart, yEnd),
        }))
        .filter((x) => x.ov > 0)
        .sort((a, b) => a.tn.startMs - b.tn.startMs)
        .map(({ tn, ov }) => ({
          key: `${tn.fm.cabinetId}-${tn.i}`,
          cabinet: cabinetById.get(tn.fm.cabinetId) ?? null,
          fm: tn.fm,
          monthsInYear: Math.max(1, Math.round(ov / MS_PER_MONTH)),
          defended: defKey === fmKey(tn.fm),
          revised: revKeys.has(fmKey(tn.fm)),
        }));
      const dominant =
        duos.reduce<Duo | null>(
          (best, d) => (!best || d.monthsInYear > best.monthsInYear ? d : best),
          null,
        ) ?? null;
      const bal = balByYear.get(year);
      const gdpY = gdp.get(year);
      const cashY = cash.get(year);
      out.push({
        year,
        balancePct:
          bal != null && gdpY ? Math.round((bal / gdpY) * 1000) / 10 : null,
        cashPct:
          cashY != null && gdpY ? Math.round((cashY / gdpY) * 1000) / 10 : null,
        arrears: arrears.get(year) ?? null,
        reserve: reserveByYear.get(year) ?? null,
        duos,
        dominant,
        budget,
      });
    }
    return out;
  }, [macro, governments, financeMinisters, budgetLaws]);

  // Per-minister budget authorship: which fiscal years each fmKey defended (got
  // adopted) and which they revised. Drives the hero's "budget author" badge +
  // emphasis and the finance-minister tooltip — the ministers who actually owned
  // a budget vs caretakers who merely executed someone else's.
  const budgetRoles = useMemo(() => {
    const map = new Map<string, { defended: number[]; revised: number[] }>();
    const slot = (k: string) => {
      let e = map.get(k);
      if (!e) {
        e = { defended: [], revised: [] };
        map.set(k, e);
      }
      return e;
    };
    for (const law of budgetLaws) {
      if (law.note) continue;
      if (law.adopted) {
        const fm = fmAtDate(financeMinisters, law.adopted);
        if (fm) slot(fmKey(fm)).defended.push(law.year);
      }
      for (const d of law.revisions ?? []) {
        const fm = fmAtDate(financeMinisters, d);
        if (fm) slot(fmKey(fm)).revised.push(law.year);
      }
    }
    return map;
  }, [budgetLaws, financeMinisters]);

  const eras = useMemo<Era[]>(() => {
    const out: Era[] = [];
    for (const r of rows) {
      const id = r.dominant?.cabinet?.id ?? "—";
      const last = out[out.length - 1];
      if (!last || last.key !== id) {
        out.push({
          key: id,
          cabinet: r.dominant?.cabinet ?? null,
          fmNames: [],
          fromYear: r.year,
          toYear: r.year,
          years: [],
          avgBalance: null,
          avgCash: null,
          avgArrears: null,
          avgReserve: null,
          budgetCredits: [],
        });
      }
      out[out.length - 1].years.push(r);
      out[out.length - 1].toYear = r.year;
    }
    for (const e of out) {
      e.avgBalance = mean(
        e.years.map((y) => y.balancePct).filter((v): v is number => v != null),
      );
      e.avgCash = mean(
        e.years.map((y) => y.cashPct).filter((v): v is number => v != null),
      );
      e.avgArrears = mean(
        e.years.map((y) => y.arrears).filter((v): v is number => v != null),
      );
      e.avgReserve = mean(
        e.years.map((y) => y.reserve).filter((v): v is number => v != null),
      );
      const names: string[] = [];
      for (const y of e.years) {
        const n = y.dominant ? fmName(y.dominant.fm, lang) : null;
        if (n && !names.includes(n)) names.push(n);
      }
      e.fmNames = names;
      // Budget authorship across the era's years (deduped by name+role).
      const seen = new Set<string>();
      for (const y of e.years) {
        if (!y.budget || y.budget.note) continue;
        if (y.budget.defender?.fm) {
          const nm = surname(y.budget.defender.fm, lang);
          const k = `${nm}|defended`;
          if (!seen.has(k)) {
            seen.add(k);
            e.budgetCredits.push({ name: nm, role: "defended", year: y.year });
          }
        }
        for (const rv of y.budget.revisions) {
          if (!rv.fm) continue;
          const nm = surname(rv.fm, lang);
          const k = `${nm}|revised|${y.year}`;
          if (!seen.has(k)) {
            seen.add(k);
            e.budgetCredits.push({ name: nm, role: "revised", year: y.year });
          }
        }
      }
    }
    return out;
  }, [rows, lang]);

  const highlights = useMemo(() => {
    const withBal = rows.filter((r) => r.balancePct != null);
    const withArr = rows.filter((r) => r.arrears != null);
    const withRes = rows.filter((r) => r.reserve != null);
    const pick = (
      arr: YearRow[],
      best: (a: YearRow) => number,
    ): YearRow | null =>
      arr.length ? arr.reduce((m, r) => (best(r) > best(m) ? r : m)) : null;
    const fmOf = (r: YearRow | null) =>
      r?.dominant ? surname(r.dominant.fm, lang) : "";
    const bestBal = pick(withBal, (r) => r.balancePct ?? -99);
    const worstBal = pick(withBal, (r) => -(r.balancePct ?? 99));
    const peakArr = pick(withArr, (r) => r.arrears ?? 0);
    const peakRes = pick(withRes, (r) => r.reserve ?? 0);
    return { bestBal, worstBal, peakArr, peakRes, fmOf };
  }, [rows, lang]);

  // ESA and cash balance bars share one scale so the two deficit measures are
  // directly comparable side by side.
  const maxBalAbs = useMemo(
    () =>
      Math.max(
        1,
        ...rows.map((r) => (r.balancePct == null ? 0 : Math.abs(r.balancePct))),
        ...rows.map((r) => (r.cashPct == null ? 0 : Math.abs(r.cashPct))),
      ),
    [rows],
  );
  const maxArrears = useMemo(
    () => Math.max(1, ...rows.map((r) => r.arrears ?? 0)),
    [rows],
  );
  const maxReserve = useMemo(
    () => Math.max(1, ...rows.map((r) => r.reserve ?? 0)),
    [rows],
  );

  // Hero geometry + the cabinet/FM tenure segments are the one heavy block in
  // the SVG. Memoised here so they aren't rebuilt on every tooltip mouse-move
  // (useTooltip re-renders the component on each pointer move). renderHero()
  // reads these; only the lightweight JSX mapping re-runs per render.
  const heroGeom = useMemo(() => {
    if (rows.length === 0) return null;
    const X0 = 30;
    const SLOT = 40;
    const Y_TOP = 30; // room above the plot for two marker label rows
    const H = 100;
    const UNIT = H / 8; // domain −5 … +3 (= 8 units)
    const ZERO = Y_TOP + 3 * UNIT;
    const RIGHT = X0 + rows.length * SLOT;
    const W = RIGHT + 30; // extra right margin for the angled FM labels
    const PLOT_B = Y_TOP + H;
    const BAND_H = 11;
    const CAB_Y = PLOT_B + 7; // cabinet track (party-coloured tenures)
    const FM_LABEL_Y = CAB_Y + BAND_H + 6; // angled finance-minister labels
    const FM_TIER = 9; // alternate-row offset so neighbouring names never collide
    const TICK_Y = FM_LABEL_Y + FM_TIER + 41;
    const VH = TICK_Y + 4;
    const heroMaxYear = rows[rows.length - 1].year;
    // slotX doubles as the fractional-year x: integer year = slot left edge,
    // fractional year lands proportionally inside the slot.
    const slotX = (yr: number) => X0 + (yr - START_YEAR) * SLOT;
    const clampX = (x: number) => Math.max(X0, Math.min(RIGHT, x));
    const endFrac = heroMaxYear + 1; // clamp ongoing tenures to the plot's right edge

    const cabinetById = new Map(governments.map((g) => [g.id, g]));
    const spanOf = (start: string, end: string | null) => ({
      x1: clampX(slotX(fracYear(start))),
      x2: clampX(slotX(end ? fracYear(end) : endFrac)),
    });
    const cabSegs = governments
      .map((g) => ({ g, ...spanOf(g.startDate, g.endDate) }))
      .filter((s) => s.x2 - s.x1 > 1);
    const fmSegs = financeMinisters
      .map((fm) => ({
        fm,
        cab: cabinetById.get(fm.cabinetId) ?? null,
        ...spanOf(fm.startDate, fm.endDate),
      }))
      .filter((s) => s.x2 - s.x1 > 1);

    // Disambiguate identical surnames from DIFFERENT people (Л. vs Т. Петкова)
    // with a first-initial prefix; same-person repeat tenures (Горанов,
    // Василев) stay bare.
    const surnamePeople = new Map<string, Set<string>>();
    for (const { fm } of fmSegs) {
      const s = surname(fm, lang);
      const set = surnamePeople.get(s) ?? new Set<string>();
      set.add(fmName(fm, lang));
      surnamePeople.set(s, set);
    }
    const fmShort = (fm: FinanceMinister): string => {
      const s = surname(fm, lang);
      if ((surnamePeople.get(s)?.size ?? 0) <= 1) return s;
      const first = fmName(fm, lang).trim().split(/\s+/)[0];
      return first ? `${first[0]}. ${s}` : s;
    };

    return {
      X0,
      SLOT,
      Y_TOP,
      H,
      UNIT,
      ZERO,
      RIGHT,
      W,
      BAND_H,
      CAB_Y,
      FM_LABEL_Y,
      FM_TIER,
      TICK_Y,
      VH,
      slotX,
      cabSegs,
      fmSegs,
      fmShort,
    };
  }, [rows, governments, financeMinisters, lang]);

  const visibleEras = useMemo(() => {
    const filtered = regularOnly
      ? eras.filter((e) => e.cabinet?.type === "regular")
      : eras;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (e: Era): number | null =>
      sort.key === "year"
        ? e.fromYear
        : sort.key === "balancePct"
          ? e.avgBalance
          : sort.key === "cashPct"
            ? e.avgCash
            : sort.key === "arrears"
              ? e.avgArrears
              : e.avgReserve;
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return a.fromYear - b.fromYear;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir || a.fromYear - b.fromYear;
    });
  }, [eras, regularOnly, sort]);

  if (!macro || rows.length === 0) return null;

  const hasArrears = rows.some((r) => r.arrears != null);
  const cabColor = (c: Government | null) =>
    c ? colorForGovernmentSolid(c, colorFor) : "#94a3b8";
  const pct = (v: number | null) =>
    v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  const eurB = (v: number | null) =>
    v == null ? "—" : `€${(v / 1000).toFixed(1)}B`;
  // Arrears are stored in EUR million; scale to absolute euros so the compact
  // formatter shows the magnitude ("€409 млн" / "€409M"), mirroring the reserve
  // column's self-describing "€x.xB".
  const eurM = (v: number | null) =>
    v == null ? "—" : formatEurCompact(v * 1_000_000, locale);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "year" ? "asc" : "desc" },
    );
  const sortIcon = (key: SortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
  const Hdr = ({
    col,
    label,
    extra,
  }: {
    col: SortKey;
    label: string;
    extra?: ReactNode;
  }) => (
    <button
      type="button"
      onClick={() => toggleSort(col)}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      <span>{label}</span>
      {extra}
      <span className={sort.key === col ? "" : "opacity-30"}>
        {sortIcon(col)}
      </span>
    </button>
  );

  // A divergent (deficit ↔ surplus) bar + its % value around a centre baseline.
  // Used for both the ESA (accrual) and the cash (КФП) balance, on one shared
  // scale so the two measures are directly comparable.
  const DivergentBar = ({ v, barW }: { v: number | null; barW: string }) => (
    <div className="flex items-center gap-2">
      <div className={`relative h-3 ${barW} shrink-0`}>
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {v != null && (
          <div
            className="absolute inset-y-0 rounded-sm"
            style={
              v < 0
                ? {
                    right: "50%",
                    width: `${(Math.abs(v) / maxBalAbs) * 50}%`,
                    backgroundColor: DEFICIT_COLOR,
                  }
                : {
                    left: "50%",
                    width: `${(v / maxBalAbs) * 50}%`,
                    backgroundColor: SURPLUS_COLOR,
                  }
            }
          />
        )}
      </div>
      <span
        className="tabular-nums text-xs w-12 text-right shrink-0"
        style={{
          color: v == null ? undefined : v < 0 ? DEFICIT_COLOR : SURPLUS_COLOR,
        }}
      >
        {pct(v)}
      </span>
    </div>
  );

  // The metric bars + values for one year. Shared by every row.
  const MetricCells = ({ r }: { r: YearRow }) => (
    <>
      <DivergentBar v={r.balancePct} barW="w-28" />
      <DivergentBar v={r.cashPct} barW="w-20" />
      <div className="flex items-center gap-2">
        <div className="relative h-3 w-24 shrink-0 bg-muted/40 rounded-sm">
          {r.arrears != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{
                width: `${(r.arrears / maxArrears) * 100}%`,
                backgroundColor: ARREARS_COLOR,
              }}
            />
          )}
        </div>
        <span className="tabular-nums text-xs w-14 text-right shrink-0 text-muted-foreground">
          {eurM(r.arrears)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative h-3 w-24 shrink-0 bg-muted/40 rounded-sm">
          {r.reserve != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{
                width: `${(r.reserve / maxReserve) * 100}%`,
                backgroundColor: RESERVE_COLOR,
              }}
            />
          )}
        </div>
        <span className="tabular-nums text-xs w-12 text-right shrink-0 text-muted-foreground">
          {eurB(r.reserve)}
        </span>
      </div>
    </>
  );

  // The grid that aligns year + the four metric cells (ESA balance, cash
  // balance, arrears, reserve).
  const ROW_GRID =
    "grid grid-cols-[44px_minmax(170px,1fr)_minmax(140px,0.9fr)_minmax(150px,1fr)_minmax(140px,1fr)] gap-x-3 items-center";

  const hl = highlights;
  const Highlight = ({
    label,
    value,
    who,
    color,
  }: {
    label: string;
    value: string;
    who: string;
    color: string;
  }) => (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold" style={{ color }}>
        {value}{" "}
        <span className="text-[11px] font-normal text-muted-foreground">
          {who}
        </span>
      </div>
    </div>
  );

  const maxYear = rows[rows.length - 1].year;
  const balYears = rows.filter((r) => r.balancePct != null).length;
  const surplusYears = rows.filter(
    (r) => r.balancePct != null && r.balancePct > 0,
  ).length;

  // Hero chart — one balance bar per year (coloured by the governing party,
  // outlined green/red for surplus/deficit) over a zero baseline and the EU 3%
  // deficit ceiling, with two timeline tracks below: every cabinet and every
  // finance minister in their ACTUAL tenure span (caretakers included), so the
  // reader sees at a glance who ran each year's budget — not just the dominant
  // cabinet. Hovering anything shows a rich tooltip and links to the table.
  const renderHero = () => {
    if (!heroGeom) return null;
    const {
      X0,
      SLOT,
      Y_TOP,
      H,
      UNIT,
      ZERO,
      W,
      BAND_H,
      CAB_Y,
      FM_LABEL_Y,
      FM_TIER,
      TICK_Y,
      VH,
      slotX,
      cabSegs,
      fmSegs,
      fmShort,
    } = heroGeom;

    const present = t("cabinet_budgets_present");
    const tenure = (start: string, end: string | null) =>
      `${monthLabel(start)} – ${end ? monthLabel(end) : present}`;
    const caretakerTag = (g: Government | null) =>
      g?.type === "caretaker" ? (
        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("gov_type_caretaker")}
        </span>
      ) : null;
    const swatch = (c: Government | null) => (
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
        style={{ backgroundColor: cabColor(c) }}
      />
    );

    // Rich tooltips (replace the native SVG <title>): full per-year detail, and
    // tenure detail for the track segments.
    const yearTip = (r: YearRow) => (
      <div className="flex flex-col gap-1 text-xs min-w-[180px]">
        <div className="text-sm font-semibold">{r.year}</div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">
            {t("cabinet_budgets_col_deficit")}
          </span>
          <span
            className="tabular-nums font-medium"
            style={{
              color:
                r.balancePct == null
                  ? undefined
                  : r.balancePct < 0
                    ? DEFICIT_COLOR
                    : SURPLUS_COLOR,
            }}
          >
            {pct(r.balancePct)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">
            {t("cabinet_budgets_col_cash")}
          </span>
          <span
            className="tabular-nums font-medium"
            style={{
              color:
                r.cashPct == null
                  ? undefined
                  : r.cashPct < 0
                    ? DEFICIT_COLOR
                    : SURPLUS_COLOR,
            }}
          >
            {r.cashPct == null ? "—" : pct(r.cashPct)}
          </span>
        </div>
        <div className="border-t border-border/50 pt-1">
          <div className="text-muted-foreground mb-0.5">
            {lang === "bg" ? "В управление" : "In office"}
          </div>
          {r.duos.map((d) => (
            <div key={d.key} className="flex items-center gap-1.5">
              {swatch(d.cabinet)}
              <span>
                {d.cabinet
                  ? cabinetShortLabel(d.cabinet, governments, lang)
                  : "—"}{" "}
                · {surname(d.fm, lang)}
              </span>
              <span className="text-muted-foreground">
                ({d.monthsInYear}
                {lang === "bg" ? "м" : "mo"})
              </span>
              {caretakerTag(d.cabinet)}
            </div>
          ))}
        </div>
        {r.budget &&
          !r.budget.note &&
          (r.budget.defender?.fm || r.budget.revisions.some((rv) => rv.fm)) && (
            <div className="border-t border-border/50 pt-1">
              <span className="text-muted-foreground">
                {t("cabinet_budgets_col_budget")}:{" "}
              </span>
              {r.budget.defender?.fm && (
                <span>{surname(r.budget.defender.fm, lang)}</span>
              )}
              {r.budget.revisions
                .map((rv) => rv.fm)
                .filter((f): f is FinanceMinister => f != null)
                .map((f, i) => (
                  <span key={i} className="text-amber-700 dark:text-amber-500">
                    {" "}
                    · {t("cabinet_budgets_badge_revised")} {surname(f, lang)}
                  </span>
                ))}
            </div>
          )}
      </div>
    );
    const govTip = (g: Government) => (
      <div className="flex flex-col gap-0.5 text-xs min-w-[150px]">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {swatch(g)}
          {cabinetShortLabel(g, governments, lang)}
          {caretakerTag(g)}
        </div>
        <div className="text-muted-foreground">
          {lang === "bg" ? g.pmBg : g.pmEn}
        </div>
        <div className="tabular-nums text-muted-foreground">
          {tenure(g.startDate, g.endDate)}
        </div>
      </div>
    );
    const fmTip = (fm: FinanceMinister, cab: Government | null) => {
      const role = budgetRoles.get(fmKey(fm));
      const fmt = (ys: number[]) => [...ys].sort((a, b) => a - b).join(", ");
      return (
        <div className="flex flex-col gap-0.5 text-xs min-w-[150px]">
          <div className="text-sm font-semibold">{fmName(fm, lang)}</div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {swatch(cab)}
            {cab ? cabinetShortLabel(cab, governments, lang) : "—"}
            {caretakerTag(cab)}
          </div>
          <div className="tabular-nums text-muted-foreground">
            {tenure(fm.startDate, fm.endDate)}
          </div>
          {role && role.defended.length > 0 && (
            <div className="flex items-start gap-1.5 pt-0.5">
              <span className="text-emerald-700 dark:text-emerald-500">●</span>
              <span>
                <span className="text-muted-foreground">
                  {t("cabinet_budgets_badge_defended_tip")}
                </span>{" "}
                <span className="tabular-nums">{fmt(role.defended)}</span>
              </span>
            </div>
          )}
          {role && role.revised.length > 0 && (
            <div className="flex items-start gap-1.5">
              <span className="text-amber-700 dark:text-amber-500">●</span>
              <span>
                <span className="text-muted-foreground">
                  {t("cabinet_budgets_badge_revised_tip")}
                </span>{" "}
                <span className="tabular-nums">{fmt(role.revised)}</span>
              </span>
            </div>
          )}
        </div>
      );
    };

    const hoverProps = (id: string | null, content: ReactNode) => ({
      style: { cursor: "pointer" } as const,
      onMouseEnter: (e: ReactMouseEvent) => {
        setHoverCab(id);
        onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, content);
      },
      onMouseMove: (e: ReactMouseEvent) =>
        onMouseMove({ pageX: e.pageX, pageY: e.pageY }),
      onMouseLeave: () => {
        setHoverCab(null);
        onMouseLeave();
      },
    });

    // Track segment (cabinet or FM): a tenure span with an inline label when
    // wide enough; caretakers are lighter with a dashed outline.
    const TrackSeg = ({
      x1,
      x2,
      y,
      color,
      caretaker,
      label,
      dim,
    }: {
      x1: number;
      x2: number;
      y: number;
      color: string;
      caretaker: boolean;
      label: string;
      dim: boolean;
    }) => {
      const w = x2 - x1;
      return (
        <>
          <rect
            x={x1 + 0.5}
            y={y}
            width={Math.max(1, w - 1)}
            height={BAND_H}
            rx="2"
            fill={color}
            fillOpacity={(caretaker ? 0.5 : 0.85) * (dim ? 0.35 : 1)}
            stroke="currentColor"
            strokeOpacity={caretaker ? 0.35 : 0}
            strokeWidth="0.6"
            strokeDasharray={caretaker ? "2 1.5" : undefined}
          />
          {w >= 34 && (
            <text
              x={(x1 + x2) / 2}
              y={y + 8}
              textAnchor="middle"
              fontSize="8"
              fill="#fff"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth="0.5"
              style={{ paintOrder: "stroke", pointerEvents: "none" }}
              opacity={dim ? 0.4 : 1}
            >
              {label}
            </text>
          )}
        </>
      );
    };

    return (
      <>
        <svg
          viewBox={`0 0 ${W} ${VH}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          className="block text-foreground"
          style={{ maxHeight: 300 }}
          role="img"
          aria-label={t("cabinet_budgets_hero_aria")}
        >
          {/* Pre-EU period (2005–06) — faded, predates EU fiscal framework. */}
          <rect
            x={X0}
            y={Y_TOP}
            width={slotX(EU_YEAR) - X0}
            height={H}
            fill="currentColor"
            opacity="0.05"
          />
          <text
            x={(X0 + slotX(EU_YEAR)) / 2}
            y={Y_TOP + H - 4}
            textAnchor="middle"
            fontSize="8"
            fill="currentColor"
            opacity="0.45"
          >
            {lang === "bg" ? "пред-ЕС" : "pre-EU"}
          </text>
          {[3, 0, -5].map((g) => {
            const y = ZERO - g * UNIT;
            return (
              <g key={g}>
                <line
                  x1={X0 - 4}
                  y1={y}
                  x2={W - 4}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={g === 0 ? 0.4 : 0.12}
                  strokeWidth={g === 0 ? 1 : 0.5}
                />
                <text
                  x={X0 - 7}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.5"
                >
                  {g > 0 ? `+${g}` : g}
                </text>
              </g>
            );
          })}
          {/* EU 3% deficit ceiling (Maastricht / Stability Pact). */}
          {(() => {
            const y = ZERO + 3 * UNIT;
            return (
              <g>
                <line
                  x1={X0 - 4}
                  y1={y}
                  x2={W - 4}
                  y2={y}
                  stroke={DEFICIT_COLOR}
                  strokeWidth="0.85"
                  strokeDasharray="4 2"
                  strokeOpacity="0.65"
                />
                <text
                  x={X0 - 7}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.5"
                >
                  -3
                </text>
                <text
                  x={X0 + 3}
                  y={y - 2.5}
                  textAnchor="start"
                  fontSize="7.5"
                  fill={DEFICIT_COLOR}
                  opacity="0.9"
                >
                  {lang === "bg" ? "праг ЕС −3%" : "EU limit −3%"}
                </text>
              </g>
            );
          })()}
          {EVENTS.filter((e) => e.year >= START_YEAR && e.year <= maxYear).map(
            (e) => {
              const x = slotX(e.year) + SLOT / 2;
              return (
                <g key={e.year}>
                  <line
                    x1={x}
                    y1={Y_TOP - 2}
                    x2={x}
                    y2={Y_TOP + H}
                    stroke="currentColor"
                    strokeWidth="0.75"
                    strokeDasharray="2 2"
                    strokeOpacity="0.35"
                  />
                  <text
                    x={x}
                    y={Y_TOP - 5}
                    textAnchor="middle"
                    fontSize="8.5"
                    fill="currentColor"
                    opacity="0.6"
                  >
                    {lang === "bg" ? e.bg : e.en}
                  </text>
                </g>
              );
            },
          )}
          {/* Institutional regime milestones — solid, upper label row. */}
          {REGIMES.map((rg) => {
            const x = slotX(rg.x);
            if (x < X0 - 2 || x > W + 2) return null;
            const anchor = x > W - 55 ? "end" : "middle";
            return (
              <g key={rg.en}>
                <line
                  x1={x}
                  y1={15}
                  x2={x}
                  y2={Y_TOP + H}
                  stroke="#6366f1"
                  strokeWidth="1"
                  strokeOpacity="0.5"
                />
                <text
                  x={x}
                  y={13}
                  textAnchor={anchor}
                  fontSize="8.5"
                  fill="#6366f1"
                  opacity="0.9"
                >
                  {lang === "bg" ? rg.bg : rg.en}
                </text>
              </g>
            );
          })}
          {rows.map((r) => {
            if (r.balancePct == null) return null;
            const cab = r.dominant?.cabinet ?? null;
            const id = cab?.id ?? "—";
            const dim = hoverCab != null && id !== hoverCab;
            const pre = r.year < EU_YEAR;
            const surplus = r.balancePct >= 0;
            // Bars are coloured purely by outcome (green surplus / red deficit) —
            // not by party, since a single year can straddle several cabinets.
            // Party identity lives in the tracks below, where each segment is one
            // cabinet.
            const color = surplus ? SURPLUS_COLOR : DEFICIT_COLOR;
            // Bars fill most of the year slot so they visually sit over the
            // cabinet / FM segments beneath them (slot is SLOT px wide).
            const barW = 30;
            const x = slotX(r.year) + (SLOT - barW) / 2;
            const y = surplus ? ZERO - r.balancePct * UNIT : ZERO;
            return (
              <rect
                key={r.year}
                x={x}
                y={y}
                width={barW}
                height={Math.max(1.5, Math.abs(r.balancePct) * UNIT)}
                rx="2"
                fill={color}
                fillOpacity={dim ? 0.15 : pre ? 0.4 : 0.8}
                stroke={color}
                strokeWidth="1"
                strokeOpacity={dim ? 0.3 : pre ? 0.6 : 1}
                {...hoverProps(id, yearTip(r))}
              />
            );
          })}
          {/* Cabinet track — actual tenures (caretakers included). */}
          {cabSegs.map(({ g, x1, x2 }) => (
            <g key={"cab" + g.id} {...hoverProps(g.id, govTip(g))}>
              <TrackSeg
                x1={x1}
                x2={x2}
                y={CAB_Y}
                color={cabColor(g)}
                caretaker={g.type === "caretaker"}
                label={cabinetShortLabel(g, governments, lang)}
                dim={hoverCab != null && g.id !== hoverCab}
              />
            </g>
          ))}
          {/* Finance ministers — every name as an angled label under the
              cabinet band, coloured by the minister's cabinet party (the FM band
              is dropped so even one-quarter caretaker stints stay legible). */}
          {fmSegs.map(({ fm, cab, x1, x2 }, i) => {
            const cx = (x1 + x2) / 2;
            // Alternate the start depth so two close names sit on different rows.
            const ly = FM_LABEL_Y + (i % 2) * FM_TIER;
            const dim = hoverCab != null && cab?.id !== hoverCab;
            // Colour by the minister's OWN party (so a partisan FM in a
            // caretaker cabinet — Василев = ПП — keeps their colour). Genuine
            // independents in a caretaker cabinet use the readable foreground
            // (currentColor) rather than the faint caretaker-band grey; partyless
            // ministers in a regular cabinet inherit the cabinet's party colour.
            const color = fm.party
              ? (colorFor(fm.party) ?? "currentColor")
              : cab?.type === "caretaker"
                ? "currentColor"
                : cabColor(cab);
            // Ministers who defended/revised a budget get a dot badge + bold,
            // so they stand out from caretakers who merely executed one.
            const role = budgetRoles.get(fmKey(fm));
            const author =
              !!role && role.defended.length + role.revised.length > 0;
            return (
              <g
                key={"fm" + i}
                transform={`translate(${cx} ${ly}) rotate(58)`}
                opacity={dim ? 0.25 : author ? 1 : 0.75}
                {...hoverProps(cab?.id ?? null, fmTip(fm, cab))}
              >
                {author && (
                  <circle
                    cx={2}
                    cy={-1.5}
                    r={1.9}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={0.5}
                  />
                )}
                <text
                  x={author ? 6.5 : 0}
                  y={0}
                  textAnchor="start"
                  fontSize="7"
                  fontWeight={author ? 700 : 400}
                  fill={color}
                  stroke="rgba(0,0,0,0.32)"
                  strokeWidth={1.1}
                  style={{ paintOrder: "stroke" }}
                >
                  {fmShort(fm)}
                </text>
              </g>
            );
          })}
          {[2005, 2010, 2015, 2020, 2025]
            .filter((y) => y <= maxYear)
            .map((y) => (
              <text
                key={y}
                x={slotX(y) + SLOT / 2}
                y={TICK_Y}
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
                opacity="0.45"
              >
                {y}
              </text>
            ))}
        </svg>
        {tooltip}
        <div className="mb-4" />
      </>
    );
  };

  return (
    <div>
      {renderHero()}

      {/* Highlights — the headline answer before any row is read. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Highlight
          label={t("cabinet_budgets_hl_best")}
          value={pct(hl.bestBal?.balancePct ?? null)}
          who={`${hl.fmOf(hl.bestBal)} ’${String(hl.bestBal?.year ?? "").slice(2)}`}
          color={SURPLUS_COLOR}
        />
        <Highlight
          label={t("cabinet_budgets_hl_worst")}
          value={pct(hl.worstBal?.balancePct ?? null)}
          who={`${hl.fmOf(hl.worstBal)} ’${String(hl.worstBal?.year ?? "").slice(2)}`}
          color={DEFICIT_COLOR}
        />
        <Highlight
          label={t("cabinet_budgets_hl_arrears")}
          value={hl.peakArr?.arrears == null ? "—" : eurM(hl.peakArr.arrears)}
          who={`${hl.fmOf(hl.peakArr)} ’${String(hl.peakArr?.year ?? "").slice(2)}`}
          color={ARREARS_COLOR}
        />
        <Highlight
          label={t("cabinet_budgets_hl_surplus_years")}
          value={`${surplusYears}`}
          who={`${lang === "bg" ? "от" : "of"} ${balYears} ${lang === "bg" ? "г." : "yrs"}`}
          color={surplusYears > 0 ? SURPLUS_COLOR : DEFICIT_COLOR}
        />
      </div>

      {/* Legend + filter. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px]"
              style={{ backgroundColor: SURPLUS_COLOR }}
            />{" "}
            {t("cabinet_budgets_legend_surplus")} ·{" "}
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px]"
              style={{ backgroundColor: DEFICIT_COLOR }}
            />{" "}
            {t("cabinet_budgets_legend_deficit")}
          </span>
          <span>
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px]"
              style={{ backgroundColor: ARREARS_COLOR }}
            />{" "}
            {t("cabinet_budgets_legend_arrears")}
          </span>
          <span>
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px]"
              style={{ backgroundColor: RESERVE_COLOR }}
            />{" "}
            {t("cabinet_budgets_legend_reserve")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setRegularOnly((v) => !v)}
          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
            regularOnly
              ? "bg-muted text-foreground border-border"
              : "text-muted-foreground border-border/60 hover:bg-muted/40"
          }`}
        >
          {t("cabinet_budgets_filter_regular")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Sortable column header. */}
          <div
            className={`${ROW_GRID} text-xs text-muted-foreground pb-1.5 border-b border-border/40 pl-3`}
          >
            <Hdr col="year" label={t("cabinet_budgets_col_year")} />
            <Hdr
              col="balancePct"
              label={t("cabinet_budgets_col_deficit")}
              extra={
                <span className="ml-1 text-[10px] text-muted-foreground/70 tabular-nums">
                  % {lang === "bg" ? "БВП" : "GDP"}
                </span>
              }
            />
            <Hdr col="cashPct" label={t("cabinet_budgets_col_cash")} />
            <Hdr col="arrears" label={t("cabinet_budgets_col_arrears")} />
            <Hdr col="reserve" label={t("cabinet_budgets_col_reserve")} />
          </div>

          {visibleEras.map((e) => {
            const color = cabColor(e.cabinet);
            // No hover-dim on table rows: the hero they would link to is usually
            // scrolled off-screen here, so the cross-link pays nothing and the
            // fade only distracts. The on-screen hover-highlight stays in the
            // hero itself.
            return (
              <div
                key={e.key + e.fromYear}
                className="mt-2 rounded-r-md"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                {/* Era header — cabinet + FM(s) shown once. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 bg-muted/40 rounded-tr-md px-3 py-1.5">
                  <div className="text-sm">
                    <span className="font-semibold">
                      {e.cabinet
                        ? cabinetShortLabel(e.cabinet, governments, lang)
                        : "—"}
                    </span>
                    {e.cabinet?.type === "caretaker" && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("gov_type_caretaker")}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      · {e.fmNames.join(", ")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {e.fromYear === e.toYear
                      ? e.fromYear
                      : `${e.fromYear}–${e.toYear}`}{" "}
                    · {t("cabinet_budgets_avg_balance")}{" "}
                    <span
                      className="font-medium"
                      style={{
                        color:
                          e.avgBalance == null
                            ? undefined
                            : e.avgBalance < 0
                              ? DEFICIT_COLOR
                              : SURPLUS_COLOR,
                      }}
                    >
                      {pct(e.avgBalance)}
                    </span>
                  </div>
                  {e.budgetCredits.length > 0 && (
                    <div className="basis-full text-[11px] text-muted-foreground">
                      {t("cabinet_budgets_col_budget")}:{" "}
                      {e.budgetCredits.map((c, i) => (
                        <span key={i}>
                          {i > 0 && " · "}
                          {c.role === "revised" && (
                            <span className="text-amber-700 dark:text-amber-500">
                              {t("cabinet_budgets_badge_revised")}{" "}
                            </span>
                          )}
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Year rows. */}
                {e.years.map((r) => {
                  const multi = r.duos.length > 1;
                  return (
                    <div
                      key={r.year}
                      className={`${ROW_GRID} px-3 py-1.5 border-t border-border/30`}
                    >
                      <div className="tabular-nums font-medium">{r.year}</div>
                      <MetricCells r={r} />
                      {multi && (
                        <div className="col-span-full text-[11px] text-muted-foreground -mt-0.5 pl-1">
                          <i className="inline-block">↔</i>{" "}
                          {r.duos
                            .filter(
                              (d) => d.cabinet?.id !== r.dominant?.cabinet?.id,
                            )
                            .map(
                              (d) =>
                                `${d.cabinet ? cabinetShortLabel(d.cabinet, governments, lang) : "—"} (${d.monthsInYear}${lang === "bg" ? "м" : "mo"}, ${surname(d.fm, lang)})`,
                            )
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {!hasArrears && (
        <p className="text-xs text-muted-foreground mt-2">
          {t("cabinet_budgets_arrears_pending")}
        </p>
      )}
    </div>
  );
};
