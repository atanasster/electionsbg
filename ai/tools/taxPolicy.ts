// simulateTaxChange — "какво става ако ДДС стане 22%" / "what if income tax
// goes to 15%" → the budget policy simulator's scoring engine, in chat form.
//
// The math is NOT re-derived here: it imports the same pure scoring modules
// the /budget/simulator screen uses (src/lib/bgTaxPolicy.ts static +
// src/lib/bgBehavioral.ts dynamic, over the offline baseline
// data/budget/derived/policy_baseline.json) and mirrors the `scenario` +
// `dynamicScenario` useMemos of
// src/screens/components/budget/BudgetPolicySimulator.tsx step by step — so
// the chat's Δ ALWAYS equals the simulator's headline for the same scenario.
// The screen's DEFAULT is the dynamic (behavioral) estimate, so the chat
// leads with it and carries the static figure as a fact. Anything that must
// stay in sync with that component (slider defaults/bounds, the МОД grid,
// the minimum-wage preset) is mirrored as a named constant with a pointer
// back to the source of truth.
//
// v1 scope: ONE primary change per question —
//   ДДС стандартна ставка X% · ДДС върху категория (храни/лекарства/енергия/
//   ресторанти/хотели/книги) → намалена/нулева/стандартна · плосък ДДФЛ X% ·
//   необлагаем минимум €X (или "= минималната заплата") · корпоративен данък
//   X% · данък върху дивидентите X% · МОД таван €X или "премахване на тавана".
// Expenditure levers (Phase 4, same screen): индексация на пенсиите с X%
//   тежест на инфлацията · ковид добавката не се индексира · съкращаване на
//   администрацията с X% · замразяване на МРЗ. Their Δ is on the budget
//   BALANCE (positive = the balance improves), the screen's convention.
// Phase-5 levers (same screen, same balance convention): отбрана X% от БВП
//   (НАТО дефиниция, спрямо прогнозния БВП) · заплати в публичния сектор ±X%
//   (изключените сектори остават по пътя си) · капиталов план ±X% (касово,
//   през историческата изпълняемост) · държавните служители сами си плащат
//   осигуровките (± компенсация → неутрално) · здравна вноска +X п.п.
// June-2026 consolidation-debate levers (full parity with the screen): срязване
//   на майчинството (втора година → 0/6 мес.) · учителски заплати → X% от
//   средната · минимална пенсия → €X · замразяване на депутатските заплати ·
//   партийна субсидия €X/глас (0 = премахване). Maternity surfaces the dynamic
//   return-to-work recapture; parity is locked by scripts/budget/__test_ai_parity.ts.

import {
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  PIT_RATE,
  VAT_STANDARD_RATE,
  resolveMod,
} from "../../src/lib/bgTax";
import {
  GAMBLING_GGR_FEE_RATE,
  MATERNITY_Y2_MONTHS,
  PARTY_SUBSIDY_RATE_EUR,
  PENSION_POLICY_CURRENT,
  VAT_GROUP_DEFAULT_REGIME,
  VAT_REDUCED_RATE,
  computeVatRevenue,
  scoreAdminCut,
  scoreCapitalChange,
  scoreCorporate,
  scoreDefenseTarget,
  scoreDividend,
  scoreExcise,
  scoreGamblingGgr,
  scoreHealthContribution,
  scoreMaternityMonths,
  scoreMinWageFreeze,
  scoreModCap,
  scoreModCapBands,
  scoreMpPayFreeze,
  scorePartySubsidy,
  scorePensionFloorRaise,
  scorePensionIndexation,
  scorePitSchedule,
  scoreSscSelfPaid,
  scoreTeachersPeg,
  scoreWageIndexation,
  scoreWineExcise,
  type ModIdentity,
  type PitBracket,
  type VatAdjustableGroup,
  type VatBaseSlice,
  type VatPolicy,
  type VatRegime,
} from "../../src/lib/bgTaxPolicy";
import { NOMINAL_GDP_2026_EUR } from "../../src/lib/bgFiscalProjection";
import {
  MC_DRAWS,
  MC_SEED,
  buildDynamicInput,
  computeDynamicScenario,
  sampleDraws,
  type BehavioralDraw,
} from "../../src/lib/bgBehavioral";
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
// Expenditure-lever defaults/bounds mirrored from the same component: the pw
// slider (pension-indexation CPI weight) is 0-100 with current law at 50, the
// adm slider (administration cut) is 0-20%, and the indexation horizon stays
// at the screen's default (1 round = next budget year).
const PW_DEF = Math.round(PENSION_POLICY_CURRENT.cpiWeight * 100); // 50
const ADM_MAX = 20;
const PENSION_HORIZON_DEF = PENSION_POLICY_CURRENT.horizonYears; // 1
// Phase-5 lever defaults/bounds, same component: the def slider is in TENTHS
// of % of GDP (15-35; 22 = the current ~2.2% NATO path = the no-change
// sentinel), wi is −5..15% with the restraint-exempt sectors kept on their
// path by default (wex=true), kap is ±30% of the capital plan, hp is 0-3 pp.
const DEF_DEF = 22;
const DEF_MIN = 15;
const DEF_MAX = 35;
const WI_MIN = -5;
const WI_MAX = 15;
const KAP_MAX = 30;
const HP_MAX = 3;
// June-2026 debate levers, same component. mp = minimum-pension target
// (EUR/mo, slider eff-clamped to [current minimum, 600]); tp = teachers' peg
// (% of the economy-average wage, eff-clamped to [100, 140]); mat = months of
// the paid second maternity year kept (0-12, 12 = current law); psub = the
// per-vote party subsidy in CENTS (current law €3.00 → 300, slider 0-450).
const MP_MAX = 600;
const MP_MIN = 250; // parser floor — below this a number is not a min-pension target
const TP_MIN = 100;
const TP_MAX = 140;
const MAT_MONTHS = MATERNITY_Y2_MONTHS; // 12
const PSUB_DEF = Math.round(PARTY_SUBSIDY_RATE_EUR * 100); // 300 (€3.00/vote)
const PSUB_MAX = 450;
// Excise levers (commit 5790a3372), bounds mirrored from the same component:
// fuel/tobacco/alcohol are a % CHANGE to the existing category rate (fuel
// −20..+50%, tobacco & alcohol −20..+100%); wine is an INTRODUCE-from-€0
// lever in €/hl (0..100, step 5). Change them THERE first.
const EXCISE_FUEL_MIN = -20;
const EXCISE_FUEL_MAX = 50;
const EXCISE_SIN_MIN = -20; // tobacco & alcohol
const EXCISE_SIN_MAX = 100;
const WINE_MAX = 100; // €/hl
// Gambling ЗХ GGR-fee lever (commit ebc14cb16), bounds mirrored from the same
// component: a single rate on gross gaming revenue (GGR), 0..40%, current 2026
// law 25% (raised from 20% in Budget 2026 → 25% is the "no change" position).
// Change them THERE first.
const GAMBLING_DEF = Math.round(GAMBLING_GGR_FEE_RATE * 100); // 25
const GAMBLING_MAX = 40;

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
  | { kind: "modCap"; capEur: number | null } // null = премахване на тавана
  // expenditure levers (balance convention: positive = the balance improves)
  | { kind: "pensionIndexation"; cpiWeightPct: number } // 100 = само по инфлация
  | { kind: "pensionSupplement" } // ковид добавката не се индексира
  | { kind: "adminCut"; sharePct: number } // съкращаване на администрацията
  | { kind: "minWageFreeze" } // МРЗ замразена (отвързана от формулата)
  // Phase-5 levers (same balance convention)
  | { kind: "defenseTarget"; pctGdpTenths: number } // НАТО %-от-БВП цел, в десети
  | { kind: "wageIndexation"; pct: number } // заплати в публичния сектор ±X%
  | { kind: "capitalChange"; pct: number } // капиталов план ±X% (касово)
  | { kind: "sscSelfPaid"; grossUp: boolean } // служителите си плащат осигуровките
  | { kind: "healthContribution"; pp: number } // здравна вноска +X п.п.
  // June-2026 consolidation-debate levers (same balance convention)
  | { kind: "maternity"; monthsKept: number } // 0 = full 2nd-year cut, 6 = halve
  | { kind: "teachersPeg"; targetPct: number } // учителски заплати → X% от средната
  | { kind: "pensionFloor"; minEur: number } // минимална пенсия → €X/мес.
  | { kind: "mpPayFreeze" } // замразяване на депутатските заплати
  | { kind: "partySubsidy"; rateCents: number } // субсидия €X/глас (0 = премахване)
  // Excise levers (revenue side; positive = more revenue, like ДДС/ДДФЛ).
  | { kind: "exciseFuel"; pct: number } // % change to the fuel excise rate
  | { kind: "exciseTobacco"; pct: number } // % change to the tobacco excise rate
  | { kind: "exciseAlcohol"; pct: number } // % change to the alcohol excise rate
  | { kind: "wineExcise"; rateEurPerHl: number } // introduce a wine excise, €/hl
  | { kind: "gamblingGgr"; ratePct: number }; // ЗХ GGR fee → X% (current 25%)

const has = (q: string, ...words: string[]): boolean =>
  words.some((w) => q.includes(w));

// Whole-token check (JS \b is unreliable around Cyrillic) — used for the short
// "мод" instrument so it can't fire inside "модел"/"мода".
const hasToken = (q: string, ...tokens: string[]): boolean => {
  const toks = q.split(/[^a-zа-яё0-9%€-]+/i).filter(Boolean);
  return tokens.some((t) => toks.includes(t));
};

// A лева/BGN-denominated amount. Post-euro (2026-01-01) the UI and deep-link
// URLs are all EUR, so a BARE number phrased in лева must NOT be read as the
// EUR figure — fall through to the definitional tool instead of mis-scoring.
// An explicit € still wins (parseEur catches it).
const hasBgn = (q: string): boolean => has(q, "лв", "лева", "bgn");

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
// Expenditure instruments. "индекс" covers индексация/индексира/индексиране;
// "index" covers indexation/indexing/indexed.
const INDEXATION_WORDS = ["индекс", "index"];
const PENSION_WORDS = ["пенси", "pension"];
const ADMIN_WORDS = [
  "администраци",
  "administration",
  "civil service",
  "държавни служители",
  "чиновни",
];
// "пенсиите/индексацията само по инфлация(та)" / "CPI-only indexation" → 100.
const CPI_ONLY_CUES = [
  "само по инфлация",
  "само по инфлацията",
  "cpi-only",
  "cpi only",
  "only cpi",
  "inflation only",
  "inflation-only",
  "only inflation",
  "only by inflation",
  "only on inflation",
];
// "само по доходите" / "income-only indexation" → 0.
const INCOME_ONLY_CUES = [
  "само по доходите",
  "само по дохода",
  "само по заплатите",
  "income only",
  "income-only",
  "only income",
  "only by income",
  "wages only",
  "only wages",
];
// Explicit weight: "70% тежест на инфлацията (в индексацията)".
const CPI_WEIGHT_CUES = [
  "тежест на инфлация",
  "тежест на инфлацията",
  "inflation weight",
  "weight on inflation",
  "weight of inflation",
  "cpi weight",
];
// "ковид добавката да не се индексира" / "don't index the covid supplement".
const NO_INDEX_CUES = [
  "да не се индексира",
  "не се индексира",
  "без индексация",
  "без индексиране",
  "don't index",
  "do not index",
  "not index", // not indexed / not be indexed
  "stop indexing",
  "without indexation",
];
const ADMIN_CUT_CUES = [
  "съкращ",
  "съкрат",
  "оряз",
  "ореж",
  "намал",
  "свие",
  "свива",
  "cut",
  "reduc",
  "trim",
  "shrink",
  "lay off",
  "layoff",
  "уволн",
];
// "замразяване на МРЗ" / "отвързване от средната заплата" / "freeze/untie".
const FREEZE_CUES = [
  "замраз",
  "freeze",
  "frozen",
  "freezing",
  "отвърз",
  "отвръз",
  "untie",
  "unty", // untying
  "unlink",
  "decoupl",
  "de-link",
  "delink",
];
// Phase-5 instruments --------------------------------------------------------
const DEFENSE_WORDS = ["отбран", "defense", "defence"];
// Public-sector wage indexation needs the sector context, so "минималната
// заплата" / a private-wage question can't fire.
const PUBLIC_SECTOR_WORDS = [
  "публичния сектор",
  "публичният сектор",
  "публичен сектор",
  "бюджетния сектор",
  "бюджетният сектор",
  "бюджетен сектор",
  "бюджетната сфера",
  "бюджетна сфера",
  "public sector",
  "public-sector",
];
const WAGE_WORDS = ["заплат", "wage", "salar"];
// June-2026 debate-lever instruments. Each needs an explicit cut/target so the
// definitional reads ("колко е майчинството", "колко е минималната пенсия")
// keep falling through to their existing tools.
const MATERNITY_WORDS = [
  "майчинств",
  "отглеждане на дете",
  "родителски отпуск",
  "maternity",
  "child-raising",
  "child raising",
  "parental leave",
];
const MATERNITY_CUT_CUES = [
  "съкрат",
  "намал",
  "ореж",
  "отрежи",
  "1 година",
  "една година",
  "от 2 на 1",
  "to 1 year",
  "to one year",
  "cut",
  "shorten",
  "scrap",
  "премахн",
  "наполовин",
];
// Halving the benefit (keep ~6 months) vs the full second-year cut (0).
const MATERNITY_HALF_CUES = [
  "наполовин",
  "половин",
  "6 месец",
  "шест месец",
  "halve",
  "by half",
  "6 month",
  "six month",
];
const TEACHER_WORDS = ["учител", "teacher"];
// "минимална пенсия" — the PENSION floor, distinct from "минимална заплата".
const MIN_PENSION_WORDS = [
  "минимална пенсия",
  "минималната пенсия",
  "минимална пенси",
  "минималната пенси",
  "minimum pension",
  "min pension",
  "minimum old-age pension",
];
const MP_PAY_WORDS = [
  "депутатск",
  "на депутатите",
  "депутатите",
  "lawmaker",
  "parliamentar",
];
// Subsidy trigger + a party/per-vote context (Bulgarian inflection makes a
// fixed "партийн субсиди" phrase brittle — "партийните субсидии" wouldn't match).
const SUBSIDY_WORDS = ["субсиди", "subsid"];
const PARTY_VOTE_CONTEXT = [
  "парти",
  "на глас",
  "/глас",
  "per vote",
  "per-vote",
  "/vote",
  "party",
];
const SUBSIDY_ABOLISH_CUES = [
  "премах",
  "махне",
  "отпадн",
  "спре",
  "спиране",
  "нулев",
  "abolish",
  "scrap",
  "remove",
  "zero",
];
const CAPEX_WORDS = [
  "капиталов", // капиталовите разходи / капиталовата програма / капиталов план
  "capital expenditure",
  "capital spending",
  "capex",
];
// "държавните служители да си плащат осигуровките" — the actor in any case
// form ("държавни(те) служители", "civil servants", "чиновниците").
const sscSelfActor = (q: string): boolean =>
  (has(q, "служител") && has(q, "държавн")) ||
  has(q, "чиновни", "civil servant");
const SSC_SELF_CUES = [
  "си плащат",
  "си плаща",
  "плащат сами",
  "плащат си",
  "pay their own",
  "pay own",
  "paying their own",
  "pay for their own",
  "themselves",
];
// "с компенсация" / "gross up" → the compensating salary increase variant.
const GROSS_UP_CUES = [
  "компенсац",
  "компенсир",
  "gross up",
  "gross-up",
  "grossed up",
  "grossed-up",
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

// Excise instruments. "акциз"/"excise" is the anchor word; a category word
// (fuel/tobacco/alcohol/wine) picks the lever. The bare "колко са акцизите"
// (anchor, no category, no target) carries no lever and falls through to the
// budget overview (the router handles that — excise is a revenue line).
const EXCISE_WORDS = ["акциз", "excise"];
const FUEL_WORDS = [
  "горив", // гориво / горива / горивата
  "бензин",
  "дизел",
  "fuel",
  "petrol",
  "diesel",
  "gasoline",
];
const TOBACCO_WORDS = ["тютюн", "цигар", "tobacco", "cigarette"];
const ALCOHOL_WORDS = [
  "алкохол",
  "спиртн",
  "ракия",
  "alcohol",
  "spirits",
  "liquor",
];
const WINE_WORDS = ["вино", "винот", "вина", "wine"];

// Gambling instruments. "хазарт"/"gambling" is the anchor; "казино"/"casino",
// "залаган"/"betting", "тотализатор"/"лотари"/"lottery" widen the catch. The
// bare "колко са приходите от хазарт" (anchor, no rate target) carries no lever
// and falls through to the budget overview (the router handles that — gambling
// is a revenue line).
const GAMBLING_WORDS = [
  "хазарт",
  "казино",
  "залаган", // залагания / залагане
  "тотализатор",
  "лотари", // лотария / лотарии
  "gambling",
  "casino",
  "betting",
  "lottery",
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

// Decimal percent for the defense %-of-GDP target ("2.5% от БВП") — the
// generic parsePct rounds to an integer, which would turn 2.5 into 3.
const parseDecimalPct = (q: string): number | undefined => {
  const m = q.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:%|процент|на сто|percent)/);
  return m ? parseFloat(m[1].replace(",", ".")) : undefined;
};

// Signed percent for the ± levers (public wages, capital plan): an explicit
// "+5%"/"-10%" sign wins; an unsigned "с 10%" takes its direction from the
// raise/cut wording ("орязване … с 10%" → −10).
const parseSignedPct = (q: string): number | undefined => {
  const m = q.match(
    /([+\-−–]?)\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:%|процент|на сто|percent)/,
  );
  if (!m) return undefined;
  const v = Math.round(parseFloat(m[2].replace(",", ".")));
  if (m[1] === "+") return v;
  if (m[1] !== "") return -v;
  return has(
    q,
    "оряз",
    "ореж",
    "намал",
    "свал",
    "свие",
    "свив",
    "смъкн",
    "съкра",
    "cut",
    "reduc",
    "slash",
    "lower",
    "shrink",
    "trim",
  )
    ? -v
    : v;
};

// Percentage points for the health contribution ("+1 пункт", "+2pp", "с 1
// процентен пункт"); a bare "%" also reads as the increment — the lever IS
// "+X" on the screen. Single digit by construction (the slider is 0-3 pp).
const parsePp = (q: string): number | undefined => {
  const m = q.match(/(\d)\s*(?:пункт|п\.п|pp\b|percentage point|%|процент)/);
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

  // 1b. Expenditure levers — instrument + an explicit lever cue, so the
  // definitional questions ("колко са пенсиите" → noiFunds, "каква е
  // минималната заплата" → macroIndicator) keep falling through.
  const indexish = has(q, ...INDEXATION_WORDS);
  // COVID supplement first: "ковид добавката да не се индексира" carries the
  // indexation word too, so it must not read as a weight change.
  if (has(q, "ковид", "covid") && has(q, "добавк", "supplement")) {
    if (has(q, ...NO_INDEX_CUES)) return { kind: "pensionSupplement" };
  }
  // Pension indexation weight: "(пенсиите да се индексират) само по
  // инфлация(та)" → 100, "само по доходите" → 0, "X% тежест на инфлацията" → X.
  if (indexish && has(q, ...CPI_ONLY_CUES))
    return { kind: "pensionIndexation", cpiWeightPct: 100 };
  if (indexish && has(q, ...INCOME_ONLY_CUES))
    return { kind: "pensionIndexation", cpiWeightPct: 0 };
  if (
    pct !== undefined &&
    has(q, ...CPI_WEIGHT_CUES) &&
    (indexish || has(q, ...PENSION_WORDS))
  )
    return { kind: "pensionIndexation", cpiWeightPct: pct };
  // Administration headcount cut: "съкращаване на администрацията с X%".
  if (has(q, ...ADMIN_WORDS) && has(q, ...ADMIN_CUT_CUES)) {
    const share =
      pct ??
      (bare !== undefined && bare > 0 && bare <= ADM_MAX ? bare : undefined);
    if (share !== undefined) return { kind: "adminCut", sharePct: share };
  }
  // МРЗ freeze: "замразяване на минималната заплата", "отвързване на МРЗ от
  // средната заплата", "freeze/untie the minimum wage".
  if (has(q, ...MIN_WAGE_WORDS) && has(q, ...FREEZE_CUES))
    return { kind: "minWageFreeze" };

  // 1c. Phase-5 expenditure levers — instrument + an explicit target, so the
  // definitional reads ("колко са разходите за отбрана" → budgetFunction GF02,
  // "каква е здравната вноска" → budgetFunction GF07) keep falling through.
  // Defense %-of-GDP target: "отбраната да стане 3% от БВП", "3% за отбрана",
  // "defense to 3% of GDP". Stored in tenths (the def slider's unit); only
  // the NATO-plausible 1.5-3.5% window reads as a target — anything else is
  // a share-of-spending figure, not this lever.
  if (has(q, ...DEFENSE_WORDS)) {
    const v = parseDecimalPct(q);
    if (v !== undefined && v >= DEF_MIN / 10 && v <= DEF_MAX / 10)
      return { kind: "defenseTarget", pctGdpTenths: Math.round(v * 10) };
  }
  // Public-sector wage indexation: "заплатите в публичния сектор +5%",
  // "индексация на заплатите в бюджетния сектор с 5%". v1 demands an explicit
  // ±X% — a bare "freeze public wages" is already current law (0% = no
  // indexation) and stays out. Exempt sectors keep the screen default (ON).
  if (has(q, ...PUBLIC_SECTOR_WORDS) && has(q, ...WAGE_WORDS)) {
    const v = parseSignedPct(q);
    if (v !== undefined && v !== 0) return { kind: "wageIndexation", pct: v };
  }
  // Capital expenditure: "капиталовите разходи -10%", "орязване на
  // капиталовите разходи с 10%", "cut capital expenditure by 10%".
  if (has(q, ...CAPEX_WORDS)) {
    const v = parseSignedPct(q);
    if (v !== undefined && v !== 0) return { kind: "capitalChange", pct: v };
  }
  // Self-paid contributions: "държавните служители да си плащат
  // осигуровките" / "civil servants pay their own contributions". With a
  // компенсация / gross-up clause the reform is scored as fiscally neutral.
  if (
    sscSelfActor(q) &&
    has(q, "осигуровк", "осигурителн", "contribution") &&
    has(q, ...SSC_SELF_CUES)
  )
    return { kind: "sscSelfPaid", grossUp: has(q, ...GROSS_UP_CUES) };
  // Health contribution +X п.п.: "здравната вноска +1 пункт", "health
  // contribution +2pp". The increment is small by construction — an
  // out-of-range number reads as the rate itself ("здравната вноска е 8%")
  // and is NOT a what-if. ("здравна вноска" ≠ the МОД/осигуровки cues: the
  // МОД blocks demand таван/мод, so neither side steals the other.)
  if (has(q, "здрав", "health") && has(q, "вноск", "contribution")) {
    const pp = parsePp(q);
    if (pp !== undefined && pp >= 1 && pp <= HP_MAX)
      return { kind: "healthContribution", pp };
  }

  // 1d. June-2026 consolidation-debate levers — each demands an explicit
  // cut/target so the definitional reads keep falling through.
  // Maternity second year: "съкращаване на майчинството", "от 2 на 1 година",
  // "наполовина" (→ keep 6 months); a bare "колко е майчинството" has no cut
  // cue and falls through.
  if (has(q, ...MATERNITY_WORDS) && has(q, ...MATERNITY_CUT_CUES)) {
    const monthsKept = has(q, ...MATERNITY_HALF_CUES) ? 6 : 0;
    return { kind: "maternity", monthsKept };
  }
  // Teachers' 125% peg: "учителските заплати на 125% от средната". Needs the
  // teacher + wage context AND an explicit % target.
  if (has(q, ...TEACHER_WORDS) && has(q, ...WAGE_WORDS)) {
    if (pct !== undefined && pct >= 80 && pct <= 200)
      return { kind: "teachersPeg", targetPct: clamp(pct, TP_MIN, TP_MAX) };
  }
  // Minimum pension floor: "минималната пенсия на €400". A EUR/bare target in
  // the plausible floor range; "колко е минималната пенсия" has none → falls
  // through. ("минимална пенсия" ≠ "минимална заплата", so no min-wage clash.)
  if (has(q, ...MIN_PENSION_WORDS)) {
    const amount =
      eur ??
      (!hasBgn(q) && bare !== undefined && bare >= MP_MIN && bare <= MP_MAX
        ? bare
        : undefined);
    if (amount !== undefined && amount >= MP_MIN && amount <= MP_MAX)
      return { kind: "pensionFloor", minEur: Math.round(amount) };
  }
  // MP pay freeze: "замразяване на депутатските заплати" — MP context + wage +
  // a freeze cue (the only MP-pay move the lever models).
  if (
    (has(q, ...MP_PAY_WORDS) || hasToken(q, "mp", "mps", "meps")) &&
    has(q, ...WAGE_WORDS) &&
    has(q, ...FREEZE_CUES)
  )
    return { kind: "mpPayFreeze" };
  // Party subsidy per vote: "субсидията на €4 на глас" or "премахване на
  // партийните субсидии" (→ €0). Needs the subsidy word + a party/per-vote
  // context (so a generic "земеделски субсидии" question can't fire).
  if (has(q, ...SUBSIDY_WORDS) && has(q, ...PARTY_VOTE_CONTEXT)) {
    if (has(q, ...SUBSIDY_ABOLISH_CUES))
      return { kind: "partySubsidy", rateCents: 0 };
    const perVote =
      eur ??
      (!hasBgn(q) && bare !== undefined && bare >= 0 && bare <= 10
        ? bare
        : undefined);
    if (perVote !== undefined && perVote >= 0 && perVote <= PSUB_MAX / 100)
      return { kind: "partySubsidy", rateCents: Math.round(perVote * 100) };
  }

  // 1e. Excise levers — anchored on the акциз/excise word + a category, with
  // an explicit target. Fuel/tobacco/alcohol = a signed % CHANGE to the
  // existing rate (direction from the +/− sign or the raise/cut wording, like
  // the public-wage lever); wine = INTRODUCE at €X/hl from €0. A bare "колко са
  // акцизите" (anchor, no category, no target) carries no lever and falls
  // through to the budget overview.
  if (has(q, ...EXCISE_WORDS)) {
    // Wine first — its €/hl unit is distinct, and the wine word must not also
    // trip the %-change branches. A bare лева amount is not read as EUR.
    if (has(q, ...WINE_WORDS)) {
      const rate =
        eur ??
        (!hasBgn(q) && cue && bare !== undefined && bare > 0 && bare <= WINE_MAX
          ? bare
          : undefined);
      if (rate !== undefined && rate > 0)
        return { kind: "wineExcise", rateEurPerHl: clamp(rate, 0, WINE_MAX) };
    }
    // Fuel / tobacco / alcohol — a signed % change to the rate (0 = no change).
    const exPct = parseSignedPct(q);
    if (exPct !== undefined && exPct !== 0) {
      if (has(q, ...FUEL_WORDS)) return { kind: "exciseFuel", pct: exPct };
      if (has(q, ...TOBACCO_WORDS))
        return { kind: "exciseTobacco", pct: exPct };
      if (has(q, ...ALCOHOL_WORDS))
        return { kind: "exciseAlcohol", pct: exPct };
    }
  }

  // 1f. Gambling ЗХ GGR fee — a single rate on gross gaming revenue (the lever
  // is a LEVEL, current law 25%, not a % change like excise). "данъкът върху
  // хазарта да стане 30%", "gambling tax to 40%". Needs the gambling word + an
  // explicit rate target: a % wins (and is clamped to the 0..40 grid, so "50%"
  // reads as the 40% ceiling — same as VAT→27); a bare number is accepted only
  // inside the grid alongside a change cue. The current 25% is the no-op
  // sentinel, so a bare "колко са приходите от хазарт" / "какъв е данъкът върху
  // хазарта" (no rate) — and a request for the current 25% — fall through to
  // the budget overview.
  if (has(q, ...GAMBLING_WORDS)) {
    const rate =
      pct ??
      (cue && bare !== undefined && bare >= 0 && bare <= GAMBLING_MAX
        ? bare
        : undefined);
    if (rate !== undefined) {
      const ratePct = clamp(rate, 0, GAMBLING_MAX);
      if (ratePct !== GAMBLING_DEF) return { kind: "gamblingGgr", ratePct };
    }
  }

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
  pw: number;
  noSupp: boolean;
  adm: number;
  mrzFreeze: boolean;
  def: number; // tenths of % of GDP; DEF_DEF = no change
  wi: number;
  wex: boolean; // exempt sectors keep their path (screen default ON)
  kap: number;
  ssp: boolean;
  sspg: boolean;
  hp: number;
  // June-2026 debate levers (mp/tp are TARGETS; 0 = no change; the effective
  // value is resolved against the baseline default in scoreScenario).
  mp: number;
  tp: number;
  mat: number;
  mpf: boolean;
  psub: number;
  // Excise (revenue side). exFuel/exTobacco/exAlcohol = integer % rate change
  // (0 = current law); wine = introduced excise in €/hl (0 = current €0).
  exFuel: number;
  exTobacco: number;
  exAlcohol: number;
  wine: number;
  // Gambling ЗХ GGR fee, integer % LEVEL (GAMBLING_DEF = 25 = current law).
  gambling: number;
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
    pw: PW_DEF,
    noSupp: false,
    adm: 0,
    mrzFreeze: false,
    def: DEF_DEF,
    wi: 0,
    wex: true,
    kap: 0,
    ssp: false,
    sspg: false,
    hp: 0,
    mp: 0,
    tp: 0,
    mat: MAT_MONTHS,
    mpf: false,
    psub: PSUB_DEF,
    exFuel: 0,
    exTobacco: 0,
    exAlcohol: 0,
    wine: 0,
    gambling: GAMBLING_DEF,
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
    case "pensionIndexation":
      p.pw = clamp(change.cpiWeightPct, 0, 100);
      break;
    case "pensionSupplement":
      p.noSupp = true;
      break;
    case "adminCut":
      p.adm = clamp(change.sharePct, 0, ADM_MAX);
      break;
    case "minWageFreeze":
      p.mrzFreeze = true;
      break;
    case "defenseTarget":
      p.def = clamp(change.pctGdpTenths, DEF_MIN, DEF_MAX);
      break;
    case "wageIndexation":
      p.wi = clamp(change.pct, WI_MIN, WI_MAX);
      break;
    case "capitalChange":
      p.kap = clamp(change.pct, -KAP_MAX, KAP_MAX);
      break;
    case "sscSelfPaid":
      p.ssp = true;
      p.sspg = change.grossUp;
      break;
    case "healthContribution":
      p.hp = clamp(change.pp, 0, HP_MAX);
      break;
    case "maternity":
      p.mat = clamp(change.monthsKept, 0, MAT_MONTHS);
      break;
    case "teachersPeg":
      p.tp = clamp(change.targetPct, TP_MIN, TP_MAX);
      break;
    case "pensionFloor":
      p.mp = clamp(change.minEur, 0, MP_MAX);
      break;
    case "mpPayFreeze":
      p.mpf = true;
      break;
    case "partySubsidy":
      p.psub = clamp(change.rateCents, 0, PSUB_MAX);
      break;
    case "exciseFuel":
      p.exFuel = clamp(change.pct, EXCISE_FUEL_MIN, EXCISE_FUEL_MAX);
      break;
    case "exciseTobacco":
      p.exTobacco = clamp(change.pct, EXCISE_SIN_MIN, EXCISE_SIN_MAX);
      break;
    case "exciseAlcohol":
      p.exAlcohol = clamp(change.pct, EXCISE_SIN_MIN, EXCISE_SIN_MAX);
      break;
    case "wineExcise":
      p.wine = clamp(change.rateEurPerHl, 0, WINE_MAX);
      break;
    case "gamblingGgr":
      p.gambling = clamp(change.ratePct, 0, GAMBLING_MAX);
      break;
  }
  return p;
};

export interface ScenarioScore {
  vatDelta: number;
  pitDelta: number;
  /** The two ДДФЛ slices, separately — the behavioral layer treats them
   *  with different elasticities. */
  pitEmploymentDelta: number;
  pitNonEmploymentDelta: number;
  corpDelta: number;
  divDelta: number;
  /** Excise deltas (revenue side; fuel/tobacco/alcohol % rate changes + the
   *  introduced wine excise) — kept apart so the behavioral pass can run the
   *  per-category demand/illicit-substitution response on each. */
  exciseFuelDelta: number;
  exciseTobaccoDelta: number;
  exciseAlcoholDelta: number;
  wineDelta: number;
  /** Gambling ЗХ GGR-fee static delta — the behavioral pass runs the
   *  offshore/illicit-migration response on top (a Laffer turn on big hikes). */
  gamblingDelta: number;
  modCentral: number;
  /** МРЗ-freeze and health-contribution deltas (revenue-side levers inside
   *  the expenditure block — the Tier-2 impulse split needs them apart). */
  mwDelta: number;
  hpDelta: number;
  /** Expenditure levers on the BALANCE (positive = the balance improves):
   *  −(pensionΔspend + adminΔspend) + mwΔ, the screen's convention. */
  expenditureBalance: number;
  /** Share of an administration cut absorbed by vacant positions (the
   *  honesty note); null when the scenario cuts nothing. */
  vacantAbsorbedShare: number | null;
  /** The schedule the scenario applies (for the behavioral PIT pass). */
  brackets: PitBracket[];
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
  const {
    vatStd,
    regimes,
    pit,
    nm,
    corp,
    div,
    mod,
    noCap,
    pw,
    noSupp,
    adm,
    mrzFreeze,
    def,
    wi,
    wex,
    kap,
    ssp,
    sspg,
    hp,
    mp,
    tp,
    mat,
    mpf,
    psub,
    exFuel,
    exTobacco,
    exAlcohol,
    wine,
    gambling,
  } = paramsFor(change, currentCap);

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

  // Excise (fixed-base static deltas; demand/cross-border/illicit response is
  // layered on in the behavioral pass) — mirrors the screen's scenario useMemo.
  const exciseFuelDelta = scoreExcise(
    baseline.revenue.exciseFuelEur ?? 0,
    exFuel / 100,
  );
  const exciseTobaccoDelta = scoreExcise(
    baseline.revenue.exciseTobaccoEur ?? 0,
    exTobacco / 100,
  );
  const exciseAlcoholDelta = scoreExcise(
    baseline.revenue.exciseAlcoholEur ?? 0,
    exAlcohol / 100,
  );
  const wineDelta = wine > 0 ? scoreWineExcise(wine) : 0;
  const exciseDelta =
    exciseFuelDelta + exciseTobaccoDelta + exciseAlcoholDelta + wineDelta;

  // Gambling ЗХ GGR fee (level lever; offshore/illicit migration is the Tier-1
  // behavioral response) — mirrors the screen's scenario useMemo.
  const gamblingDelta =
    gambling !== GAMBLING_DEF ? scoreGamblingGgr(gambling / 100) : 0;

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

  // Expenditure levers (balance convention: positive = the balance improves)
  // — the same block as the component's scenario useMemo.
  const exp = baseline.expenditure;
  const pensionDeltaSpend = exp
    ? scorePensionIndexation(exp.pensions, {
        cpiWeight: pw / 100,
        indexSupplement: !noSupp,
        horizonYears: PENSION_HORIZON_DEF,
      })
    : 0;
  const adminRes =
    exp && adm > 0 ? scoreAdminCut(exp.administration, adm / 100) : null;
  const adminDeltaSpend = adminRes ? adminRes.netEur : 0;
  const mwDelta =
    exp && mrzFreeze
      ? scoreMinWageFreeze(earnings.bands, exp.minWage).netEur
      : 0;
  const defDelta =
    exp && def !== DEF_DEF
      ? scoreDefenseTarget(
          // Mirror the simulator screen: price the defense %-of-GDP target
          // against the projection's EC-consistent 2026 nominal GDP
          // (€123.9B), NOT the stale pipeline `gdpNextEur` (€128.2B, a
          // +10.5% nominal-growth vintage). Same lever, same base as the UI.
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
      ? scoreCapitalChange(exp.capital.planEur, exp.capital.executionRate, kap)
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
  // June-2026 debate levers (Δ spending; negative = the budget saves). mp/tp
  // resolve their effective target against the baseline default, exactly like
  // the simulator's mpEff/tpEff.
  const mpDef = exp?.pensionFloor ? Math.round(exp.pensionFloor.minimumEur) : 0;
  const mpEff = mp > 0 ? Math.min(MP_MAX, Math.max(mpDef, mp)) : mpDef;
  const mpDeltaSpend =
    exp?.pensionFloor && mpEff !== mpDef
      ? scorePensionFloorRaise(
          exp.pensionFloor.bands,
          exp.pensionFloor.minimumEur,
          mpEff,
        )
      : 0;
  const tpDef = exp?.teachers ? Math.round(exp.teachers.currentRatio * 100) : 0;
  const tpEff = tp > 0 ? Math.min(TP_MAX, Math.max(TP_MIN, tp)) : tpDef;
  const tpDeltaSpend =
    exp?.teachers && tpEff !== tpDef
      ? scoreTeachersPeg(
          exp.teachers.count,
          exp.teachers.economyWageEur,
          exp.teachers.currentRatio,
          tpEff,
        )
      : 0;
  const matDeltaSpend = mat !== MAT_MONTHS ? scoreMaternityMonths(mat) : 0;
  const mpfDeltaSpend =
    exp && mpf ? scoreMpPayFreeze(exp.pensions.wageGrowthPct) : 0;
  const psubDeltaSpend = psub !== PSUB_DEF ? scorePartySubsidy(psub / 100) : 0;
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
    exciseDelta +
    gamblingDelta +
    modRes.centralEur +
    expenditureBalance;
  const low =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    exciseDelta +
    gamblingDelta +
    expenditureBalance +
    Math.min(modRes.lowEur, modRes.highEur);
  const high =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    exciseDelta +
    gamblingDelta +
    expenditureBalance +
    Math.max(modRes.lowEur, modRes.highEur);

  return {
    vatDelta,
    pitDelta,
    pitEmploymentDelta,
    pitNonEmploymentDelta,
    corpDelta,
    divDelta,
    exciseFuelDelta,
    exciseTobaccoDelta,
    exciseAlcoholDelta,
    wineDelta,
    gamblingDelta,
    modCentral: modRes.centralEur,
    mwDelta,
    hpDelta,
    expenditureBalance,
    vacantAbsorbedShare: adminRes ? adminRes.vacantAbsorbedShare : null,
    brackets,
    central,
    low,
    high,
  };
};

// ---------------------------------------------------------------------------
// Dynamic (behavioral) pass — the screen's DEFAULT headline. Mirrors the
// component's `dynamicScenario` useMemo over the same engine module. Single-
// change scenarios put the pension year-1 delta straight into the spending
// impulse (the screen routes it via the per-year fixed path, but at year 1
// the two are identical — and the headline only reads year 1).
// ---------------------------------------------------------------------------

export interface DynamicScore {
  headlineEur: number;
  p5Eur: number;
  p95Eur: number;
  /** headline − static central (the behavioral correction, signed). */
  behavioralEur: number;
}

// Monte-Carlo draws are pure in (n, seed, modIdentity); the baseline (hence
// its modIdentity object) is fetched once and cached, so memoize the 500-draw
// sample per modIdentity reference the way the screen does via useMemo.
const drawsCache = new WeakMap<ModIdentity, BehavioralDraw[]>();
const drawsFor = (modIdentity: ModIdentity): BehavioralDraw[] => {
  let draws = drawsCache.get(modIdentity);
  if (!draws) {
    draws = sampleDraws(MC_DRAWS, MC_SEED, modIdentity);
    drawsCache.set(modIdentity, draws);
  }
  return draws;
};

export const scoreDynamicScenario = (
  baseline: PolicyBaselineFile,
  change: TaxChange,
  score: ScenarioScore,
): DynamicScore => {
  const currentCap = resolveMod(null).mod;
  const p = paramsFor(change, currentCap);
  const input = buildDynamicInput(
    baseline,
    {
      totalEur: score.central,
      vatDeltaEur: score.vatDelta,
      pitEmploymentDeltaEur: score.pitEmploymentDelta,
      pitNonEmploymentDeltaEur: score.pitNonEmploymentDelta,
      corpDeltaEur: score.corpDelta,
      divDeltaEur: score.divDelta,
      modCentralEur: score.modCentral,
      healthDeltaEur: score.hpDelta,
      minWageDeltaEur: score.mwDelta,
      // Excise static deltas — the behavioral pass runs the per-category
      // demand/illicit-substitution response (tobacco bends into the Laffer
      // turn on big hikes); wine carries a flat home-production leakage.
      exciseFuelDeltaEur: score.exciseFuelDelta,
      exciseTobaccoDeltaEur: score.exciseTobaccoDelta,
      exciseAlcoholDeltaEur: score.exciseAlcoholDelta,
      wineDeltaEur: score.wineDelta,
      // Gambling static delta — the behavioral pass runs the offshore/illicit
      // migration response (a Laffer turn on big hikes).
      gamblingDeltaEur: score.gamblingDelta,
      // single-change scenarios route the pension lever through the
      // expenditure balance (no per-year compounding path here).
      expenditureBalanceNonPensionEur:
        score.expenditureBalance - score.mwDelta - score.hpDelta,
      // surfaces the maternity-cut return-to-work PIT+SSC recapture (0 when
      // the change isn't maternity → p.mat stays at MAT_MONTHS).
      maternityMonthsCut: MAT_MONTHS - p.mat,
      brackets: score.brackets,
    },
    {
      pitNewRate: p.pit / 100,
      corpNewRate: p.corp / 100,
      divNewRate: p.div / 100,
      modTargetCapEur: p.noCap ? Infinity : p.mod,
      modCurrentCapEur: currentCap,
      exciseFuelRateChange: p.exFuel / 100,
      exciseTobaccoRateChange: p.exTobacco / 100,
      exciseAlcoholRateChange: p.exAlcohol / 100,
      gamblingNewRate: p.gambling / 100,
    },
  );
  const dyn = computeDynamicScenario(input, drawsFor(baseline.modIdentity));
  return {
    headlineEur: dyn.dynamicHeadlineEur,
    p5Eur: dyn.p5Eur,
    p95Eur: dyn.p95Eur,
    behavioralEur: dyn.dynamicHeadlineEur - score.central,
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
    case "pensionIndexation":
      return bg
        ? `индексация на пенсиите с ${p.pw}% тежест на инфлацията`
        : `pension indexation ${p.pw}% CPI-weighted`;
    case "pensionSupplement":
      return bg
        ? "ковид добавката не се индексира"
        : "COVID supplement not indexed";
    case "adminCut":
      return bg ? `администрация −${p.adm}%` : `administration −${p.adm}%`;
    case "minWageFreeze":
      return bg ? "замразена МРЗ" : "minimum wage frozen";
    case "defenseTarget": {
      // budget_policy_frag_def renders the tenths slider as (def/10).toFixed(1)
      const v = (p.def / 10).toFixed(1);
      return bg ? `отбрана ${v}% от БВП` : `defense ${v}% of GDP`;
    }
    case "wageIndexation":
      return bg
        ? `заплати в публичния сектор ${p.wi}%`
        : `public wages ${p.wi}%`;
    case "capitalChange":
      return bg ? `капиталов план ${p.kap}%` : `capital plan ${p.kap}%`;
    case "sscSelfPaid":
      return p.sspg
        ? bg
          ? "държавните служители плащат осигуровките си (с компенсация)"
          : "civil servants pay own contributions (grossed up)"
        : bg
          ? "държавните служители плащат осигуровките си"
          : "civil servants pay own contributions";
    case "healthContribution":
      return bg
        ? `здравна вноска +${p.hp} п.п.`
        : `health contribution +${p.hp} pp`;
    case "maternity":
      return p.mat === 0
        ? bg
          ? "майчинство: втората година отпада"
          : "maternity: second year cut"
        : bg
          ? `майчинство: втората година → ${p.mat} мес.`
          : `maternity: second year → ${p.mat} mo`;
    case "teachersPeg":
      return bg
        ? `учителски заплати → ${p.tp}% от средната`
        : `teachers' pay → ${p.tp}% of average`;
    case "pensionFloor":
      return bg
        ? `минимална пенсия → €${p.mp}/мес.`
        : `minimum pension → €${p.mp}/mo`;
    case "mpPayFreeze":
      return bg ? "замразени депутатски заплати" : "MP pay frozen";
    case "partySubsidy":
      return p.psub === 0
        ? bg
          ? "без партийни субсидии"
          : "no party subsidy"
        : bg
          ? `партийна субсидия €${(p.psub / 100).toFixed(2)}/глас`
          : `party subsidy €${(p.psub / 100).toFixed(2)}/vote`;
    case "exciseFuel": {
      const v = `${p.exFuel > 0 ? "+" : ""}${p.exFuel}%`;
      return bg ? `акциз върху горивата ${v}` : `fuel excise ${v}`;
    }
    case "exciseTobacco": {
      const v = `${p.exTobacco > 0 ? "+" : ""}${p.exTobacco}%`;
      return bg ? `акциз върху тютюна ${v}` : `tobacco excise ${v}`;
    }
    case "exciseAlcohol": {
      const v = `${p.exAlcohol > 0 ? "+" : ""}${p.exAlcohol}%`;
      return bg ? `акциз върху алкохола ${v}` : `alcohol excise ${v}`;
    }
    case "wineExcise":
      return bg
        ? `нов акциз върху виното €${p.wine}/хл`
        : `new wine excise €${p.wine}/hl`;
    case "gamblingGgr":
      return bg
        ? `данък върху хазарта (такса върху GGR) ${p.gambling}% (сега ${GAMBLING_DEF}%)`
        : `gambling tax (GGR fee) ${p.gambling}% (now ${GAMBLING_DEF}%)`;
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
  if (p.pw !== PW_DEF) parts.push(`pw=${p.pw}`);
  if (p.noSupp) parts.push("ks=0");
  if (p.adm !== 0) parts.push(`adm=${p.adm}`);
  if (p.mrzFreeze) parts.push("mrz=1");
  if (p.def !== DEF_DEF) parts.push(`def=${p.def}`);
  if (p.wi !== 0) parts.push(`wi=${p.wi}`);
  if (p.wi !== 0 && !p.wex) parts.push("wex=0");
  if (p.kap !== 0) parts.push(`kap=${p.kap}`);
  if (p.ssp) parts.push("ssp=1");
  if (p.ssp && p.sspg) parts.push("sspg=1");
  if (p.hp !== 0) parts.push(`hp=${p.hp}`);
  if (p.mp > 0) parts.push(`mp=${p.mp}`);
  if (p.tp > 0) parts.push(`tp=${p.tp}`);
  if (p.mat !== MAT_MONTHS) parts.push(`mat=${p.mat}`);
  if (p.mpf) parts.push("mpf=1");
  if (p.psub !== PSUB_DEF) parts.push(`psub=${p.psub}`);
  if (p.exFuel !== 0) parts.push(`excf=${p.exFuel}`);
  if (p.exTobacco !== 0) parts.push(`exct=${p.exTobacco}`);
  if (p.exAlcohol !== 0) parts.push(`exca=${p.exAlcohol}`);
  if (p.wine !== 0) parts.push(`winex=${p.wine}`);
  if (p.gambling !== GAMBLING_DEF) parts.push(`haz=${p.gambling}`);
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
  // The screen's default headline is the DYNAMIC (behavioral) estimate —
  // lead with it; the static figure rides as a fact.
  const dynScore = scoreDynamicScenario(baseline, change, score);
  const label = changeLabel(change, p, currentCap, ctx.lang);
  const locale = bg ? "bg-BG" : "en-US";
  const pctGdp = (dynScore.headlineEur / baseline.gdpEur) * 100;
  const pctGdpStr = `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(pctGdp)}%`;

  const facts: Record<string, string | number> = {
    change: label,
    delta_per_year: fmtDelta(dynScore.headlineEur, ctx.lang),
    share_of_gdp: pctGdpStr,
    baseline_year: baseline.baselineYear,
  };
  // Static counterpart + the behavioral correction, when they diverge.
  if (Math.abs(dynScore.behavioralEur) >= 5e5) {
    facts.delta_static = fmtDelta(score.central, ctx.lang);
    facts.behavior = fmtDelta(dynScore.behavioralEur, ctx.lang);
  }
  // Monte-Carlo 90% band on the headline (subsumes the old МОД-only band).
  if (Math.abs(dynScore.p95Eur - dynScore.p5Eur) > 1e6)
    facts.range = `${fmtDelta(dynScore.p5Eur, ctx.lang)} … ${fmtDelta(dynScore.p95Eur, ctx.lang)}`;
  // A no-op (the asked regime is already current law) — say so honestly.
  if (
    change.kind === "vatCategory" &&
    change.regime === VAT_GROUP_DEFAULT_REGIME[change.group]
  )
    facts.note = bg
      ? "Това е действащият режим — без промяна в приходите."
      : "That is already current law — no revenue change.";
  // Expenditure levers move the BALANCE, not revenue — flag it so the
  // narrator says "по бюджетното салдо" (hidden via the _id suffix).
  if (
    change.kind === "pensionIndexation" ||
    change.kind === "pensionSupplement" ||
    change.kind === "adminCut" ||
    change.kind === "minWageFreeze" ||
    change.kind === "defenseTarget" ||
    change.kind === "wageIndexation" ||
    change.kind === "capitalChange" ||
    change.kind === "sscSelfPaid" ||
    change.kind === "healthContribution" ||
    change.kind === "maternity" ||
    change.kind === "teachersPeg" ||
    change.kind === "pensionFloor" ||
    change.kind === "mpPayFreeze" ||
    change.kind === "partySubsidy"
  )
    facts.basis_id = "balance";
  // Maternity honesty note: the dynamic figure already credits the PIT+SSC of
  // mothers returning to work earlier (a recapture on top of the saving).
  if (change.kind === "maternity")
    facts.note = bg
      ? "Динамичната оценка добавя данъка и осигуровките на по-рано върналите се на работа майки (връщане към бюджета над спестяването)."
      : "The dynamic figure adds the income tax + contributions of mothers returning to work earlier (a recapture on top of the saving).";
  // Administration-cut honesty note: vacant positions absorb the cut first
  // and save ≈ nothing in cash terms.
  if (change.kind === "adminCut" && score.vacantAbsorbedShare != null) {
    const vac = Math.round(score.vacantAbsorbedShare * 100);
    facts.note = bg
      ? `${vac}% от съкращението се поема от незаети щатни бройки, които не спестяват реални разходи.`
      : `${vac}% of the cut is absorbed by vacant positions, which save almost nothing in cash terms.`;
  }
  // Defense scenarios are priced on the NATO definition (differs from the
  // national-accounts COFOG line) against the projected-year GDP.
  if (change.kind === "defenseTarget") {
    const cur = baseline.expenditure.defense.natoPctGdp.toFixed(1);
    facts.note = bg
      ? `По дефиницията на НАТО за разходи за отбрана (сега ~${cur.replace(".", ",")}% от БВП), спрямо прогнозния БВП.`
      : `On the NATO definition of defense spending (now ~${cur}% of GDP), priced against projected GDP.`;
  }
  // Capital-plan honesty note: only the historically executed share of the
  // plan turns into cash.
  if (change.kind === "capitalChange") {
    const r = Math.round(baseline.expenditure.capital.executionRate * 100);
    facts.note = bg
      ? `Касов ефект при ${r}% историческа изпълняемост на капиталовата програма.`
      : `Cash effect at the plan's ${r}% historical execution rate.`;
  }
  // Gross-up variant: the compensating salary increase undoes the saving.
  if (change.kind === "sscSelfPaid" && change.grossUp)
    facts.note = bg
      ? "С компенсиращо увеличение на заплатите реформата е фискално неутрална (±0)."
      : "With a compensating salary gross-up the reform is fiscally neutral (±0).";
  // Tobacco excise: the dynamic figure already nets the demand contraction and
  // the shift to the illicit market — on a big hike the gain shrinks (Laffer).
  if (change.kind === "exciseTobacco")
    facts.note = bg
      ? "Динамичната оценка включва свиване на търсенето и преминаване към нелегален пазар — при голямо вдигане ефектът се изяжда (кривата на Лафер)."
      : "The dynamic figure nets the demand contraction and the shift to the illicit market — on a big hike the gain is eaten away (the Laffer turn).";
  // Wine excise: introduced from €0; the dynamic figure accounts for leakage to
  // untaxed home production (the taxable commercial base is the smaller share).
  if (change.kind === "wineExcise")
    facts.note = bg
      ? "Нов акциз от €0 — динамичната оценка отчита изтичане към необложеното домашно производство (облага се само търговската част)."
      : "A new excise from €0 — the dynamic figure accounts for leakage to untaxed home production (only the commercial base is taxed).";
  // Gambling GGR fee: the base (GGR ~€716M) is НАП/industry-reported, not a
  // published budget line; the dynamic figure already nets the migration of
  // licensed play to unlicensed/offshore operators — on a big hike the gain
  // shrinks (a strong Laffer case).
  if (change.kind === "gamblingGgr")
    facts.note = bg
      ? "Базата (БГП ~716 млн €) е по данни на НАП/бранша, не е отделен бюджетен ред. Динамичната оценка отчита изместване към нелицензирани/офшорни оператори — при високи ставки приходът може да е доста под статичния (кривата на Лафер)."
      : "The base (GGR ~€716M) is НАП/industry-reported, not a standalone budget line. The dynamic figure nets the migration to unlicensed/offshore operators — at high rates the gain lands well below the static figure (the Laffer turn).";

  // hidden deep-link payload (keys ending in _id are not rendered as facts)
  const qs = scenarioQuery(p, currentCap);
  facts.scenario_id = qs;

  return {
    tool: "simulateTaxChange",
    domain: "fiscal",
    kind: "scalar",
    title: bg ? `Какво става, ако: ${label}` : `What if: ${label}`,
    subtitle: bg
      ? `Динамична оценка на база изпълнението за ${baseline.baselineYear} — с поведенчески реакции и макроефект (както на /budget/simulator).`
      : `Dynamic estimate on the ${baseline.baselineYear} execution base — with behavioral response and macro feedback (as on /budget/simulator).`,
    viz: "none",
    value: Math.round(dynScore.headlineEur),
    valueFormat: "int",
    facts,
    provenance: ["budget/derived/policy_baseline.json"],
  };
};
