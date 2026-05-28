// Parse protocols.txt for a local election race-type folder.
//
// Per CIK's mi2019/mi2023 readme:
//   row[0]  form_id  (typically "1")
//   row[1]  section_code
//   row[2]  admin_unit_id (OIK/kmetstvo/район)
//   row[3]  serial pages joined by "|"
//   row[4]  ballots received (т. А)
//   row[5]  numRegisteredVoters (т. 1)
//   ...
//   row[6+] various ballot-accounting fields, then validVotes etc.
//
// We extract only the three fields the SPA needs at the município-tile level:
// registered voters, actual voters, valid votes. (Full protocol breakdown
// can be added later if a dedicated local-protocol screen is built.)

import fs from "fs";
import { parse } from "csv-parse";

export type LocalProtocolRow = {
  sectionCode: string;
  oikCode: string;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
};

export const parseLocalProtocols = (
  inFolder: string,
): Promise<LocalProtocolRow[]> => {
  const file = `${inFolder}/protocols.txt`;
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
        const out: LocalProtocolRow[] = [];
        for (const row of rows) {
          if (!row[1]) continue;
          const sectionCode = row[1].trim();
          if (!sectionCode) continue;
          const oikDigits = (row[2] ?? "").replace(/\D+/g, "");
          const oikCode = oikDigits
            ? oikDigits.slice(0, 4).padStart(4, "0")
            : "";
          // mi2019/mi2023 column positions per the readme:
          //   row[5] = num registered voters at handover (sum of 1.a + 1.b)
          //   row[9] = num signatures = totalActualVoters
          //   row[19] = (т. 7) total valid votes  — used as numValidVotes
          // Some race types omit certain points (e.g. KO has fewer fields
          // than OS); we fall back to NaN-safe parsing.
          const numRegisteredVoters = parseInt(row[5] ?? "", 10);
          const totalActualVoters = parseInt(row[9] ?? "", 10);
          // Find first plausible "valid votes" candidate: prefer row[19],
          // fall back to the last numeric column. The exact index varies
          // by race type and round, so structural-defensive parsing.
          const validCandidates = [19, 18, 17, 16, 15]
            .map((i) => parseInt(row[i] ?? "", 10))
            .filter((v) => !Number.isNaN(v));
          const numValidVotes = validCandidates[0] ?? 0;
          out.push({
            sectionCode,
            oikCode,
            numRegisteredVoters: Number.isNaN(numRegisteredVoters)
              ? 0
              : numRegisteredVoters,
            totalActualVoters: Number.isNaN(totalActualVoters)
              ? 0
              : totalActualVoters,
            numValidVotes,
          });
        }
        resolve(out);
      })
      .on("error", reject),
  );
};
