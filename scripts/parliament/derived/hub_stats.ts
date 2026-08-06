// The /parliament hub's stat blob — one small file the hub reads instead of the ~1.65 MB of
// full derived artifacts its seven preview tiles used to fetch between them.
//
// Computed from the objects rebuildDerived ALREADY HAS IN MEMORY, at the end of its run.
// Two reasons that matters more than it looks: the 31 MB dissents artifact is never
// re-parsed, and — the real one — the hub's numbers cannot drift from the sub-pages',
// because both are literally the same object.
//
// ===========================================================================
// EVERY FIGURE DECLARES ITS BASIS.
//
// Not a style rule. There are three defensible answers to "how many votes were there" in
// the 52nd NS (1,263 raw / 1,198 post-dedupe / 1,157 titled) and three to "what is
// attendance" (70.2% simple mean / 73.2% weighted / 73.6% over full-term members), and an
// earlier draft of the hub picked a different one for each tile by accident. The basis is
// chosen once here and named in the field, and §11's gate recomputes it from the source.
// ===========================================================================

import type { SessionFile } from "./types";
import type { AttendanceOutput } from "./attendance";
import type { CohesionOutput } from "./cohesion";
import type { SimilarityHeadlineSlice } from "./similarity_headline";

/** The three states an NS can be in. `partial` is the dangerous one: it renders exactly
 *  like `full` unless the hub is told, and the 44th NS holds five months of a four-year
 *  term. */
export type Coverage = "full" | "partial";

export interface HubTileStats {
  /** Plenary days for THIS parliament — not the 613 corpus total. */
  sessions: number;
  /** Post-dedupe item count, the denominator every other metric on the module uses. */
  items: number;
  /** Bills reaching a second reading, by title-stem grouping. NOT "laws passed" — the
   *  corpus has no whole-bill adoption marker, so the pass/fail split is not derivable. */
  billsSecondReading: number;
  /** Members who cast at least one vote. Exceeds the seat count, because substitutions. */
  membersVoting: number;
  /** Members the UMAP actually placed. Fewer than membersVoting — the projection drops
   *  members with too little signal — so the map's own tile must not quote the roll. */
  membersProjected: number;
  /** Parliamentary groups with a cohesion entry. */
  groups: number;
  /** WEIGHTED: sum(present) / sum(items). A simple mean over members over-weights those
   *  who sat for nine items. */
  attendanceWeighted: number;
  /** Unweighted mean over groups. Paired with the least-unified group, because one number
   *  cannot wear both labels. */
  cohesionMean: number;
  leastUnifiedGroup: string | null;
  leastUnifiedValue: number | null;
}

export interface HubNsStats {
  lastDate: string;
  coveredFrom: string;
  coveredTo: string;
  coverage: Coverage;
  /** Days since the last sitting, as of the build. The hub re-derives this against the
   *  reader's today; this is here so a prerendered body can state it. */
  inRecessDays: number;
  tiles: HubTileStats;
  seeds: { similarity?: string; pair?: string };
}

export interface HubStatsFile {
  computedAt: string;
  byNs: Record<string, HubNsStats>;
}

const DAY_MS = 86_400_000;

/** Bills that reached a second reading, by title stem.
 *
 *  The corpus has no "law adopted" record: 7,782 items across the corpus carry
 *  „второ гласуване", but they are per-ARTICLE votes — 754 in the 52nd NS alone, of which
 *  466 match `параграф`. Counting them would report ~750 laws for a parliament that passed
 *  a few dozen. Grouping on the title before the reading marker collapses the 52nd's 754
 *  to 33, which is a credible number and the one the tile shows.
 *
 *  What is NOT derivable is the pass/fail split: the largest stem (държавния бюджет, 232
 *  items) ends on yes:38 no:4 abstain:135, a rejected amendment rather than an adoption. */
export const secondReadingBills = (sessions: SessionFile[]): number => {
  const stems = new Set<string>();
  for (const session of sessions) {
    for (const title of Object.values(session.itemTitles ?? {})) {
      const stem = title
        .split(/\s*[-–—]\s*второ\s+(?:гласуване|четене)/i)[0]
        .trim();
      // THE SPLIT FIRING is the qualification, not a bare "второ гласуване" match.
      // Bulgarian plenary titles carry the phrase in a PROCEDURAL position too — „ЗИ на
      // Закона за държавната финансова инспекция – първо гласуване - процедура за второ
      // гласуване" is a motion to take a bill through both readings in one sitting, and it
      // is a FIRST reading. Matching the phrase alone made eight such titles their own
      // stems on the 52nd, every one of them a bill already counted from its real second
      // reading: 33 where the honest answer is 25. (55 of 189 on the 51st.) The plan's own
      // "33" was measured with the loose regex and so confirmed nothing.
      if (stem && stem !== title.trim()) stems.add(stem);
    }
  }
  return stems.size;
};

export interface HubStatsInput {
  ns: string;
  /** DEDUPED sessions for this NS — the same set every other metric is computed over. */
  sessions: SessionFile[];
  attendance: AttendanceOutput | undefined;
  cohesion: CohesionOutput | undefined;
  headline: SimilarityHeadlineSlice | undefined;
  /** Points in the UMAP projection for this NS. */
  embeddingPoints: number;
  /** Most-divergent party pair slug, if the correlation matrix yielded one. */
  pairSlug: string | undefined;
  /** ISO date the build treats as "today", so the output is deterministic under test. */
  today: string;
}

/** The term this parliament actually sat, so `partial` can be detected. Sourced from the
 *  sessions themselves rather than a calendar: a parliament's dissolution date is not in
 *  this corpus, and inventing one would be worse than measuring the span we hold. */
/** Not a group: the unaffiliated buckets parliament.bg reports alongside the real ones. */
const NON_GROUP = /^(НЕЗ|НЕЧЛ)/i;

/** Collapse spelling variants so one group counts once. Hyphen-vs-spaced-hyphen is the
 *  only variation the corpus actually shows, but normalising all separators is no less
 *  correct and does not depend on that staying true. */
const groupKey = (short: string): string =>
  short
    .replace(/\s*-\s*/g, "-")
    .trim()
    .toUpperCase();

export const realGroups = <T extends { partyShort: string }>(
  entries: T[],
): T[] => {
  const byKey = new Map<string, T>();
  for (const e of entries) {
    if (NON_GROUP.test(e.partyShort.trim())) continue;
    const key = groupKey(e.partyShort);
    // Keep the first spelling seen; the entries arrive sorted, so this is stable.
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()];
};

const spanOf = (sessions: SessionFile[]): { from: string; to: string } => {
  const dates = sessions.map((s) => s.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
};

export const computeHubNsStats = (input: HubStatsInput): HubNsStats | null => {
  if (input.sessions.length === 0) return null;
  const { from, to } = spanOf(input.sessions);

  const attendanceEntries = input.attendance?.entries ?? [];
  const totalItems = attendanceEntries.reduce((n, e) => n + e.totalItems, 0);
  const totalPresent = attendanceEntries.reduce(
    (n, e) => n + e.presentCount,
    0,
  );

  // cohesion.json's entries are not the parliamentary GROUPS. They include the
  // unaffiliated buckets (НЕЗ, НЕЧЛ В ПГ, НЕЧЛ ПГ) — which are not groups and vote like
  // individuals, so they drag the mean down — and the same group under two spellings
  // (`ГЕРБ - СДС` and `ГЕРБ-СДС` both appear in the 51st). Counting them gave the 51st
  // fifteen "groups" for a chamber of about eight, and the 50th a mean of 0.94 against a
  // real-group 0.97 with НЕЧЛ В ПГ as its "least unified group".
  const cohesionEntries = realGroups(input.cohesion?.entries ?? []);
  const least = cohesionEntries.reduce<(typeof cohesionEntries)[number] | null>(
    (worst, e) => (!worst || e.meanCohesion < worst.meanCohesion ? e : worst),
    null,
  );

  // A parliament whose recorded span is much shorter than the gap between its first sitting
  // and the next parliament's would be `partial` — but that comparison needs the NEXT NS,
  // which this function does not see. The caller supplies it via `coverage`; the default
  // here is the honest one for a span we can measure end to end.
  const days = input.sessions.length;

  return {
    lastDate: to,
    coveredFrom: from,
    coveredTo: to,
    coverage: "full",
    inRecessDays: Math.max(
      0,
      Math.round(
        (Date.parse(`${input.today}T00:00:00Z`) -
          Date.parse(`${to}T00:00:00Z`)) /
          DAY_MS,
      ),
    ),
    tiles: {
      sessions: days,
      items: input.attendance?.totalVoteItems ?? 0,
      billsSecondReading: secondReadingBills(input.sessions),
      membersVoting: attendanceEntries.length,
      membersProjected: input.embeddingPoints,
      groups: cohesionEntries.length,
      attendanceWeighted: totalItems > 0 ? totalPresent / totalItems : 0,
      cohesionMean:
        cohesionEntries.length > 0
          ? cohesionEntries.reduce((n, e) => n + e.meanCohesion, 0) /
            cohesionEntries.length
          : 0,
      leastUnifiedGroup: least?.partyShort ?? null,
      leastUnifiedValue: least?.meanCohesion ?? null,
    },
    seeds: {
      ...(input.headline?.seedId != null
        ? { similarity: String(input.headline.seedId) }
        : {}),
      ...(input.pairSlug ? { pair: input.pairSlug } : {}),
    },
  };
};
