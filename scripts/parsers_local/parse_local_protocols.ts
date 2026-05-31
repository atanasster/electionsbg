// Parse protocols.txt for a local election race-type folder into raw rows.
//
// Each row is one section protocol; fields are ";"-separated:
//   row[0]  form_id
//   row[1]  section_code
//   row[2]  admin_unit_id (OIK/kmetstvo/район)
//   row[3]  serial pages joined by "|"
//   ...     ballot-accounting points (А, Б, 1, 1.а, 1.б, 2, 3, …)
//
// The column offsets of "registered voters" (point 1) and "actual voters"
// (point 3) DIFFER by cycle: minr2015 carries an extra leading accounting
// field, so point 1 sits at serials+3; mi2019 puts it at serials+2. And a
// handful of sections (≈9 Sofia 2015) have a data-entry quirk that breaks the
// "point 1 = 1.а + 1.б" identity at the true position. Neither a fixed offset
// nor a value-matching heuristic is reliable alone.
//
// So this module only extracts the RAW numeric fields + the serials-cell
// index; the section aggregator resolves (registered, actual) against the
// votes.txt-derived valid total — actual voters MUST be ≥ valid votes, which
// arbitrates the ambiguity exactly.

import fs from "fs";
import { parse } from "csv-parse";
import { resolveRaceFile } from "./csv_files";

// Resolved turnout for one section (built by the aggregator, kept here for the
// per-município bundle's protocol summary).
export type LocalProtocolRow = {
  sectionCode: string;
  oikCode: string;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
};

// Raw protocol row: the parsed string fields + the index of the "|"-joined
// serials cell (the stable anchor the points are offset from).
export type RawLocalProtocol = {
  sectionCode: string;
  oikCode: string;
  serialsIdx: number;
  fields: string[];
};

const locateSerialsIdx = (row: string[]): number => {
  for (let i = 0; i < row.length; i++) {
    if ((row[i] ?? "").includes("|")) return i;
  }
  return -1;
};

export const parseLocalProtocolRows = (
  inFolder: string,
): Promise<RawLocalProtocol[]> => {
  const file = resolveRaceFile(inFolder, "protocols");
  if (!file) return Promise.resolve([]);
  const rows: string[][] = [];
  return new Promise((resolve, reject) =>
    fs
      .createReadStream(file)
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (r) => rows.push(r))
      .on("end", () => {
        const out: RawLocalProtocol[] = [];
        for (const row of rows) {
          if (!row[1]) continue;
          const sectionCode = row[1].trim();
          if (!sectionCode) continue;
          const oikDigits = (row[2] ?? "").replace(/\D+/g, "");
          const oikCode = oikDigits
            ? oikDigits.slice(0, 4).padStart(4, "0")
            : "";
          out.push({
            sectionCode,
            oikCode,
            serialsIdx: locateSerialsIdx(row),
            fields: row,
          });
        }
        resolve(out);
      })
      .on("error", reject),
  );
};

const toInt = (s: string | undefined): number => {
  const n = parseInt((s ?? "").trim(), 10);
  return Number.isNaN(n) ? NaN : n;
};

// The registered-voter (point 1) offset from the serials cell. minr2015 = 3
// (А + Б precede point 1); mi2019 = 2 (only one accounting field precedes it).
const CANDIDATE_REG_OFFSETS = [2, 3, 4, 1];

/**
 * Pick the cycle-wide registered-voter offset from the serials cell. The
 * layout is consistent within a cycle, so we choose the single offset whose
 * point-3 (= offset + 4) clears each section's valid-vote total (Σ votes.txt)
 * for the most sections — actual voters MUST be ≥ valid votes, so the correct
 * offset scores ~100% while a wrong one fails on a large fraction.
 */
export const calibrateRegOffset = (
  rows: RawLocalProtocol[],
  validBySection: Map<string, number>,
): number => {
  let best = 3;
  let bestScore = -1;
  for (const off of CANDIDATE_REG_OFFSETS) {
    let score = 0;
    for (const r of rows) {
      if (r.serialsIdx < 0) continue;
      const valid = validBySection.get(r.sectionCode) ?? 0;
      if (valid <= 0) continue;
      const act = toInt(r.fields[r.serialsIdx + off + 4]);
      if (!Number.isNaN(act) && act >= valid) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = off;
    }
  }
  return best;
};

/**
 * Resolve (registered, actual) voters for one section, using the cycle's
 * calibrated `regOff` and the section's valid total as an arbiter. Falls back
 * to the other offsets / the "1 = 1.а + 1.б" identity for the handful of rows
 * whose layout deviates (the Sofia 2015 data-entry quirk).
 */
export const resolveTurnout = (
  fields: string[],
  serialsIdx: number,
  validVotes: number,
  regOff: number,
): { numRegisteredVoters: number; totalActualVoters: number } => {
  if (serialsIdx < 0) {
    return { numRegisteredVoters: 0, totalActualVoters: 0 };
  }
  const at = (regIdx: number): { reg: number; act: number } | null => {
    const reg = toInt(fields[regIdx]);
    const act = toInt(fields[regIdx + 4]); // point 3 = point 1 + 4
    if (Number.isNaN(reg) || Number.isNaN(act)) return null;
    if (act < validVotes) return null; // impossible: fewer voters than votes
    // NB: we do NOT require reg ≥ act — election-day "под чертата" additions
    // (point 2) legitimately push actual voters above the handover roll.
    return { reg, act };
  };
  const out = (r: { reg: number; act: number }) => ({
    numRegisteredVoters: r.reg,
    totalActualVoters: r.act,
  });

  // Calibrated offset first.
  const primary = at(serialsIdx + regOff);
  if (primary) return out(primary);
  // Other fixed offsets (a deviating row).
  for (const off of CANDIDATE_REG_OFFSETS) {
    if (off === regOff) continue;
    const r = at(serialsIdx + off);
    if (r) return out(r);
  }
  // Identity fallback (point 1 = 1.а + 1.б).
  for (let i = serialsIdx + 1; i + 2 < fields.length; i++) {
    const a = toInt(fields[i]);
    const b = toInt(fields[i + 1]);
    const c = toInt(fields[i + 2]);
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) continue;
    if (a >= 10 && a === b + c) {
      const r = at(i);
      if (r) return out(r);
    }
  }
  // Last resort: the calibrated offset's raw values (keeps registered/actual
  // self-consistent for empty sections where `valid` can't arbitrate).
  return {
    numRegisteredVoters: toInt(fields[serialsIdx + regOff]) || 0,
    totalActualVoters: toInt(fields[serialsIdx + regOff + 4]) || 0,
  };
};
