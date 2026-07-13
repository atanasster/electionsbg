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
//
// Excise blocks (exDiesel/exPetrol/exCigarettes/exSpirits/exWine) added
// 2026-06-14. Fuel + cigarettes from the Tax Foundation EU energy/cigarette
// tables (1 Jan 2026) — VALUE-checked by the eu_excise_rates watcher. Spirits +
// wine from the EC DG TAXUD "Taxes in Europe Database" (TEDB) v3 REST API, the
// authoritative per-state €/hl source — VALUE-checked by eu_alcohol_excise and
// refreshed against it 2026-06-15 (SE spirits 5000→4775, SE wine 253→268, HU
// spirits 1555→1581; PL/FR/EE/IE/DE/GR/BG already exact). BG anchors confirmed
// against PwC (diesel €330.29, petrol €363.02, spirits €562.43, wine €0,
// cigarettes min total €113.51). The DE `def` note reflects the NATO 2025
// estimate (2.40%), which that edition does report.

/** The NATO defence-expenditure compendium edition the `def` options below
 *  encode (June-2025 PDF, 2025 estimates). Compared against the live PDF
 *  probe by scripts/budget/check_policy_anchors.ts — bump it together with
 *  the def values when a new edition lands. */
export const NATO_COMPENDIUM_EDITION = 2026;

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
  /** Excise levers — absolute rates in the simulator's slider units:
   *  diesel/petrol €/1000 L, cigarettes €/1000, spirits €/hl PA, wine €/hl. */
  exDiesel?: number;
  exPetrol?: number;
  exCigarettes?: number;
  exSpirits?: number;
  exWine?: number;
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
  | "pw"
  | "exDiesel"
  | "exPetrol"
  | "exCigarettes"
  | "exSpirits"
  | "exWine";

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
        bg: "4,48% — най-високият дял в НАТО (оценка за 2026 г.).",
        en: "4.48% — the highest share in NATO (2026 estimate).",
      },
      apply: { def: 45 },
    },
    {
      id: "def_lt",
      cc: "LT",
      label: { bg: "Литва — 5,3%", en: "Lithuania — 5.3%" },
      note: {
        bg: "5,33% по оценката на НАТО за 2026 г. (3,1% през 2024 г.).",
        en: "5.33% per the NATO 2026 estimate (3.1% in 2024).",
      },
      apply: { def: 53 },
    },
    {
      id: "def_ee",
      cc: "EE",
      label: { bg: "Естония — 5,1%", en: "Estonia — 5.1%" },
      note: {
        bg: "5,10% (оценка 2026 г.) — достигна обявената цел ≥5%.",
        en: "5.10% (2026 estimate) — has reached its stated ≥5% target.",
      },
      apply: { def: 51 },
    },
    {
      id: "def_gr",
      cc: "GR",
      label: { bg: "Гърция — 3,7%", en: "Greece — 3.7%" },
      note: {
        bg: "3,65% по оценката на НАТО за 2026 г. — трайно над 2%.",
        en: "3.65% per the NATO 2026 estimate — persistently above 2%.",
      },
      apply: { def: 37 },
    },
    {
      id: "def_de",
      cc: "DE",
      label: { bg: "Германия — 2,7%", en: "Germany — 2.7%" },
      note: {
        bg: "2,69% по оценката на НАТО за 2026 г.",
        en: "2.69% per the NATO 2026 estimate.",
      },
      apply: { def: 27 },
    },
    {
      id: "def_it",
      cc: "IT",
      label: { bg: "Италия — 2,1%", en: "Italy — 2.1%" },
      note: {
        bg: "2,10% — достигна целта на НАТО през 2025 г. (1,5% през 2024 г.).",
        en: "2.10% — reached the NATO target in 2025 (1.5% in 2024).",
      },
      apply: { def: 21 },
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
  exDiesel: [
    {
      id: "dies_it",
      cc: "IT",
      label: { bg: "Италия — 632 €/1000 л", en: "Italy — €632/1000 L" },
      note: {
        bg: "Сред най-високите акцизи на дизел в ЕС.",
        en: "Among the EU's highest diesel excise.",
      },
      apply: { exDiesel: 632 },
    },
    {
      id: "dies_be",
      cc: "BE",
      label: { bg: "Белгия — 600 €/1000 л", en: "Belgium — €600/1000 L" },
      note: { bg: "Високо облагане.", en: "Heavily taxed." },
      apply: { exDiesel: 600 },
    },
    {
      id: "dies_fr",
      cc: "FR",
      label: { bg: "Франция — 594 €/1000 л", en: "France — €594/1000 L" },
      note: {
        bg: "Чувствително над средното за ЕС.",
        en: "Well above the EU average.",
      },
      apply: { exDiesel: 594 },
    },
    {
      id: "dies_de",
      cc: "DE",
      label: { bg: "Германия — 470 €/1000 л", en: "Germany — €470/1000 L" },
      note: { bg: "Над средното за ЕС.", en: "Above the EU average." },
      apply: { exDiesel: 470 },
    },
    {
      id: "dies_pl",
      cc: "PL",
      label: { bg: "Полша — 391 €/1000 л", en: "Poland — €391/1000 L" },
      note: {
        bg: "Малко над минимума на ЕС (330 €); България е на самия минимум.",
        en: "Just above the EU floor (€330); Bulgaria sits at the floor.",
      },
      apply: { exDiesel: 391 },
    },
  ],
  exPetrol: [
    {
      id: "petr_nl",
      cc: "NL",
      label: {
        bg: "Нидерландия — 845 €/1000 л",
        en: "Netherlands — €845/1000 L",
      },
      note: {
        bg: "Най-високият акциз на бензин в ЕС.",
        en: "The EU's highest petrol excise.",
      },
      apply: { exPetrol: 845 },
    },
    {
      id: "petr_it",
      cc: "IT",
      label: { bg: "Италия — 713 €/1000 л", en: "Italy — €713/1000 L" },
      note: { bg: "Сред най-високите в ЕС.", en: "Among the EU's highest." },
      apply: { exPetrol: 713 },
    },
    {
      id: "petr_gr",
      cc: "GR",
      label: { bg: "Гърция — 700 €/1000 л", en: "Greece — €700/1000 L" },
      note: { bg: "Високо.", en: "High." },
      apply: { exPetrol: 700 },
    },
    {
      id: "petr_fr",
      cc: "FR",
      label: { bg: "Франция — 683 €/1000 л", en: "France — €683/1000 L" },
      note: { bg: "Високо.", en: "High." },
      apply: { exPetrol: 683 },
    },
    {
      id: "petr_de",
      cc: "DE",
      label: { bg: "Германия — 655 €/1000 л", en: "Germany — €655/1000 L" },
      note: {
        bg: "Около двойно над българския (363 €, малко над минимума на ЕС).",
        en: "Roughly double Bulgaria's (€363, just above the EU floor).",
      },
      apply: { exPetrol: 655 },
    },
  ],
  exCigarettes: [
    {
      id: "cig_bg_zads2027",
      cc: "BG",
      label: {
        bg: "ЗАДС календар 2027 — 120 €/1000",
        en: "ZADS calendar 2027 — €120/1000",
      },
      note: {
        bg: "Ускореният акцизен календар по ЗДБРБ-2026: 234 лв/1000 (≈120 €) от 01.08.2026, +12 лв/год до 2029.",
        en: "The ЗДБРБ-2026 accelerated excise calendar: BGN 234/1000 (≈€120) from 01.08.2026, +12 BGN/yr to 2029.",
      },
      // 120 ≈ cigaretteAcceleratedRateEur() (234 BGN ÷ 1.95583 = 119.64),
      // rounded to the integer cigarette slider.
      apply: { exCigarettes: 120 },
    },
    {
      id: "cig_ie",
      cc: "IE",
      label: { bg: "Ирландия — 535 €/1000", en: "Ireland — €535/1000" },
      note: {
        bg: "Най-високият акциз на цигари в ЕС.",
        en: "The EU's highest cigarette excise.",
      },
      apply: { exCigarettes: 535 },
    },
    {
      id: "cig_fr",
      cc: "FR",
      label: { bg: "Франция — 404 €/1000", en: "France — €404/1000" },
      note: { bg: "Сред най-високите в ЕС.", en: "Among the EU's highest." },
      apply: { exCigarettes: 404 },
    },
    {
      id: "cig_nl",
      cc: "NL",
      label: { bg: "Нидерландия — 388 €/1000", en: "Netherlands — €388/1000" },
      note: { bg: "Високо.", en: "High." },
      apply: { exCigarettes: 388 },
    },
    {
      id: "cig_de",
      cc: "DE",
      label: { bg: "Германия — 195 €/1000", en: "Germany — €195/1000" },
      note: {
        bg: "Близо двойно над българския.",
        en: "Nearly double Bulgaria's.",
      },
      apply: { exCigarettes: 195 },
    },
    {
      id: "cig_gr",
      cc: "GR",
      label: { bg: "Гърция — 137 €/1000", en: "Greece — €137/1000" },
      note: {
        bg: "Над българския (~114 €); минимумът на ЕС е 90 €/1000 и поне 60% от цената.",
        en: "Above Bulgaria's (~€114); the EU floor is €90/1000 and ≥60% of price.",
      },
      apply: { exCigarettes: 137 },
    },
  ],
  exSpirits: [
    {
      id: "spir_se",
      cc: "SE",
      label: { bg: "Швеция — 4775 €/хл", en: "Sweden — €4775/hl" },
      note: {
        bg: "Сред най-високите в ЕС (расте всяка година).",
        en: "Among the EU's highest (indexed yearly).",
      },
      apply: { exSpirits: 4775 },
    },
    {
      id: "spir_ie",
      cc: "IE",
      label: { bg: "Ирландия — ~4257 €/хл", en: "Ireland — ~€4257/hl" },
      note: { bg: "Много високо.", en: "Very high." },
      apply: { exSpirits: 4257 },
    },
    {
      id: "spir_pl",
      cc: "PL",
      label: { bg: "Полша — 1965 €/хл", en: "Poland — €1965/hl" },
      note: {
        bg: "Над три пъти над българския (8391 PLN/хл за 2026 г., +5% годишно).",
        en: "Over triple Bulgaria's (PLN 8,391/hl in 2026, +5% a year).",
      },
      apply: { exSpirits: 1965 },
    },
    {
      id: "spir_fr",
      cc: "FR",
      label: { bg: "Франция — 1932 €/хл", en: "France — €1932/hl" },
      note: {
        bg: "Над три пъти над българския (ставка за 2026 г.).",
        en: "Over triple Bulgaria's (2026 rate).",
      },
      apply: { exSpirits: 1932 },
    },
    {
      id: "spir_de",
      cc: "DE",
      label: { bg: "Германия — 1303 €/хл", en: "Germany — €1303/hl" },
      note: {
        bg: "Над двойно над българския (562 €, малко над минимума от 550 €).",
        en: "Over double Bulgaria's (€562, just above the €550 floor).",
      },
      apply: { exSpirits: 1303 },
    },
  ],
  exWine: [
    {
      id: "wine_ie",
      cc: "IE",
      label: { bg: "Ирландия — 425 €/хл", en: "Ireland — €425/hl" },
      note: {
        bg: "Най-високият в ЕС (~3,19 € на бутилка).",
        en: "The EU's highest (~€3.19 per bottle).",
      },
      apply: { exWine: 425 },
    },
    {
      id: "wine_se",
      cc: "SE",
      label: { bg: "Швеция — 268 €/хл", en: "Sweden — €268/hl" },
      note: { bg: "Високо.", en: "High." },
      apply: { exWine: 268 },
    },
    {
      id: "wine_dk",
      cc: "DK",
      label: { bg: "Дания — 202 €/хл", en: "Denmark — €202/hl" },
      note: { bg: "Високо.", en: "High." },
      apply: { exWine: 202 },
    },
    {
      id: "wine_nl",
      cc: "NL",
      label: { bg: "Нидерландия — 96 €/хл", en: "Netherlands — €96/hl" },
      note: { bg: "Средно ниво.", en: "Mid-level." },
      apply: { exWine: 96 },
    },
    {
      id: "wine_fr",
      cc: "FR",
      label: { bg: "Франция — 4 €/хл", en: "France — €4/hl" },
      note: {
        bg: "Символична ставка; повечето членки (вкл. България) облагат виното с 0.",
        en: "Token rate; most members (incl. Bulgaria) zero-rate wine.",
      },
      apply: { exWine: 4 },
    },
  ],
};

// Whole-country quick-select profiles for the simulator. The inverse of the
// per-lever comparators above: pick one country and EVERY comparable lever
// snaps to that country's policy at once (like the domestic preset chips, but
// cross-border). Each profile sets VAT std/reduced, the PIT schedule, the
// corporate rate, defence %GDP, maternity, pension indexation and the five
// excises; spending levers with no clean cross-country analogue (МОД cap,
// pension floor, admin cut, gambling) stay at BG current law.
//
// Sourcing & methodology (verified 2026-06-14, same sources as the per-lever
// blocks — PwC Worldwide Tax Summaries, Tax Foundation 2026 EU VAT/energy/
// cigarette tables, EC DG TAXUD Excise Duty Tables, NATO June-2025 compendium,
// national social-security agencies):
//   • Where a country already appears in EU_LEVER_PRESETS for a lever, the
//     profile reuses that exact value, so the chip and the per-lever popover
//     can never disagree.
//   • Credit-based PIT reliefs (PL, IE, GR, SE) are modelled as the equivalent
//     0%-band: refundable credit ÷ entry rate (e.g. IE €4,000 ÷ 20% ≈
//     €1,667/mo; SE's grundavdrag + jobbskatteavdrag earned-income credit ÷
//     the ~32% municipal rate ≈ €1,100/mo — far above the ~€300 grundavdrag
//     alone, which is what makes Sweden's effective low-wage tax modest).
//     Headline-allowance systems (EE €700) use the allowance directly.
//   • Cigarette figures are Tax-Foundation total-at-weighted-average-price per
//     1000 (the cross-EU comparable basis), like the per-lever block.
//   • Spirits/wine reuse the per-lever block values (PL/FR refreshed to the
//     current 2026 statutory rates; SE/IE still conservative approximations)
//     and the current national rate for EE/HU/GR.
//   • IE omits defence (≈0.2% GDP is below the slider floor and is not part of
//     Ireland's tax identity); HU/GR/IE omit pension indexation where their
//     rule already coincides with BG's 50/50 Swiss default.
// Bilingual name/note strings live inline — sourced DATA, like the blocks above.

export interface CountryProfile {
  id: string;
  /** ISO country code for the flag chip. */
  cc: string;
  name: BiText;
  /** One-line summary of what makes this country's fiscal model distinct. */
  note: BiText;
  /** The full lever bundle the chip applies (same units as EuPresetApply). */
  apply: EuPresetApply;
}

export const COUNTRY_PROFILES: CountryProfile[] = [
  {
    id: "country_ee",
    cc: "EE",
    name: { bg: "Естония", en: "Estonia" },
    note: {
      bg: "Нисък плосък данък (22%) с необлагаем минимум €700 и корпоративен данък само при разпределена печалба, но високо ДДС без намалена ставка за храни.",
      en: "Low 22% flat tax with a €700 tax-free minimum and corporate tax only on distributed profit, but high VAT with no reduced food rate.",
    },
    apply: {
      vatStd: 24,
      vatRed: 24,
      pit: 22,
      nm: 700,
      b2: null,
      corp: 22,
      def: 51,
      mat: 6,
      pw: 20,
      exDiesel: 428,
      exPetrol: 591,
      exCigarettes: 204,
      exSpirits: 2281,
      exWine: 179,
    },
  },
  {
    id: "country_pl",
    cc: "PL",
    name: { bg: "Полша", en: "Poland" },
    note: {
      bg: "Прогресивен данък 12/32% с голям необлагаем минимум, стандартно ДДС 23% и най-високите отбранителни разходи в НАТО (~4,5% от БВП).",
      en: "Progressive 12/32% income tax with a large tax-free amount, 23% VAT and NATO's highest defence spend (~4.5% of GDP).",
    },
    apply: {
      vatStd: 23,
      vatRed: 5,
      pit: 12,
      nm: 580,
      b2: { t2: 2326, r2: 32 },
      corp: 19,
      def: 45,
      mat: 2,
      pw: 80,
      exDiesel: 391,
      exPetrol: 423,
      exCigarettes: 147,
      exSpirits: 1965,
      // 2026 statutory rate PLN 233/hl (the +5%/yr indexation moved it off the
      // 2025 PLN 222/hl ≈ €52); €54 at ~4.30 PLN/EUR.
      exWine: 54,
    },
  },
  {
    id: "country_hu",
    cc: "HU",
    name: { bg: "Унгария", en: "Hungary" },
    note: {
      bg: "Най-високото ДДС в ЕС (27%) и най-ниският корпоративен данък (9%), с плосък данък 15% и пенсии, индексирани изцяло по инфлацията.",
      en: "The EU's highest VAT (27%) and lowest corporate tax (9%), a flat 15% income tax and pensions indexed purely to inflation.",
    },
    apply: {
      vatStd: 27,
      // Basic foodstuffs / bakery / dairy / hotels sit in Hungary's 18% reduced
      // band (the bulk of a food basket); the 5% band is the narrower set (meat,
      // eggs, fresh milk, books, medicines).
      vatRed: 18,
      pit: 15,
      nm: 0,
      b2: null,
      corp: 9,
      def: 21,
      // GYED pays ~70% of prior earnings continuously through the child's 2nd
      // birthday, so the well-paid second year is effectively full (not 8 mo).
      mat: 12,
      pw: 100,
      exDiesel: 383,
      exPetrol: 409,
      exCigarettes: 154,
      exSpirits: 1581,
      exWine: 0,
    },
  },
  {
    id: "country_de",
    cc: "DE",
    name: { bg: "Германия", en: "Germany" },
    note: {
      bg: "Рязко прогресивен данък (14–42%) с висок необлагаем минимум, корпоративен данък ~30% и пенсии, обвързани със заплатите.",
      en: "Steeply progressive income tax (14–42%) with a high tax-free allowance, a ~30% corporate rate and pensions tied to wages.",
    },
    apply: {
      vatStd: 19,
      vatRed: 7,
      pit: 14,
      nm: 1029,
      // 2026 Spitzensteuersatz threshold €69 879/yr (the nm above is already on
      // the 2026 Grundfreibetrag €12 348; 5707 was the 2025 €68 481 threshold).
      b2: { t2: 5823, r2: 42 },
      corp: 30,
      def: 27,
      mat: 0,
      pw: 0,
      exDiesel: 470,
      exPetrol: 655,
      exCigarettes: 195,
      exSpirits: 1303,
      exWine: 0,
    },
  },
  {
    id: "country_fr",
    cc: "FR",
    name: { bg: "Франция", en: "France" },
    note: {
      bg: "Високи данъци и акцизи: прогресивен данък до 45%, корпоративен 25% и пенсии, индексирани само по инфлацията.",
      en: "High taxes and excises: a progressive income tax up to 45%, a 25% corporate rate and CPI-only pension indexation.",
    },
    apply: {
      vatStd: 20,
      // France taxes most groceries at 5,5% (10% only for immediate-consumption
      // / restaurant food); 6 matched no French rate.
      vatRed: 5,
      pit: 11,
      nm: 967,
      // The modal upper-middle band (30% from ~€29 315/yr ≈ €2 443/mo), not the
      // 41% top rate (€84k/yr) — that threshold sits above the modeled BG wage
      // range, so a top-rate bracket would never fire and France would collapse
      // to a flat 11%. 30% is the rate most French upper-middle earners pay.
      b2: { t2: 2443, r2: 30 },
      corp: 25,
      def: 22,
      mat: 2,
      pw: 100,
      exDiesel: 594,
      exPetrol: 683,
      exCigarettes: 404,
      exSpirits: 1932,
      exWine: 4,
    },
  },
  {
    id: "country_se",
    cc: "SE",
    name: { bg: "Швеция", en: "Sweden" },
    note: {
      bg: "Скандинавски модел: 25% ДДС, предимно общински данък ~32% с държавна добавка за високите доходи и пенсии по ръста на заплатите.",
      en: "Nordic model: 25% VAT, a mainly municipal ~32% income tax with a national top-up on high earners and wage-indexed pensions.",
    },
    apply: {
      vatStd: 25,
      vatRed: 12,
      pit: 32,
      // grundavdrag (~€300/mo at most) + the jobbskatteavdrag earned-income
      // credit converted to a 0%-band (credit ÷ ~32% municipal rate), the same
      // way IE/GR/PL credits are — see the header note. The old €300 (basic
      // deduction only) overstated a mid earner's tax (~28% vs Sweden's ~18%).
      nm: 1100,
      b2: { t2: 4743, r2: 52 },
      // bolagsskatt 20,6% (the corp lever carries one decimal); the proposed
      // 2026 cut to 20% was dropped from the final budget.
      corp: 20.6,
      def: 32,
      mat: 3,
      pw: 0,
      exDiesel: 359,
      exPetrol: 434,
      exCigarettes: 192,
      exSpirits: 4775,
      exWine: 268,
    },
  },
  {
    id: "country_ie",
    cc: "IE",
    name: { bg: "Ирландия", en: "Ireland" },
    note: {
      bg: "Нисък корпоративен данък 12,5%, нулево ДДС върху основните храни и едни от най-високите акцизи в ЕС върху алкохол и цигари.",
      en: "A 12.5% corporate tax, zero VAT on basic food and some of the EU's highest alcohol and tobacco excises.",
    },
    apply: {
      vatStd: 23,
      vatRed: 0,
      pit: 20,
      nm: 1667,
      b2: { t2: 3667, r2: 40 },
      // 12,5% trading rate (the 15% Pillar-Two top-up applies only to €750M+
      // groups); the corp lever now carries one decimal, so keep the exact rate.
      corp: 12.5,
      mat: 2,
      exDiesel: 616,
      exPetrol: 706,
      exCigarettes: 535,
      exSpirits: 4257,
      exWine: 425,
    },
  },
  {
    id: "country_gr",
    cc: "GR",
    name: { bg: "Гърция", en: "Greece" },
    note: {
      bg: "Високо ДДС 24% след дълговата криза, прогресивен данък 9–44% и трайно високи отбранителни разходи (~3,7% от БВП).",
      en: "A high 24% VAT after the debt crisis, a progressive 9–44% income tax and persistently high defence spending (~3.7% of GDP).",
    },
    apply: {
      vatStd: 24,
      vatRed: 13,
      pit: 9,
      nm: 720,
      // The 2026 second band (20% above €10k/yr; €1 000/mo is the slider floor
      // and lands just inside it), not the 44% top rate (€60k/yr after the 2026
      // reform) — that top threshold is above the modeled BG wage range, so a
      // top-rate bracket would never fire and Greece would collapse to a flat 9%.
      b2: { t2: 1000, r2: 20 },
      corp: 22,
      def: 37,
      mat: 2,
      exDiesel: 410,
      exPetrol: 700,
      exCigarettes: 137,
      exSpirits: 2450,
      exWine: 0,
    },
  },
];
