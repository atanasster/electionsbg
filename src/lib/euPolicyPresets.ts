// EU country comparators for the budget policy simulator: each supported
// lever carries a list of "like in <country>" options that snap the lever to
// that country's actual policy, with a one-line sourced note. All values
// verified 2026-06-11 against PwC tax summaries (Dec-2025–Apr-2026
// revisions), EMTA, the NATO defence-expenditure compendium (June 2025,
// 2025 estimates), Sotsiaalkindlustusamet/Försäkringskassan/BMBFSFJ and
// service-public.fr/DRV; notable recent changes are in the notes (Estonia's
// 24% PIT/CIT rise cancelled Dec 2025, Slovakia's 4-bracket PIT from 2026,
// Spain's food-VAT holiday lapsed). Bilingual strings live inline — this is
// sourced DATA, like VAT_SLICES, not UI chrome.

export interface BiText {
  bg: string;
  en: string;
}

/** Lever values an option applies — same units as the simulator state:
 *  integer percent (def in tenths of % GDP, nm in EUR/month, mat in
 *  months of paid second-year leave kept). */
export interface EuPresetApply {
  vatStd?: number;
  vatRed?: number;
  pit?: number;
  nm?: number;
  b2?: { t2: number; r2: number } | null;
  corp?: number;
  def?: number;
  mat?: number;
  pw?: number;
}

export interface EuPresetOption {
  id: string;
  /** ISO country code for the flag chip. */
  cc: string;
  label: BiText;
  note: BiText;
  apply: EuPresetApply;
}

export type EuLeverId =
  | "vatStd"
  | "vatRed"
  | "pit"
  | "corp"
  | "def"
  | "mat"
  | "pw";

export const EU_LEVER_PRESETS: Record<EuLeverId, EuPresetOption[]> = {
  vatStd: [
    {
      id: "vat_hu",
      cc: "HU",
      label: { bg: "Унгария — 27%", en: "Hungary — 27%" },
      note: {
        bg: "Най-високата стандартна ставка в ЕС (от 2012 г.).",
        en: "The highest standard rate in the EU (since 2012).",
      },
      apply: { vatStd: 27 },
    },
    {
      id: "vat_dk",
      cc: "DK",
      label: { bg: "Дания — 25%", en: "Denmark — 25%" },
      note: {
        bg: "Единна ставка без намалени ставки — единствената в ЕС.",
        en: "A single rate with no reduced rates — unique in the EU.",
      },
      apply: { vatStd: 25 },
    },
    {
      id: "vat_gr",
      cc: "GR",
      label: { bg: "Гърция — 24%", en: "Greece — 24%" },
      note: {
        bg: "Вдигната по време на дълговата криза (юни 2016 г.).",
        en: "Raised during the debt crisis (June 2016).",
      },
      apply: { vatStd: 24 },
    },
    {
      id: "vat_ee",
      cc: "EE",
      label: { bg: "Естония — 24%", en: "Estonia — 24%" },
      note: {
        bg: "Вдигната от 22% на 24% от юли 2025 г. — окончателно, след отпадането на „данъка за сигурност“.",
        en: "Raised from 22% to 24% in July 2025 — made permanent after the security tax was dropped.",
      },
      apply: { vatStd: 24 },
    },
    {
      id: "vat_ie",
      cc: "IE",
      label: { bg: "Ирландия — 23%", en: "Ireland — 23%" },
      note: {
        bg: "Стандартна ставка 23% от 2012 г.",
        en: "Standard rate of 23% since 2012.",
      },
      apply: { vatStd: 23 },
    },
    {
      id: "vat_de",
      cc: "DE",
      label: { bg: "Германия — 19%", en: "Germany — 19%" },
      note: {
        bg: "Под средното за ЕС; непроменена от 2007 г.",
        en: "Below the EU average; unchanged since 2007.",
      },
      apply: { vatStd: 19 },
    },
    {
      id: "vat_lu",
      cc: "LU",
      label: { bg: "Люксембург — 17%", en: "Luxembourg — 17%" },
      note: {
        bg: "Най-ниската стандартна ставка в ЕС (върната на 17% от 2024 г. след временните 16%).",
        en: "The lowest standard rate in the EU (back at 17% since 2024 after a temporary 16%).",
      },
      apply: { vatStd: 17 },
    },
  ],
  vatRed: [
    {
      id: "vatr_gr",
      cc: "GR",
      label: { bg: "Гърция — 13%", en: "Greece — 13%" },
      note: {
        bg: "13% за основни храни, ресторанти, хотели; 6% за лекарства и книги.",
        en: "13% for basic foods, restaurants, hotels; 6% for medicines and books.",
      },
      apply: { vatRed: 13 },
    },
    {
      id: "vatr_es",
      cc: "ES",
      label: { bg: "Испания — 10%", en: "Spain — 10%" },
      note: {
        bg: "Намалена ставка 10%; хляб, мляко, книги и лекарства на 4% свръхнамалена. Нулевата ставка за храни от 2022–24 г. отпадна.",
        en: "Reduced rate of 10%; bread, milk, books and medicines at a 4% super-reduced rate. The 2022-24 zero rate on staples has lapsed.",
      },
      apply: { vatRed: 10 },
    },
    {
      id: "vatr_de",
      cc: "DE",
      label: { bg: "Германия — 7%", en: "Germany — 7%" },
      note: {
        bg: "Намалена ставка 7% за храни и книги.",
        en: "Reduced rate of 7% for food and books.",
      },
      apply: { vatRed: 7 },
    },
    {
      id: "vatr_be",
      cc: "BE",
      label: { bg: "Белгия — 6%", en: "Belgium — 6%" },
      note: {
        bg: "Намалена ставка 6% за основни храни, лекарства, ток и газ за домакинствата.",
        en: "Reduced rate of 6% for basic food, medicines, household electricity and gas.",
      },
      apply: { vatRed: 6 },
    },
  ],
  pit: [
    {
      id: "pit_ee",
      cc: "EE",
      label: { bg: "Естония — 22% + минимум", en: "Estonia — 22% + minimum" },
      note: {
        bg: "Плосък данък 22% (планираните 24% бяха отменени през декември 2025 г.) с универсален необлагаем минимум €700/мес. от 2026 г., без топене при високи доходи.",
        en: "Flat 22% (the planned 24% was cancelled in December 2025) with a universal €700/mo tax-free minimum from 2026, no phase-out.",
      },
      apply: { pit: 22, nm: 700, b2: null },
    },
    {
      id: "pit_sk",
      cc: "SK",
      label: { bg: "Словакия — 19/25%", en: "Slovakia — 19/25%" },
      note: {
        bg: "Приближение: от 2026 г. скобите са четири (19/25/30/35%), 25% започва от ~€3 665/мес.; личната отстъпка €497/мес. се топи при високи доходи. Тук — първите две скоби.",
        en: "Approximation: since 2026 there are four brackets (19/25/30/35%), 25% from ~€3,665/mo; the €497/mo allowance phases out at high incomes. Modeled here: the first two brackets.",
      },
      apply: { pit: 19, nm: 500, b2: { t2: 3700, r2: 25 } },
    },
    {
      id: "pit_cz",
      cc: "CZ",
      label: { bg: "Чехия — 15/23%", en: "Czechia — 15/23%" },
      note: {
        bg: "15% до ~€5 950/мес., 23% отгоре (36 средни заплати годишно); облекчението е данъчен кредит, не минимум — приближение.",
        en: "15% up to ~€5,950/mo, 23% above (36 average wages per year); relief is a tax credit, not an exemption — approximate.",
      },
      apply: { pit: 15, nm: 0, b2: { t2: 5900, r2: 23 } },
    },
  ],
  corp: [
    {
      id: "corp_hu",
      cc: "HU",
      label: { bg: "Унгария — 9%", en: "Hungary — 9%" },
      note: {
        bg: "Най-ниската корпоративна ставка в ЕС (от 2017 г.).",
        en: "The lowest corporate rate in the EU (since 2017).",
      },
      apply: { corp: 9 },
    },
    {
      id: "corp_ee",
      cc: "EE",
      label: { bg: "Естония — 22%", en: "Estonia — 22%" },
      note: {
        bg: "Дължи се само при разпределяне на печалбата (22/78 от 2025 г.) — неразпределената не се облага; планираните 24% бяха отменени.",
        en: "Due only on distributed profits (22/78 since 2025) — retained earnings untaxed; the planned 24% was cancelled.",
      },
      apply: { corp: 22 },
    },
    {
      id: "corp_fr",
      cc: "FR",
      label: { bg: "Франция — 25%", en: "France — 25%" },
      note: {
        bg: "Стандартна ставка 25%; извънредна надбавка за групи с оборот ≥ €1,5 млрд, удължена и през 2026 г.",
        en: "Standard rate of 25%; an exceptional surtax for groups with turnover ≥ €1.5bn, extended into 2026.",
      },
      apply: { corp: 25 },
    },
    {
      id: "corp_de",
      cc: "DE",
      label: { bg: "Германия — ≈30%", en: "Germany — ≈30%" },
      note: {
        bg: "Комбинирана ефективна ставка ~29,9% (федерален данък + надбавка + търговски данък); федералната част пада поетапно от 2028 г.",
        en: "Combined effective rate of ~29.9% (federal tax + surcharge + trade tax); the federal part falls in steps from 2028.",
      },
      apply: { corp: 30 },
    },
  ],
  def: [
    {
      id: "def_pl",
      cc: "PL",
      label: { bg: "Полша — 4,5%", en: "Poland — 4.5%" },
      note: {
        bg: "4,48% — най-високият дял в НАТО (оценка за 2025 г.).",
        en: "4.48% — the highest share in NATO (2025 estimate).",
      },
      apply: { def: 45 },
    },
    {
      id: "def_lt",
      cc: "LT",
      label: { bg: "Литва — 4,0%", en: "Lithuania — 4.0%" },
      note: {
        bg: "4,00% по оценката на НАТО за 2025 г. (3,1% през 2024 г.).",
        en: "4.00% per the NATO 2025 estimate (3.1% in 2024).",
      },
      apply: { def: 40 },
    },
    {
      id: "def_ee",
      cc: "EE",
      label: { bg: "Естония — 3,4%", en: "Estonia — 3.4%" },
      note: {
        bg: "3,38% (оценка 2025 г.); обявена цел ≥5% от 2026 г.",
        en: "3.38% (2025 estimate); a stated target of ≥5% from 2026.",
      },
      apply: { def: 34 },
    },
    {
      id: "def_gr",
      cc: "GR",
      label: { bg: "Гърция — 2,9%", en: "Greece — 2.9%" },
      note: {
        bg: "2,85% по оценката на НАТО за 2025 г. — трайно над 2%.",
        en: "2.85% per the NATO 2025 estimate — persistently above 2%.",
      },
      apply: { def: 29 },
    },
    {
      id: "def_de",
      cc: "DE",
      label: { bg: "Германия — ≈2,4%", en: "Germany — ≈2.4%" },
      note: {
        bg: "≈2,4% за 2025 г. по националния бюджет (НАТО не публикува оценка за Германия в изданието от юни 2025 г.).",
        en: "≈2.4% for 2025 per the federal budget (NATO's June 2025 edition reports no estimate for Germany).",
      },
      apply: { def: 24 },
    },
    {
      id: "def_it",
      cc: "IT",
      label: { bg: "Италия — 2,0%", en: "Italy — 2.0%" },
      note: {
        bg: "2,01% — достигна целта на НАТО едва през 2025 г. (1,5% през 2024 г.).",
        en: "2.01% — reached the NATO target only in 2025 (1.5% in 2024).",
      },
      apply: { def: 20 },
    },
  ],
  mat: [
    {
      id: "mat_ee",
      cc: "EE",
      label: { bg: "Естония — ≈20 мес.", en: "Estonia — ≈20 mo" },
      note: {
        bg: "605 дни родителско обезщетение на 100% от дохода — ~6,5 мес. добре платени отвъд българската първа година; приближено като 6 мес.",
        en: "605 days of parental benefit at 100% of income — ~6.5 well-paid months beyond Bulgaria's first year; approximated as 6 months.",
      },
      apply: { mat: 6 },
    },
    {
      id: "mat_se",
      cc: "SE",
      label: {
        bg: "Швеция — ≈13 мес. + добавка",
        en: "Sweden — ≈13 mo + flat",
      },
      note: {
        bg: "390 добре платени дни (~80%) + 90 дни по ~180 SEK — добре платената част свършва с първата година; приближено като 3 мес. на ниска ставка.",
        en: "390 well-paid days (~80%) + 90 days at ~SEK 180 — the well-paid part ends with year one; approximated as 3 low-rate months.",
      },
      apply: { mat: 3 },
    },
    {
      id: "mat_de",
      cc: "DE",
      label: { bg: "Германия — 12–14 мес.", en: "Germany — 12-14 mo" },
      note: {
        bg: "Elterngeld 65–67% за 12–14 мес., след това няма платен отпуск — еквивалент на отпадане на втората година.",
        en: "Elterngeld at 65-67% for 12-14 months, nothing paid afterwards — equivalent to dropping the second year.",
      },
      apply: { mat: 0 },
    },
  ],
  pw: [
    {
      id: "pw_fr",
      cc: "FR",
      label: { bg: "Франция — само инфлация", en: "France — CPI only" },
      note: {
        bg: "Основните пенсии се индексират само с инфлацията: +0,9% от януари 2026 г. (предложеното замразяване отпадна в парламента).",
        en: "Base pensions are indexed to inflation only: +0.9% from January 2026 (the proposed freeze was dropped in parliament).",
      },
      apply: { pw: 100 },
    },
    {
      id: "pw_de",
      cc: "DE",
      label: { bg: "Германия — само доходи", en: "Germany — wages only" },
      note: {
        bg: "Пенсиите следват ръста на заплатите (Rentenanpassung): +4,24% от юли 2026 г.",
        en: "Pensions track wage growth (Rentenanpassung): +4.24% from July 2026.",
      },
      apply: { pw: 0 },
    },
  ],
};
