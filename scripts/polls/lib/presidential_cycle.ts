import fs from "node:fs";
import path from "node:path";
import { isRealIsoDate } from "../../../src/data/polls/fieldwork";

export const presidentialRound1Date = (cycle: string): string | null => {
  if (typeof cycle !== "string" || !/^\d{4}_\d{2}_\d{2}_pvr$/.test(cycle))
    return null;
  const date = cycle.slice(0, 10).replace(/_/g, "-");
  return isRealIsoDate(date) ? date : null;
};

export const presidentialCycleDates = (root: string) => {
  const dir = path.join(root, "data");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const round1 = presidentialRound1Date(entry.name);
      if (!entry.isDirectory() || !round1) return [];
      const file = path.join(dir, entry.name, "national_summary.json");
      const summary = fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as {
            round2Date?: string | null;
          })
        : {};
      const round2 = summary.round2Date;
      return [
        {
          cycle: entry.name,
          round1,
          lastRound:
            typeof round2 === "string" &&
            isRealIsoDate(round2) &&
            round2 > round1
              ? round2
              : round1,
        },
      ];
    })
    .sort((a, b) => a.round1.localeCompare(b.round1));
};

/** Date-only inference is restricted to the election year. Between-round
 * observations belong to that cycle; older undated campaigns stay unresolved. */
export const resolvePresidentialCycle = (
  root: string,
  end: string,
): string | null => {
  if (!isRealIsoDate(end)) return null;
  return (
    presidentialCycleDates(root).find(
      (c) => c.round1.slice(0, 4) === end.slice(0, 4) && end <= c.lastRound,
    )?.cycle ?? null
  );
};
