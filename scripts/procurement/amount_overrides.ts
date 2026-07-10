// Curated corrections for contract amounts that the SOURCE publishes wrong.
//
// These are NOT parse bugs. Each entry below was checked against the upstream
// record: the publisher typed the contract value with the decimal separator
// dropped, i.e. entered stotinki into a leva field, so `contractValue` reads as
// exactly 100× the truth. Example, raw ЦАИС ЕОП record for 03000-2025-0001:
//
//     "estimatedValue": "201592,00",   "contractValue": "20159200,10"
//
// The proof that the CONTRACT is the corrupted side (rather than the estimate)
// is structural, not statistical: dividing the contract value by 100 reproduces
// that row's own published lot estimate to the stotinka. A bare "ratio ≈ 100"
// test does NOT establish this — four other rows in the corpus sit at 99.68–99.95×
// with no such correspondence, and for those it is the ESTIMATE that looks wrong.
// They are deliberately absent from this table. See detect_amount_anomalies.ts,
// which reports both classes and is the only sanctioned way to grow this list.
//
// Why a hand-checked table and not a rule. A blanket `if (ratio ≈ 100) amount /= 100`
// would silently rewrite real awards the day a genuine contract lands at 100× its
// estimate — which is exactly the kind of finding the corpus exists to surface.
// Every correction here is one row, one human, one piece of evidence.
//
// Safety. `overrideAmount()` only fires when the value it is handed still equals
// the recorded corrupt figure. If the publisher fixes the record upstream, the
// guard stops matching and the override quietly retires itself — it can never
// divide an already-correct amount by 100 a second time.
//
// Impact when this landed (2026-07-10): 13 of the 14 rows are in the corpus,
// carrying ~€45.2M of value that does not exist. Община Две могили alone showed a
// €14.2M contract that is really €142k.

/** One publisher-side amount error, corrected. Amounts are NATIVE (pre-EUR). */
export interface AmountOverride {
  /** УНП — matches across the legacy, ЕОП and OCDS feeds. Absent when the source
   *  publishes a ЦАИС-internal `T…` id instead of a real УНП. */
  unp?: string;
  /** Feed-specific ocid. Only needed when `unp` cannot identify the row. */
  ocid?: string;
  contractId: string;
  currency: string;
  /** The wrong value as published, exactly as our parsers read it. The guard. */
  sourceAmount: number;
  /** The corrected value: `sourceAmount / 100`, cross-checked against the row's
   *  own published lot estimate. */
  correctedAmount: number;
  buyer: string;
  note: string;
}

// Ordered by the size of the error. `note` records the row's published estimate,
// which is the evidence for the correction.
export const AMOUNT_OVERRIDES: AmountOverride[] = [
  {
    unp: "00087-2021-0218",
    contractId: "59074",
    currency: "BGN",
    sourceAmount: 6938481985.0,
    correctedAmount: 69384819.85,
    buyer: "Столична община",
    note: "lot estimate 69 384 819,85 BGN — exact match after ÷100. Not currently in the corpus (the ЕОП gap-fill filter excludes this buyer); kept so it can never enter wrong.",
  },
  {
    unp: "00621-2020-0008",
    contractId: "109",
    currency: "BGN",
    sourceAmount: 27797070.0,
    correctedAmount: 277970.7,
    buyer: "Община Две могили",
    note: "lot estimate 277 970,70 BGN — exact. A €14.2M contract for a municipality of ~9k people; truth is ~€142k.",
  },
  {
    unp: "03000-2025-0001",
    contractId: "225100",
    currency: "BGN",
    sourceAmount: 20159200.1,
    correctedAmount: 201592.0,
    buyer: "ОД МВР Пазарджик",
    note: "lot estimate 201 592,00 BGN. Source reads 20159200,10 — the trailing ,10 is noise on top of the dropped decimal; corrected to the estimate.",
  },
  {
    unp: "00322-2022-0041",
    contractId: "90552",
    currency: "BGN",
    sourceAmount: 12264750.0,
    correctedAmount: 122647.5,
    buyer: "Община Кърджали",
    note: "lot estimate 122 647,50 BGN — exact.",
  },
  {
    unp: "00774-2022-0036",
    contractId: "56491",
    currency: "BGN",
    sourceAmount: 8855191.0,
    correctedAmount: 88551.91,
    buyer: "Община Стара Загора",
    note: "lot estimate 88 551,91 BGN — exact.",
  },
  {
    unp: "00106-2025-0012",
    contractId: "223199",
    currency: "BGN",
    sourceAmount: 7281663.0,
    correctedAmount: 72816.63,
    buyer: "Министерство на правосъдието",
    note: "lot estimate 72 816,63 BGN — exact.",
  },
  {
    unp: "00193-2024-0067",
    contractId: "155810",
    currency: "BGN",
    sourceAmount: 4434946.0,
    correctedAmount: 44349.46,
    buyer: "Технически университет",
    note: "lot estimate 44 349,46 BGN — exact.",
  },
  {
    ocid: "eop-T407893",
    contractId: "163520",
    currency: "BGN",
    sourceAmount: 2595833.0,
    correctedAmount: 25958.33,
    buyer: "Община Варна",
    note: "lot estimate 25 958,33 BGN — exact. Source publishes a ЦАИС-internal id (T407893) in place of a УНП, so this row is keyed by ocid.",
  },
  {
    unp: "00116-2026-0001",
    ocid: "ocds-e82gsb-549385",
    contractId: "236116",
    currency: "EUR",
    sourceAmount: 2189352.0,
    correctedAmount: 21893.52,
    buyer: "Община Лом",
    note: "lot estimate 21 893,52 EUR — exact. Reaches us via the OCDS feed, which carries no УНП at normalize time; keyed by both.",
  },
  {
    unp: "02332-2026-0001",
    ocid: "ocds-e82gsb-578481",
    contractId: "250774",
    currency: "EUR",
    sourceAmount: 671055.0,
    correctedAmount: 6710.55,
    buyer: 'Първо основно училище "Иван Вазов"',
    note: "lot estimate 6 710,55 EUR — exact. OCDS feed; keyed by both.",
  },
  {
    unp: "04319-2025-0001",
    contractId: "191791",
    currency: "BGN",
    sourceAmount: 574580.0,
    correctedAmount: 5745.8,
    buyer: 'Основно училище "Димитър Петров"',
    note: "lot estimate 5 745,81 BGN — off by one stotinka after ÷100 (rounding upstream). The procedure's whole estimate is 28 042,07 BGN, so a 574 580 BGN lot is impossible.",
  },
  {
    unp: "03360-2025-0002",
    contractId: "197322",
    currency: "BGN",
    sourceAmount: 518694.0,
    correctedAmount: 5186.94,
    buyer: "Профилирана гимназия за чужди езици",
    note: "lot estimate 5 186,94 BGN — exact.",
  },
  {
    unp: "04347-2024-0003",
    contractId: "146181",
    currency: "BGN",
    sourceAmount: 151666.0,
    correctedAmount: 1516.66,
    buyer: "Професионална техническа гимназия",
    note: "lot estimate 1 516,66 BGN — exact.",
  },
  {
    unp: "04647-2025-0001",
    contractId: "192068",
    currency: "BGN",
    sourceAmount: 71307.0,
    correctedAmount: 713.07,
    buyer: '149 средно училище "Иван Хаджийски"',
    note: "lot estimate 713,08 BGN — off by one stotinka after ÷100 (rounding upstream).",
  },

  // --- Second cohort, found by comparing against the PROCEDURE estimate --------
  // The ЕОП per-row estimate cannot see these: they arrive via the legacy CSV and
  // the OCDS bundles, neither of which publishes a lot-level estimate. Each is
  // still a single-lot procedure (`tenders.lots_count <= 1`), so the procedure
  // estimate IS that contract's estimate, and each reproduces it exactly.
  //
  // The four OCDS rows share a striking signature: `amount / estimate` = 51.129
  // for all of them, which is 100 / 1.95583. The publisher made the same ×100
  // stotinki error, and the value then passed through a BGN→EUR conversion. The
  // contract is priced in EUR while the tender estimate is still in BGN, so the
  // proof is `amount / 100 × 1.95583 == estimate` — exact to the cent.
  {
    unp: "00115-2022-0099",
    contractId: "80834",
    currency: "BGN",
    sourceAmount: 165333000.0,
    correctedAmount: 165333.0,
    buyer: "Община Русе",
    note: "×1000, not ×100. Single-lot procedure estimate 165 333,00 BGN — exact after ÷1000.",
  },
  {
    unp: "00105-2025-0026",
    contractId: "236360",
    currency: "EUR",
    sourceAmount: 102258376.0,
    correctedAmount: 1022583.76,
    buyer: "Министерство на външните работи",
    note: "Single-lot estimate 2 000 000,00 BGN. 1 022 583,76 EUR × 1,95583 = 2 000 000,00 BGN — exact.",
  },
  {
    unp: "00172-2025-0007",
    contractId: "242653",
    currency: "EUR",
    sourceAmount: 8179034.0,
    correctedAmount: 81790.34,
    buyer: "Община Хитрино",
    note: "Single-lot estimate 159 968,00 BGN. 81 790,34 EUR × 1,95583 = 159 968,00 BGN — exact.",
  },
  {
    unp: "02711-2025-0106",
    contractId: "242345",
    currency: "EUR",
    sourceAmount: 4090335.0,
    correctedAmount: 40903.35,
    buyer: 'ТП "Държавно горско стопанство"',
    note: "Single-lot estimate 80 000,00 BGN. 40 903,35 EUR × 1,95583 = 80 000,00 BGN — exact.",
  },
  {
    unp: "02709-2025-0018",
    contractId: "239736",
    currency: "EUR",
    sourceAmount: 511292.0,
    correctedAmount: 5112.92,
    buyer: "ТП Държавно горско стопанство",
    note: "Single-lot estimate 10 000,00 BGN. 5 112,92 EUR × 1,95583 = 10 000,00 BGN — exact.",
  },

  // NOT corrected, deliberately. Seven further single-lot rows sit at 69–100× their
  // procedure estimate but ÷100 does NOT reproduce it exactly (Община Опан −0.12%,
  // Община Стара Загора −0.08%, МВнР −0.6%, Община Две могили 00621-2020-0009 −4.9%,
  // Държавен куклен театър −2.2%, СУ "Йордан Йовков" −8.9%, ОУ 05981-2020-0001 −30%).
  // A real award may legitimately land a few percent under its estimate, so "≈100×"
  // alone cannot distinguish a decimal slip from a genuinely huge overrun. They need
  // a human to read the contract. Do not add them on the strength of the ratio.
];

// The published amount and our parse of it must agree to well under a stotinka
// before we substitute anything. Floating-point noise only.
const GUARD_EPSILON = 0.005;

const byUnp = new Map<string, AmountOverride>();
const byOcid = new Map<string, AmountOverride>();
for (const o of AMOUNT_OVERRIDES) {
  if (o.unp) byUnp.set(`${o.unp}::${o.contractId}`, o);
  if (o.ocid) byOcid.set(`${o.ocid}::${o.contractId}`, o);
}

/**
 * The corrected NATIVE amount for a known publisher-side error, or `undefined`
 * when the row is not in the table — or when it is, but the value handed in no
 * longer matches the corrupt figure we recorded (upstream fixed it, or this is a
 * pre-split share of a multi-supplier award). Never divides blindly.
 *
 * Call it with the FULL contract value, before any multi-supplier split.
 */
export const overrideAmount = (row: {
  unp?: string;
  ocid?: string;
  contractId?: string;
  amount?: number;
}): number | undefined => {
  if (row.contractId == null || row.amount == null) return undefined;
  const hit =
    (row.unp ? byUnp.get(`${row.unp}::${row.contractId}`) : undefined) ??
    (row.ocid ? byOcid.get(`${row.ocid}::${row.contractId}`) : undefined);
  if (!hit) return undefined;
  if (Math.abs(row.amount - hit.sourceAmount) > GUARD_EPSILON) return undefined;
  return hit.correctedAmount;
};
