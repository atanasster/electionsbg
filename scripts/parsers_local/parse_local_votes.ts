// Parse votes.txt for a local election race-type folder.
//
// Two on-disk shapes, auto-detected per row:
//
//   A) minr2015 / mi2019 (paper only):
//        section_code ; admin_unit_id ; <triplets: party_num ; valid ; invalid>
//
//   B) mi2023 (machine voting added):
//        form_id ; section_code ; admin_unit_id ;
//          <quadruplets: party_num ; total_valid ; paper ; machine>
//      (total_valid = paper + machine — that's the action-vote total we want.)
//
// We tell them apart by whether the SECOND field is a full 9-digit section
// code: in shape A field[1] is the short admin_unit_id (3–4 digits for the
// council ballot), in shape B the leading form_id pushes the 9-digit section
// into field[1]. In both shapes the votes value is the field right after the
// party number.
//
// One record is emitted per (section, party) so downstream rollups sum cleanly.

import fs from "fs";
import { parse } from "csv-parse";
import { resolveRaceFile } from "./csv_files";

export type LocalVoteRow = {
  sectionCode: string;
  oikCode: string;
  localPartyNum: number;
  validVotes: number;
  invalidVotes: number;
};

const isFullSection = (s: string | undefined): boolean =>
  /^\d{9}$/.test((s ?? "").trim());

export const parseLocalVotes = (inFolder: string): Promise<LocalVoteRow[]> => {
  const file = resolveRaceFile(inFolder, "votes");
  if (!file) return Promise.resolve([]);
  return parseVotesFile(file);
};

// Parse one explicit votes.txt path (same row decoding as parseLocalVotes).
// Exposed so callers that need to merge a race folder's multiple dated files
// (e.g. an original tabulation + a later partial re-count) can read each.
export const parseVotesFile = (file: string): Promise<LocalVoteRow[]> => {
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
          // Shape B carries a leading form_id, so the 9-digit section lands in
          // field[1]; shape A starts with the section directly.
          const formIdPrefixed = isFullSection(row[1]);
          const sectionCode = (formIdPrefixed ? row[1] : row[0])?.trim() ?? "";
          if (!sectionCode) continue;
          const oikDigits = ((formIdPrefixed ? row[2] : row[1]) ?? "").replace(
            /\D+/g,
            "",
          );
          const oikCode = oikDigits
            ? oikDigits.slice(0, 4).padStart(4, "0")
            : "";
          const start = formIdPrefixed ? 3 : 2;
          const step = formIdPrefixed ? 4 : 3; // quadruplets vs triplets
          for (let j = start; j + step - 1 < row.length; j += step) {
            const partyRaw = row[j];
            if (!partyRaw || partyRaw.trim() === "") continue;
            const partyNum = parseInt(partyRaw, 10);
            if (Number.isNaN(partyNum)) continue;
            // Field right after the party number is the (total) valid votes in
            // both shapes; the trailing field(s) are paper/machine or invalid.
            const valid = parseInt(row[j + 1] ?? "0", 10) || 0;
            const invalid =
              step === 3 ? parseInt(row[j + 2] ?? "0", 10) || 0 : 0;
            out.push({
              sectionCode,
              oikCode,
              localPartyNum: partyNum,
              validVotes: valid,
              invalidVotes: invalid,
            });
          }
        }
        resolve(out);
      })
      .on("error", reject),
  );
};
