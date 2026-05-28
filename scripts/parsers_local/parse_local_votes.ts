// Parse votes.txt for a local election race-type folder.
//
// Per CIK's mi2019/mi2023 readme, each row is:
//   section_code ; admin_unit_id ; <triplets of: party_num ; valid_votes ; invalid_votes>
//
// The triplets repeat for every party that ran in the OIK; missing parties
// have no entry (not a zero). We emit one record per (section, party) so
// downstream rollups can sum cleanly.

import fs from "fs";
import { parse } from "csv-parse";

export type LocalVoteRow = {
  sectionCode: string;
  oikCode: string;
  localPartyNum: number;
  validVotes: number;
  invalidVotes: number;
};

export const parseLocalVotes = (inFolder: string): Promise<LocalVoteRow[]> => {
  const file = `${inFolder}/votes.txt`;
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
        const out: LocalVoteRow[] = [];
        for (const row of rows) {
          if (!row[0]) continue;
          const sectionCode = row[0].trim();
          const oikDigits = (row[1] ?? "").replace(/\D+/g, "");
          if (!sectionCode) continue;
          const oikCode = oikDigits
            ? oikDigits.slice(0, 4).padStart(4, "0")
            : "";
          // Walk the triplets starting at column 2.
          let j = 2;
          while (j + 2 < row.length) {
            const partyRaw = row[j];
            if (!partyRaw || partyRaw.trim() === "") {
              j += 3;
              continue;
            }
            const partyNum = parseInt(partyRaw, 10);
            const valid = parseInt(row[j + 1] ?? "0", 10) || 0;
            const invalid = parseInt(row[j + 2] ?? "0", 10) || 0;
            if (!Number.isNaN(partyNum)) {
              out.push({
                sectionCode,
                oikCode,
                localPartyNum: partyNum,
                validVotes: valid,
                invalidVotes: invalid,
              });
            }
            j += 3;
          }
        }
        resolve(out);
      })
      .on("error", reject),
  );
};
