// National tax-policy simulator (/budget/simulator). Move a rate, see what
// happens to consolidated budget revenue AND to one worked payslip — the two
// numbers every "да вдигнем/намалим данъка" debate needs side by side.
//
// Scoring is STATIC (fixed tax base at the latest closed fiscal year, no
// behavioral response) through src/lib/bgTaxPolicy.ts over the baseline file
// assembled offline by run_policy_baseline.ts. The VAT side runs the COICOP
// consumption model bridged by the calibration factor validated year-by-year
// against actual ДДС revenue; МОД-cap raises carry an explicit uncertainty
// band (Pareto tail α). Same two-pane shell and query-string mirroring as
// BudgetTaxCalculator, so scenarios are shareable links.

import { FC, ReactNode, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  SlidersHorizontal,
  Link2,
  Check,
  RotateCcw,
  Landmark,
  User,
  Users,
  Info,
  TriangleAlert,
  Sparkles,
  Copy,
  ChevronDown,
  Globe,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatEur } from "@/lib/currency";
import {
  PIT_RATE,
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  VAT_STANDARD_RATE,
  SSC_EMPLOYEE_RATE,
  resolveMod,
} from "@/lib/bgTax";
import {
  VAT_ADJUSTABLE_GROUPS,
  VAT_GROUP_DEFAULT_REGIME,
  VAT_REDUCED_RATE,
  computeVatRevenue,
  giniOnBands,
  pitMonthlyUnderBrackets,
  scoreCorporate,
  scoreDividend,
  scoreAdminCut,
  scoreCapitalChange,
  scoreDefenseTarget,
  scoreHealthContribution,
  scoreMinWageFreeze,
  scoreSscSelfPaid,
  scoreWageIndexation,
  scoreModCap,
  scoreModCapBands,
  scorePensionFloorRaise,
  scorePensionIndexation,
  scorePitSchedule,
  scoreTeachersPeg,
  scoreMaternityMonths,
  scoreMpPayFreeze,
  scorePartySubsidy,
  MATERNITY_Y2_MONTHS,
  PARTY_SUBSIDY_RATE_EUR,
  type PitBracket,
  type VatAdjustableGroup,
  type VatBaseSlice,
  type VatPolicy,
  type VatRegime,
} from "@/lib/bgTaxPolicy";
import { usePolicyBaseline } from "@/data/budget/useBudget";
import { useCofog } from "@/data/macro/useCofog";
import {
  NOMINAL_GDP_2026_EUR,
  PROJECTION_YEARS,
  projectFiscalPath,
} from "@/lib/bgFiscalProjection";
import {
  PolicyIncidenceCurve,
  type IncidencePoint,
} from "./PolicyIncidenceCurve";
import { PolicyFiscalProjection } from "./PolicyFiscalProjection";
import { fmtCompactEur, fmtDelta, fmtPct1 } from "./budgetFormat";
import { EuFlag } from "./EuFlag";
import {
  EU_LEVER_PRESETS,
  type EuLeverId,
  type EuPresetApply,
  type EuPresetOption,
} from "@/lib/euPolicyPresets";

// Slider bounds, all in integer percent (МОД in EUR/month). Defaults are
// current law; defaults are omitted from the query string.
const VAT_STD_DEF = Math.round(VAT_STANDARD_RATE * 100);
const VAT_RED_DEF = Math.round(VAT_REDUCED_RATE * 100);
const PIT_DEF = Math.round(PIT_RATE * 100);
const CORP_DEF = Math.round(CORP_TAX_RATE * 100);
const DIV_DEF = Math.round(DIVIDEND_TAX_RATE * 100);
// МОД slider grid: anchored on the CURRENT cap so the default is always a
// reachable slider value (a fixed min like 1200 with step 50 would make
// €2,112 unreachable — once touched, the slider could never drag back to
// "no change"). Lowering is scoreable too (the fitted earnings distribution
// provides the below-cap density), down to ~€1,200 where the model's body
// anchors stop being meaningful.
const MOD_STEP = 50;
const MOD_STEPS_DOWN = 18; // ≈ €900 below the cap
const MOD_STEPS_UP = 78; // ≈ €3,900 above the cap
const GROSS_DEF = 1100;

// Bracket-control bounds (monthly, on the post-SSC taxable base).
const NM_MAX = 1200;
const T2_DEF = 3000;
const R2_DEF = 15;

// Party-subsidy slider unit is euro-cents; the default derives from the
// engine's current-law rate so a future law change flows to the baseline
// and the slider's "no change" position in one edit.
const PSUB_DEF = Math.round(PARTY_SUBSIDY_RATE_EUR * 100);

// Exemplar payslips in the citizen pane: minimum wage, ~average, upper
// professional, above-cap.
const EXEMPLAR_GROSS = [620, 1250, 2500, 5000];

// Citizen-pane assumption: share of net income spent on VAT-carrying
// consumption (mirrors the tax calculator's default).
const CITIZEN_CONSUMPTION_SHARE = 0.75;

// One-tap preset scenarios — the recurring proposals of the Bulgarian tax
// debate (the taxjusticenow pattern: evaluate real proposals, not abstract
// sliders). Applying one resets everything else to current law first.
interface PresetApply {
  nm?: number;
  b2?: { t2: number; r2: number };
  regimes?: Partial<Record<VatAdjustableGroup, VatRegime>>;
  noCap?: boolean;
  /** Swiss-rule CPI weight, % (default 50). */
  pw?: number;
  adm?: number;
  mrzFreeze?: boolean;
  /** Months of paid second-year maternity kept (current law: 12). */
  mat?: number;
}
const PRESETS: { id: string; apply: PresetApply }[] = [
  { id: "nm_mrz", apply: { nm: 620 } },
  { id: "progressive", apply: { b2: { t2: 2000, r2: 20 } } },
  { id: "food9", apply: { regimes: { food: "reduced" } } },
  { id: "restaurants9", apply: { regimes: { restaurants: "reduced" } } },
  { id: "nocap", apply: { noCap: true } },
  { id: "cpionly", apply: { pw: 100 } },
  { id: "admin10", apply: { adm: 10 } },
  { id: "maternity1", apply: { mat: 0 } },
];

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

const REGIMES: VatRegime[] = ["standard", "reduced", "zero"];
const parseRegimeParam = (raw: string | null): VatRegime | null =>
  raw === "standard" || raw === "reduced" || raw === "zero" ? raw : null;

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
    <TooltipContent className="max-w-[280px] text-xs font-normal leading-snug">
      {text}
    </TooltipContent>
  </Tooltip>
);

// One labelled rate slider with a numeric badge and a reset-to-default hint.
// `info` replaces the plain hover tooltip with a richer node (the EU
// comparator popover) when provided.
const RateSlider: FC<{
  id: string;
  label: string;
  tip?: string;
  info?: ReactNode;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  /** Non-integer badge display (defense tenths, subsidy euro-cents);
   *  overrides `value`+`suffix`. */
  formatValue?: (v: number) => string;
}> = ({
  id,
  label,
  tip,
  info,
  min,
  max,
  value,
  defaultValue,
  onChange,
  suffix = "%",
  step = 1,
  formatValue,
}) => (
  <div>
    <label htmlFor={id} className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        {info ?? (tip ? <InfoTip text={tip} /> : null)}
      </span>
      <span
        className={
          "text-sm font-semibold tabular-nums " +
          (value !== defaultValue ? "text-indigo-700 dark:text-indigo-300" : "")
        }
      >
        {formatValue ? formatValue(value) : `${value}${suffix}`}
      </span>
    </label>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mt-1.5 w-full accent-indigo-500"
      aria-label={label}
    />
  </div>
);

// Per-tax result row: label, signed Δ, and a centered diverging bar.
const DeltaRow: FC<{
  label: string;
  deltaEur: number;
  maxAbs: number;
  lang: string;
  sub?: string;
  tip?: string;
}> = ({ label, deltaEur, maxAbs, lang, sub, tip }) => {
  const widthPct = maxAbs > 0 ? (Math.abs(deltaEur) / maxAbs) * 50 : 0;
  const positive = deltaEur >= 0;
  return (
    <li className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate min-w-0">
          {label}
          {tip ? (
            <span className="ml-1 inline-flex align-middle">
              <InfoTip text={tip} />
            </span>
          ) : null}
        </span>
        <span
          className={
            "tabular-nums shrink-0 font-semibold " +
            (deltaEur > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : deltaEur < 0
                ? "text-red-700 dark:text-red-400"
                : "text-muted-foreground")
          }
        >
          {fmtDelta(deltaEur, lang)}
        </span>
      </div>
      {/* The range annotation gets its own line — inline it crowds the row
          label off-screen on narrow viewports. */}
      {sub ? (
        <div className="text-right text-[10px] text-muted-foreground tabular-nums">
          {sub}
        </div>
      ) : null}
      <div className="mt-1 relative h-2 rounded bg-muted overflow-hidden">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        <div
          className={
            "absolute top-0 h-full " +
            (positive ? "bg-emerald-500/70" : "bg-red-500/70")
          }
          style={
            positive
              ? { left: "50%", width: `${widthPct}%` }
              : { right: "50%", width: `${widthPct}%` }
          }
        />
      </div>
    </li>
  );
};

// Info popover for levers that carry EU comparators: the lever's
// description on top, then the country list — one (i) icon serves both,
// keeping the controls column compact. The applied pick is re-derived by
// the caller (it self-clears when the lever drifts off the country value).
const EuInfoPopover: FC<{
  text: string;
  lever: EuLeverId;
  lang: "bg" | "en";
  appliedId: string | null;
  onApply: (o: EuPresetOption) => void;
}> = ({ text, lever, lang, appliedId, onApply }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const options = EU_LEVER_PRESETS[lever];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="inline-flex shrink-0 align-middle text-muted-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3" align="start">
        <p className="text-xs font-normal leading-snug text-muted-foreground">
          {text}
        </p>
        <div className="mt-2 border-t pt-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Globe className="h-3 w-3" />
            {t("budget_policy_eu_label")}
          </div>
          <ul className="mt-1 space-y-0.5">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onApply(o);
                    setOpen(false);
                  }}
                  className={
                    "flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-muted " +
                    (o.id === appliedId ? "bg-indigo-500/10" : "")
                  }
                >
                  <EuFlag cc={o.cc} className="mt-[3px]" />
                  <span className="min-w-0">
                    <span
                      className={
                        "block text-xs leading-snug " +
                        (o.id === appliedId
                          ? "font-medium text-indigo-700 dark:text-indigo-300"
                          : "text-foreground")
                      }
                    >
                      {o.label[lang]}
                    </span>
                    <span className="block text-[10px] leading-snug text-muted-foreground">
                      {o.note[lang]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const BudgetPolicySimulator: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "bg";
  const locale = lang === "en" ? "en-US" : "bg-BG";
  const {
    data: baseline,
    isError: baselineError,
    isSuccess: baselineSettled,
  } = usePolicyBaseline();

  const currentCap = resolveMod(null).mod;
  const modMin = currentCap - MOD_STEPS_DOWN * MOD_STEP;
  const modMax = currentCap + MOD_STEPS_UP * MOD_STEP;
  const [searchParams, setSearchParams] = useSearchParams();

  const [vatStd, setVatStd] = useState(() =>
    clampIntParam(searchParams.get("dds"), 10, 27, VAT_STD_DEF),
  );
  const [vatRed, setVatRed] = useState(() =>
    clampIntParam(searchParams.get("ddsr"), 0, 27, VAT_RED_DEF),
  );
  const [regimes, setRegimes] = useState<
    Partial<Record<VatAdjustableGroup, VatRegime>>
  >(() => {
    const out: Partial<Record<VatAdjustableGroup, VatRegime>> = {};
    for (const g of VAT_ADJUSTABLE_GROUPS) {
      const v = parseRegimeParam(searchParams.get(g));
      if (v && v !== VAT_GROUP_DEFAULT_REGIME[g]) out[g] = v;
    }
    return out;
  });
  const [pit, setPit] = useState(() =>
    clampIntParam(searchParams.get("pit"), 0, 30, PIT_DEF),
  );
  const [corp, setCorp] = useState(() =>
    clampIntParam(searchParams.get("corp"), 0, 30, CORP_DEF),
  );
  const [div, setDiv] = useState(() =>
    clampIntParam(searchParams.get("div"), 0, 20, DIV_DEF),
  );
  const [mod, setMod] = useState(() =>
    clampIntParam(searchParams.get("mod"), modMin, modMax, currentCap),
  );
  const [noCap, setNoCap] = useState(() => searchParams.get("nocap") === "1");
  const [nm, setNm] = useState(() =>
    clampIntParam(searchParams.get("nm"), 0, NM_MAX, 0),
  );
  const [bracket2, setBracket2] = useState(
    () => searchParams.get("b2") === "1",
  );
  const [t2, setT2] = useState(() =>
    clampIntParam(searchParams.get("t2"), 1000, 6000, T2_DEF),
  );
  const [r2, setR2] = useState(() =>
    clampIntParam(searchParams.get("r2"), 0, 30, R2_DEF),
  );
  const [gross, setGross] = useState(() =>
    clampIntParam(searchParams.get("gross"), 500, 8000, GROSS_DEF),
  );
  // Expenditure levers: Swiss-rule CPI weight (%), COVID-supplement
  // indexation, horizon (years), administration cut (%), МРЗ freeze.
  const [pw, setPw] = useState(() =>
    clampIntParam(searchParams.get("pw"), 0, 100, 50),
  );
  const [noSupp, setNoSupp] = useState(() => searchParams.get("ks") === "0");
  const [ph, setPh] = useState(() =>
    clampIntParam(searchParams.get("ph"), 1, 5, 1),
  );
  const [adm, setAdm] = useState(() =>
    clampIntParam(searchParams.get("adm"), 0, 20, 0),
  );
  const [mrzFreeze, setMrzFreeze] = useState(
    () => searchParams.get("mrz") === "1",
  );
  // Phase-5 levers: defense target (tenths of % GDP), wage indexation %,
  // exempt-sectors toggle, capital ±%, SSC-self-paid (+gross-up), health pp.
  const [def, setDef] = useState(() =>
    clampIntParam(searchParams.get("def"), 15, 50, 22),
  );
  const [wi, setWi] = useState(() =>
    clampIntParam(searchParams.get("wi"), -5, 15, 0),
  );
  const [wex, setWex] = useState(() => searchParams.get("wex") !== "0");
  const [kap, setKap] = useState(() =>
    clampIntParam(searchParams.get("kap"), -30, 30, 0),
  );
  const [ssp, setSsp] = useState(() => searchParams.get("ssp") === "1");
  const [sspg, setSspg] = useState(() => searchParams.get("sspg") === "1");
  const [hp, setHp] = useState(() =>
    clampIntParam(searchParams.get("hp"), 0, 3, 0),
  );
  // Pension floor (€/mo) and teachers' peg (% of the average wage): their
  // defaults derive from the baseline at runtime (the МОД-grid idiom — the
  // default must be a reachable slider value), so state holds 0 = "current
  // law" and the effective value is resolved against the baseline below.
  const [mp, setMp] = useState(() =>
    clampIntParam(searchParams.get("mp"), 0, 600, 0),
  );
  const [tp, setTp] = useState(() =>
    clampIntParam(searchParams.get("tp"), 0, 140, 0),
  );
  // June-2026 consolidation-debate levers: paid second-year maternity months
  // (12 = current law), MP pay freeze, party subsidy in euro-cents per vote
  // (300 = current law since 30.04.2026).
  const [mat, setMat] = useState(() =>
    clampIntParam(searchParams.get("mat"), 0, MATERNITY_Y2_MONTHS, 12),
  );
  const [mpf, setMpf] = useState(() => searchParams.get("mpf") === "1");
  const [psub, setPsub] = useState(() =>
    clampIntParam(searchParams.get("psub"), 0, 450, PSUB_DEF),
  );
  // Last "like in <country>" pick per lever — display-only memory; the
  // levers themselves carry the state (and the URL).
  const [euPicks, setEuPicks] = useState<Partial<Record<EuLeverId, string>>>(
    {},
  );
  const [expOpen, setExpOpen] = useState(
    () =>
      searchParams.get("pw") != null ||
      searchParams.get("ks") === "0" ||
      searchParams.get("adm") != null ||
      searchParams.get("mrz") === "1" ||
      searchParams.get("def") != null ||
      searchParams.get("wi") != null ||
      searchParams.get("kap") != null ||
      searchParams.get("ssp") === "1" ||
      searchParams.get("hp") != null ||
      searchParams.get("mp") != null ||
      searchParams.get("tp") != null ||
      searchParams.get("mat") != null ||
      searchParams.get("mpf") === "1" ||
      searchParams.get("psub") != null,
  );
  const [shareCopied, setShareCopied] = useState(false);
  const [sentenceCopied, setSentenceCopied] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);

  // Progressive disclosure: the per-category VAT chips and the progressive-
  // tax controls fold away by default; a shared link that uses them opens
  // its section expanded.
  const [vatCatsOpen, setVatCatsOpen] = useState(() =>
    VAT_ADJUSTABLE_GROUPS.some((g) => parseRegimeParam(searchParams.get(g))),
  );
  const [taxDetailOpen, setTaxDetailOpen] = useState(
    () => searchParams.get("nm") != null || searchParams.get("b2") === "1",
  );

  // The second bracket's threshold rides above the untaxed minimum: when nm
  // crosses t2 the threshold is pushed up (non-destructively — t2 returns to
  // its own value when nm drops back) so the schedule can never silently
  // drop the bracket. Declared before the URL-mirror effect that writes it.
  const t2Eff = Math.max(t2, nm + 100);

  // The reduced VAT rate rides at or below the standard rate — raising it to
  // the standard rate abolishes the reduced regime. Non-destructive: vatRed
  // keeps its own value when the standard rate climbs back up.
  const vatRedEff = Math.min(vatRed, vatStd);

  // Runtime defaults for the baseline-anchored expenditure levers. Both are
  // 0 until the baseline arrives (the component renders a loading card then).
  const pensionFloor = baseline?.expenditure?.pensionFloor;
  const teachers = baseline?.expenditure?.teachers;
  const mpDef = pensionFloor ? Math.round(pensionFloor.minimumEur) : 0;
  const mpEff = mp > 0 ? Math.min(600, Math.max(mpDef, mp)) : mpDef;
  const tpDef = teachers ? Math.round(teachers.currentRatio * 100) : 0;
  const tpEff = tp > 0 ? Math.min(140, Math.max(100, tp)) : tpDef;

  // ----- presets -------------------------------------------------------------
  const applyPreset = (p: PresetApply): void => {
    setVatStd(VAT_STD_DEF);
    setVatRed(VAT_RED_DEF);
    setRegimes(p.regimes ?? {});
    setPit(PIT_DEF);
    setNm(p.nm ?? 0);
    setBracket2(!!p.b2);
    setT2(p.b2?.t2 ?? T2_DEF);
    setR2(p.b2?.r2 ?? R2_DEF);
    setCorp(CORP_DEF);
    setDiv(DIV_DEF);
    setMod(currentCap);
    setNoCap(!!p.noCap);
    setPw(p.pw ?? 50);
    setNoSupp(false);
    setPh(1);
    setAdm(p.adm ?? 0);
    setMrzFreeze(!!p.mrzFreeze);
    setDef(22);
    setWi(0);
    setWex(true);
    setKap(0);
    setSsp(false);
    setSspg(false);
    setHp(0);
    setMp(0);
    setTp(0);
    setMat(p.mat ?? MATERNITY_Y2_MONTHS);
    setMpf(false);
    setPsub(PSUB_DEF);
    setVatCatsOpen(!!p.regimes);
    setTaxDetailOpen(p.nm != null || !!p.b2);
    setExpOpen(p.pw != null || p.adm != null || !!p.mrzFreeze || p.mat != null);
  };
  const presetIsActive = (p: PresetApply): boolean => {
    const wantRegimes = p.regimes ?? {};
    const regimesMatch =
      VAT_ADJUSTABLE_GROUPS.every(
        (g) => (regimes[g] ?? null) === (wantRegimes[g] ?? null),
      ) &&
      vatStd === VAT_STD_DEF &&
      vatRedEff === VAT_RED_DEF;
    return (
      regimesMatch &&
      pit === PIT_DEF &&
      nm === (p.nm ?? 0) &&
      bracket2 === !!p.b2 &&
      (!p.b2 || (t2Eff === p.b2.t2 && r2 === p.b2.r2)) &&
      corp === CORP_DEF &&
      div === DIV_DEF &&
      noCap === !!p.noCap &&
      (noCap || mod === currentCap) &&
      pw === (p.pw ?? 50) &&
      !noSupp &&
      ph === 1 &&
      adm === (p.adm ?? 0) &&
      mrzFreeze === !!p.mrzFreeze &&
      def === 22 &&
      wi === 0 &&
      kap === 0 &&
      !ssp &&
      hp === 0 &&
      mpEff === mpDef &&
      tpEff === tpDef &&
      mat === (p.mat ?? MATERNITY_Y2_MONTHS) &&
      !mpf &&
      psub === PSUB_DEF
    );
  };

  useEffect(() => {
    const next: Record<string, string> = {};
    if (vatStd !== VAT_STD_DEF) next.dds = String(vatStd);
    if (vatRedEff !== VAT_RED_DEF) next.ddsr = String(vatRedEff);
    for (const g of VAT_ADJUSTABLE_GROUPS) {
      if (regimes[g] && regimes[g] !== VAT_GROUP_DEFAULT_REGIME[g])
        next[g] = regimes[g]!;
    }
    if (pit !== PIT_DEF) next.pit = String(pit);
    if (nm !== 0) next.nm = String(nm);
    if (bracket2) {
      next.b2 = "1";
      if (t2Eff !== T2_DEF) next.t2 = String(t2Eff);
      if (r2 !== R2_DEF) next.r2 = String(r2);
    }
    if (corp !== CORP_DEF) next.corp = String(corp);
    if (div !== DIV_DEF) next.div = String(div);
    if (!noCap && mod !== currentCap) next.mod = String(mod);
    if (noCap) next.nocap = "1";
    if (gross !== GROSS_DEF) next.gross = String(gross);
    if (pw !== 50) next.pw = String(pw);
    if (noSupp) next.ks = "0";
    if (ph !== 1) next.ph = String(ph);
    if (adm !== 0) next.adm = String(adm);
    if (mrzFreeze) next.mrz = "1";
    if (def !== 22) next.def = String(def);
    if (wi !== 0) next.wi = String(wi);
    if (wi !== 0 && !wex) next.wex = "0";
    if (kap !== 0) next.kap = String(kap);
    if (ssp) next.ssp = "1";
    if (ssp && sspg) next.sspg = "1";
    if (hp !== 0) next.hp = String(hp);
    if (mpEff !== mpDef) next.mp = String(mpEff);
    if (tpEff !== tpDef) next.tp = String(tpEff);
    if (mat !== MATERNITY_Y2_MONTHS) next.mat = String(mat);
    if (mpf) next.mpf = "1";
    if (psub !== PSUB_DEF) next.psub = String(psub);
    setSearchParams(next, { replace: true });
  }, [
    vatStd,
    vatRedEff,
    regimes,
    pit,
    nm,
    bracket2,
    t2Eff,
    r2,
    corp,
    div,
    mod,
    noCap,
    gross,
    pw,
    noSupp,
    ph,
    adm,
    mrzFreeze,
    def,
    wi,
    wex,
    kap,
    ssp,
    sspg,
    hp,
    mpEff,
    mpDef,
    tpEff,
    tpDef,
    mat,
    mpf,
    psub,
    currentCap,
    setSearchParams,
  ]);

  const resetAll = (): void => {
    setVatStd(VAT_STD_DEF);
    setVatRed(VAT_RED_DEF);
    setRegimes({});
    setPit(PIT_DEF);
    setNm(0);
    setBracket2(false);
    setT2(T2_DEF);
    setR2(R2_DEF);
    setCorp(CORP_DEF);
    setDiv(DIV_DEF);
    setMod(currentCap);
    setNoCap(false);
    setGross(GROSS_DEF);
    setPw(50);
    setNoSupp(false);
    setPh(1);
    setAdm(0);
    setMrzFreeze(false);
    setDef(22);
    setWi(0);
    setWex(true);
    setKap(0);
    setSsp(false);
    setSspg(false);
    setHp(0);
    setMp(0);
    setTp(0);
    setMat(MATERNITY_Y2_MONTHS);
    setMpf(false);
    setPsub(PSUB_DEF);
  };

  // ----- EU country comparators ----------------------------------------------
  // euPicks remembers the last pick per lever; the applied id is re-derived
  // by matching against current state, so it self-clears when values drift.
  const applyEuOption = (lever: EuLeverId, o: EuPresetOption): void => {
    const a = o.apply;
    if (a.vatStd != null) setVatStd(a.vatStd);
    if (a.vatRed != null) setVatRed(a.vatRed);
    if (a.pit != null) setPit(a.pit);
    if (a.nm != null) setNm(a.nm);
    if (a.b2 !== undefined) {
      if (a.b2 === null) setBracket2(false);
      else {
        setBracket2(true);
        setT2(a.b2.t2);
        setR2(a.b2.r2);
      }
    }
    if (a.nm != null || a.b2 !== undefined) setTaxDetailOpen(true);
    if (a.corp != null) setCorp(a.corp);
    if (a.def != null) setDef(a.def);
    if (a.mat != null) setMat(a.mat);
    if (a.pw != null) setPw(a.pw);
    setEuPicks((prev) => ({ ...prev, [lever]: o.id }));
  };
  const euMatches = (a: EuPresetApply): boolean =>
    (a.vatStd == null || vatStd === a.vatStd) &&
    (a.vatRed == null || vatRedEff === a.vatRed) &&
    (a.pit == null || pit === a.pit) &&
    (a.nm == null || nm === a.nm) &&
    (a.b2 === undefined ||
      (a.b2 === null
        ? !bracket2
        : bracket2 && t2Eff === a.b2.t2 && r2 === a.b2.r2)) &&
    (a.corp == null || corp === a.corp) &&
    (a.def == null || def === a.def) &&
    (a.mat == null || mat === a.mat) &&
    (a.pw == null || pw === a.pw);
  const euAppliedId = (lever: EuLeverId): string | null => {
    const id = euPicks[lever];
    if (!id) return null;
    const o = EU_LEVER_PRESETS[lever].find((x) => x.id === id);
    return o && euMatches(o.apply) ? id : null;
  };
  const euInfo = (lever: EuLeverId, text: string): ReactNode => (
    <EuInfoPopover
      lever={lever}
      text={text}
      lang={lang}
      appliedId={euAppliedId(lever)}
      onApply={(o) => applyEuOption(lever, o)}
    />
  );
  // The applied country's note, shown under the lever while it still
  // matches that country's values.
  const euNoteLine = (lever: EuLeverId): ReactNode => {
    const id = euAppliedId(lever);
    const o = id ? EU_LEVER_PRESETS[lever].find((x) => x.id === id) : undefined;
    return o ? (
      <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-muted-foreground/80">
        <EuFlag cc={o.cc} className="mt-[2px]" />
        <span>{o.note[lang]}</span>
      </p>
    ) : null;
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

  // ----- scoring -----------------------------------------------------------
  const scenario = useMemo(() => {
    if (!baseline?.earnings?.bands || !baseline.vat?.slices) return null;
    const slices = baseline.vat.slices as VatBaseSlice[];
    const currentPolicy: VatPolicy = {
      standardRate: VAT_STANDARD_RATE,
      reducedRate: VAT_REDUCED_RATE,
      regimes: {},
    };
    const policy: VatPolicy = {
      standardRate: vatStd / 100,
      reducedRate: vatRedEff / 100,
      regimes,
    };
    const vatBaseRun = computeVatRevenue(slices, currentPolicy);
    const vatRun = computeVatRevenue(slices, policy);
    const vatDelta =
      (vatRun.modeledEur - vatBaseRun.modeledEur) * baseline.vat.factor;

    // ДДФЛ: the employment portion is scored over the fitted earnings bands
    // (so untaxed-minimum / second-bracket schedules work), non-employment
    // income scales with the schedule's base rate.
    const brackets: PitBracket[] = [];
    if (nm > 0) brackets.push({ fromEur: 0, rate: 0 });
    brackets.push({ fromEur: nm, rate: pit / 100 });
    if (bracket2) brackets.push({ fromEur: t2Eff, rate: r2 / 100 });
    const earnings = baseline.earnings;
    const pitEmploymentDelta = scorePitSchedule(
      earnings.bands,
      earnings.capEur,
      brackets,
      earnings.kappa,
    );
    const pitNonEmploymentDelta =
      baseline.revenue.pitEur *
      baseline.revenue.pitNonEmploymentShare *
      (pit / 100 / PIT_RATE - 1);
    const pitDelta = pitEmploymentDelta + pitNonEmploymentDelta;

    const corpDelta = scoreCorporate(baseline.revenue.corporateEur, corp / 100);
    const divDelta = scoreDividend(baseline.revenue.dividendEur, div / 100);

    // МОД: central from the band model (works in both directions and knows
    // the schedule's base rate for the deduction interaction); the range
    // comes from the closed-form Pareto α band when raising, and a flat
    // ±15% model margin when lowering (the body is far better anchored
    // than the tail, but it is still a fitted shape).
    const targetCap = noCap ? Infinity : mod;
    const modBands = scoreModCapBands(
      earnings.bands,
      currentCap,
      targetCap,
      pit / 100,
    );
    let modRes: { centralEur: number; lowEur: number; highEur: number };
    if (targetCap >= currentCap) {
      const cf = scoreModCap(baseline.modIdentity, targetCap, currentCap);
      modRes = {
        centralEur: modBands.totalEur,
        lowEur: Math.min(cf.lowEur, cf.highEur, modBands.totalEur),
        highEur: Math.max(cf.lowEur, cf.highEur, modBands.totalEur),
      };
    } else {
      modRes = {
        centralEur: modBands.totalEur,
        lowEur: modBands.totalEur * 1.15,
        highEur: modBands.totalEur * 0.85,
      };
    }

    // Expenditure levers (balance convention: positive = budget improves).
    const exp = baseline.expenditure;
    const pensionDeltaSpend = exp
      ? scorePensionIndexation(exp.pensions, {
          cpiWeight: pw / 100,
          indexSupplement: !noSupp,
          horizonYears: ph,
        })
      : 0;
    const adminRes =
      exp && adm > 0 ? scoreAdminCut(exp.administration, adm / 100) : null;
    const adminDeltaSpend = adminRes ? adminRes.netEur : 0;
    const mwDelta =
      exp && mrzFreeze
        ? scoreMinWageFreeze(baseline.earnings.bands, exp.minWage)
        : 0;
    // Priced against the projection module's 2026 GDP so the defense lever
    // and the projection card never quote two different GDPs.
    const defDelta =
      exp && def !== 22
        ? scoreDefenseTarget(
            NOMINAL_GDP_2026_EUR,
            exp.defense.natoPctGdp,
            def / 10,
          )
        : 0;
    const wiDelta =
      exp && wi !== 0
        ? scoreWageIndexation(
            exp.personnel.massEur,
            exp.personnel.exemptShare,
            wi,
            wex,
          )
        : 0;
    const kapDelta =
      exp && kap !== 0
        ? scoreCapitalChange(
            exp.capital.planEur,
            exp.capital.executionRate,
            kap,
          )
        : 0;
    const sspDelta =
      exp && ssp
        ? scoreSscSelfPaid(
            exp.sscSelfPaid.count,
            exp.sscSelfPaid.avgWageEur,
            sspg,
          )
        : 0;
    const hpDelta =
      exp && hp !== 0 ? scoreHealthContribution(exp.health.baseEur, hp) : 0;
    // Pension floor: top-up to the new minimum for every pensioner below it.
    const mpDeltaSpend =
      exp?.pensionFloor && mpEff !== mpDef
        ? scorePensionFloorRaise(
            exp.pensionFloor.bands,
            exp.pensionFloor.minimumEur,
            mpEff,
          )
        : 0;
    // Teachers' peg: move the (proxy) ratio to the target % of the economy
    // average — negative below the current ratio (a saving).
    const tpDeltaSpend =
      exp?.teachers && tpEff !== tpDef
        ? scoreTeachersPeg(
            exp.teachers.count,
            exp.teachers.economyWageEur,
            exp.teachers.currentRatio,
            tpEff,
          )
        : 0;
    // June-2026 debate levers (Δ spending; negative = the budget saves).
    const matDeltaSpend =
      mat !== MATERNITY_Y2_MONTHS ? scoreMaternityMonths(mat) : 0;
    const mpfDeltaSpend =
      exp && mpf ? scoreMpPayFreeze(exp.pensions.wageGrowthPct) : 0;
    const psubDeltaSpend =
      psub !== PSUB_DEF ? scorePartySubsidy(psub / 100) : 0;
    const expenditureBalance =
      -(
        pensionDeltaSpend +
        adminDeltaSpend +
        defDelta +
        wiDelta +
        kapDelta +
        sspDelta +
        mpDeltaSpend +
        tpDeltaSpend +
        matDeltaSpend +
        mpfDeltaSpend +
        psubDeltaSpend
      ) +
      mwDelta +
      hpDelta;

    const central =
      vatDelta +
      pitDelta +
      corpDelta +
      divDelta +
      modRes.centralEur +
      expenditureBalance;
    const low =
      vatDelta +
      pitDelta +
      corpDelta +
      divDelta +
      expenditureBalance +
      Math.min(modRes.lowEur, modRes.highEur);
    const high =
      vatDelta +
      pitDelta +
      corpDelta +
      divDelta +
      expenditureBalance +
      Math.max(modRes.lowEur, modRes.highEur);

    // Household effective VAT take per euro of taxable consumption — drives
    // the citizen pane's VAT line.
    const taxableBase = slices.reduce(
      (acc, s) => (s.regime !== null ? acc + s.valueEur : acc),
      0,
    );
    const vatFractionBase = vatBaseRun.modeledEur / taxableBase;
    const vatFractionNew = vatRun.modeledEur / taxableBase;

    return {
      vatDelta,
      pitDelta,
      corpDelta,
      divDelta,
      modRes,
      brackets,
      pensionBalance: -pensionDeltaSpend,
      adminBalance: -adminDeltaSpend,
      adminRes,
      mwDelta,
      defBalance: -defDelta,
      wiBalance: -wiDelta,
      kapBalance: -kapDelta,
      sspBalance: -sspDelta,
      hpDelta,
      mpBalance: -mpDeltaSpend,
      tpBalance: -tpDeltaSpend,
      matBalance: -matDeltaSpend,
      mpfBalance: -mpfDeltaSpend,
      psubBalance: -psubDeltaSpend,
      central,
      low,
      high,
      vatFractionBase,
      vatFractionNew,
    };
  }, [
    baseline,
    vatStd,
    vatRedEff,
    regimes,
    pit,
    nm,
    bracket2,
    t2Eff,
    r2,
    corp,
    div,
    mod,
    noCap,
    pw,
    noSupp,
    ph,
    adm,
    mrzFreeze,
    def,
    wi,
    wex,
    kap,
    ssp,
    sspg,
    hp,
    mpEff,
    mpDef,
    tpEff,
    tpDef,
    mat,
    mpf,
    psub,
    currentCap,
  ]);

  // ----- citizen pane ------------------------------------------------------
  // Minimal payslip math under (schedule, cap) — child relief and the
  // self-insured profile stay in the full calculator.
  const citizen = useMemo(() => {
    if (!scenario) return null;
    const deltaFor = (g: number) => {
      const payslip = (brackets: PitBracket[], cap: number) => {
        const insurable = Math.min(g, cap);
        const ssc = insurable * SSC_EMPLOYEE_RATE;
        const pitAmt = pitMonthlyUnderBrackets(Math.max(0, g - ssc), brackets);
        return { net: g - ssc - pitAmt, ssc, pitAmt };
      };
      const before = payslip([{ fromEur: 0, rate: PIT_RATE }], currentCap);
      const after = payslip(scenario.brackets, noCap ? Infinity : mod);
      // VAT on spending: consumption share of net, at the household-
      // effective VAT fraction before/after.
      const vatBefore =
        before.net * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionBase;
      const vatAfter =
        after.net * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionNew;
      return {
        netDelta: after.net - before.net,
        vatDelta: vatAfter - vatBefore,
        totalDelta: after.net - before.net - (vatAfter - vatBefore),
      };
    };
    return {
      ...deltaFor(gross),
      exemplars: EXEMPLAR_GROSS.map((g) => ({
        gross: g,
        totalDelta: deltaFor(g).totalDelta,
      })),
    };
  }, [scenario, gross, mod, noCap, currentCap]);

  // ----- distributional view (incidence curve + Gini) -----------------------
  const distribution = useMemo(() => {
    if (!baseline?.earnings || !scenario) return null;
    const bands = baseline.earnings.bands;
    const netUnder =
      (brackets: PitBracket[], cap: number) =>
      (g: number): number => {
        const ssc = Math.min(g, cap) * SSC_EMPLOYEE_RATE;
        return (
          g - ssc - pitMonthlyUnderBrackets(Math.max(0, g - ssc), brackets)
        );
      };
    const beforeNet = netUnder([{ fromEur: 0, rate: PIT_RATE }], currentCap);
    const afterNet = netUnder(scenario.brackets, noCap ? Infinity : mod);
    const points: IncidencePoint[] = [];
    const N = 48;
    for (let i = 0; i < N; i++) {
      const g = 500 + (i / (N - 1)) * 5500;
      const nb = beforeNet(g);
      const na = afterNet(g);
      const vatB = nb * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionBase;
      const vatA = na * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionNew;
      points.push({ grossEur: g, deltaEur: na - nb - (vatA - vatB) });
    }
    const anyVisible = points.some((p) => Math.abs(p.deltaEur) >= 0.5);
    return {
      points,
      anyVisible,
      giniBefore: giniOnBands(bands, beforeNet),
      giniAfter: giniOnBands(bands, afterNet),
    };
  }, [baseline, scenario, mod, noCap, currentCap]);

  // ----- multi-year balance & debt projection --------------------------------
  // ESA general-government grain (EC Spring 2026 baseline) — distinct from
  // the КФП cash grain of the rest of the screen; the projection card says so.
  // The pension-indexation slice COMPOUNDS (current-law rate ~7%/yr), so it
  // is recomputed for each projection year and passed as a fixed path; the
  // headline keeps the user's horizon slider, the projection ignores it.
  const projection = useMemo(() => {
    const central = scenario?.central ?? 0;
    const pensions = baseline?.expenditure?.pensions;
    const pensionActive = !!pensions && (pw !== 50 || noSupp);
    if (!scenario || !pensionActive) return projectFiscalPath(central);
    return projectFiscalPath(
      central - scenario.pensionBalance,
      PROJECTION_YEARS.map(
        (_, i) =>
          -scorePensionIndexation(pensions, {
            cpiWeight: pw / 100,
            indexSupplement: !noSupp,
            horizonYears: i + 1,
          }),
      ),
    );
  }, [scenario, baseline, pw, noSupp]);

  // ----- model vs published estimates ----------------------------------------
  // Live engine runs of the canonical scenarios that official costings exist
  // for (МФ consolidation menu 2023, Фискален съвет 2025, КНСБ/НОИ 2025) —
  // the caveats card folds them into a comparison table so the calibration
  // is inspectable, not asserted.
  const benchmarks = useMemo(() => {
    if (!baseline?.vat?.slices || !baseline.earnings?.bands) return null;
    const exp = baseline.expenditure;
    const slices = baseline.vat.slices as VatBaseSlice[];
    const vatAt = (regimes: VatPolicy["regimes"]): number =>
      computeVatRevenue(slices, {
        standardRate: VAT_STANDARD_RATE,
        reducedRate: VAT_REDUCED_RATE,
        regimes,
      }).modeledEur;
    const vatBase = vatAt({});
    const e = baseline.earnings;
    const rows: { key: string; ours: number }[] = [
      {
        key: "restaurants",
        ours:
          (vatAt({ restaurants: "reduced" }) - vatBase) * baseline.vat.factor,
      },
      {
        key: "corp",
        ours: scoreCorporate(baseline.revenue.corporateEur, 0.11),
      },
      { key: "div", ours: scoreDividend(baseline.revenue.dividendEur, 0.1) },
      {
        key: "mod",
        // €2,352 = the cap in the withdrawn Budget-2026 draft — the move
        // the КНСБ costing scored.
        ours: scoreModCapBands(e.bands, currentCap, 2352).totalEur,
      },
      {
        key: "nm",
        ours: scorePitSchedule(
          e.bands,
          e.capEur,
          [
            { fromEur: 0, rate: 0 },
            { fromEur: 620, rate: PIT_RATE },
          ],
          e.kappa,
        ),
      },
    ];
    if (exp)
      rows.splice(3, 0, {
        key: "ssc",
        // +1пп on the insurable base is fund-agnostic — the health scorer
        // is just base × pp, reused here as the generic contribution row.
        ours: scoreHealthContribution(exp.health.baseEur, 1),
      });
    return rows;
  }, [baseline, currentCap]);

  // ----- "what it buys" comparator (COFOG health + education) ---------------
  const { data: cofog } = useCofog();
  const comparator = useMemo(() => {
    if (!cofog || !scenario || Math.abs(scenario.central) < 1e6) return null;
    const yr = cofog.latestYear;
    const health = cofog.series.GF07?.find((p) => p.year === yr)?.valueEur;
    const education = cofog.series.GF09?.find((p) => p.year === yr)?.valueEur;
    if (!health || !education) return null;
    return {
      year: yr,
      healthPct: (Math.abs(scenario.central) / health) * 100,
      educationPct: (Math.abs(scenario.central) / education) * 100,
    };
  }, [cofog, scenario]);

  // ----- auto-generated scenario sentence ------------------------------------
  const sentence = useMemo(() => {
    if (!scenario || !baseline) return null;
    const rateOf = (regime: VatRegime): string =>
      regime === "standard"
        ? `${vatStd}%`
        : regime === "reduced"
          ? `${vatRedEff}%`
          : "0%";
    const parts: string[] = [];
    if (vatStd !== VAT_STD_DEF)
      parts.push(t("budget_policy_frag_vat", { v: vatStd }));
    if (vatRedEff !== VAT_RED_DEF)
      parts.push(t("budget_policy_frag_vat_red", { v: vatRedEff }));
    for (const g of VAT_ADJUSTABLE_GROUPS) {
      if (regimes[g] && regimes[g] !== VAT_GROUP_DEFAULT_REGIME[g])
        parts.push(
          `${t(`budget_policy_group_${g}`)} → ${rateOf(regimes[g]!)} ${t("budget_policy_frag_vat_word")}`,
        );
    }
    if (pit !== PIT_DEF) parts.push(t("budget_policy_frag_pit", { v: pit }));
    if (nm > 0) parts.push(t("budget_policy_frag_nm", { v: nm }));
    if (bracket2) parts.push(t("budget_policy_frag_b2", { r: r2, t: t2Eff }));
    if (corp !== CORP_DEF)
      parts.push(t("budget_policy_frag_corp", { v: corp }));
    if (div !== DIV_DEF) parts.push(t("budget_policy_frag_div", { v: div }));
    if (noCap) parts.push(t("budget_policy_frag_nocap"));
    else if (mod !== currentCap)
      parts.push(t("budget_policy_frag_mod", { v: mod }));
    if (pw !== 50) parts.push(t("budget_policy_frag_swiss", { v: pw }));
    if (noSupp) parts.push(t("budget_policy_frag_nosupp"));
    if (ph !== 1) parts.push(t("budget_policy_frag_horizon", { v: ph }));
    if (adm > 0) parts.push(t("budget_policy_frag_admin", { v: adm }));
    if (mrzFreeze) parts.push(t("budget_policy_frag_mrz"));
    if (def !== 22)
      parts.push(t("budget_policy_frag_def", { v: (def / 10).toFixed(1) }));
    if (wi !== 0) parts.push(t("budget_policy_frag_wi", { v: wi }));
    if (kap !== 0) parts.push(t("budget_policy_frag_kap", { v: kap }));
    if (ssp)
      parts.push(
        t(sspg ? "budget_policy_frag_ssp_gross" : "budget_policy_frag_ssp"),
      );
    if (hp !== 0) parts.push(t("budget_policy_frag_hp", { v: hp }));
    if (mpEff !== mpDef) parts.push(t("budget_policy_frag_mp", { v: mpEff }));
    if (tpEff !== tpDef) parts.push(t("budget_policy_frag_tp", { v: tpEff }));
    if (mat !== MATERNITY_Y2_MONTHS)
      parts.push(t("budget_policy_frag_mat", { v: mat }));
    if (mpf) parts.push(t("budget_policy_frag_mpf"));
    if (psub !== PSUB_DEF) {
      const rate = (psub / 100).toFixed(2);
      parts.push(
        t("budget_policy_frag_psub", {
          v: lang === "bg" ? rate.replace(".", ",") : rate,
        }),
      );
    }
    if (!parts.length) return null;
    return t("budget_policy_sentence", {
      changes: parts.join("; "),
      total: fmtDelta(scenario.central, lang),
      pct: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
        (scenario.central / baseline.gdpEur) * 100,
      ),
    });
  }, [
    scenario,
    baseline,
    vatStd,
    vatRedEff,
    regimes,
    pit,
    nm,
    bracket2,
    t2Eff,
    r2,
    corp,
    div,
    mod,
    noCap,
    pw,
    noSupp,
    ph,
    adm,
    mrzFreeze,
    def,
    wi,
    kap,
    ssp,
    sspg,
    hp,
    mpEff,
    mpDef,
    tpEff,
    tpDef,
    mat,
    mpf,
    psub,
    currentCap,
    t,
    lang,
    locale,
  ]);

  const onCopySentence = (): void => {
    if (!sentence) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(`${sentence}\n${window.location.href}`)
        .then(() => {
          setSentenceCopied(true);
          setTimeout(() => setSentenceCopied(false), 2000);
        })
        .catch(() => undefined);
    }
  };

  // Distinguish "still fetching" from "fetched but unusable": a 404 (stale
  // bucket without the new file) or a baseline missing the earnings section
  // must surface an error card, not load forever or crash the render.
  if (baselineError || (baselineSettled && (!baseline || !baseline.earnings))) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("budget_policy_error")}
      </div>
    );
  }
  if (!baseline || !scenario || !citizen) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("budget_policy_loading")}
      </div>
    );
  }

  const eur = (v: number): string => formatEur(v, locale);
  const modUncertain =
    Math.abs(scenario.modRes.highEur - scenario.modRes.lowEur) > 1e6;
  const maxAbs = Math.max(
    Math.abs(scenario.vatDelta),
    Math.abs(scenario.pitDelta),
    Math.abs(scenario.corpDelta),
    Math.abs(scenario.divDelta),
    Math.abs(scenario.modRes.centralEur),
    Math.abs(scenario.pensionBalance),
    Math.abs(scenario.adminBalance),
    Math.abs(scenario.mwDelta),
    Math.abs(scenario.defBalance),
    Math.abs(scenario.wiBalance),
    Math.abs(scenario.kapBalance),
    Math.abs(scenario.sspBalance),
    Math.abs(scenario.hpDelta),
    Math.abs(scenario.mpBalance),
    Math.abs(scenario.tpBalance),
    Math.abs(scenario.matBalance),
    Math.abs(scenario.mpfBalance),
    Math.abs(scenario.psubBalance),
    1,
  );
  const pctGdp = (scenario.central / baseline.gdpEur) * 100;
  const anyChange =
    scenario.central !== 0 || scenario.vatDelta !== 0 || citizen.netDelta !== 0;
  const fyProj = projection.years[0];
  const heroDeficitLine = anyChange
    ? t("budget_policy_hero_deficit", {
        year: fyProj.year,
        before: fmtPct1(fyProj.baselineBalancePctGdp, locale),
        after: fmtPct1(fyProj.balancePctGdp, locale),
      })
    : t("budget_policy_hero_deficit_nochange", {
        year: fyProj.year,
        before: fmtPct1(fyProj.baselineBalancePctGdp, locale),
      });

  const regimeChip = (g: VatAdjustableGroup): ReactNode => {
    const active = regimes[g] ?? VAT_GROUP_DEFAULT_REGIME[g];
    return (
      <div key={g} className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t(`budget_policy_group_${g}`)}
        </span>
        <div className="inline-flex rounded-md border border-input p-0.5">
          {REGIMES.map((r) => {
            const label =
              r === "standard"
                ? `${vatStd}%`
                : r === "reduced"
                  ? `${vatRedEff}%`
                  : "0%";
            const isActive = active === r;
            const isDefault = VAT_GROUP_DEFAULT_REGIME[g] === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={isActive}
                aria-label={`${t(`budget_policy_group_${g}`)}: ${t(`budget_policy_regime_${r}`)}`}
                onClick={() =>
                  setRegimes((prev) => {
                    const next = { ...prev };
                    if (r === VAT_GROUP_DEFAULT_REGIME[g]) delete next[g];
                    else next[g] = r;
                    return next;
                  })
                }
                className={
                  "px-2 py-0.5 rounded text-[11px] tabular-nums transition-colors " +
                  (isActive
                    ? isDefault
                      ? "bg-muted text-foreground font-medium"
                      : "bg-indigo-500 text-white font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
                title={t(`budget_policy_regime_${r}`)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      id="budget-policy-simulator"
      // pb compensates for the fixed mobile result bar so it never occludes
      // the caveats card / footer once a scenario is active.
      className={"scroll-mt-20 space-y-4" + (anyChange ? " pb-16 lg:pb-0" : "")}
    >
      {/* ============================ PRESETS =========================== */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mr-1">
          <Sparkles className="h-3.5 w-3.5" />
          {t("budget_policy_presets_title")}
        </span>
        {PRESETS.map((p) => {
          const active = presetIsActive(p.apply);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => applyPreset(p.apply)}
              title={t(`budget_policy_preset_${p.id}_tip`)}
              className={
                "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                (active
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                  : "border-input text-muted-foreground hover:text-foreground hover:border-ring")
              }
            >
              {t(`budget_policy_preset_${p.id}`)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* ============================ INPUTS ============================ */}
        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("budget_policy_inputs_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div>
              <RateSlider
                id="policy-vat-std"
                label={t("budget_policy_vat_std")}
                info={euInfo("vatStd", t("budget_policy_tip_vat_std"))}
                min={10}
                max={27}
                value={vatStd}
                defaultValue={VAT_STD_DEF}
                onChange={setVatStd}
              />
              {euNoteLine("vatStd")}
            </div>
            <div>
              <RateSlider
                id="policy-vat-red"
                label={t("budget_policy_vat_red")}
                info={euInfo("vatRed", t("budget_policy_tip_vat_red"))}
                min={0}
                max={vatStd}
                value={vatRedEff}
                defaultValue={VAT_RED_DEF}
                onChange={setVatRed}
              />
              {euNoteLine("vatRed")}
            </div>

            {/* Per-category VAT regime chips — folded by default */}
            <div>
              {/* InfoTip renders its own <button>, so it must stay a sibling
                  of the toggle — nested buttons are invalid HTML. */}
              <div className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={vatCatsOpen}
                    onClick={() => setVatCatsOpen((v) => !v)}
                    className="hover:text-foreground"
                  >
                    {t("budget_policy_groups_title")}
                  </button>
                  <InfoTip text={t("budget_policy_tip_groups")} />
                  {!vatCatsOpen && Object.keys(regimes).length > 0 ? (
                    <span className="rounded-full bg-indigo-500/10 px-1.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                      {Object.keys(regimes).length}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => setVatCatsOpen((v) => !v)}
                  className="hover:text-foreground"
                >
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (vatCatsOpen ? "rotate-180" : "")
                    }
                  />
                </button>
              </div>
              {vatCatsOpen ? (
                <div className="mt-2 space-y-1.5">
                  {VAT_ADJUSTABLE_GROUPS.map((g) => regimeChip(g))}
                </div>
              ) : null}
            </div>

            <div className="border-t pt-3 space-y-4">
              <div>
                <RateSlider
                  id="policy-pit"
                  label={t("budget_policy_pit")}
                  info={euInfo("pit", t("budget_policy_tip_pit"))}
                  min={0}
                  max={30}
                  value={pit}
                  defaultValue={PIT_DEF}
                  onChange={setPit}
                />
                {euNoteLine("pit")}
              </div>
              {/* Progressive-tax controls — folded by default */}
              <div>
                <button
                  type="button"
                  aria-expanded={taxDetailOpen}
                  onClick={() => setTaxDetailOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-1">
                    {t("budget_policy_progressive_title")}
                    {!taxDetailOpen && (nm > 0 || bracket2) ? (
                      <span className="rounded-full bg-indigo-500/10 px-1.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                        {(nm > 0 ? 1 : 0) + (bracket2 ? 1 : 0)}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (taxDetailOpen ? "rotate-180" : "")
                    }
                  />
                </button>
                {taxDetailOpen ? (
                  <div className="mt-2 space-y-4">
                    <RateSlider
                      id="policy-nm"
                      label={t("budget_policy_nm")}
                      tip={t("budget_policy_tip_nm")}
                      min={0}
                      max={NM_MAX}
                      step={20}
                      value={nm}
                      defaultValue={0}
                      onChange={setNm}
                      suffix=" €"
                    />
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={bracket2}
                          onChange={(e) => setBracket2(e.target.checked)}
                          className="accent-indigo-500"
                        />
                        <span>{t("budget_policy_b2")}</span>
                      </label>
                      {bracket2 ? (
                        <div className="mt-2 space-y-3 pl-4 border-l-2 border-indigo-500/30">
                          <RateSlider
                            id="policy-t2"
                            label={t("budget_policy_b2_threshold")}
                            min={Math.max(1000, nm + 100)}
                            max={6000}
                            step={100}
                            value={t2Eff}
                            defaultValue={T2_DEF}
                            onChange={setT2}
                            suffix=" €"
                          />
                          <RateSlider
                            id="policy-r2"
                            label={t("budget_policy_b2_rate")}
                            min={0}
                            max={30}
                            value={r2}
                            defaultValue={R2_DEF}
                            onChange={setR2}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div>
                <RateSlider
                  id="policy-corp"
                  label={t("budget_policy_corp")}
                  info={euInfo("corp", t("budget_policy_tip_corp"))}
                  min={0}
                  max={30}
                  value={corp}
                  defaultValue={CORP_DEF}
                  onChange={setCorp}
                />
                {euNoteLine("corp")}
              </div>
              <RateSlider
                id="policy-div"
                label={t("budget_policy_div")}
                tip={t("budget_policy_tip_div")}
                min={0}
                max={20}
                value={div}
                defaultValue={DIV_DEF}
                onChange={setDiv}
              />
            </div>

            {/* МОД cap */}
            <div className="border-t pt-3">
              <RateSlider
                id="policy-mod"
                label={t("budget_policy_mod", { cap: eur(currentCap) })}
                tip={t("budget_policy_tip_mod")}
                min={modMin}
                max={modMax}
                step={MOD_STEP}
                value={noCap ? modMax : mod}
                defaultValue={currentCap}
                onChange={(v) => {
                  setMod(v);
                  setNoCap(false);
                }}
                suffix=" €"
              />
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={noCap}
                  onChange={(e) => setNoCap(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span>{t("budget_policy_mod_nocap")}</span>
              </label>
            </div>

            {/* Expenditure side — pensions, administration, МРЗ */}
            <div className="border-t pt-3">
              {/* InfoTip renders its own <button>, so it must stay a sibling
                  of the toggle — nested buttons are invalid HTML. */}
              <div className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={expOpen}
                    onClick={() => setExpOpen((v) => !v)}
                    className="hover:text-foreground"
                  >
                    {t("budget_policy_exp_title")}
                  </button>
                  <InfoTip text={t("budget_policy_tip_exp")} />
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => setExpOpen((v) => !v)}
                  className="hover:text-foreground"
                >
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (expOpen ? "rotate-180" : "")
                    }
                  />
                </button>
              </div>
              {expOpen ? (
                <div className="mt-2 space-y-4">
                  <div>
                    <RateSlider
                      id="policy-pw"
                      label={t("budget_policy_swiss")}
                      info={euInfo("pw", t("budget_policy_tip_swiss"))}
                      min={0}
                      max={100}
                      step={10}
                      value={pw}
                      defaultValue={50}
                      onChange={setPw}
                    />
                    {euNoteLine("pw")}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={noSupp}
                      onChange={(e) => setNoSupp(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>{t("budget_policy_nosupp")}</span>
                    <InfoTip text={t("budget_policy_tip_nosupp")} />
                  </label>
                  <RateSlider
                    id="policy-ph"
                    label={t("budget_policy_horizon")}
                    min={1}
                    max={5}
                    value={ph}
                    defaultValue={1}
                    onChange={setPh}
                    suffix={" " + t("budget_policy_horizon_unit")}
                  />
                  <RateSlider
                    id="policy-adm"
                    label={t("budget_policy_admin")}
                    tip={t("budget_policy_tip_admin")}
                    min={0}
                    max={20}
                    value={adm}
                    defaultValue={0}
                    onChange={setAdm}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={mrzFreeze}
                      onChange={(e) => setMrzFreeze(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>
                      {t("budget_policy_mrz", {
                        cur: baseline.expenditure?.minWage.currentEur ?? 620,
                        next: baseline.expenditure?.minWage.formulaEur ?? "",
                      })}
                    </span>
                    <InfoTip text={t("budget_policy_tip_mrz")} />
                  </label>
                  {/* Defense target, % of GDP (NATO definition), in tenths */}
                  <div>
                    <RateSlider
                      id="policy-def"
                      label={t("budget_policy_def")}
                      info={euInfo("def", t("budget_policy_tip_def"))}
                      min={15}
                      max={50}
                      value={def}
                      defaultValue={22}
                      onChange={setDef}
                      formatValue={(v) => `${(v / 10).toFixed(1)}%`}
                    />
                    {euNoteLine("def")}
                  </div>
                  <RateSlider
                    id="policy-wi"
                    label={t("budget_policy_wi")}
                    tip={t("budget_policy_tip_wi")}
                    min={-5}
                    max={15}
                    value={wi}
                    defaultValue={0}
                    onChange={setWi}
                  />
                  {wi !== 0 ? (
                    <label className="flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={wex}
                        onChange={(e) => setWex(e.target.checked)}
                        className="accent-indigo-500"
                      />
                      <span>{t("budget_policy_wex")}</span>
                    </label>
                  ) : null}
                  <RateSlider
                    id="policy-kap"
                    label={t("budget_policy_kap")}
                    tip={t("budget_policy_tip_kap", {
                      rate: Math.round(
                        (baseline.expenditure?.capital.executionRate ?? 1) *
                          100,
                      ),
                    })}
                    min={-30}
                    max={30}
                    value={kap}
                    defaultValue={0}
                    onChange={setKap}
                  />
                  <div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={ssp}
                        onChange={(e) => setSsp(e.target.checked)}
                        className="accent-indigo-500"
                      />
                      <span>{t("budget_policy_ssp")}</span>
                      <InfoTip text={t("budget_policy_tip_ssp")} />
                    </label>
                    {ssp ? (
                      <label className="mt-1.5 flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={sspg}
                          onChange={(e) => setSspg(e.target.checked)}
                          className="accent-indigo-500"
                        />
                        <span>{t("budget_policy_sspg")}</span>
                      </label>
                    ) : null}
                  </div>
                  <RateSlider
                    id="policy-hp"
                    label={t("budget_policy_hp")}
                    tip={t("budget_policy_tip_hp")}
                    min={0}
                    max={3}
                    value={hp}
                    defaultValue={0}
                    onChange={setHp}
                    suffix={lang === "bg" ? " п.п." : " pp"}
                  />
                  {pensionFloor ? (
                    <RateSlider
                      id="policy-mp"
                      label={t("budget_policy_mp", {
                        cur: pensionFloor.minimumEur,
                      })}
                      tip={t("budget_policy_tip_mp")}
                      min={mpDef}
                      max={600}
                      step={10}
                      value={mpEff}
                      defaultValue={mpDef}
                      onChange={(v) => setMp(v === mpDef ? 0 : v)}
                      suffix=" €"
                    />
                  ) : null}
                  {teachers ? (
                    <RateSlider
                      id="policy-tp"
                      label={t("budget_policy_tp")}
                      tip={t("budget_policy_tip_tp")}
                      min={100}
                      max={140}
                      value={tpEff}
                      defaultValue={tpDef}
                      onChange={(v) => setTp(v === tpDef ? 0 : v)}
                    />
                  ) : null}
                  <div>
                    <RateSlider
                      id="policy-mat"
                      label={t("budget_policy_mat")}
                      info={euInfo("mat", t("budget_policy_tip_mat"))}
                      min={0}
                      max={MATERNITY_Y2_MONTHS}
                      value={mat}
                      defaultValue={MATERNITY_Y2_MONTHS}
                      onChange={setMat}
                      suffix={" " + t("budget_policy_mat_unit")}
                    />
                    {euNoteLine("mat")}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={mpf}
                      disabled={!baseline.expenditure}
                      onChange={(e) => setMpf(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>{t("budget_policy_mpf")}</span>
                    <InfoTip text={t("budget_policy_tip_mpf")} />
                  </label>
                  {/* Party subsidy in euro-cents per vote (the def/10 idiom:
                      integer state, fractional display). */}
                  <RateSlider
                    id="policy-psub"
                    label={t("budget_policy_psub")}
                    tip={t("budget_policy_tip_psub")}
                    min={0}
                    max={450}
                    step={25}
                    value={psub}
                    defaultValue={PSUB_DEF}
                    onChange={setPsub}
                    formatValue={(v) =>
                      (lang === "bg"
                        ? (v / 100).toFixed(2).replace(".", ",")
                        : (v / 100).toFixed(2)) + " €"
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("budget_policy_reset")}
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
                  ? t("budget_policy_share_done")
                  : t("budget_policy_share")}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* ============================ RESULTS =========================== */}
        <div className="space-y-4">
          {/* Hero figures */}
          {/* default grid stretch keeps same-row tiles equal height */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border px-3 py-2.5 bg-indigo-500/10 border-indigo-500/30">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                {t("budget_policy_hero_total")}
                <InfoTip
                  text={t("budget_policy_tip_total", {
                    year: baseline.baselineYear,
                  })}
                />
              </div>
              <div className="text-xl md:text-2xl font-bold tabular-nums leading-tight text-indigo-700 dark:text-indigo-300">
                {fmtDelta(scenario.central, lang)}
                <span className="text-sm font-medium">
                  {" "}
                  / {t("budget_policy_per_year")}
                </span>
              </div>
              {modUncertain ? (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {t("budget_policy_hero_range", {
                    low: fmtDelta(scenario.low, lang),
                    high: fmtDelta(scenario.high, lang),
                  })}
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border px-3 py-2.5 bg-card border-border">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("budget_policy_hero_gdp")}
              </div>
              <div className="text-xl md:text-2xl font-bold tabular-nums leading-tight">
                {(pctGdp >= 0 ? "+" : "−") +
                  new Intl.NumberFormat(locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(Math.abs(pctGdp))}
                %
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("budget_policy_hero_gdp_sub", {
                  pct: new Intl.NumberFormat(locale, {
                    maximumFractionDigits: 1,
                  }).format(
                    (scenario.central / baseline.revenue.totalRevenueEur) * 100,
                  ),
                })}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {heroDeficitLine}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2.5 bg-card border-border">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" />
                {t("budget_policy_hero_citizen")}
              </div>
              <div
                className={
                  "text-xl md:text-2xl font-bold tabular-nums leading-tight " +
                  (citizen.totalDelta > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : citizen.totalDelta < 0
                      ? "text-red-700 dark:text-red-400"
                      : "")
                }
              >
                {(citizen.totalDelta >= 0 ? "+" : "−") +
                  eur(Math.abs(citizen.totalDelta))}
                <span className="text-sm font-medium">
                  {" "}
                  / {t("budget_policy_per_month")}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("budget_policy_hero_citizen_sub", { gross: eur(gross) })}
              </div>
            </div>
          </div>

          {/* Per-tax breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-4 w-4" />
                {t("budget_policy_breakdown_title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {anyChange ? (
                <ul className="space-y-2.5">
                  <DeltaRow
                    label={t("budget_policy_row_vat")}
                    deltaEur={scenario.vatDelta}
                    maxAbs={maxAbs}
                    lang={lang}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_pit")}
                    deltaEur={scenario.pitDelta}
                    maxAbs={maxAbs}
                    lang={lang}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_corp")}
                    deltaEur={scenario.corpDelta}
                    maxAbs={maxAbs}
                    lang={lang}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_div")}
                    deltaEur={scenario.divDelta}
                    maxAbs={maxAbs}
                    lang={lang}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_mod")}
                    tip={t("budget_policy_tip_mod_row")}
                    deltaEur={scenario.modRes.centralEur}
                    maxAbs={maxAbs}
                    lang={lang}
                    sub={
                      modUncertain
                        ? `(${fmtDelta(scenario.modRes.lowEur, lang)} … ${fmtDelta(scenario.modRes.highEur, lang)})`
                        : undefined
                    }
                  />
                  {scenario.pensionBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_pensions")}
                      deltaEur={scenario.pensionBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.adminRes ? (
                    <DeltaRow
                      label={t("budget_policy_row_admin")}
                      deltaEur={scenario.adminBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={t("budget_policy_admin_note", {
                        vac: Math.round(
                          scenario.adminRes.vacantAbsorbedShare * 100,
                        ),
                      })}
                    />
                  ) : null}
                  {scenario.mwDelta !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mrz")}
                      deltaEur={scenario.mwDelta}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.defBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_def")}
                      deltaEur={scenario.defBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.wiBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_wi")}
                      deltaEur={scenario.wiBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={wex ? t("budget_policy_wi_note") : undefined}
                    />
                  ) : null}
                  {scenario.kapBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_kap")}
                      deltaEur={scenario.kapBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={t("budget_policy_kap_note", {
                        rate: Math.round(
                          (baseline.expenditure?.capital.executionRate ?? 1) *
                            100,
                        ),
                      })}
                    />
                  ) : null}
                  {scenario.sspBalance !== 0 || (ssp && sspg) ? (
                    <DeltaRow
                      label={t("budget_policy_row_ssp")}
                      deltaEur={scenario.sspBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={sspg ? t("budget_policy_ssp_note") : undefined}
                    />
                  ) : null}
                  {scenario.hpDelta !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_hp")}
                      deltaEur={scenario.hpDelta}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.mpBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mp")}
                      tip={t("budget_policy_tip_mp")}
                      deltaEur={scenario.mpBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.tpBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_tp")}
                      tip={t("budget_policy_tip_tp")}
                      deltaEur={scenario.tpBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.matBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mat")}
                      tip={t("budget_policy_tip_mat")}
                      deltaEur={scenario.matBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.mpfBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mpf")}
                      tip={t("budget_policy_tip_mpf")}
                      deltaEur={scenario.mpfBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.psubBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_psub")}
                      tip={t("budget_policy_tip_psub")}
                      deltaEur={scenario.psubBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("budget_policy_no_change")}
                </p>
              )}
              {comparator ? (
                <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                  {t("budget_policy_comparator", {
                    health: new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(comparator.healthPct),
                    education: new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(comparator.educationPct),
                    year: comparator.year,
                  })}
                </p>
              ) : null}
              <p className="mt-3 text-[11px] text-muted-foreground/80">
                {t("budget_policy_baseline_note", {
                  year: baseline.baselineYear,
                  vat: fmtCompactEur(baseline.revenue.vatEur, lang),
                  pit: fmtCompactEur(baseline.revenue.pitEur, lang),
                })}
              </p>
            </CardContent>
          </Card>

          {/* Multi-year balance & debt projection */}
          <PolicyFiscalProjection
            projection={projection}
            anyChange={anyChange}
            lang={lang}
            locale={locale}
          />

          {/* Scenario summary sentence */}
          {sentence ? (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm">{sentence}</p>
                  <button
                    type="button"
                    onClick={onCopySentence}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {sentenceCopied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {sentenceCopied
                      ? t("budget_policy_share_done")
                      : t("budget_policy_sentence_copy")}
                  </button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Winners and losers across the wage distribution */}
          {distribution && distribution.anyVisible ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {t("budget_policy_incidence_title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PolicyIncidenceCurve
                  points={distribution.points}
                  locale={locale}
                  capEur={noCap ? undefined : mod}
                />
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {t("budget_policy_incidence_caption")}
                  {Math.abs(distribution.giniAfter - distribution.giniBefore) >=
                  0.0005
                    ? " " +
                      t("budget_policy_gini", {
                        before: new Intl.NumberFormat(locale, {
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        }).format(distribution.giniBefore),
                        after: new Intl.NumberFormat(locale, {
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        }).format(distribution.giniAfter),
                      })
                    : ""}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Citizen pane */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                {t("budget_policy_citizen_title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div>
                <label
                  htmlFor="policy-gross"
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {t("budget_policy_citizen_gross")}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {eur(gross)}
                  </span>
                </label>
                <input
                  id="policy-gross"
                  type="range"
                  min={500}
                  max={8000}
                  step={100}
                  value={gross}
                  onChange={(e) => setGross(Number(e.target.value))}
                  className="mt-1.5 w-full accent-indigo-500"
                  aria-label={t("budget_policy_citizen_gross")}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="text-muted-foreground">
                    {t("budget_policy_citizen_net")}
                  </div>
                  <div className="font-semibold tabular-nums">
                    {(citizen.netDelta >= 0 ? "+" : "−") +
                      eur(Math.abs(citizen.netDelta))}
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="text-muted-foreground">
                    {t("budget_policy_citizen_vat")}
                  </div>
                  <div className="font-semibold tabular-nums">
                    {(citizen.vatDelta > 0 ? "−" : "+") +
                      eur(Math.abs(citizen.vatDelta))}
                  </div>
                </div>
                <div className="rounded-md bg-indigo-500/10 px-2 py-1.5 ring-1 ring-indigo-500/20">
                  <div className="text-muted-foreground">
                    {t("budget_policy_citizen_total")}
                  </div>
                  <div className="font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                    {(citizen.totalDelta >= 0 ? "+" : "−") +
                      eur(Math.abs(citizen.totalDelta))}
                  </div>
                </div>
              </div>
              <div className="mt-3 border-t pt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("budget_policy_exemplars_title")}
                </div>
                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {citizen.exemplars.map((ex) => (
                    <div
                      key={ex.gross}
                      className="rounded-md bg-muted/40 px-2 py-1.5"
                    >
                      <div className="text-muted-foreground tabular-nums">
                        {eur(ex.gross)}
                      </div>
                      <div
                        className={
                          "font-semibold tabular-nums " +
                          (ex.totalDelta > 0.5
                            ? "text-emerald-700 dark:text-emerald-400"
                            : ex.totalDelta < -0.5
                              ? "text-red-700 dark:text-red-400"
                              : "")
                        }
                      >
                        {(ex.totalDelta >= 0 ? "+" : "−") +
                          eur(Math.abs(ex.totalDelta))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                {t("budget_policy_citizen_caption")}
              </p>
            </CardContent>
          </Card>

          {/* Method + caveats */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1.5">
                  <p>{t("budget_policy_caveat_static")}</p>
                  <p>{t("budget_policy_caveat_corp")}</p>
                  <p>
                    {t("budget_policy_caveat_vat", {
                      factor: baseline.vat.factor.toFixed(2),
                      years: `${baseline.vat.calibration[0]?.year}–${baseline.vat.calibration[baseline.vat.calibration.length - 1]?.year}`,
                    })}
                  </p>
                  <p>
                    {t("budget_policy_caveat_mod", {
                      year: baseline.modIdentity.year,
                    })}
                  </p>
                  <p>
                    {t("budget_policy_caveat_brackets", {
                      wave: baseline.earnings.sesWave,
                      kappa: baseline.earnings.kappaIdentityYear.toFixed(2),
                    })}
                  </p>
                  <p>{t("budget_policy_caveat_exp")}</p>
                  <p>{t("budget_policy_caveat_multiplier")}</p>
                </div>
              </div>
              {benchmarks ? (
                <div className="mt-3 border-t pt-2">
                  <button
                    type="button"
                    aria-expanded={benchOpen}
                    onClick={() => setBenchOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <span>{t("budget_policy_bench_title")}</span>
                    <ChevronDown
                      className={
                        "h-3.5 w-3.5 transition-transform " +
                        (benchOpen ? "rotate-180" : "")
                      }
                    />
                  </button>
                  {benchOpen ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        {t("budget_policy_bench_intro")}
                      </p>
                      <table className="w-full text-[11px] tabular-nums">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="py-1 pr-2 font-normal" />
                            <th className="py-1 pr-2 font-normal text-right">
                              {t("budget_policy_bench_model")}
                            </th>
                            <th className="py-1 font-normal text-right">
                              {t("budget_policy_bench_published")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {benchmarks.map((b) => (
                            <tr
                              key={b.key}
                              className="border-t border-border/60"
                            >
                              <td className="py-1 pr-2">
                                {t(`budget_policy_bench_${b.key}`)}
                              </td>
                              <td className="py-1 pr-2 text-right font-medium">
                                {fmtDelta(b.ours, lang)}
                              </td>
                              <td className="py-1 text-right text-muted-foreground">
                                {t(`budget_policy_bench_${b.key}_pub`)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky mobile result bar — on small screens the controls are a long
          scroll above the results, so the headline numbers follow along once
          a scenario deviates from current law. */}
      {anyChange ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 py-2 lg:hidden">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("budget_policy_hero_total")}
              </div>
              <div className="font-bold tabular-nums text-sm text-indigo-700 dark:text-indigo-300">
                {fmtDelta(scenario.central, lang)} /{" "}
                {t("budget_policy_per_year")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("budget_policy_hero_citizen")}
              </div>
              <div
                className={
                  "font-bold tabular-nums text-sm " +
                  (citizen.totalDelta > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : citizen.totalDelta < 0
                      ? "text-red-700 dark:text-red-400"
                      : "")
                }
              >
                {(citizen.totalDelta >= 0 ? "+" : "−") +
                  eur(Math.abs(citizen.totalDelta))}{" "}
                / {t("budget_policy_per_month")}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
