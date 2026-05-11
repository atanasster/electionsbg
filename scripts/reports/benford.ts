import fs from "fs";
import path from "path";
import type { PartyInfo, SectionInfo } from "@/data/dataTypes";

// Benford's law screen for section-level vote counts.
//
// IMPORTANT EDITORIAL CAVEAT (mirrored in the UI):
//   Benford deviation is NOT evidence of fraud. Section-level vote counts
//   are range-bounded — they violate one of Benford's preconditions
//   (numbers spanning multiple orders of magnitude). Plenty of clean
//   electoral data fails 1st-digit Benford. Mebane (2006) explicitly
//   recommends second-digit (2BL) as the more applicable test for
//   election forensics. We compute both here and the UI defaults to
//   showing 2BL while keeping 1BL as a toggle.
//
// References:
//   - Mebane, "Election Forensics" (UMich, 2006) — public.websites.umich.edu/~wmebane
//   - Williams College Kossosky-Miller analysis (2020)

const MIN_VOTES_1BL = 10; // sections below this break the 1BL test
const MIN_VOTES_2BL = 10; // 2BL only needs two significant digits to exist

// Expected Benford first-digit distribution: log10(1 + 1/d).
const benford1 = (d: number): number => Math.log10(1 + 1 / d);
const benford1Expected = Array.from({ length: 9 }, (_, i) => benford1(i + 1));

// Expected Benford second-digit distribution (Mebane's preferred form).
// P(d_2 = d) = Σ_{k=1}^{9} log10(1 + 1/(10k+d)) for d ∈ {0,…,9}.
const benford2 = (d: number): number => {
  let s = 0;
  for (let k = 1; k <= 9; k += 1) s += Math.log10(1 + 1 / (10 * k + d));
  return s;
};
const benford2Expected = Array.from({ length: 10 }, (_, i) => benford2(i));

const firstDigit = (n: number): number => {
  let x = Math.abs(n);
  while (x >= 10) x = Math.floor(x / 10);
  return Math.floor(x);
};

const secondDigit = (n: number): number => {
  const x = Math.abs(n);
  // Need at least two significant digits for the 2nd-digit test.
  if (x < 10) return -1;
  let scaled = x;
  while (scaled >= 100) scaled = Math.floor(scaled / 10);
  return Math.floor(scaled) % 10;
};

// Chi-squared statistic with k-1 df (used for both 1BL and 2BL).
const chiSquared = (observed: number[], expected: number[], n: number) => {
  let chi2 = 0;
  for (let i = 0; i < observed.length; i += 1) {
    const e = expected[i] * n;
    if (e > 0) chi2 += (observed[i] - e) ** 2 / e;
  }
  return chi2;
};

// Approximate upper-tail p-value for χ² with `df` degrees of freedom.
// Uses Wilson-Hilferty cube-root approximation (within ~0.01 of true
// p for p ∈ [0.001, 0.999] which is the only range we display). Avoids
// pulling a stats library for one number.
const chi2PValue = (chi2: number, df: number): number => {
  if (chi2 <= 0) return 1;
  const x = Math.cbrt(chi2 / df);
  const z = (x - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  // Standard-normal upper tail via erfc approximation.
  const erfc = (t: number) => {
    const sign = t < 0 ? -1 : 1;
    const a = Math.abs(t);
    const tt = 1 / (1 + 0.3275911 * a);
    const y =
      1 -
      ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt -
        0.284496736) *
        tt +
        0.254829592) *
        tt *
        Math.exp(-a * a);
    return 1 - sign * y;
  };
  return 0.5 * erfc(z / Math.sqrt(2));
};

// Mean absolute deviation (MAD) — Nigrini's intuitive "how far off from
// Benford" metric. Reported alongside chi-squared because chi-squared
// scales with n while MAD does not, so MAD is what you compare across
// parties of different size.
const mad = (observed: number[], expected: number[], n: number) => {
  let s = 0;
  for (let i = 0; i < observed.length; i += 1) {
    s += Math.abs(observed[i] / n - expected[i]);
  }
  return s / observed.length;
};

export type BenfordTest = {
  /** Observed digit frequencies as shares (sum to 1). */
  observed: number[];
  /** Expected (Benford) shares. */
  expected: number[];
  /** Number of sections that passed the count threshold for this test. */
  n: number;
  /** Chi-squared statistic. */
  chi2: number;
  /** Approximate upper-tail p-value. */
  pValue: number;
  /** Mean absolute deviation in share space. */
  mad: number;
};

export type BenfordPartyEntry = {
  partyNum: number;
  nickName: string;
  name?: string;
  name_en?: string;
  color?: string;
  totalSections: number;
  firstDigit?: BenfordTest;
  secondDigit?: BenfordTest;
};

export type BenfordReport = {
  election: string;
  generatedAt: string;
  thresholds: {
    minVotes1BL: number;
    minVotes2BL: number;
  };
  parties: BenfordPartyEntry[];
};

const readSections = (publicFolder: string, year: string): SectionInfo[] => {
  const dir = path.join(publicFolder, year, "sections", "by-oblast");
  if (!fs.existsSync(dir)) return [];
  const out: SectionInfo[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(dir, file), "utf-8"),
      ) as Record<string, SectionInfo>;
      for (const s of Object.values(data)) out.push(s);
    } catch {
      // skip corrupt files
    }
  }
  return out;
};

const computeTest = (
  votes: number[],
  digitFn: (n: number) => number,
  expected: number[],
): BenfordTest | undefined => {
  const counts = new Array<number>(expected.length).fill(0);
  let n = 0;
  for (const v of votes) {
    const d = digitFn(v);
    if (d < 0 || d >= expected.length) continue;
    // For 1BL, the digit range is 1..9 so we offset by 1.
    const idx = expected.length === 9 ? d - 1 : d;
    if (idx < 0 || idx >= expected.length) continue;
    counts[idx] += 1;
    n += 1;
  }
  if (n < 30) return undefined; // too few to be meaningful
  const observed = counts.map((c) => c / n);
  const chi2 = chiSquared(counts, expected, n);
  const df = expected.length - 1;
  return {
    observed,
    expected,
    n,
    chi2,
    pValue: chi2PValue(chi2, df),
    mad: mad(counts, expected, n),
  };
};

export const generateBenfordReport = ({
  publicFolder,
  reportsFolder,
  year,
  parties,
  stringify,
}: {
  publicFolder: string;
  reportsFolder: string;
  year: string;
  parties: PartyInfo[];
  stringify: (o: object) => string;
}): void => {
  const sections = readSections(publicFolder, year);
  if (!sections.length) return;

  // Build per-party vote arrays from the cross-section list.
  const byParty = new Map<number, number[]>();
  for (const s of sections) {
    for (const v of s.results?.votes ?? []) {
      if (!v.totalVotes) continue;
      let arr = byParty.get(v.partyNum);
      if (!arr) {
        arr = [];
        byParty.set(v.partyNum, arr);
      }
      arr.push(v.totalVotes);
    }
  }

  const entries: BenfordPartyEntry[] = [];
  for (const p of parties) {
    const votes = byParty.get(p.number) ?? [];
    if (!votes.length) continue;
    const votes1 = votes.filter((v) => v >= MIN_VOTES_1BL);
    const votes2 = votes.filter((v) => v >= MIN_VOTES_2BL);
    entries.push({
      partyNum: p.number,
      nickName: p.nickName,
      name: p.name,
      name_en: p.name_en,
      color: p.color,
      totalSections: votes.length,
      firstDigit: computeTest(votes1, firstDigit, benford1Expected),
      secondDigit: computeTest(votes2, secondDigit, benford2Expected),
    });
  }

  // Sort by partyNum so the small-multiples grid renders in a stable
  // ballot-order, NOT by deviation — sorting by χ² would create the
  // misleading impression that the top-listed parties are the "most
  // suspicious", which is exactly the misreading we want to avoid.
  entries.sort((a, b) => a.partyNum - b.partyNum);

  const out: BenfordReport = {
    election: year,
    generatedAt: new Date().toISOString(),
    thresholds: { minVotes1BL: MIN_VOTES_1BL, minVotes2BL: MIN_VOTES_2BL },
    parties: entries,
  };
  const file = `${reportsFolder}/benford.json`;
  fs.writeFileSync(file, stringify(out), "utf8");
  console.log("Successfully added file ", file);
};
