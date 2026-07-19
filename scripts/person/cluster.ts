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
// evidence identifies a person INDEPENDENTLY of the name: a shared declared company
// (uic) or a shared birth date. WEAK evidence (party, place) does not — two different
// "Георги Иванов" in the same party is common — so it corroborates only IN COMBINATION
// (party AND place), the scoped context decorate_candidate_links actually relies on.
//
// Note: a matching PATRONYMIC is deliberately NOT here. It is part of the name, not
// independent of it, so on a common name it just re-states the collision (148 people
// share "Димитър Георгиев Димитров"). Full-name identity is handled by the
// namesake-gated Tier 2 below, which merges identical full names ONLY when they are
// globally unique — never on a common name.
const shareCorroborant = (a: Mention, b: Mention): boolean => {
  const ca = a.corroborants;
  const cb = b.corroborants;
  const strong =
    (!!ca.uic && ca.uic === cb.uic) ||
    (!!ca.birthDate && ca.birthDate === cb.birthDate);
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

  // Tier 2 — same UNIQUE full name. given+family are equal across the whole block, so
  // the full name is fixed by the patronymic. Merge mentions that share a patronymic
  // ONLY when that full name is globally unique (namesakeRisk <= 1), 3-part, and not an
  // ambiguous (4+ token) guess. A common full name (namesakeRisk > 1) is NOT safe to
  // merge on the name alone — many people share it — so it stays separate for review.
  const byPatronymic = new Map<string, number[]>();
  mentions.forEach((m, i) => {
    if (
      m.nameParts !== 3 ||
      m.ambiguous ||
      m.namesakeRisk > 1 ||
      !m.patronymicFold
    )
      return;
    const arr =
      byPatronymic.get(m.patronymicFold) ??
      byPatronymic.set(m.patronymicFold, []).get(m.patronymicFold)!;
    arr.push(i);
  });
  for (const idxs of byPatronymic.values())
    for (let j = 1; j < idxs.length; j++) union(idxs[0], idxs[j]);

  // Collect components.
  const comps = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (comps.get(r) ?? comps.set(r, []).get(r)!).push(i);
  }

  const merges: MergeGroup[] = [];
  for (const members of comps.values()) {
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
    }
  }

  // Tier 3 — aggressive review candidates: same-name mentions that did NOT merge, for a
  // human. Nothing is merged here. Two shapes:
  //  - A 2-part name is ambiguous against the WHOLE colliding block (it could be any of
  //    the full names present), so when a 2-part mention sits in a block of >=2 distinct
  //    persons, flag the whole block.
  //  - Otherwise flag only IDENTICAL full names (same patronymic) that stayed split —
  //    the genuine "same name, can't confirm same person" case — not people who merely
  //    share a given+family but differ in patronymic (those are clearly different).
  const reviewCandidates: ReviewCandidate[] = [];
  const distinctRoots = new Set(mentions.map((_, i) => find(i)));
  if (distinctRoots.size >= 2 && mentions.some((m) => m.nameParts === 2)) {
    reviewCandidates.push({ memberIds: mentions.map((m) => m.id) });
  } else {
    const byFullName = new Map<string, { ids: string[]; roots: Set<number> }>();
    mentions.forEach((m, i) => {
      const key = m.nameParts === 3 ? (m.patronymicFold ?? "") : "";
      const g =
        byFullName.get(key) ??
        byFullName.set(key, { ids: [], roots: new Set() }).get(key)!;
      g.ids.push(m.id);
      g.roots.add(find(i));
    });
    for (const g of byFullName.values())
      if (g.roots.size >= 2) reviewCandidates.push({ memberIds: g.ids });
  }

  return { merges, reviewCandidates };
}
