// Pure row selection behind the presidential polls accuracy cards
// (`src/screens/presidential/PresidentialPollsTile.tsx`) — kept out of the component file so
// it is testable without rendering and so the component module exports components only.
//
// ⚠ THE GRADE IS THE ANALYZER'S. `kind: "complete"` is exactly „the analyzer published an
// MAE with complete coverage"; a partial comparison keeps `mae: null` here whatever its errors
// would average to. See the tile's header for why.

import { fieldworkEndMs } from "@/data/polls/fieldwork";
import type {
  Poll,
  PresidentialCandidateResultError,
  PresidentialCycleAccuracy,
} from "@/data/polls/pollsTypes";

/** Anchor of the full explorer the „see details" link scrolls to. */
export const PRESIDENTIAL_POLLS_DETAIL_ID = "presidential-polls-detail";

export type PresidentialPollRow =
  | {
      kind: "complete" | "partial";
      agencyId: string;
      mae: number | null;
      daysBefore: number;
      miss: PresidentialCandidateResultError | null;
    }
  | {
      kind: "unscored";
      agencyId: string;
      daysBefore: number | null;
      reasons: string[];
    };

const DAY_MS = 86_400_000;

const biggestMiss = (
  errors: PresidentialCandidateResultError[],
): PresidentialCandidateResultError | null =>
  errors.reduce<PresidentialCandidateResultError | null>(
    (best, e) => (!best || Math.abs(e.error) > Math.abs(best.error) ? e : best),
    null,
  );

const pollEndMs = (p: Poll | undefined): number | null => {
  if (!p) return null;
  const iso = p.provenance?.fieldworkEnd;
  if (iso) {
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) return ms;
  }
  return fieldworkEndMs(p.fieldwork);
};

/** One row per agency with a poll on this round. Pure, so the three-way split is testable. */
export const accuracyRows = (
  cycle: PresidentialCycleAccuracy,
  round: 1 | 2,
  polls: Poll[],
): PresidentialPollRow[] => {
  const target = cycle.rounds?.find((r) => r.round === round);
  const roundMs = target ? Date.parse(target.date) : NaN;
  const pollById = new Map(polls.map((p) => [p.id, p]));
  const rows: PresidentialPollRow[] = [];
  const seen = new Set<string>();

  for (const c of target?.comparisons ?? []) {
    if (seen.has(c.agencyId)) continue;
    seen.add(c.agencyId);
    rows.push({
      kind: c.mae !== null && c.coverage.complete ? "complete" : "partial",
      agencyId: c.agencyId,
      mae: c.coverage.complete ? c.mae : null,
      daysBefore: c.daysBefore,
      miss: biggestMiss(c.errors),
    });
  }

  // Agencies whose every question on this round was refused: name the refusal of the LATEST.
  const latest = new Map<
    string,
    { endMs: number | null; reasons: string[]; pollId: string }
  >();
  for (const d of cycle.diagnostics ?? []) {
    if (d.round !== round || seen.has(d.agencyId)) continue;
    const endMs = pollEndMs(pollById.get(d.pollId));
    const prev = latest.get(d.agencyId);
    const newer =
      !prev ||
      (endMs ?? -Infinity) > (prev.endMs ?? -Infinity) ||
      ((endMs ?? -Infinity) === (prev.endMs ?? -Infinity) &&
        d.pollId > prev.pollId);
    if (newer)
      latest.set(d.agencyId, { endMs, reasons: d.reasons, pollId: d.pollId });
  }
  for (const [agencyId, l] of latest)
    rows.push({
      kind: "unscored",
      agencyId,
      daysBefore:
        l.endMs !== null && !Number.isNaN(roundMs)
          ? Math.round((roundMs - l.endMs) / DAY_MS)
          : null,
      reasons: l.reasons,
    });

  const rank = { complete: 0, partial: 1, unscored: 2 } as const;
  return rows.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      (a.kind === "complete" && b.kind === "complete"
        ? (a.mae ?? 0) - (b.mae ?? 0)
        : 0) ||
      (a.daysBefore ?? Infinity) - (b.daysBefore ?? Infinity) ||
      a.agencyId.localeCompare(b.agencyId),
  );
};

/** `source_ineligible` is the reviewer's summary flag and rides on nearly every refusal, so it
 *  tells a reader nothing; name the first SPECIFIC reason and fall back to it only when alone. */
export const specificReason = (reasons: string[]): string =>
  reasons.find((r) => r !== "source_ineligible") ?? reasons[0];
