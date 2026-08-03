// The one reader of the procedure catalogue.
//
// The prerender and the sitemap must enumerate EXACTLY the same set: a <loc>
// with no prerendered dist/<path>/index.html is the failure the repo's
// sitemap-validity rule exists to catch, and it happens the moment the two
// consumers hand-roll the same shape with a slightly different filter. They
// share this function instead.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { FundsProjectsProceduresIndex } from "./projects_types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROCEDURES_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/funds/projects/by-procedure/index.json",
);

export type IndexableProcedure =
  FundsProjectsProceduresIndex["procedures"][number];

const isFiniteNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * Every procedure that earns a page, or [] when the catalogue is missing or
 * unreadable.
 *
 * Malformed entries are dropped with a warning rather than published: an empty
 * code would write into the parent directory (replacing its index.html) and a
 * non-finite figure would render "EUR NaN" into a title. Silence would delete
 * pages while a separately-generated sitemap kept listing them.
 */
export const readIndexableProcedures = (
  file: string = PROCEDURES_INDEX_FILE,
): IndexableProcedure[] => {
  if (!fs.existsSync(file)) return [];
  let parsed: Partial<FundsProjectsProceduresIndex>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(
      `funds: could not read ${file} — no procedure pages (${String(err)})`,
    );
    return [];
  }
  if (!Array.isArray(parsed.procedures)) {
    if (parsed.procedures != null)
      console.warn(
        `funds: ${file} has a non-array \`procedures\` — no procedure pages`,
      );
    return [];
  }
  return parsed.procedures.filter((p) => {
    const ok =
      typeof p?.procedureCode === "string" &&
      p.procedureCode.trim().length > 0 &&
      [p.contractCount, p.beneficiaryCount, p.totalEur, p.paidEur].every(
        isFiniteNum,
      );
    if (!ok)
      console.warn(
        `funds: skipping malformed procedure entry ${JSON.stringify(p?.procedureCode)}`,
      );
    return ok;
  });
};
