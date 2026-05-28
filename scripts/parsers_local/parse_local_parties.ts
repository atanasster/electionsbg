// Parse cik_parties.txt + local_parties.txt for a single race-type folder.
//
// cik_parties.txt is the national party register (id;name) — small, shared
// across all four race types in a given cycle.
//
// local_parties.txt is per-OIK: a given local_party_num means different
// things in different OIKs. Each row is run through `resolveLocalParty` to
// derive the canonical-party credit (primary + members + unmatched fragments).
// Unmatched fragments are aggregated into a single array per cycle so the
// orchestrator can dump them for hand-curation.

import fs from "fs";
import { parse } from "csv-parse";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { CikParty, LocalParty } from "./types";
import { buildByNickNameLower, resolveLocalParty } from "./local_coalitions";

export const parseCikParties = (inFolder: string): Promise<CikParty[]> => {
  const file = `${inFolder}/cik_parties.txt`;
  if (!fs.existsSync(file)) return Promise.resolve([]);
  const rows: string[][] = [];
  return new Promise((resolve, reject) =>
    fs
      .createReadStream(file)
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (r) => rows.push(r))
      .on("end", () => {
        const out: CikParty[] = [];
        for (const row of rows) {
          if (!row[0]) continue;
          const number = parseInt(row[0], 10);
          if (Number.isNaN(number)) continue;
          out.push({ number, name: (row[1] ?? "").trim() });
        }
        resolve(out);
      })
      .on("error", reject),
  );
};

export type LocalPartiesResult = {
  parties: LocalParty[];
  /** Coalition name → unmatched fragment strings, aggregated for operator
   * review. Empty when every coalition resolves cleanly. */
  unmatchedByRawName: Record<string, string[]>;
};

export const parseLocalParties = (
  inFolder: string,
  canonical: CanonicalPartiesIndex | undefined,
): Promise<LocalPartiesResult> => {
  const file = `${inFolder}/local_parties.txt`;
  if (!fs.existsSync(file)) {
    return Promise.resolve({ parties: [], unmatchedByRawName: {} });
  }
  const byNickNameLower = buildByNickNameLower(canonical);
  const rows: string[][] = [];
  return new Promise((resolve, reject) =>
    fs
      .createReadStream(file)
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (r) => rows.push(r))
      .on("end", () => {
        const parties: LocalParty[] = [];
        const unmatchedByRawName: Record<string, string[]> = {};
        for (const row of rows) {
          // Columns: oik_code ; oik_name ; local_party_num ; local_party_name
          if (!row[0] || !row[2]) continue;
          const oikCode = row[0].trim().padStart(4, "0");
          const localPartyNum = parseInt(row[2], 10);
          if (Number.isNaN(localPartyNum)) continue;
          const rawName = (row[3] ?? "").trim();
          const resolution = resolveLocalParty(rawName, byNickNameLower);
          if (resolution.unmatchedFragments.length > 0) {
            unmatchedByRawName[rawName] = resolution.unmatchedFragments;
          }
          parties.push({
            oikCode,
            oikName: (row[1] ?? "").trim(),
            localPartyNum,
            localPartyName: rawName,
            isIndependent: resolution.isIndependent,
            primaryCanonicalId: resolution.primaryCanonicalId,
            memberCanonicalIds: resolution.memberCanonicalIds,
            unmatchedFragments: resolution.unmatchedFragments,
          });
        }
        resolve({ parties, unmatchedByRawName });
      })
      .on("error", reject),
  );
};
