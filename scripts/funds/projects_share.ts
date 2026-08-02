// Shared rules and helpers for the ИСУН contract corpus.
//
// A leaf module on purpose: the ingest (projects_ingest.ts), the focus-themes
// builder (themes.ts) and the procedure grain (procedures.ts) all need these,
// and none should import another — projects_ingest.ts is a CLI entrypoint that
// runs on import.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTLEMENTS_FILE = path.resolve(__dirname, "../../data/settlements.json");

// The structural minimum the rule needs. Deliberately not ResolvedFundsProject:
// themes.ts reads the programme shards back off disk into its own slimmer row
// type, and both shapes satisfy this.
export interface MuniAttributable {
  location?: { munis?: string[] } | null;
}

// The split denominator — how many distinct муни the row names.
export const muniCount = (r: MuniAttributable): number =>
  new Set(r.location?.munis ?? []).size;

// A row whose declared Местонахождение names N муни (e.g. the RRP grid
// projects listing 39) resolves to one location carrying all N in munis[].
// Attributing the full value to each would invent money: doing so put
// €7.15 bn of phantom spend on the choropleth, 79 % of it from ten rows.
// ИСУН publishes no per-муни breakdown, so an even split is the only
// allocation that keeps Σ(per-муни money) equal to the mappable corpus.
//
// Applies to every муни-keyed money aggregate; per-EKATTE / per-EIK /
// per-programme / per-contract totals are untouched (single-valued keys).
// Counts are never shared — the contract is one contract wherever it lands.
export const muniShare = (r: MuniAttributable): number => {
  const n = muniCount(r);
  return n > 1 ? 1 / n : 1;
};

// ── place dimension ──────────────────────────────────────────────────────────

// Sofia's city core sits under an obshtina pseudo-code rather than a real one;
// the resolver (projects_resolve.ts, SOFIA_SYNTHETIC) keeps the same mapping.
export const SYNTHETIC_SETTLEMENTS: Array<{
  ekatte: string;
  oblast: string;
  obshtina: string;
}> = [{ ekatte: "68134", oblast: "S22", obshtina: "S22" }];

// data/settlements.json carries the Plovdiv oblast under two codes — see the
// oblast-code shard-mismatch note. Everything downstream keys on `PDV`.
export const normOblast = (o: string): string => (o === "PDV-00" ? "PDV" : o);

/**
 * The canonical обштина → област dictionary, read from data/settlements.json.
 *
 * An oblast is a property of the MUNICIPALITY, never of a contract. Deriving it
 * from `location.oblasts[0]` puts the wrong region on every муни of a row that
 * names several: it labelled 311 of 5,719 published rows with an oblast that
 * does not own them (SZR31 / Стара Загора as VRC / Враца, RSE27 / Русе as BGS /
 * Бургас). That renders as a clean fact with nothing failing, which is the worst
 * shape a transparency error can take.
 */
export const loadOblastByMuni = (): Map<string, string> => {
  const settlements: Array<{
    ekatte: string;
    oblast: string;
    obshtina: string;
  }> = JSON.parse(fs.readFileSync(SETTLEMENTS_FILE, "utf-8"));
  const byMuni = new Map<string, string>();
  for (const s of [...settlements, ...SYNTHETIC_SETTLEMENTS]) {
    if (s.oblast === "32") continue; // foreign-country pseudo-rows
    if (!byMuni.has(s.obshtina)) byMuni.set(s.obshtina, normOblast(s.oblast));
  }
  return byMuni;
};

// ── status buckets ───────────────────────────────────────────────────────────

// The four dashboard buckets the raw ИСУН status strings collapse into. Shared
// so the programme page and the procedure page can never disagree about the
// same contracts — the drift would be invisible, since both would still render.
const STATUS_GROUPS: Array<{ match: (s: string) => boolean; key: string }> = [
  { match: (s) => s.startsWith("Приключен"), key: "completed" },
  { match: (s) => s.startsWith("В изпълнение"), key: "in-progress" },
  { match: (s) => s === "Сключен", key: "signed" },
  { match: (s) => s.startsWith("Прекратен"), key: "terminated" },
];

export const statusBucket = (status: string): string =>
  STATUS_GROUPS.find((g) => g.match(status))?.key ?? "other";

// ── top-муни rollup ──────────────────────────────────────────────────────────

export interface MuniRollupRow extends MuniAttributable {
  contractNumber: string;
  totalEur: number;
  paidEur: number;
}

export interface TopMuni {
  muni: string;
  oblast: string | null;
  contractCount: number;
  totalEur: number;
  paidEur: number;
}

/**
 * Rank the municipalities a slice of contracts landed in.
 *
 * Money is split across the муни a row names (`muniShare`); counts never are —
 * it is one contract wherever it lands. The oblast comes from `oblastOfMuni`,
 * the муни's own dictionary, never from the contract.
 */
export const rollupTopMunis = (
  rows: MuniRollupRow[],
  topN: number,
  oblastOfMuni: (muni: string) => string | null,
): TopMuni[] => {
  const byMuni = new Map<string, TopMuni & { seen: Set<string> }>();
  for (const r of rows) {
    const munis = r.location?.munis ?? [];
    if (munis.length === 0) continue;
    const share = muniShare(r);
    for (const m of munis) {
      const e = byMuni.get(m) ?? {
        muni: m,
        oblast: oblastOfMuni(m),
        contractCount: 0,
        totalEur: 0,
        paidEur: 0,
        seen: new Set<string>(),
      };
      // De-dup contract numbers — a row must not double-count when it names
      // the same муни twice (defensive; the resolver de-dups).
      if (e.seen.has(r.contractNumber)) continue;
      e.seen.add(r.contractNumber);
      e.contractCount += 1;
      e.totalEur += r.totalEur * share;
      e.paidEur += r.paidEur * share;
      byMuni.set(m, e);
    }
  }
  return [...byMuni.values()]
    .map((e) => ({
      muni: e.muni,
      oblast: e.oblast,
      contractCount: e.contractCount,
      totalEur: round2(e.totalEur),
      paidEur: round2(e.paidEur),
    }))
    .sort((a, b) => b.totalEur - a.totalEur || a.muni.localeCompare(b.muni))
    .slice(0, topN);
};

// ── small shared utilities ───────────────────────────────────────────────────

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

/** Empty a shard directory and recreate it, so a removed key cannot linger. */
export const resetDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
};
