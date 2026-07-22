// Pure filter for the /education "Намери своето училище" finder — kept out of the
// screen so the wiring (≥2-char guard, name-OR-община match, score sort, 30-cap) is
// unit-tested without mounting the screen. Matching folds both scripts via the
// shared skeletonMatches, so Cyrillic and shliokavitsa (Latin-typed) queries match.

import { skeletonMatches } from "@/lib/translitSearch";
import type { DirectorySchool } from "@/data/schools/useSchoolDirectory";

const MAX_RESULTS = 30;

export const searchSchools = (
  schools: DirectorySchool[],
  query: string,
): DirectorySchool[] => {
  if (query.trim().length < 2) return [];
  return schools
    .filter(
      (s) =>
        skeletonMatches(s.name, query) ||
        skeletonMatches(s.obshtinaName, query),
    )
    .sort((a, b) => (b.latestScore ?? 0) - (a.latestScore ?? 0))
    .slice(0, MAX_RESULTS);
};
