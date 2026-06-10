// simulateTaxChange — "какво става ако ДДС стане 22%" / "what if income tax
// goes to 15%" → the budget policy simulator's scoring engine, in chat form.
//
// The math is NOT re-derived here: it imports the same pure scoring module the
// /budget/simulator screen uses (src/lib/bgTaxPolicy.ts over the offline
// baseline data/budget/derived/policy_baseline.json) and mirrors the `scenario`
// useMemo of src/screens/components/budget/BudgetPolicySimulator.tsx step by
// step — so the chat's Δ ALWAYS equals the simulator's headline for the same
// scenario. Anything that must stay in sync with that component (slider
// defaults/bounds, the МОД grid, the minimum-wage preset) is mirrored as a
// named constant with a pointer back to the source of truth.
//
// v1 scope: ONE primary change per question —
//   ДДС стандартна ставка X% · ДДС върху категория (храни/лекарства/енергия/
//   ресторанти/хотели/книги) → намалена/нулева/стандартна · плосък ДДФЛ X% ·
//   необлагаем минимум €X (или "= минималната заплата") · корпоративен данък
//   X% · данък върху дивидентите X% · МОД таван €X или "премахване на тавана".

import {
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  PIT_RATE,
  VAT_STANDARD_RATE,
  resolveMod,
} from "../../src/lib/bgTax";
import {
  VAT_GROUP_DEFAULT_REGIME,
  VAT_REDUCED_RATE,
  computeVatRevenue,
  scoreCorporate,
  scoreDividend,
  scoreModCap,
  scoreModCapBands,
  scorePitSchedule,
  type PitBracket,
  type VatAdjustableGroup,
  type VatBaseSlice,
  type VatPolicy,
  type VatRegime,
} from "../../src/lib/bgTaxPolicy";
import type { PolicyBaselineFile } from "../../src/data/budget/types";
import { fetchData } from "./dataClient";
import type { Envelope, Lang, ToolArgs, ToolContext } from "./types";

// ---------------------------------------------------------------------------
// Constants mirrored from BudgetPolicySimulator.tsx (slider defaults + bounds
// + the МОД grid + the minimum-wage preset). Change them THERE first.
// ---------------------------------------------------------------------------
const VAT_STD_DEF = Math.round(VAT_STANDARD_RATE * 100); // 20
const VAT_RED_DEF = Math.round(VAT_REDUCED_RATE * 100); // 9
const PIT_DEF = Math.round(PIT_RATE * 100); // 10
const CORP_DEF = Math.round(CORP_TAX_RATE * 100); // 10
const DIV_DEF = Math.round(DIVIDEND_TAX_RATE * 100); // 5
const NM_MAX = 1200;
const MOD_STEP = 50;
const MOD_STEPS_DOWN = 18; // slider floor ≈ €900 below the current cap
const MOD_STEPS_UP = 78; // slider ceiling ≈ €3,900 above the current cap
// The "необлагаем минимум = минималната заплата" preset (nm_mrz) value.
const MIN_WAGE_EUR = 620;

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(n)));

// ---------------------------------------------------------------------------
// Question → TaxChange detection (also the router's gate: a `undefined` means
// "not a tax-policy what-if, let the other tools have it").
// ---------------------------------------------------------------------------

export type TaxChange =
  | { kind: "vatStandard"; pct: number }
  | { kind: "vatCategory"; group: VatAdjustableGroup; regime: VatRegime }
  | { kind: "pitFlat"; pct: number }
  | { kind: "untaxedMin"; nmEur: number }
  | { kind: "corporate"; pct: number }
  | { kind: "dividend"; pct: number }
  | { kind: "modCap"; capEur: number | null }; // null = премахване на тавана

const has = (q: string, ...words: string[]): boolean =>
  words.some((w) => q.includes(w));

// Whole-token check (JS \b is unreliable around Cyrillic) — used for the short
// "мод" instrument so it can't fire inside "модел"/"мода".
const hasToken = (q: string, ...tokens: string[]): boolean => {
  const toks = q.split(/[^a-zа-яё0-9%€-]+/i).filter(Boolean);
  return tokens.some((t) => toks.includes(t));
};

// A what-if / change / fiscal-cost framing. Required when the question carries
// no explicit % target, so bare mentions ("колко е данъкът върху доходите")
// keep falling through to the existing tools.
const CHANGE_CUES = [
  "какво става",
  "какво ще стане",
  "какво би",
  "ако ",
  "what if",
  "what happens",
  "what would",
  "колко струва",
  "колко би струвал",
  "колко ще струва",
  "how much would",
  "how much does",
  "how much is the cost",
  "cost of",
  "fiscal cost",
  "стане",
  "вдигн",
  "повиш",
  "увелич",
  "качи",
  "намал",
  "свали",
  "смъкн",
  "падне",
  "въвед",
  "премах", // премахне / премахнем / премахване
  "махне",
  "отпадн",
  "отмен",
  "raise",
  "raising",
  "increase",
  "hike",
  "cut",
  "lower",
  "reduc",
  "drop",
  "goes to",
  "go to",
  "went to",
  "set to",
  "becomes",
  "introduc",
  "remov",
  "abolish",
  "scrap",
];
const hasChangeCue = (q: string): boolean => has(q, ...CHANGE_CUES);

// instrument token sets ------------------------------------------------------
const VAT_WORDS = [
  "ддс",
  "vat",
  "добавена стойност",
  "добавената стойност",
  "value added tax",
  "value-added tax",
];
const PIT_WORDS = [
  "ддфл",
  "подоход",
  "данък общ доход",
  "общия доход",
  "данък върху доходите",
  "данъка върху доходите",
  "плосък данък",
  "плоския данък",
  "плосък данъчен",
  "income tax",
  "flat tax",
];
const NM_WORDS = [
  "необлагаем",
  "untaxed minimum",
  "untaxed income",
  "tax-free minimum",
  "tax free minimum",
  "tax-free allowance",
  "tax-free threshold",
];
const CORP_WORDS = ["корпоратив", "corporate tax", "corporation tax"];
const DIV_WORDS = ["дивидент", "dividend"];
const MIN_WAGE_WORDS = [
  "минимална заплата",
  "минималната заплата",
  "минималната работна заплата",
  "мрз",
  "minimum wage",
];
// МОД / осигурителен таван context. "мод"/"mod" only as a whole token.
const modContext = (q: string): boolean =>
  has(
    q,
    "максимален осигурителен",
    "максималния осигурителен",
    "максималният осигурителен",
    "осигурителен таван",
    "осигурителния таван",
    "осигурителният таван",
    "maximum insurable",
    "insurable income cap",
    "insurance income cap",
    "contribution ceiling",
    "social-security cap",
    "social security cap",
    "ssc cap",
  ) ||
  (has(q, "таван") && has(q, "осигур")) ||
  hasToken(q, "мод");
const NO_CAP_CUES = [
  "премах", // премахне / премахнем / премахване
  "махне",
  "махнем",
  "отпадн",
  "отмен",
  "без таван",
  "no cap",
  "remove",
  "removing",
  "abolish",
  "scrap",
  "without a cap",
  "uncap",
];

const VAT_CATEGORY_TOKENS: [VatAdjustableGroup, string[]][] = [
  ["food", ["храни", "хранит", "хляб", "food", "groceries"]],
  ["medicines", ["лекарств", "медикамент", "medicine", "drug"]],
  [
    "energy",
    ["енерги", "ток", "парно", "отоплени", "energy", "electricity", "heating"],
  ],
  [
    "restaurants",
    ["ресторант", "заведени", "кетъринг", "restaurant", "catering"],
  ],
  ["hotels", ["хотел", "нощувк", "настаняван", "hotel", "accommodation"]],
  ["books", ["книг", "учебниц", "book"]],
];

// First explicit percent in the question ("22%", "22 процента", "22 на сто").
const parsePct = (q: string): number | undefined => {
  const m = q.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:%|процент|на сто|percent)/);
  return m ? Math.round(parseFloat(m[1].replace(",", "."))) : undefined;
};

// First explicit euro amount ("620 €", "620 евро", "€620").
const parseEur = (q: string): number | undefined => {
  const m =
    q.match(/(\d{2,6})\s*(?:€|евро|eur\b|euros?\b)/) ??
    q.match(/€\s*(\d{2,6})/);
  return m ? parseInt(m[1], 10) : undefined;
};

// First bare number — accepted only alongside a change cue, range-checked by
// the caller (so "стане 22" works without the % sign).
const parseBareNumber = (q: string): number | undefined => {
  const m = q.match(/\b(\d{1,6})(?:[.,]\d+)?\b/);
  return m ? parseInt(m[1], 10) : undefined;
};

/** Parse a question into the ONE primary policy change it asks about, or
 *  undefined when it isn't a tax-policy what-if (the router's gate). */
export const detectTaxChange = (question: string): TaxChange | undefined => {
  const q = question.toLowerCase();
  const cue = hasChangeCue(q);
  const pct = parsePct(q);
  const eur = parseEur(q);
  const bare = parseBareNumber(q);

  // 1. МОД cap removal — "премахване на тавана (на осигурителния доход)",
  // "no cap on social security". The bare "премахване на тавана" reading is
  // accepted: in the Bulgarian fiscal debate "таванът" IS the МОД cap.
  if (
    has(q, ...NO_CAP_CUES) &&
    (modContext(q) || (has(q, "таван") && !has(q, "пенси")))
  )
    return { kind: "modCap", capEur: null };

  // 2. VAT on a category — needs the VAT word + a category word, plus a
  // target: a %, a change cue, or an explicit regime word ("zero VAT on
  // medicines", "нулева ставка за храните").
  if (has(q, ...VAT_WORDS)) {
    const cat = VAT_CATEGORY_TOKENS.find(([, toks]) => has(q, ...toks));
    const regimeCue = has(
      q,
      "нулев",
      "zero",
      "без ддс",
      "стандартн",
      "standard",
      "намален",
      "reduced",
    );
    if (cat && (pct !== undefined || cue || regimeCue)) {
      const regime: VatRegime =
        pct !== undefined
          ? pct <= 0
            ? "zero"
            : pct < VAT_STD_DEF
              ? "reduced"
              : "standard"
          : has(q, "нулев", "zero", "0%", "премахн", "махне", "без ддс")
            ? "zero"
            : has(q, "стандартн", "върне", "standard", "back to")
              ? "standard"
              : "reduced";
      return { kind: "vatCategory", group: cat[0], regime };
    }
    // 3. VAT standard rate — explicit % wins; a bare number needs a cue.
    if (pct !== undefined) return { kind: "vatStandard", pct };
    if (cue && bare !== undefined && bare >= 5 && bare <= 30)
      return { kind: "vatStandard", pct: bare };
  }

  // 4. Untaxed minimum — amount from €/bare number/"= минималната заплата";
  // a cost/what-if framing with no amount defaults to the МРЗ preset (620).
  if (has(q, ...NM_WORDS)) {
    const amount =
      eur ??
      (has(q, ...MIN_WAGE_WORDS) ? MIN_WAGE_EUR : undefined) ??
      (bare !== undefined && bare >= 50 && bare <= NM_MAX ? bare : undefined);
    if (amount !== undefined) return { kind: "untaxedMin", nmEur: amount };
    if (cue) return { kind: "untaxedMin", nmEur: MIN_WAGE_EUR };
  }

  // 5. Flat ДДФЛ
  if (has(q, ...PIT_WORDS)) {
    if (pct !== undefined) return { kind: "pitFlat", pct };
    if (cue && bare !== undefined && bare <= 30)
      return { kind: "pitFlat", pct: bare };
  }

  // 6. Corporate ("данък печалба" needs the данък/tax pairing so a generic
  // "печалба" question can't fire).
  if (
    has(q, ...CORP_WORDS) ||
    (has(q, "печалб") && has(q, "данък", "данъц", "tax"))
  ) {
    if (pct !== undefined) return { kind: "corporate", pct };
    if (cue && bare !== undefined && bare <= 30)
      return { kind: "corporate", pct: bare };
  }

  // 7. Dividend
  if (has(q, ...DIV_WORDS)) {
    if (pct !== undefined) return { kind: "dividend", pct };
    if (cue && bare !== undefined && bare <= 20)
      return { kind: "dividend", pct: bare };
  }

  // 8. МОД cap to an amount — "МОД 3000 €", "вдигане на тавана на 2500 евро".
  if (modContext(q)) {
    const cap = resolveMod(null).mod;
    // Bare numbers need a change cue and must not look like a year —
    // realistic cap values overlap 2024-2026, and a definitional
    // "таванът за 2025" is not a what-if (FINDING-001).
    const looksLikeYear = bare !== undefined && bare >= 2000 && bare <= 2099;
    const amount =
      eur ??
      (cue &&
      bare !== undefined &&
      !looksLikeYear &&
      bare >= cap - MOD_STEPS_DOWN * MOD_STEP &&
      bare <= cap + MOD_STEPS_UP * MOD_STEP
        ? bare
        : undefined);
    if (amount !== undefined) return { kind: "modCap", capEur: amount };
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Scoring — an EXACT mirror of the `scenario` useMemo in
// BudgetPolicySimulator.tsx, with every control at its current-law default
// except the one change (so the sum is the simulator's headline number).
// ---------------------------------------------------------------------------

interface ScenarioParams {
  vatStd: number;
  regimes: Partial<Record<VatAdjustableGroup, VatRegime>>;
  pit: number;
  nm: number;
  corp: number;
  div: number;
  mod: number;
  noCap: boolean;
}

const paramsFor = (change: TaxChange, currentCap: number): ScenarioParams => {
  const p: ScenarioParams = {
    vatStd: VAT_STD_DEF,
    regimes: {},
    pit: PIT_DEF,
    nm: 0,
    corp: CORP_DEF,
    div: DIV_DEF,
    mod: currentCap,
    noCap: false,
  };
  // Clamp to the simulator's own URL-param bounds (clampIntParam calls in
  // BudgetPolicySimulator.tsx) so the chat number equals what the deep link
  // will show after the simulator clamps the same way.
  switch (change.kind) {
    case "vatStandard":
      p.vatStd = clamp(change.pct, 10, 27);
      break;
    case "vatCategory":
      if (change.regime !== VAT_GROUP_DEFAULT_REGIME[change.group])
        p.regimes[change.group] = change.regime;
      break;
    case "pitFlat":
      p.pit = clamp(change.pct, 0, 30);
      break;
    case "untaxedMin":
      p.nm = clamp(change.nmEur, 0, NM_MAX);
      break;
    case "corporate":
      p.corp = clamp(change.pct, 0, 30);
      break;
    case "dividend":
      p.div = clamp(change.pct, 0, 20);
      break;
    case "modCap":
      if (change.capEur === null) p.noCap = true;
      else
        p.mod = clamp(
          change.capEur,
          currentCap - MOD_STEPS_DOWN * MOD_STEP,
          currentCap + MOD_STEPS_UP * MOD_STEP,
        );
      break;
  }
  return p;
};

export interface ScenarioScore {
  vatDelta: number;
  pitDelta: number;
  corpDelta: number;
  divDelta: number;
  modCentral: number;
  central: number;
  low: number;
  high: number;
}

// Exported so the harness can score a change directly against the golden
// simulator numbers (the parity gate).
export const scoreScenario = (
  baseline: PolicyBaselineFile,
  change: TaxChange,
): ScenarioScore => {
  const currentCap = resolveMod(null).mod;
  const { vatStd, regimes, pit, nm, corp, div, mod, noCap } = paramsFor(
    change,
    currentCap,
  );

  const slices = baseline.vat.slices as VatBaseSlice[];
  const currentPolicy: VatPolicy = {
    standardRate: VAT_STANDARD_RATE,
    reducedRate: VAT_REDUCED_RATE,
    regimes: {},
  };
  const policy: VatPolicy = {
    standardRate: vatStd / 100,
    reducedRate: VAT_RED_DEF / 100,
    regimes,
  };
  const vatBaseRun = computeVatRevenue(slices, currentPolicy);
  const vatRun = computeVatRevenue(slices, policy);
  const vatDelta =
    (vatRun.modeledEur - vatBaseRun.modeledEur) * baseline.vat.factor;

  const brackets: PitBracket[] = [];
  if (nm > 0) brackets.push({ fromEur: 0, rate: 0 });
  brackets.push({ fromEur: nm, rate: pit / 100 });
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

  const central =
    vatDelta + pitDelta + corpDelta + divDelta + modRes.centralEur;
  const low =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    Math.min(modRes.lowEur, modRes.highEur);
  const high =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    Math.max(modRes.lowEur, modRes.highEur);

  return {
    vatDelta,
    pitDelta,
    corpDelta,
    divDelta,
    modCentral: modRes.centralEur,
    central,
    low,
    high,
  };
};

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

// Signed compact money — copied verbatim from BudgetPolicySimulator.tsx
// `fmtDelta` so the chat shows the same "+447 млн €" the simulator hero does.
const fmtDelta = (v: number, lang: Lang): string => {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  // (sign neutralized below when the rounded magnitude is zero)
  const a = Math.abs(v);
  const raw =
    a >= 995e6 ? (a / 1e9).toFixed(1) : a >= 1e6 ? (a / 1e6).toFixed(0) : "0";
  const num = lang === "bg" ? raw.replace(".", ",") : raw;
  const unit =
    a >= 995e6
      ? lang === "bg"
        ? "млрд €"
        : "B"
      : lang === "bg"
        ? "млн €"
        : "M";
  const sgn = num === "0" ? "±" : sign;
  return lang === "bg" ? `${sgn}${num} ${unit}` : `${sgn}€${num}${unit}`;
};

// Mirrors the simulator's budget_policy_group_* i18n labels.
const GROUP_LABELS: Record<VatAdjustableGroup, { bg: string; en: string }> = {
  food: { bg: "Храни", en: "Food" },
  medicines: { bg: "Лекарства", en: "Medicines" },
  energy: { bg: "Енергия за домакинствата", en: "Household energy" },
  restaurants: { bg: "Ресторанти и кетъринг", en: "Restaurants & catering" },
  hotels: { bg: "Хотелско настаняване", en: "Hotel accommodation" },
  books: { bg: "Книги и преса", en: "Books & press" },
};

const regimeLabel = (regime: VatRegime, lang: Lang): string =>
  regime === "zero"
    ? lang === "bg"
      ? "нулева ставка (0%)"
      : "zero rate (0%)"
    : regime === "reduced"
      ? lang === "bg"
        ? `намалена ставка (${VAT_RED_DEF}%)`
        : `reduced rate (${VAT_RED_DEF}%)`
      : lang === "bg"
        ? `стандартна ставка (${VAT_STD_DEF}%)`
        : `standard rate (${VAT_STD_DEF}%)`;

// One human label per change, mirroring the simulator's budget_policy_frag_*
// wording so the chat and the page describe the scenario identically.
const changeLabel = (
  change: TaxChange,
  p: ScenarioParams,
  currentCap: number,
  lang: Lang,
): string => {
  const bg = lang === "bg";
  switch (change.kind) {
    case "vatStandard":
      return bg ? `ДДС ${p.vatStd}%` : `VAT ${p.vatStd}%`;
    case "vatCategory": {
      const g = GROUP_LABELS[change.group][lang];
      return bg
        ? `${g} → ${regimeLabel(change.regime, lang)} ДДС`
        : `${g} → ${regimeLabel(change.regime, lang)} VAT`;
    }
    case "pitFlat":
      return bg ? `ДДФЛ ${p.pit}%` : `income tax ${p.pit}%`;
    case "untaxedMin":
      return bg
        ? `необлагаем минимум €${p.nm}/мес.`
        : `untaxed minimum €${p.nm}/mo`;
    case "corporate":
      return bg ? `корпоративен данък ${p.corp}%` : `corporate tax ${p.corp}%`;
    case "dividend":
      return bg
        ? `данък върху дивидентите ${p.div}%`
        : `dividend tax ${p.div}%`;
    case "modCap":
      if (p.noCap) return bg ? "без таван МОД" : "no МОД cap";
      return bg
        ? `таван МОД €${p.mod} (сега €${currentCap})`
        : `МОД cap €${p.mod} (now €${currentCap})`;
  }
};

// Deep-link query string — the exact params the simulator's URL-mirror effect
// writes for the same scenario (defaults are omitted there too).
const scenarioQuery = (p: ScenarioParams, currentCap: number): string => {
  const parts: string[] = [];
  if (p.vatStd !== VAT_STD_DEF) parts.push(`dds=${p.vatStd}`);
  for (const [g, r] of Object.entries(p.regimes)) parts.push(`${g}=${r}`);
  if (p.pit !== PIT_DEF) parts.push(`pit=${p.pit}`);
  if (p.nm !== 0) parts.push(`nm=${p.nm}`);
  if (p.corp !== CORP_DEF) parts.push(`corp=${p.corp}`);
  if (p.div !== DIV_DEF) parts.push(`div=${p.div}`);
  if (p.noCap) parts.push("nocap=1");
  else if (p.mod !== currentCap) parts.push(`mod=${p.mod}`);
  return parts.join("&");
};

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export const simulateTaxChange = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const question = String(args.change ?? "");
  const change = detectTaxChange(question);
  if (!change) {
    return {
      tool: "simulateTaxChange",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Не разпознах данъчна промяна"
        : "I couldn't read a tax change",
      subtitle: bg
        ? "Пример: „Какво става, ако ДДС стане 22%?“ или „Колко струва необлагаем минимум от 620 €?“"
        : 'Try: "What if VAT goes to 22%?" or "What if income tax goes to 15%?"',
      viz: "none",
      facts: {},
      provenance: ["budget/derived/policy_baseline.json"],
    };
  }

  const baseline = await fetchData<PolicyBaselineFile>(
    "/budget/derived/policy_baseline.json",
  );
  const currentCap = resolveMod(null).mod;
  const p = paramsFor(change, currentCap);
  const score = scoreScenario(baseline, change);
  const label = changeLabel(change, p, currentCap, ctx.lang);
  const locale = bg ? "bg-BG" : "en-US";
  const pctGdp = (score.central / baseline.gdpEur) * 100;
  const pctGdpStr = `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(pctGdp)}%`;

  const facts: Record<string, string | number> = {
    change: label,
    delta_per_year: fmtDelta(score.central, ctx.lang),
    share_of_gdp: pctGdpStr,
    baseline_year: baseline.baselineYear,
  };
  // МОД scenarios carry a real uncertainty band (Pareto tail α) — surface it.
  if (Math.abs(score.high - score.low) > 1e6)
    facts.range = `${fmtDelta(score.low, ctx.lang)} … ${fmtDelta(score.high, ctx.lang)}`;
  // A no-op (the asked regime is already current law) — say so honestly.
  if (
    change.kind === "vatCategory" &&
    change.regime === VAT_GROUP_DEFAULT_REGIME[change.group]
  )
    facts.note = bg
      ? "Това е действащият режим — без промяна в приходите."
      : "That is already current law — no revenue change.";

  // hidden deep-link payload (keys ending in _id are not rendered as facts)
  const qs = scenarioQuery(p, currentCap);
  facts.scenario_id = qs;

  return {
    tool: "simulateTaxChange",
    domain: "fiscal",
    kind: "scalar",
    title: bg ? `Какво става, ако: ${label}` : `What if: ${label}`,
    subtitle: bg
      ? `Статична оценка на база изпълнението за ${baseline.baselineYear} — без поведенчески реакции.`
      : `Static estimate on the ${baseline.baselineYear} execution base — no behavioral response.`,
    viz: "none",
    value: Math.round(score.central),
    valueFormat: "int",
    facts,
    provenance: ["budget/derived/policy_baseline.json"],
  };
};
