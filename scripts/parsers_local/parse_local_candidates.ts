// Parse local_candidates.txt — the slate of candidates per (OIK, local party).
//
// Columns: oik_code ; oik_name ; local_party_num ; local_party_name ; list_pos ; candidate_name
//
// For council ballots (ОС), `list_pos` enumerates the full party list
// (a município with 33 seats may have lists of 30+ candidates). For mayor
// ballots (КО/КК/КР), there's typically one row per (oik, party) with
// list_pos = 1 — the candidate name.

import fs from "fs";
import { parse } from "csv-parse";
import { LocalCandidate } from "./types";

export const parseLocalCandidates = (
  inFolder: string,
): Promise<LocalCandidate[]> => {
  const file = `${inFolder}/local_candidates.txt`;
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
        const out: LocalCandidate[] = [];
        for (const row of rows) {
          if (!row[0] || !row[2] || !row[4]) continue;
          const listPos = parseInt(row[4], 10);
          if (Number.isNaN(listPos)) continue;
          const localPartyNum = parseInt(row[2], 10);
          if (Number.isNaN(localPartyNum)) continue;
          out.push({
            oikCode: row[0].trim().padStart(4, "0"),
            oikName: (row[1] ?? "").trim(),
            localPartyNum,
            localPartyName: (row[3] ?? "").trim(),
            listPos,
            candidateName: (row[5] ?? "").trim(),
          });
        }
        resolve(out);
      })
      .on("error", reject),
  );
};
