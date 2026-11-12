// Pure rules for "has the operator's file drop landed?" — kept apart from the
// registry so they are unit-testable without the files on disk.

import { newestQuarterOf } from "../../budget/municipal_fiscal/quarter_token";

/** Does any of `files` cover the `due` quarter ("YYYY-QN")? A release covers
 *  up to the highest quarter its name mentions (newestQuarterOf), whatever
 *  else МФ put in the name. */
export const coversQuarter = (
  files: readonly string[],
  due: unknown,
): boolean => {
  if (typeof due !== "string" || !/^\d{4}-Q[1-4]$/.test(due)) return false;
  return files.some((f) => {
    const q = newestQuarterOf(f);
    return q !== "" && q >= due;
  });
};

/** Is the EC FTS XLSX for `year` among `files`? `year` may arrive as a number
 *  or a numeric string from watcher meta. */
export const hasFtsYear = (
  files: readonly string[],
  year: unknown,
): boolean => {
  const y =
    typeof year === "number"
      ? year
      : typeof year === "string" && /^\d{4}$/.test(year)
        ? Number(year)
        : NaN;
  return Number.isInteger(y) && files.includes(`${y}_FTS_dataset_en.xlsx`);
};
