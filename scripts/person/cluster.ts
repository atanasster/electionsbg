// The resolver's merge-decision core (plan §3, the tiered resolution). PURE and
// hermetic — no DB — so it can carry the §7a gold-set + the hard invariant that a
// wrong PUBLIC merge is an accusation.
//
// Key model (why this is safe): a mention from an authoritative-keyed source (an MP
// seat, a magistrate record, an official slug, a donor row) is a REAL role on its own
// — its existence is never in doubt. What the resolver decides is whether two mentions
// are the SAME person. So namesake risk gates MERGES, never a record's existence:
//   - Tier 0/1/2 produce SAFE merges (→ one active person absorbing both roles).
//   - Tier 3 (ambiguous, aggressive policy) produces a REVIEW MERGE-CANDIDATE — a
//     "these same-fold people might be one" flag for a human — and NEVER an actual
//     merge. Ambiguous mentions therefore stay on separate active persons (each keeps
//     its real role) and nothing wrong is ever asserted publicly.
//
// Callers block first: every mention passed to clusterBlock() shares one
// (givenFold, familyFold) key (plan §2a — the patronymic is never the block key).

export type Corroborants = {
  party?: string | null;
  place?: string | null; // municipality / oblast
  uic?: string | null; // shared declared company
  birthDate?: string | null;
};

export type Mention = {
  /** Stable id within the run, e.g. "mp:123" | "magistrate:<name>" | "tr:<uic>~<name>". */
  id: string;
  source: string; // person_source key
  /** Gold key when the source has one (parliament MP id) — Tier 0. */
  hardId?: string | null;
  givenFold: string;
  familyFold: string;
  patronymicFold: string | null;
  nameParts: 2 | 3;
  ambiguous: boolean; // 4+ token guess (nameParts.ts)
  /** Distinct-company count for the folded name — the namesake / defamation guard. */
  namesakeRisk: number;
  corroborants: Corroborants;
};

/** A SAFE merge → one active person. `confidence` is the strongest edge that formed it. */
export type MergeGroup = {
  memberIds: string[];
  confidence: "exact_id" | "high";
};
/** An ambiguous same-fold group → a human review item. NOTHING is merged. */
export type ReviewCandidate = { memberIds: string[] };
export type ClusterResult = {
  merges: MergeGroup[];
  reviewCandidates: ReviewCandidate[];
};

// Corroborants have two strengths (the zero-false-public-merge invariant). STRONG
// evidence identifies a person on its own: a shared declared company (uic), a shared
// birth date, or a matching patronymic (only when BOTH names are 3-part — a 2-part
// name has no patronymic to agree on, §2a rule 3). WEAK evidence (party, place) does
// NOT: two different "Георги Иванов" in the same party is common, so party alone would
// false-merge. Weak signals corroborate only IN COMBINATION (party AND place) — the
// scoped name+party+place context decorate_candidate_links actually relies on.
const shareCorroborant = (a: Mention, b: Mention): boolean => {
  const ca = a.corroborants;
  const cb = b.corroborants;
  const strong =
    (!!ca.uic && ca.uic === cb.uic) ||
    (!!ca.birthDate && ca.birthDate === cb.birthDate) ||
    (a.nameParts === 3 &&
      b.nameParts === 3 &&
      !!a.patronymicFold &&
      a.patronymicFold === b.patronymicFold);
  const weakBoth =
    !!ca.party && ca.party === cb.party && !!ca.place && ca.place === cb.place;
  return strong || weakBoth;
};

/**
 * Decide merges + review-candidates for one block of same-fold mentions.
 *
 * Guarantees (the §7a invariants): a `MergeGroup` is only ever formed by a shared
 * hardId (Tier 0), a shared corroborant (Tier 1), or a globally-unique clean fold
 * (Tier 2, `namesakeRisk <= 1` AND all 3-part AND none ambiguous). A 2-part name, an
 * ambiguous name, or a colliding fold (`namesakeRisk > 1`) is NEVER merged without a
 * corroborant — it stays its own person and surfaces as a review candidate.
 *
 * @param mentions - mentions sharing one (givenFold, familyFold) block key
 * @returns safe merges and ambiguous review candidates (never both for the same pair)
 */
export function clusterBlock(mentions: Mention[]): ClusterResult {
  const n = mentions.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Tier 0 — same hardId.
  const byHardId = new Map<string, number>();
  mentions.forEach((m, i) => {
    if (m.hardId == null) return;
    const seen = byHardId.get(m.hardId);
    if (seen === undefined) byHardId.set(m.hardId, i);
    else union(seen, i);
  });

  // Tier 1 — a shared corroborant (pairwise; a block is small).
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (shareCorroborant(mentions[i], mentions[j])) union(i, j);

  // Tier 2 — unique clean fold: a globally-unique 3-part non-ambiguous name is one
  // person, so the whole block merges safely.
  const uniqueFoldClean = mentions.every(
    (m) => m.namesakeRisk <= 1 && m.nameParts === 3 && !m.ambiguous,
  );
  if (uniqueFoldClean) for (let i = 1; i < n; i++) union(0, i);

  // Collect components.
  const comps = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (comps.get(r) ?? comps.set(r, []).get(r)!).push(i);
  }

  const merges: MergeGroup[] = [];
  const singletonRoots: number[] = [];
  for (const [root, members] of comps) {
    if (members.length > 1) {
      // exact_id iff some hardId is shared by >=2 members (i.e. a Tier-0 edge formed
      // this component) — recomputed from the FINAL members, immune to root changes.
      const ids = members
        .map((i) => mentions[i].hardId)
        .filter((h): h is string => h != null);
      const exact = new Set(ids).size < ids.length;
      merges.push({
        memberIds: members.map((i) => mentions[i].id),
        confidence: exact ? "exact_id" : "high",
      });
    } else {
      singletonRoots.push(root);
    }
  }

  // Tier 3 — aggressive review candidate. Only when the block genuinely collides
  // (NOT unique-fold-clean), there is at least one un-merged (ambiguous) mention, and
  // 2+ distinct persons exist. Flags "these same-fold persons might be one"; merges
  // nothing. Lists one representative per distinct component.
  const reviewCandidates: ReviewCandidate[] = [];
  const distinctRoots = [...comps.keys()];
  if (
    !uniqueFoldClean &&
    singletonRoots.length >= 1 &&
    distinctRoots.length >= 2
  ) {
    reviewCandidates.push({
      memberIds: distinctRoots.map((r) => mentions[comps.get(r)![0]].id),
    });
  }

  return { merges, reviewCandidates };
}
