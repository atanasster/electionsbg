// Citizen tax-bill calculator. Pick a taxpayer profile and income; the
// calculator computes the monthly tax (income tax + social-security
// contributions, or corporate + dividend tax for a company owner), estimates
// VAT embedded in spending, projects a pension, and routes the bill into the
// general-government (COFOG) spending composition. Answers "what did MY taxes
// buy". Lives on its own page (/budget/tax-calculator) as a two-pane layout:
// inputs on the left, results on the right.
//
// Inspired by NZ Treasury's Income Explorer and the old Where Does My Money
// Go "Daily Bread" view. Numbers are illustrative, not a tax-policy
// calculator — see the per-section captions. Tax math lives in src/lib/bgTax.
// Every input is mirrored to the query string so a configuration is
// shareable by copy-pasting the URL; the monthly/annual toggle rescales the
// result figures.

import { FC, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Receipt,
  Briefcase,
  User,
  Building2,
  Link2,
  Check,
  RotateCcw,
  PieChart,
  PiggyBank,
  TrendingDown,
  Info,
} from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatEur } from "@/lib/currency";
import {
  COFOG_FUNCTIONS,
  useCofog,
  type CofogCode,
} from "@/data/macro/useCofog";
import {
  VAT_CONSUMPTION_SHARE,
  computeCompanyTax,
  computeLabourTax,
  computePension,
  computeVat,
  resolveMod,
  type TaxpayerProfile,
  type LabourTaxResult,
  type CompanyTaxResult,
  type PensionResult,
} from "@/lib/bgTax";
import { TaxRateCurve, type CurvePoint } from "./TaxRateCurve";

// Salary / income slider. Defaults to ~average gross monthly wage in
// Bulgaria (€1,100 in 2024 NSI terms). The top runs well above the МОД cap
// so IT / finance salaries are visible.
const MIN_GROSS = 500;
const MAX_GROSS = 8000;
const STEP_GROSS = 100;
const DEFAULT_GROSS = 1100;

// Company-owner profit slider (monthly).
const MIN_PROFIT = 1000;
const MAX_PROFIT = 50000;
const STEP_PROFIT = 500;
const DEFAULT_PROFIT = 5000;

// МОД input bounds. Below €1,000 the cap stops being meaningful; above
// €4,000 it dwarfs the slider range. Step €1 — user might paste a precise
// value (e.g. the €2,111.64 transitional rate).
const MIN_MOD = 1000;
const MAX_MOD = 4000;

// Years-of-service slider for the pension projection.
const MIN_SERVICE = 15;
const MAX_SERVICE = 50;
const DEFAULT_SERVICE = 40;

// VAT consumption-share slider — percent of net income spent on standard-
// rated goods. Default mirrors VAT_CONSUMPTION_SHARE from bgTax.
const VAT_DEFAULT_PCT = Math.round(VAT_CONSUMPTION_SHARE * 100);

const PROFILES: TaxpayerProfile[] = ["employee", "self", "company"];
const PROFILE_ICON: Record<TaxpayerProfile, typeof Briefcase> = {
  employee: Briefcase,
  self: User,
  company: Building2,
};

type Period = "month" | "year";

// A full set of inputs that fully describes one calculation.
interface Snapshot {
  profile: TaxpayerProfile;
  gross: number;
  profit: number;
  children: number;
  serviceYears: number;
  includeEmployer: boolean;
  vatSharePct: number;
  mod: number;
}

// Everything the results panes display, derived from one Snapshot.
interface Scenario {
  isLabour: boolean;
  labour: LabourTaxResult;
  company: CompanyTaxResult;
  net: number;
  vat: number;
  directTax: number;
  effectiveRate: number;
  marginalRate: number;
  employerPart: number;
  routedTotal: number;
  pension: PensionResult;
}

const computeScenario = (s: Snapshot): Scenario => {
  const isLabour = s.profile !== "company";
  const labour = computeLabourTax({
    monthlyGross: s.gross,
    mod: s.mod,
    profile: s.profile === "self" ? "self" : "employee",
    children: s.children,
  });
  const company = computeCompanyTax(s.profit);
  const net = isLabour ? labour.net : company.net;
  const vat = computeVat(net, s.vatSharePct / 100);
  const directTax = isLabour ? labour.directTax : company.totalTax;
  const employerPart =
    s.profile === "employee" && s.includeEmployer ? labour.employerSsc : 0;
  return {
    isLabour,
    labour,
    company,
    net,
    vat,
    directTax,
    effectiveRate: isLabour ? labour.effectiveRate : company.effectiveRate,
    marginalRate: isLabour ? labour.marginalRate : company.marginalRate,
    employerPart,
    routedTotal: directTax + vat + employerPart,
    pension: computePension(labour.insurableBase, s.serviceYears),
  };
};

// Every editable input is mirrored into the query string so a calculator
// configuration is shareable by copy-pasting the URL. Defaults are omitted
// from the URL to keep a pristine calculator's link clean.
const clampIntParam = (
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number => {
  if (raw == null) return fallback;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const parseProfileParam = (raw: string | null): TaxpayerProfile =>
  raw === "self" || raw === "company" ? raw : "employee";

const fmtPct = (v: number, locale: string, decimals = 1): string =>
  `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v * 100)}%`;

const COFOG_FALLBACK_EN: Record<Exclude<CofogCode, "TOTAL">, string> = {
  GF01: "General public services",
  GF02: "Defence",
  GF03: "Public order and safety",
  GF04: "Economic affairs",
  GF05: "Environmental protection",
  GF06: "Housing and community amenities",
  GF07: "Health",
  GF08: "Recreation, culture and religion",
  GF09: "Education",
  GF10: "Social protection",
};

interface Slice {
  code: Exclude<CofogCode, "TOTAL">;
  share: number;
  eur: number;
}

// Small info-icon with a hover/focus tooltip explaining a jargon term.
const InfoTip: FC<{ text: string }> = ({ text }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        aria-label={text}
        className="inline-flex shrink-0 align-middle text-muted-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
      >
        <Info className="h-3 w-3" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-[260px] text-xs font-normal leading-snug">
      {text}
    </TooltipContent>
  </Tooltip>
);

// One headline result figure.
const HeroStat: FC<{
  label: string;
  labelTip?: string;
  value: string;
  sub?: string;
  accent?: boolean;
}> = ({ label, labelTip, value, sub, accent }) => (
  <div
    className={
      "rounded-lg border px-3 py-2.5 " +
      (accent
        ? "bg-indigo-500/10 border-indigo-500/30"
        : "bg-card border-border")
    }
  >
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
      {label}
      {labelTip ? <InfoTip text={labelTip} /> : null}
    </div>
    <div
      className={
        "text-xl md:text-2xl font-bold tabular-nums leading-tight " +
        (accent ? "text-indigo-700 dark:text-indigo-300" : "")
      }
    >
      {value}
    </div>
    {sub ? (
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {sub}
      </div>
    ) : null}
  </div>
);

// A summary figure inside the "where it goes" routing section.
const RoutedStat: FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <div
    className={
      "rounded-md border px-2.5 py-2 " +
      (accent
        ? "bg-indigo-500/10 border-indigo-500/30"
        : "bg-muted/40 border-border")
    }
  >
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div
      className={
        "text-base md:text-lg font-bold tabular-nums leading-tight " +
        (accent ? "text-indigo-700 dark:text-indigo-300" : "")
      }
    >
      {value}
    </div>
  </div>
);

export const BudgetTaxCalculator: FC<{ fiscalYear?: number | null }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const { data: cofog } = useCofog();
  const locale = i18n.language === "en" ? "en-US" : "bg-BG";
  const eur = (v: number): string => formatEur(v, locale);

  const [searchParams, setSearchParams] = useSearchParams();

  // Inputs are hydrated once from the query string (lazy initialisers); the
  // effect below writes them back whenever an input changes.
  const [profile, setProfile] = useState<TaxpayerProfile>(() =>
    parseProfileParam(searchParams.get("profile")),
  );
  const [gross, setGross] = useState(() =>
    clampIntParam(
      searchParams.get("gross"),
      MIN_GROSS,
      MAX_GROSS,
      DEFAULT_GROSS,
    ),
  );
  const [profit, setProfit] = useState(() =>
    clampIntParam(
      searchParams.get("profit"),
      MIN_PROFIT,
      MAX_PROFIT,
      DEFAULT_PROFIT,
    ),
  );
  const [children, setChildren] = useState(() =>
    clampIntParam(searchParams.get("children"), 0, 3, 0),
  );
  const [serviceYears, setServiceYears] = useState(() =>
    clampIntParam(
      searchParams.get("years"),
      MIN_SERVICE,
      MAX_SERVICE,
      DEFAULT_SERVICE,
    ),
  );
  const [includeEmployer, setIncludeEmployer] = useState(
    () => searchParams.get("employer") === "1",
  );
  const [vatSharePct, setVatSharePct] = useState(() =>
    clampIntParam(searchParams.get("vat"), 0, 100, VAT_DEFAULT_PCT),
  );
  const [period, setPeriod] = useState<Period>(() =>
    searchParams.get("period") === "year" ? "year" : "month",
  );

  const isLabour = profile !== "company";

  // The income number input keeps its own draft string so typing isn't
  // clamped mid-keystroke; it resyncs to the committed value (slider drag,
  // profile switch, reset) via the effect below.
  const [incomeDraft, setIncomeDraft] = useState(() =>
    String(isLabour ? gross : profit),
  );
  useEffect(() => {
    setIncomeDraft(String(isLabour ? gross : profit));
  }, [gross, profit, isLabour]);

  // МОД default tracks the selected fiscal year (election-scoped reuse);
  // resolveMod reports the year the value is drawn from so the label always
  // names the year whose cap is on screen.
  const modRes = resolveMod(fiscalYear);
  const defaultMod = modRes.mod;
  const modYear = modRes.year;
  const modParam = searchParams.get("mod");
  const initialMod =
    modParam != null
      ? clampIntParam(modParam, MIN_MOD, MAX_MOD, defaultMod)
      : defaultMod;
  const [mod, setMod] = useState<number>(initialMod);
  const [modDraft, setModDraft] = useState<string>(String(initialMod));
  const [modTouched, setModTouched] = useState(modParam != null);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (!modTouched) {
      setMod(defaultMod);
      setModDraft(String(defaultMod));
    }
  }, [defaultMod, modTouched]);

  const commitMod = (): void => {
    const parsed = Number(modDraft);
    if (!Number.isFinite(parsed)) {
      setModDraft(String(mod));
      return;
    }
    const clamped = Math.max(MIN_MOD, Math.min(MAX_MOD, Math.round(parsed)));
    setMod(clamped);
    setModDraft(String(clamped));
    setModTouched(true);
  };
  const resetMod = (): void => {
    setMod(defaultMod);
    setModDraft(String(defaultMod));
    setModTouched(false);
  };
  const isModCustom = modTouched && mod !== defaultMod;

  const commitIncome = (): void => {
    const parsed = Number(incomeDraft);
    const lo = isLabour ? MIN_GROSS : MIN_PROFIT;
    const hi = isLabour ? MAX_GROSS : MAX_PROFIT;
    if (!Number.isFinite(parsed)) {
      setIncomeDraft(String(isLabour ? gross : profit));
      return;
    }
    const clamped = Math.max(lo, Math.min(hi, Math.round(parsed)));
    if (isLabour) setGross(clamped);
    else setProfit(clamped);
  };

  // Reset all inputs and the monthly/annual view back to their defaults.
  const resetAll = (): void => {
    setProfile("employee");
    setGross(DEFAULT_GROSS);
    setProfit(DEFAULT_PROFIT);
    setChildren(0);
    setServiceYears(DEFAULT_SERVICE);
    setIncludeEmployer(false);
    setVatSharePct(VAT_DEFAULT_PCT);
    setPeriod("month");
    setMod(defaultMod);
    setModDraft(String(defaultMod));
    setModTouched(false);
  };

  const onShare = (): void => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => {
          setShareCopied(true);
          setTimeout(() => setShareCopied(false), 2000);
        })
        .catch(() => undefined);
    }
  };

  const snapshot: Snapshot = {
    profile,
    gross,
    profit,
    children,
    serviceYears,
    includeEmployer,
    vatSharePct,
    mod,
  };

  // Mirror every editable input into the query string — replace (not push)
  // so slider drags don't flood the browser history.
  useEffect(() => {
    const next: Record<string, string> = {};
    if (profile !== "employee") next.profile = profile;
    if (gross !== DEFAULT_GROSS) next.gross = String(gross);
    if (profit !== DEFAULT_PROFIT) next.profit = String(profit);
    if (isLabour && children !== 0) next.children = String(children);
    if (serviceYears !== DEFAULT_SERVICE) next.years = String(serviceYears);
    if (profile === "employee" && includeEmployer) next.employer = "1";
    if (vatSharePct !== VAT_DEFAULT_PCT) next.vat = String(vatSharePct);
    if (isLabour && isModCustom) next.mod = String(mod);
    if (period === "year") next.period = "year";
    setSearchParams(next, { replace: true });
  }, [
    profile,
    isLabour,
    gross,
    profit,
    children,
    serviceYears,
    includeEmployer,
    vatSharePct,
    mod,
    isModCustom,
    period,
    setSearchParams,
  ]);

  const scenario = computeScenario(snapshot);
  const { labour, company } = scenario;

  // Period rescaling — the toggle scales the result money flows; rates,
  // shares and the (monthly) income inputs are left untouched.
  const pf = period === "year" ? 12 : 1;
  const eurFlow = (v: number): string => eur(v * pf);
  const per = t(
    period === "year"
      ? "budget_tax_bill_per_year"
      : "budget_tax_bill_per_month",
  );

  // Effective-rate curve across the salary range (labour profiles only —
  // for a company owner the corporate+dividend rate is flat).
  const curvePoints = useMemo<CurvePoint[]>(() => {
    if (!isLabour) return [];
    const pts: CurvePoint[] = [];
    const N = 56;
    for (let i = 0; i <= N; i++) {
      const g = MIN_GROSS + (i / N) * (MAX_GROSS - MIN_GROSS);
      pts.push({
        gross: g,
        rate: computeLabourTax({
          monthlyGross: g,
          mod,
          profile: profile === "self" ? "self" : "employee",
          children,
        }).effectiveRate,
      });
    }
    return pts;
  }, [isLabour, mod, profile, children]);

  const { slices, year, isFallback } = useMemo(() => {
    if (!cofog)
      return {
        slices: [] as Slice[],
        year: null as number | null,
        isFallback: false,
      };
    const requested =
      fiscalYear != null &&
      cofog.series.TOTAL.some((p) => p.year === fiscalYear && p.valueEur > 0)
        ? fiscalYear
        : null;
    const yr = requested ?? cofog.latestYear;
    const tot = cofog.series.TOTAL.find((p) => p.year === yr)?.valueEur ?? 0;
    if (tot <= 0) return { slices: [], year: yr, isFallback: false };
    const rows: Slice[] = [];
    for (const code of COFOG_FUNCTIONS) {
      const v = cofog.series[code].find((p) => p.year === yr)?.valueEur ?? 0;
      if (v <= 0) continue;
      rows.push({
        code,
        share: v / tot,
        eur: scenario.routedTotal * (v / tot),
      });
    }
    rows.sort((a, b) => b.eur - a.eur);
    return {
      slices: rows,
      year: yr,
      isFallback: fiscalYear != null && yr !== fiscalYear,
    };
  }, [cofog, scenario.routedTotal, fiscalYear]);
  const maxShare = slices[0]?.share ?? 0;

  // Summary cards for the routing section — direct tax, VAT, the optional
  // employer contribution, and their total (the figure the COFOG split sums
  // to). Kept in sync so direct + VAT (+ employer) always equals total.
  const routedCards: {
    key: string;
    label: string;
    value: number;
    accent?: boolean;
  }[] = [
    {
      key: "direct",
      label: t("budget_tax_bill_routed_direct"),
      value: scenario.directTax,
    },
    { key: "vat", label: t("budget_tax_bill_routed_vat"), value: scenario.vat },
  ];
  if (scenario.employerPart > 0)
    routedCards.push({
      key: "employer",
      label: t("budget_tax_bill_routed_employer"),
      value: scenario.employerPart,
    });
  routedCards.push({
    key: "total",
    label: t("budget_tax_bill_routed_total"),
    value: scenario.routedTotal,
    accent: true,
  });

  // Tax-bill stacked bar — every segment of gross income / company profit.
  const incomeTotal = isLabour ? gross : profit;
  const barSegments = isLabour
    ? [
        {
          key: "ssc",
          label: t(
            profile === "self"
              ? "budget_tax_bill_ssc_self"
              : "budget_tax_bill_ssc",
          ),
          value: labour.ssc,
          color: "bg-indigo-400",
        },
        {
          key: "pit",
          label: t("budget_tax_bill_pit"),
          value: labour.pit,
          color: "bg-indigo-600",
        },
        {
          key: "net",
          label: t("budget_tax_bill_net_inline"),
          value: labour.net,
          color: "bg-emerald-500",
        },
      ]
    : [
        {
          key: "corp",
          label: t("budget_tax_bill_corp_tax"),
          value: company.corpTax,
          color: "bg-indigo-400",
        },
        {
          key: "div",
          label: t("budget_tax_bill_dividend_tax"),
          value: company.dividendTax,
          color: "bg-indigo-600",
        },
        {
          key: "net",
          label: t("budget_tax_bill_net_inline"),
          value: company.net,
          color: "bg-emerald-500",
        },
      ];

  const modTickPct = ((mod - MIN_GROSS) / (MAX_GROSS - MIN_GROSS)) * 100;
  const showModTick = isLabour && mod > MIN_GROSS && mod < MAX_GROSS;
  const labelClass = "text-xs font-medium text-muted-foreground";

  return (
    <div
      id="budget-tax-calculator"
      // Explicit grid-cols-1 on mobile: the implicit single `auto` column
      // over-grows past the viewport on very narrow screens; minmax(0,1fr)
      // pins it to the container width.
      className="scroll-mt-20 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_1fr]"
    >
      {/* ============================ INPUTS ============================ */}
      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {t("budget_tax_bill_inputs_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Profile */}
          <div>
            <div className={labelClass}>
              {t("budget_tax_bill_profile_label")}
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {PROFILES.map((p) => {
                const Icon = PROFILE_ICON[p];
                const active = profile === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProfile(p)}
                    aria-pressed={active}
                    className={
                      "flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] leading-tight text-center transition-colors " +
                      (active
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                        : "border-input text-muted-foreground hover:text-foreground")
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {t(`budget_tax_bill_profile_${p}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Income */}
          <div>
            <label
              htmlFor="budget-tax-calculator-income"
              className="flex items-baseline justify-between gap-2"
            >
              <span className="text-sm">
                {isLabour
                  ? profile === "self"
                    ? t("budget_tax_bill_income_label")
                    : t("budget_tax_bill_gross_label")
                  : t("budget_tax_bill_profit_label")}
              </span>
              <span className="flex items-baseline gap-0.5">
                <span className="text-sm">€</span>
                <input
                  id="budget-tax-calculator-income"
                  type="number"
                  inputMode="numeric"
                  min={isLabour ? MIN_GROSS : MIN_PROFIT}
                  max={isLabour ? MAX_GROSS : MAX_PROFIT}
                  value={incomeDraft}
                  onChange={(e) => setIncomeDraft(e.target.value)}
                  onBlur={commitIncome}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitIncome();
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      setIncomeDraft(String(isLabour ? gross : profit));
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-24 rounded border border-input bg-background px-2 py-0.5 text-right text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </span>
            </label>
            <input
              type="range"
              min={isLabour ? MIN_GROSS : MIN_PROFIT}
              max={isLabour ? MAX_GROSS : MAX_PROFIT}
              step={isLabour ? STEP_GROSS : STEP_PROFIT}
              value={isLabour ? gross : profit}
              onChange={(e) =>
                isLabour
                  ? setGross(Number(e.target.value))
                  : setProfit(Number(e.target.value))
              }
              className="mt-2 w-full accent-indigo-500"
              aria-label={
                isLabour
                  ? t("budget_tax_bill_gross_label")
                  : t("budget_tax_bill_profit_label")
              }
            />
            <div className="relative flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{eur(isLabour ? MIN_GROSS : MIN_PROFIT)}</span>
              {showModTick ? (
                <span
                  className="absolute -translate-x-1/2 text-amber-600 dark:text-amber-400 whitespace-nowrap"
                  style={{ left: `${modTickPct}%` }}
                >
                  ↑ МОД
                </span>
              ) : null}
              <span>{eur(isLabour ? MAX_GROSS : MAX_PROFIT)}</span>
            </div>
          </div>

          {/* МОД + children (labour only) */}
          {isLabour ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-baseline gap-1">
                <label
                  htmlFor="budget-tax-calculator-mod"
                  className="text-xs text-muted-foreground mr-1 inline-flex items-center gap-1"
                >
                  {t("budget_tax_bill_mod_label")}
                  <InfoTip text={t("budget_tax_bill_tip_mod")} />
                </label>
                <span className="text-xs">€</span>
                <input
                  id="budget-tax-calculator-mod"
                  type="number"
                  min={MIN_MOD}
                  max={MAX_MOD}
                  step={1}
                  value={modDraft}
                  onChange={(e) => setModDraft(e.target.value)}
                  onBlur={commitMod}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitMod();
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      setModDraft(String(mod));
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-20 rounded border border-input bg-background px-2 py-0.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label={t("budget_tax_bill_mod_label")}
                />
              </div>
              <div className="flex items-baseline gap-1">
                <label
                  htmlFor="budget-tax-calculator-children"
                  className="text-xs text-muted-foreground mr-1"
                >
                  {t("budget_tax_bill_children_label")}
                </label>
                <NativeSelect
                  id="budget-tax-calculator-children"
                  value={children}
                  onChange={(e) => setChildren(Number(e.target.value))}
                  className="rounded border border-input bg-background px-2 py-0.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3+</option>
                </NativeSelect>
              </div>
              <div className="basis-full text-[11px] text-muted-foreground -mt-1">
                {isModCustom ? (
                  <button
                    type="button"
                    onClick={resetMod}
                    className="text-primary hover:underline"
                  >
                    {t("budget_tax_bill_mod_reset", {
                      year: modYear,
                      eur: defaultMod,
                    })}
                  </button>
                ) : (
                  t("budget_tax_bill_mod_default", { year: modYear })
                )}
              </div>
            </div>
          ) : null}

          {/* VAT consumption share */}
          <div>
            <label
              htmlFor="budget-tax-calculator-vat-share"
              className="flex items-baseline justify-between gap-2"
            >
              <span className="text-xs text-muted-foreground">
                {t("budget_tax_bill_vat_share_label")}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {fmtPct(vatSharePct / 100, locale, 0)}
              </span>
            </label>
            <input
              id="budget-tax-calculator-vat-share"
              type="range"
              min={0}
              max={100}
              step={5}
              value={vatSharePct}
              onChange={(e) => setVatSharePct(Number(e.target.value))}
              className="mt-1.5 w-full accent-indigo-500"
              aria-label={t("budget_tax_bill_vat_share_label")}
            />
          </div>

          {/* Years of service */}
          {isLabour ? (
            <div>
              <label
                htmlFor="budget-tax-calculator-years"
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-xs text-muted-foreground">
                  {t("budget_tax_bill_pension_years")}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {serviceYears}
                </span>
              </label>
              <input
                id="budget-tax-calculator-years"
                type="range"
                min={MIN_SERVICE}
                max={MAX_SERVICE}
                step={1}
                value={serviceYears}
                onChange={(e) => setServiceYears(Number(e.target.value))}
                className="mt-1.5 w-full accent-indigo-500"
                aria-label={t("budget_tax_bill_pension_years")}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("budget_tax_bill_reset")}
            </button>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {shareCopied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {shareCopied
                ? t("budget_tax_bill_share_done")
                : t("budget_tax_bill_share")}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ============================ RESULTS =========================== */}
      <div className="space-y-4">
        {/* Monthly / annual toggle */}
        <div className="flex justify-end">
          <div className="inline-flex rounded-md border border-input p-0.5 text-[11px]">
            {(["month", "year"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={
                  "px-2.5 py-0.5 rounded transition-colors " +
                  (period === p
                    ? "bg-indigo-500 text-white"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {t(
                  p === "month"
                    ? "budget_tax_bill_period_month"
                    : "budget_tax_bill_period_year",
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Hero figures */}
        <div className="grid gap-3 sm:grid-cols-3 items-start">
          <HeroStat
            label={t("budget_tax_bill_hero_tax")}
            value={eurFlow(scenario.directTax)}
            sub={t("budget_tax_bill_hero_vat", { eur: eurFlow(scenario.vat) })}
            accent
          />
          <HeroStat
            label={t("budget_tax_bill_effective")}
            labelTip={t("budget_tax_bill_tip_rate")}
            value={fmtPct(scenario.effectiveRate, locale)}
            // Income tax is flat 10%, but the marginal rate is not: below the
            // МОД cap each extra euro also carries SSC (~22% total), above it
            // only the 10% income tax. So the marginal rate is shown only
            // above the cap, where it differs from the effective rate.
            sub={
              isLabour && labour.isAboveCap
                ? `${t("budget_tax_bill_marginal")} ${fmtPct(
                    scenario.marginalRate,
                    locale,
                  )}`
                : undefined
            }
          />
          <HeroStat
            label={t("budget_tax_bill_hero_net")}
            value={eurFlow(scenario.net)}
          />
        </div>

        {/* Tax bill */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {t("budget_tax_bill_section_breakdown")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Stacked bar */}
            <div className="flex h-7 w-full overflow-hidden rounded">
              {barSegments.map((s) => {
                const pct = incomeTotal > 0 ? (s.value / incomeTotal) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={s.key}
                    className={s.color}
                    style={{ width: `${pct}%` }}
                    title={`${s.label} ${eurFlow(s.value)}`}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
              {barSegments.map((s) => (
                <span key={s.key} className="flex items-center gap-1">
                  <span
                    className={`inline-block h-2 w-2 rounded-sm ${s.color}`}
                  />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-medium tabular-nums">
                    {eurFlow(s.value)}
                  </span>
                </span>
              ))}
            </div>

            {/* Detail boxes */}
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {isLabour ? (
                <>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <div className="text-muted-foreground flex items-center gap-1">
                      {t(
                        profile === "self"
                          ? "budget_tax_bill_ssc_self"
                          : "budget_tax_bill_ssc",
                      )}
                      <InfoTip text={t("budget_tax_bill_tip_ssc")} />
                    </div>
                    <div className="font-semibold tabular-nums">
                      {eurFlow(labour.ssc)}
                    </div>
                    {labour.isAboveCap ? (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                        {t("budget_tax_bill_ssc_capped", { cap: mod })}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <div className="text-muted-foreground">
                      {t("budget_tax_bill_pit")}
                    </div>
                    <div className="font-semibold tabular-nums">
                      {eurFlow(labour.pit)}
                    </div>
                    {labour.childRelief > 0 ? (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                        {t("budget_tax_bill_child_relief", {
                          eur: eurFlow(labour.childRelief),
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-md bg-indigo-500/10 px-2 py-1.5 ring-1 ring-indigo-500/20">
                    <div className="text-muted-foreground">
                      {t("budget_tax_bill_total")}
                    </div>
                    <div className="font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                      {eurFlow(labour.directTax)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <div className="text-muted-foreground">
                      {t("budget_tax_bill_corp_tax")}
                    </div>
                    <div className="font-semibold tabular-nums">
                      {eurFlow(company.corpTax)}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <div className="text-muted-foreground">
                      {t("budget_tax_bill_dividend_tax")}
                    </div>
                    <div className="font-semibold tabular-nums">
                      {eurFlow(company.dividendTax)}
                    </div>
                  </div>
                  <div className="rounded-md bg-indigo-500/10 px-2 py-1.5 ring-1 ring-indigo-500/20">
                    <div className="text-muted-foreground">
                      {t("budget_tax_bill_total")}
                    </div>
                    <div className="font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                      {eurFlow(company.totalTax)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {isLabour && labour.isAboveCap ? (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                {t("budget_tax_bill_above_cap_hint")}
              </p>
            ) : null}

            {/* Employer side (employee only) */}
            {profile === "employee" ? (
              <div className="mt-3 rounded-md border border-dashed border-input px-2.5 py-2 text-[11px] text-muted-foreground">
                <div>
                  {t("budget_tax_bill_employer_ssc")}{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {eurFlow(labour.employerSsc)}
                  </span>{" "}
                  {t("budget_tax_bill_employer_ssc_name")} —{" "}
                  {t("budget_tax_bill_labour_cost", {
                    eur: eurFlow(labour.labourCost),
                    per,
                  })}
                  {", "}
                  <span className="inline-flex items-center gap-1">
                    {t("budget_tax_bill_wedge", {
                      pct: fmtPct(labour.taxWedge, locale),
                    })}
                    <InfoTip text={t("budget_tax_bill_tip_wedge")} />
                  </span>
                </div>
                <label className="mt-1.5 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeEmployer}
                    onChange={(e) => setIncludeEmployer(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  <span>{t("budget_tax_bill_include_employer")}</span>
                </label>
              </div>
            ) : null}

            {/* VAT */}
            <div className="mt-3 text-[11px] text-muted-foreground">
              {t("budget_tax_bill_vat")}{" "}
              <span className="font-medium text-foreground tabular-nums">
                {eurFlow(scenario.vat)}
              </span>
              <span className="text-muted-foreground/80">
                {" — "}
                {t("budget_tax_bill_vat_note", {
                  pct: fmtPct(vatSharePct / 100, locale, 0),
                })}
              </span>
            </div>

            {/* Effective-rate curve (labour only) */}
            {isLabour && curvePoints.length > 1 ? (
              <div className="mt-3 border-t pt-3">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <TrendingDown className="h-3.5 w-3.5 text-indigo-500" />
                  {t("budget_tax_bill_curve_title")}
                </div>
                <div className="mt-1 max-w-[560px]">
                  <TaxRateCurve
                    points={curvePoints}
                    current={{ gross, rate: labour.effectiveRate }}
                    capGross={mod}
                    minGross={MIN_GROSS}
                    maxGross={MAX_GROSS}
                    locale={locale}
                    capLabel="МОД"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/80">
                  {t("budget_tax_bill_curve_caption")}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Where it goes */}
        {slices.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="h-4 w-4" />
                {t("budget_tax_bill_section_routing")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div
                className={
                  "grid gap-2 " +
                  (routedCards.length === 4
                    ? "grid-cols-2 sm:grid-cols-4"
                    : "grid-cols-3")
                }
              >
                {routedCards.map((c) => (
                  <RoutedStat
                    key={c.key}
                    label={c.label}
                    value={eurFlow(c.value)}
                    accent={c.accent}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                {t("budget_tax_bill_routed_heading", { year: year ?? "" })}
                {isFallback ? (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    {t("budget_functional_fallback", {
                      requested: fiscalYear,
                    })}
                  </span>
                ) : null}
              </p>
              <ul className="mt-2 space-y-2">
                {slices.map((s) => {
                  const label =
                    t(`cofog_${s.code}`) || COFOG_FALLBACK_EN[s.code];
                  const widthPct =
                    maxShare > 0 ? (s.share / maxShare) * 100 : 0;
                  return (
                    <li key={s.code} className="text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        {/* min-w-0 lets the flex item shrink so `truncate`
                            actually clips a long label instead of forcing
                            the row (and the whole page) wider. */}
                        <span className="truncate min-w-0" title={label}>
                          {label}
                        </span>
                        <span className="tabular-nums shrink-0 font-medium">
                          {eurFlow(s.eur)}
                          <span className="text-muted-foreground font-normal">
                            {" · "}
                            {fmtPct(s.share, locale, 0)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full rounded bg-indigo-500/70"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* Pension (labour only) */}
        {isLabour ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PiggyBank className="h-4 w-4" />
                {t("budget_tax_bill_pension_heading")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-[11px] text-muted-foreground">
                {profile === "self"
                  ? t("budget_tax_bill_pension_into_self", {
                      total: eurFlow(labour.pensionContribEmployee),
                      per,
                    })
                  : t("budget_tax_bill_pension_into", {
                      total: eurFlow(
                        labour.pensionContribEmployee +
                          labour.pensionContribEmployer,
                      ),
                      you: eurFlow(labour.pensionContribEmployee),
                      employer: eurFlow(labour.pensionContribEmployer),
                      per,
                    })}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="text-sm">
                  {t("budget_tax_bill_pension_estimate")}
                </span>
                <span className="text-xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
                  {eurFlow(scenario.pension.monthly)}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("budget_tax_bill_pension_replacement", {
                  pct: fmtPct(
                    gross > 0 ? scenario.pension.monthly / gross : 0,
                    locale,
                    0,
                  ),
                })}
                {scenario.pension.cappedAtMin
                  ? ` — ${t("budget_tax_bill_pension_capped_min")}`
                  : scenario.pension.cappedAtMax
                    ? ` — ${t("budget_tax_bill_pension_capped_max")}`
                    : ""}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                {t("budget_tax_bill_pension_ages")}{" "}
                {t("budget_tax_bill_pension_caption")}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Caption */}
        <p className="text-[11px] text-muted-foreground/80">
          {isLabour
            ? t("budget_tax_bill_caption")
            : t("budget_tax_bill_company_caption")}
        </p>
      </div>
    </div>
  );
};
