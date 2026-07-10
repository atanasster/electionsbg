// Parse ONE МЗ quarterly "Финансови показатели на лечебни заведения за болнична
// помощ" workbook (the ЕЕОФ financial + activity indicators) into a typed
// EeofQuarter. Fetching + writing lives in write_eeof.ts; this file is pure
// parsing so it can be unit-tested against a cached buffer.
//
// Source: mh.government.bg standards page, one XLSX per quarter, 2019 Q2 →
// 2025 Q3. Legal basis Наредба № 5 от 17 юни 2019 г.
//
// Workbook shape (and its cross-year drift — all handled dynamically, never by
// fixed offsets):
//   - Recent files (2019 Q4 →) carry THREE sheets: a state ЛЗБП sheet, a
//     municipal ЛЗБП sheet, and an НЗОК payments sheet. Sheet names drift
//     ("Държавни ЛЗБП Q3" / "държавни ЛЗПБ Q3" / "Q3 държавни ЛЗБП" / "Държавни").
//   - The earliest file (2019 Q2) has only a combined "MЗ" state sheet + НЗОК;
//     municipal is simply not published that quarter.
//   - 2019 Q3 additionally carries STALE leftover Q2 sheets alongside the real
//     Q3 ones, so sheet selection must prefer the file's own quarter.
//   - The state/municipal sheets have a two-row header: row 0 = merged group
//     labels (25 indicator groups), row 1 = period sub-columns. Group ORDER is
//     not guaranteed stable across years, so the column map is built by
//     forward-filling the merged group row and matching each group label to a
//     dictionary of distinctive tokens.
//   - The НЗОК sheet is keyed by `Рег.№ ЛЗ` in recent files but by Област+name
//     (no reg number) in 2019 Q2 → 2021; the payment sub-column captions also
//     drift ("Здравноосигурителни плащания…" vs older "Общо изплатени средства").
//
// Units: state/municipal money groups are in ХИЛ. ЛЕВА (thousands of BGN); the
// two "среден разход … в лева" groups are plain BGN; the НЗОК payment columns
// are plain BGN. Everything is converted to EUR at the locked 1.95583 peg via
// toEur(); the native figure is kept alongside for parity assertions.

import * as xlsx from "xlsx";
import { toEur } from "../../src/lib/currency";

// ---- Public types ---------------------------------------------------------

export type EeofOwnership = "state" | "municipal";

/** One hospital's parsed indicator bag. Keys are added only when the source
 *  group is present + numeric. Money is stored native + EUR:
 *   - thousands-of-leva groups → `<key>ThousandsBgn` (raw cell) + `<key>Eur`
 *   - plain-leva groups        → `<key>Bgn`          (raw cell) + `<key>Eur`
 *  Counts / ratios / percentages / days are stored as a single native number. */
export interface EeofHospital {
  name: string;
  nameFold: string;
  // Money — thousands of BGN natively (+ EUR).
  revenueThousandsBgn?: number;
  revenueEur?: number;
  expenseThousandsBgn?: number;
  expenseEur?: number;
  personnelCostThousandsBgn?: number;
  personnelCostEur?: number;
  maintenanceCostThousandsBgn?: number;
  maintenanceCostEur?: number;
  drugsDevicesCostThousandsBgn?: number;
  drugsDevicesCostEur?: number;
  totalLiabilitiesThousandsBgn?: number;
  totalLiabilitiesEur?: number;
  overdueLiabilitiesThousandsBgn?: number;
  overdueLiabilitiesEur?: number;
  // Money — plain BGN (+ EUR).
  costPerBedDayBgn?: number;
  costPerBedDayEur?: number;
  costPerPatientBgn?: number;
  costPerPatientEur?: number;
  // Ratios / percentages / counts / days (native, not converted).
  costEfficiencyCoef?: number;
  personnelCostSharePct?: number;
  maintenanceCostSharePct?: number;
  drugsDevicesCostSharePct?: number;
  totalLiabilitiesRevenueSharePct?: number;
  overdueLiabilitiesRevenueSharePct?: number;
  overdueLiabilitiesExpenseSharePct?: number;
  patientsTreated?: number;
  avgMonthlyDoctors?: number;
  avgMonthlyNurses?: number;
  patientsPerDoctor?: number;
  patientsPerNurse?: number;
  avgMonthlyBeds?: number;
  bedDays?: number;
  avgLengthOfStay?: number;
  bedOccupancyPct?: number;
}

/** One НЗОК-sheet facility row for the current quarter — the parity reference
 *  for the three НЗОК payment streams, keyed by the 10-digit Рег.№ ЛЗ. */
export interface EeofNzokRow {
  quarter: string; // "2025-Q3"
  regNo: string;
  rzokCode: string | null;
  name: string;
  pathwayCount: number | null;
  bmpBgn: number | null;
  bmpEur: number | null;
  devicesBgn: number | null;
  devicesEur: number | null;
  drugsBgn: number | null;
  drugsEur: number | null;
}

export interface EeofQuarter {
  quarter: string; // "2025-Q3"
  year: number;
  q: number; // 1..4
  groups: { ownership: EeofOwnership; hospitals: EeofHospital[] }[];
  nzok: EeofNzokRow[];
}

// ---- Indicator dictionary -------------------------------------------------

type Unit = "thousandsBgn" | "bgn" | "count" | "ratio" | "pct" | "days";

interface Indicator {
  key: string;
  unit: Unit;
  // Matched against the normalized (lowercased, whitespace-collapsed) group
  // label. `not` tokens disambiguate a money group from its "Дял … %" sibling.
  has: string[];
  not?: string[];
}

// The 25 groups. Order here is only for match priority (share rows carry "дял");
// the actual column order in the file is discovered dynamically.
const INDICATORS: Indicator[] = [
  { key: "revenue", unit: "thousandsBgn", has: ["общо приходи"] },
  { key: "expense", unit: "thousandsBgn", has: ["общо разходи"] },
  {
    key: "costEfficiencyCoef",
    unit: "ratio",
    has: ["коефициент на ефективност"],
  },
  {
    key: "personnelCost",
    unit: "thousandsBgn",
    has: ["разходи за персонал", "хил"],
  },
  { key: "personnelCostSharePct", unit: "pct", has: ["дял", "персонал"] },
  {
    key: "maintenanceCost",
    unit: "thousandsBgn",
    has: ["разходи за издръжка", "хил"],
  },
  { key: "maintenanceCostSharePct", unit: "pct", has: ["дял", "издръжка"] },
  {
    key: "drugsDevicesCost",
    unit: "thousandsBgn",
    has: ["разходи за", "лекарства", "хил"],
  },
  { key: "drugsDevicesCostSharePct", unit: "pct", has: ["дял", "лекарства"] },
  {
    key: "totalLiabilities",
    unit: "thousandsBgn",
    has: ["общо задължения", "хил"],
  },
  {
    key: "overdueLiabilities",
    unit: "thousandsBgn",
    has: ["просрочени задължения", "хил"],
  },
  {
    key: "totalLiabilitiesRevenueSharePct",
    unit: "pct",
    has: ["дял", "общите задължения", "приходи"],
  },
  {
    key: "overdueLiabilitiesRevenueSharePct",
    unit: "pct",
    has: ["дял", "просрочените задължения", "приходи"],
  },
  {
    key: "overdueLiabilitiesExpenseSharePct",
    unit: "pct",
    has: ["дял", "просрочените задължения", "разходи"],
  },
  { key: "patientsTreated", unit: "count", has: ["брой преминали болни"] },
  {
    key: "avgMonthlyDoctors",
    unit: "count",
    has: ["месечен брой лекари"],
  },
  {
    key: "avgMonthlyNurses",
    unit: "count",
    has: ["месечен брой специалисти"],
  },
  {
    key: "patientsPerDoctor",
    unit: "ratio",
    has: ["брой болни на един лекар"],
  },
  {
    key: "patientsPerNurse",
    unit: "ratio",
    has: ["брой болни на един специалист"],
  },
  { key: "avgMonthlyBeds", unit: "count", has: ["месечен брой легла"] },
  { key: "bedDays", unit: "count", has: ["проведени леглодни"] },
  {
    key: "costPerBedDay",
    unit: "bgn",
    has: ["разход на един леглоден"],
  },
  {
    key: "costPerPatient",
    unit: "bgn",
    has: ["разход на един преминал болен"],
  },
  { key: "avgLengthOfStay", unit: "days", has: ["продължителност на престоя"] },
  { key: "bedOccupancyPct", unit: "pct", has: ["използваемост на едно легло"] },
];

// ---- Small helpers --------------------------------------------------------

const norm = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\s+/g, " ").trim();
const normLower = (v: unknown): string => norm(v).toLowerCase();

/** A stable fold of a hospital name for cross-sheet matching: upper-cased,
 *  quotes/punctuation stripped, whitespace collapsed. */
const foldName = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[«»"'`„“”‘’]/g, "")
    .replace(/[^0-9A-ZА-Я]+/g, " ")
    .trim();

const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : null;
};

const matchIndicator = (label: string): Indicator | null => {
  const l = label.toLowerCase();
  for (const ind of INDICATORS) {
    if (
      ind.has.every((t) => l.includes(t)) &&
      !(ind.not ?? []).some((t) => l.includes(t))
    )
      return ind;
  }
  return null;
};

/** A row is an aggregate/subtotal (not a facility) when its name is the
 *  ОБЩО/СРЕДНО roll-up or a bare legal-form subtotal (" ЕАД", " АД", …). */
const isAggregateName = (name: string): boolean => {
  const t = norm(name);
  if (!t) return true;
  if (/^(ОБЩО|СРЕДНО)/i.test(t)) return true;
  return /^(ЕАД|АД|ЕООД|ООД|ЕТ)$/.test(t);
};

type Grid = unknown[][];

const sheetGrid = (wb: xlsx.WorkBook, name: string): Grid =>
  xlsx.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    defval: null,
  }) as Grid;

// ---- Sheet selection (handles stale + combined sheets) --------------------

/** Pick the sheet for a role, preferring one that names the file's own quarter
 *  (so 2019 Q3's stale leftover Q2 sheets are not chosen). */
const pickSheet = (
  names: string[],
  roleRe: RegExp,
  q: number,
): string | null => {
  const cands = names.filter((n) => roleRe.test(n));
  if (cands.length <= 1) return cands[0] ?? null;
  const byQuarter = cands.filter((n) =>
    new RegExp(`q\\s*${q}\\b`, "i").test(n),
  );
  return byQuarter[0] ?? cands[0];
};

// ---- State / municipal sheet ----------------------------------------------

/** The current-quarter value column for a group: the "Текущо тримесечие"
 *  column if present, else the right-most column that is not a change column.
 *  (Liability groups order columns as [current, Δ, Δ, prior-yr, prior-q], so a
 *  naive "right-most" would wrongly pick a prior period — hence the Текущо
 *  preference.) */
const currentCol = (cols: { c: number; period: string }[]): number | null => {
  const tekushto = cols.find((x) => /текущо тримесечие/i.test(x.period));
  if (tekushto) return tekushto.c;
  const values = cols.filter((x) => !/изменени/i.test(x.period));
  return values.length ? values[values.length - 1].c : null;
};

interface ParsedSheet {
  hospitals: EeofHospital[];
  /** current-quarter period label (e.g. "Q3 2025") for quarter self-derivation */
  currentPeriodLabel: string | null;
}

const parseFinancialSheet = (grid: Grid): ParsedSheet => {
  // Locate the group-label row: the first (of the top rows) that carries a
  // "хил. лева" money-group caption. Period sub-columns are the next row.
  let grpRow = -1;
  for (let i = 0; i < Math.min(6, grid.length); i++) {
    if ((grid[i] ?? []).some((c) => /хил\.?\s*лева/i.test(norm(c)))) {
      grpRow = i;
      break;
    }
  }
  if (grpRow < 0) return { hospitals: [], currentPeriodLabel: null };
  const groupRow = grid[grpRow] ?? [];
  const periodRow = grid[grpRow + 1] ?? [];

  // Forward-fill the merged group labels and bucket columns by group.
  const buckets = new Map<string, { c: number; period: string }[]>();
  const order: string[] = [];
  let cur = "";
  for (let c = 1; c < groupRow.length; c++) {
    const g = norm(groupRow[c]);
    if (g) cur = g;
    if (!cur) continue;
    if (!buckets.has(cur)) {
      buckets.set(cur, []);
      order.push(cur);
    }
    buckets.get(cur)!.push({ c, period: norm(periodRow[c]) });
  }

  // Group label → { indicator, current-quarter column }.
  const colFor = new Map<string, { ind: Indicator; col: number }>();
  let currentPeriodLabel: string | null = null;
  for (const g of order) {
    const ind = matchIndicator(g);
    if (!ind) continue;
    const col = currentCol(buckets.get(g)!);
    if (col == null) continue;
    if (!colFor.has(ind.key)) colFor.set(ind.key, { ind, col });
    // Derive the quarter from a dated money group's current column label.
    if (
      currentPeriodLabel == null &&
      (ind.key === "revenue" || ind.key === "expense")
    ) {
      const p = buckets.get(g)!.find((x) => x.c === col)?.period ?? "";
      if (/q[1-4]\s*\d{4}/i.test(p)) currentPeriodLabel = p;
    }
  }

  const hospitals: EeofHospital[] = [];
  for (let r = grpRow + 2; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const name = norm(row[0]);
    if (isAggregateName(name)) continue;
    const h: EeofHospital = { name, nameFold: foldName(name) };
    let filled = 0;
    for (const { ind, col } of colFor.values()) {
      const v = toNum(row[col]);
      if (v == null) continue;
      filled += assignIndicator(h, ind, v);
    }
    if (filled > 0) hospitals.push(h);
  }
  hospitals.sort((a, b) => a.nameFold.localeCompare(b.nameFold, "bg"));
  return { hospitals, currentPeriodLabel };
};

/** Write one indicator's native + EUR fields onto a hospital record. Returns 1
 *  when a value was written (used to drop fully-empty rows). */
const assignIndicator = (
  h: EeofHospital,
  ind: Indicator,
  v: number,
): number => {
  // `EeofHospital` is a closed record of named indicator fields, so it carries no
  // index signature; the keys written below are built at runtime from the
  // workbook's group row. Route through `unknown` — every key produced here is
  // one the interface already declares (they are enumerated in INDICATORS).
  const rec = h as unknown as Record<string, number>;
  switch (ind.unit) {
    case "thousandsBgn": {
      rec[`${ind.key}ThousandsBgn`] = round(v, 3);
      rec[`${ind.key}Eur`] = round(toEur(v * 1000, "BGN") ?? 0, 2);
      return 1;
    }
    case "bgn": {
      rec[`${ind.key}Bgn`] = round(v, 2);
      rec[`${ind.key}Eur`] = round(toEur(v, "BGN") ?? 0, 2);
      return 1;
    }
    case "count":
      rec[ind.key] = round(v, 2);
      return 1;
    case "ratio":
      rec[ind.key] = round(v, 4);
      return 1;
    case "pct":
      rec[ind.key] = round(v, 6);
      return 1;
    case "days":
      rec[ind.key] = round(v, 3);
      return 1;
  }
};

// ---- НЗОК sheet -----------------------------------------------------------

const parseNzokSheet = (grid: Grid, quarter: string): EeofNzokRow[] => {
  // The sub-column caption row carries "Брой клинични пътеки"; the block-header
  // row (period blocks) is the row above it.
  let subRow = -1;
  for (let i = 0; i < Math.min(8, grid.length); i++) {
    if ((grid[i] ?? []).some((c) => /клинични пътеки/i.test(norm(c)))) {
      subRow = i;
      break;
    }
  }
  if (subRow < 1) return [];
  const blockRow = grid[subRow - 1] ?? [];
  const subs = grid[subRow] ?? [];

  // Column roles from the block-header row. Reg.№ is absent on 2019–2021 sheets
  // (keyed by Област+name instead) → no join key, so those rows are skipped.
  let regCol = -1;
  let nameCol = -1;
  let rzokCol = -1;
  for (let c = 0; c < blockRow.length; c++) {
    const l = normLower(blockRow[c]);
    if (regCol < 0 && /рег\.?\s*№/.test(l)) regCol = c;
    if (nameCol < 0 && /(лз за бмп|изпълнители)/.test(l)) nameCol = c;
    if (rzokCol < 0 && /(№ рзок|област)/.test(l)) rzokCol = c;
  }
  if (regCol < 0) return []; // no reg-number key on this sheet → cannot join

  // Forward-fill the period blocks; the current quarter is the right-most block
  // that is not a change ("Изменение") block.
  const blockCols = new Map<string, number[]>();
  const blockOrder: string[] = [];
  let cur = "";
  for (let c = 0; c < blockRow.length; c++) {
    const b = norm(blockRow[c]);
    if (b) cur = b;
    if (!cur || c <= Math.max(regCol, nameCol, rzokCol)) continue;
    if (!blockCols.has(cur)) {
      blockCols.set(cur, []);
      blockOrder.push(cur);
    }
    blockCols.get(cur)!.push(c);
  }
  const valueBlocks = blockOrder.filter((b) => !/изменени/i.test(b));
  const currentBlock = valueBlocks[valueBlocks.length - 1];
  if (!currentBlock) return [];

  // Map the current block's 4 sub-columns by their caption.
  let pathwayC = -1;
  let bmpC = -1;
  let devicesC = -1;
  let drugsC = -1;
  for (const c of blockCols.get(currentBlock)!) {
    const l = normLower(subs[c]);
    if (/клинични пътеки/.test(l)) pathwayC = c;
    else if (/изделия/.test(l)) devicesC = c;
    else if (/продукти/.test(l)) drugsC = c;
    else if (l) bmpC = c; // "плащания …" / "общо изплатени средства …"
  }

  const eur = (b: number | null): number | null =>
    b == null ? null : round(toEur(b, "BGN") ?? 0, 2);

  const rows: EeofNzokRow[] = [];
  for (let r = subRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    let regNo = norm(row[regCol]);
    const name = norm(nameCol >= 0 ? row[nameCol] : "");
    if (/^(ОБЩО|СРЕДНО)/i.test(regNo) || /^(ОБЩО|СРЕДНО)/i.test(name)) continue;
    if (/^\d+$/.test(regNo) && regNo.length < 10)
      regNo = regNo.padStart(10, "0");
    if (!/^\d{10}$/.test(regNo)) continue;
    const bmpBgn = bmpC >= 0 ? toNum(row[bmpC]) : null;
    const devicesBgn = devicesC >= 0 ? toNum(row[devicesC]) : null;
    const drugsBgn = drugsC >= 0 ? toNum(row[drugsC]) : null;
    rows.push({
      quarter,
      regNo,
      rzokCode: rzokCol >= 0 ? norm(row[rzokCol]) || null : null,
      name,
      pathwayCount: pathwayC >= 0 ? toNum(row[pathwayC]) : null,
      bmpBgn: bmpBgn == null ? null : round(bmpBgn, 2),
      bmpEur: eur(bmpBgn),
      devicesBgn: devicesBgn == null ? null : round(devicesBgn, 2),
      devicesEur: eur(devicesBgn),
      drugsBgn: drugsBgn == null ? null : round(drugsBgn, 2),
      drugsEur: eur(drugsBgn),
    });
  }
  rows.sort((a, b) => a.regNo.localeCompare(b.regNo));
  return rows;
};

// ---- Quarter self-derivation ----------------------------------------------

const deriveQuarter = (
  names: string[],
  currentPeriodLabel: string | null,
  nzokGrid: Grid | null,
): { q: number; year: number } => {
  // 1) A dated money-group current column ("Q3 2025").
  if (currentPeriodLabel) {
    const m = currentPeriodLabel.match(/q([1-4])\s*(\d{4})/i);
    if (m) return { q: Number(m[1]), year: Number(m[2]) };
  }
  // 2) The НЗОК title row ("… за III тримесечие на 2025 година").
  const rom: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
  if (nzokGrid) {
    for (let i = 0; i < Math.min(3, nzokGrid.length); i++) {
      const t = norm(nzokGrid[i]?.[0]).replace(/[І-Ѵ]/g, (c) =>
        // fold Cyrillic Roman-looking letters (І) to Latin where relevant
        c === "І" ? "I" : c,
      );
      const m = t.match(/\b(I{1,3}|IV)\s+тримесечие\s+на\s+(\d{4})/i);
      if (m) return { q: rom[m[1].toUpperCase()], year: Number(m[2]) };
    }
  }
  // 3) A sheet name that carries "Q3 …" + a 4-digit year anywhere.
  for (const n of names) {
    const mq = n.match(/q([1-4])/i);
    const my = n.match(/(\d{4})/) ?? names.join(" ").match(/(\d{4})/);
    if (mq && my) return { q: Number(mq[1]), year: Number(my[1]) };
  }
  throw new Error("could not derive quarter/year from workbook");
};

// ---- Entry point ----------------------------------------------------------

export const parseEeofWorkbook = (buf: Buffer): EeofQuarter => {
  const wb = xlsx.read(buf, { type: "buffer" });
  const names = wb.SheetNames;

  // Preliminary quarter guess from sheet names (needed to disambiguate stale
  // sheets); refined below from cell content.
  const qGuess = Number((names.join(" ").match(/q([1-4])/i) ?? [])[1]) || 0;

  const nzokName = pickSheet(names, /нзок/i, qGuess);
  const muniName = pickSheet(names, /общин/i, qGuess);
  // State: a "държав" sheet, else the combined "МЗ" sheet (2019 Q2) — the one
  // that is neither НЗОК nor municipal.
  let stateName = pickSheet(names, /държав/i, qGuess);
  if (!stateName) {
    const rest = names.filter((n) => n !== nzokName && n !== muniName);
    stateName = pickSheet(rest, /.*/, qGuess);
  }

  const groups: EeofQuarter["groups"] = [];
  let currentPeriodLabel: string | null = null;
  if (stateName) {
    const s = parseFinancialSheet(sheetGrid(wb, stateName));
    currentPeriodLabel ??= s.currentPeriodLabel;
    groups.push({ ownership: "state", hospitals: s.hospitals });
  }
  if (muniName) {
    const m = parseFinancialSheet(sheetGrid(wb, muniName));
    currentPeriodLabel ??= m.currentPeriodLabel;
    groups.push({ ownership: "municipal", hospitals: m.hospitals });
  }

  const nzokGrid = nzokName ? sheetGrid(wb, nzokName) : null;
  const { q, year } = deriveQuarter(names, currentPeriodLabel, nzokGrid);
  const quarter = `${year}-Q${q}`;

  const nzok = nzokGrid ? parseNzokSheet(nzokGrid, quarter) : [];

  return { quarter, year, q, groups, nzok };
};
