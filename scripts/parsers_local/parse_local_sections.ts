// Parse a local-election sections.txt file. Same column shape as
// parliamentary, but we additionally derive the 4-digit OIK code from
// the admin_unit_id field — that's the join key for fan-out per município.
//
// admin_unit_id is the OIK identifier for council (ОС) and município mayor
// (КО) ballots; for kmetstvo and район ballots it's the kmetstvo/район id.
// We always slice the first 4 digits to get the parent OIK.

import fs from "fs";
import { parse } from "csv-parse";
import { LocalSection } from "./types";

const oikFromAdminUnitId = (raw: string): string => {
  // OIK codes in mi2023 are 4 digits ("0103"). Older cycles may use shorter
  // forms; pad-left to 4 to normalise.
  const digits = (raw ?? "").replace(/\D+/g, "");
  if (digits.length === 0) return "";
  return digits.slice(0, 4).padStart(4, "0");
};

export const parseLocalSections = (
  inFolder: string,
): Promise<LocalSection[]> => {
  const file = `${inFolder}/sections.txt`;
  if (!fs.existsSync(file)) return Promise.resolve([]);
  const result: string[][] = [];
  const sections: LocalSection[] = [];
  return new Promise((resolve, reject) =>
    fs
      .createReadStream(file)
      .pipe(
        parse({
          delimiter: ";",
          relax_column_count: true,
          relax_quotes: true,
        }),
      )
      .on("data", (row) => result.push(row))
      .on("end", () => {
        for (const row of result) {
          // CIK mi2019/mi2023 layout (per readme):
          //   row[0] section_code(9)
          //   row[1] admin_unit_id      ← OIK / kmetstvo / район
          //   row[2] admin_unit_name    e.g. "0103. Благоевград"
          //   row[3] ekatte
          //   row[4] settlement_name
          //   row[5] mobile_flag
          if (!row[0]) continue;
          const sectionCode = row[0].trim();
          if (!sectionCode) continue;
          const oikCode = oikFromAdminUnitId(row[1] ?? "");
          // admin_unit_name often starts with "NNNN. " — the same 4 digits
          // as oikCode, included as a quick sanity check (skip on mismatch
          // to avoid silent data drift).
          const adminUnitName = (row[2] ?? "").trim();
          const namePrefix = adminUnitName.match(/^(\d{3,4})\.\s/);
          if (
            namePrefix &&
            oikCode &&
            namePrefix[1].padStart(4, "0") !== oikCode
          ) {
            // Don't throw — older cycles or kmetstvo/район rows may legitimately
            // disagree (admin_unit_name reflects the sub-OIK identifier).
          }
          sections.push({
            sectionCode,
            oikCode,
            // We don't have oblast in this file; left blank — the
            // orchestrator fills it from data/municipalities.json via the
            // OIK→obshtina mapping.
            oblastName: "",
            ekatte: (row[3] ?? "").trim(),
            settlement: (row[4] ?? "").trim(),
            isMobile: (row[5] ?? "").trim() === "1",
          });
        }
        resolve(sections);
      })
      .on("error", reject),
  );
};
