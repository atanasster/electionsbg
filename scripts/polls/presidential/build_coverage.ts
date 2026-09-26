import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Agency, Poll } from "../../../src/data/polls/pollsTypes";
import type { PresidentialCoverage } from "../../../src/data/presidential/pollCoverage";
import { pollEnd } from "../../../src/data/presidential/pollHistory";

type Review = {
  reviewedAt: string;
  publications: { agencyId: string; year: number; status: string }[];
};
type Watch = {
  lastChecked?: string;
  meta?: { armErrors?: { site?: string }; error?: string };
  error?: string;
  detail?: string;
};
const watcherNames: Record<string, string> = {
  TR: "trend",
  AR: "alpha_research",
  GM: "global_metrics",
  SH: "sova_harris",
  ML: "market_links",
  MY: "myara",
  GIB: "gallup",
};
export function buildCoverage(
  agencies: Agency[],
  polls: Poll[],
  review: Review,
  watches: Record<string, Watch>,
): PresidentialCoverage {
  return {
    reviewedAt: review.reviewedAt,
    agencies: agencies.map((a) => {
      const accepted = polls.filter((p) => p.agencyId === a.id);
      const dates = accepted
        .map(pollEnd)
        .filter((d): d is string => !!d)
        .sort();
      const reviewed = review.publications.filter((p) => p.agencyId === a.id);
      const watch = watches[a.id];
      return {
        agencyId: a.id,
        lastChecked: watch?.lastChecked ?? null,
        unavailable: !!(
          watch?.error ||
          watch?.meta?.armErrors?.site ||
          watch?.meta?.error
        ),
        accepted: accepted.length,
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
        reviewedPublications: reviewed.length,
        missingMetadata: reviewed.filter((p) => p.status === "missing_metadata")
          .length,
        excluded: reviewed.filter((p) => p.status === "excluded").length,
        otherQuestions: reviewed.filter(
          (p) => p.status === "other_question" || p.status === "other_race",
        ).length,
        cycles: [2001, 2006, 2011, 2016, 2021, 2026].map((year) => ({
          year,
          accepted: accepted.filter(
            (p) => Number((p.cycle ?? pollEnd(p))?.slice(0, 4)) === year,
          ).length,
        })),
      };
    }),
  };
}
export function main(root = process.cwd()) {
  const read = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const watches: Record<string, Watch> = {};
  for (const [id, name] of Object.entries(watcherNames)) {
    const file = path.join(root, "state/watch/polls_" + name + ".json");
    if (fs.existsSync(file))
      watches[id] = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const result = buildCoverage(
    read<Agency[]>("data/polls/agencies.json"),
    read<Poll[]>("data/polls/presidential/polls.json"),
    read<Review>("state/polls/historical-reconciliation.json"),
    watches,
  );
  fs.writeFileSync(
    path.join(root, "data/polls/presidential/coverage.json"),
    JSON.stringify(result) + "\n",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
