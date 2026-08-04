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
  uics?: string[] | null; // shared declared/linked company EIKs (a person can hold many)
  birthDate?: string | null;
  /**
   * True when `party` comes from holding a NATIONAL PARTY OFFICE — the Сметна палата
   * `party_leader` category: chair, deputy chair, or the person who represents the party
   * under its statute. A seat a handful of people per party hold, not an affiliation
   * millions share, so it qualifies the party evidence — see `samePartyOffice`.
   */
  partyOffice?: boolean;
  /**
   * For `local` mentions: WHICH SEAT this term is a term of, as minted by `localSeatKey`
   * (scripts/parsers_local/localPersonRefs.ts) — which is also where the per-role reasons
   * for the key's shape live. NULL means "this repo cannot name the seat stably", not
   * "no seat", and the rule must then not fire at all. See `sameLocalSeat`.
   */
  localSeat?: string | null;
  /** The election cycle the term belongs to (`2023_10_29_mi`). Two terms of one seat in
   *  DIFFERENT cycles are re-election; in the SAME cycle they are two different people. */
  localCycle?: string | null;
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
export type ReviewCandidate = {
  memberIds: string[];
  /** Why it can't be auto-resolved: a 2-part name colliding with the whole block, or an
   *  identical full name that stayed split (a common 3-part name — many people share it). */
  reason: "twopart_block" | "identical_fullname";
};
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
const shareCorroborant = (
  a: Mention,
  b: Mention,
  contestedTerms: ReadonlySet<string>,
): boolean => {
  const ca = a.corroborants;
  const cb = b.corroborants;
  const shareUic =
    !!ca.uics &&
    !!cb.uics &&
    ca.uics.some((u) => u !== "" && cb.uics!.includes(u));
  const strong = shareUic || (!!ca.birthDate && ca.birthDate === cb.birthDate);
  const weakBoth =
    !!ca.party && ca.party === cb.party && !!ca.place && ca.place === cb.place;
  return (
    strong ||
    weakBoth ||
    samePartyOffice(a, b) ||
    sameLocalSeat(a, b, contestedTerms)
  );
};

/** `<seat>\t<cycle>` — one TERM of one seat, the unit `contestedTerms` counts. */
const seatTerm = (m: Mention): string | null =>
  m.corroborants.localSeat && m.corroborants.localCycle
    ? `${m.corroborants.localSeat}\t${m.corroborants.localCycle}`
    : null;

/**
 * The seat-terms in a block that MORE THAN ONE mention claims — the mentions
 * `sameLocalSeat` must refuse to touch. Read its comment for why.
 */
const contestedSeatTerms = (mentions: Mention[]): Set<string> => {
  const seen = new Map<string, number>();
  for (const m of mentions) {
    const k = seatTerm(m);
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
};

// The LOCAL-CONTINUITY rule: the same seat, held under the same name, in two different
// election cycles.
//
// Why it was needed. `weakBoth` above wants party AND place, and a local officeholder
// routinely has no party at all — an инициативен комитет carries `primaryCanonicalId: null`,
// which is exactly how a village mayor without a party gets on the ballot. So a re-elected
// officeholder merged only if Tier 2 saved them (a globally unique name), and otherwise
// became one person record per term: 640 (name, obshtina, role) groups spanning 1,402 person
// records, five-term mayors split into five pages. 498 of those groups are people sitting
// today. docs/plans/local-person-links-v2.md §A3.
//
// Why the seat is good evidence where party is not. A село has ONE кмет на кметство and a
// община ONE кмет, so "the Х who was mayor of this place in 2015 is the Х who was mayor of
// it in 2019" needs only that no two same-named people held that one seat in different
// cycles. Party evidence carries no such exclusivity — thousands share a party.
//
// The key is NOT equally exclusive for every role, and it is worth being plain about that.
// `councillor` keys on the ОБЩИНА, because a list position is not a seat — so it means "on
// this council", which seats dozens rather than one. The claim there is the weaker "the same
// three-part name on the same council in two different cycles is one person re-elected",
// which is what the §A3 measurement actually found across all roles.
//
// DIFFERENT CYCLES IS REQUIRED, and is the guard rather than a detail — it is what keeps the
// weaker keys honest. Within ONE cycle two mentions of a seat-key are two DIFFERENT people:
// for a mayor because the seat is held by one person, and for a councillor because one
// council does not seat the same person twice. Since §T2 a village mayor's place is the
// SETTLEMENT, a same-cycle collision there means two same-named people in one village —
// precisely the case that must go to review, not merge. Measured: 637 of the 640 split
// groups span cycles, 3 do not, and those 3 must surface as `identical_fullname` candidates.
//
// THE SAME-CYCLE GUARD CANNOT BE A PAIRWISE CONDITION, and this is the one thing about the
// rule that is easy to get wrong — it was wrong in the first draft. Every other Tier-1
// corroborant is an EQUALITY, so transitive closure preserves it; "different cycle" is an
// ANTI-condition, and union-find closes over edges regardless. Three mentions of one seat,
// two of them in 2023, still fuse: 2019–2023a and 2019–2023b are each legal pairs, and the
// two 2023 rows arrive in one component through the 2019 row without ever being compared.
// The damage is not merely a bad merge — `reviewCandidates` is computed from the FINAL
// components, so a single root also DELETES the `identical_fullname` flag that was supposed
// to carry the case to a human. (Live instance: Валери Иванов Василев, VID09, elected from
// two different lists on the same council in 2023 plus a 2019 term.)
//
// So the guard is applied at BLOCK level instead: any seat-term claimed by more than one
// mention is "contested", and every mention claiming a contested term is excluded from this
// rule entirely — including against a third, uncontested cycle. That last part is deliberate.
// If two people held seat S in 2023, we cannot say WHICH of them is the S of 2019, so
// merging the 2019 term into either is a coin flip. All three stay separate and Tier 3
// flags them, which is the outcome the measurement asked for.
//
// Note the exclusion can only ever cost a merge, never create one: a same-cycle duplicate
// that is genuinely one person (a councillor listed under two coalition party numbers) is
// left split for review rather than joined. That is the correct direction to fail.
//
// THE NAMESAKE CAP APPLIES ONLY WHERE THE SEAT IS NOT EXCLUSIVE — i.e. to `councillor`.
//
// It is inherited from `samePartyOffice`, and it turned out to be both the wrong instrument
// here and the only thing still blocking the rule's headline cases. `namesakeRisk` is
// `officer_name_counts.company_count` — a count of COMPANIES an officer-name appears in,
// which `resolve_persons` already calls a flawed proxy elsewhere. It says nothing about how
// many people of that name hold office, so on an exclusive seat it filters a man only if he
// happens to sit on many boards. Measured over the 18,935 people with a local role: 10,766
// score 0 and just 657 (3.5%) exceed 12.
//
// Those 657 are not a random tail. After the §A3 resolve, 53 groups (121 person records) on
// an EXCLUSIVE seat were still split, and the cap was the sole blocker for all 53 — among
// them the plan's own symptom #3, Георги Стоянов Георгиев, кмет на община Тунджа across
// 2007–2019 on four person records at `namesakeRisk` 39, and кмет на BGS09 on all five
// cycles as five records.
//
// Dropping it there is not a loosening so much as deleting a guard that was never doing this
// job: one община has one кмет and one село one кмет на кметство, so on those seats the SEAT
// identifies and the name only has to agree. The same-cycle contest exclusion above is what
// covers the ambiguous case, and it is unaffected.
//
// Adjacency was considered as a replacement and REJECTED as undeliverable against this
// corpus: 2011 and 2015 carry zero village-mayor rows, so the recurring "2007, 2019, 2023"
// shape is a DATA GAP, not a career gap, and requiring consecutive terms would refuse a man
// who served continuously.
//
// The residue this accepts, stated plainly: 4 of the 43 village groups bridge a 16-year gap
// on a mass name (e.g. "Димитър Иванов Димитров", risk 178) with no intervening term. A
// grandson sharing his grandfather's full name is possible in a name-concentrated village —
// the patronymic guard excludes father/son but not that. Judged acceptable against leaving
// 121 records split; revisit if a wrong merge is ever reported.
//
// `councillor` KEEPS the cap because its key is the ОБЩИНА — a council seats dozens, so the
// exclusivity argument above does not hold and the name is doing more of the work.
const LOCAL_SEAT_NAMESAKE_CAP = 12;

/** Seats held by exactly ONE person per cycle — see `LOCAL_SEAT_NAMESAKE_CAP`. Keyed off the
 *  role prefix `localSeatKey` writes, so it cannot drift from the key itself. */
const EXCLUSIVE_SEAT = /^(mayor|village_mayor)\t/;

const sameLocalSeat = (
  a: Mention,
  b: Mention,
  contestedTerms: ReadonlySet<string>,
): boolean => {
  const ta = seatTerm(a);
  const tb = seatTerm(b);
  if (!ta || !tb) return false;
  if (contestedTerms.has(ta) || contestedTerms.has(tb)) return false;
  const seat = a.corroborants.localSeat!;
  if (
    seat !== b.corroborants.localSeat ||
    a.corroborants.localCycle === b.corroborants.localCycle
  )
    return false;
  if (a.nameParts !== 3 || b.nameParts !== 3) return false;
  if (a.ambiguous || b.ambiguous) return false;
  if (!a.patronymicFold || a.patronymicFold !== b.patronymicFold) return false;
  if (EXCLUSIVE_SEAT.test(seat)) return true;
  return (
    a.namesakeRisk <= LOCAL_SEAT_NAMESAKE_CAP &&
    b.namesakeRisk <= LOCAL_SEAT_NAMESAKE_CAP
  );
};

// The party-office rule. A national party office is held by a handful of people per party,
// so "same party" seen from that seat is far stronger than the ordinary affiliation weak
// evidence above — but only against an IDENTICAL FULL NAME. The caller has already blocked
// on (given, family), so demanding a patronymic that is PRESENT on both sides and equal
// pins the whole name; the remaining claim is "the X who chairs party P is the X who
// stands for party P", and for that to be wrong two different people with the same three
// names must both attach to the same party, one of them in its leadership.
//
// This is the one merge in the resolver that does NOT need a place, which is the whole
// point: a minister or a party chair has an institution, not an oblast, so weak-both can
// never fire for them — that is why Слави Трифонов's declared wealth sat on a person row
// disjoint from /person/mp-3056 while namesake_risk 5 kept Tier 2 shut. Ambiguous (4+
// token) names are excluded, as everywhere else the split is a guess.
//
// Still capped on namesake risk, because on a MASS name the argument collapses: "Георги
// Иванов Георгиев" carries 198 and a party the size of ГЕРБ has many, so the leader and
// the councillor of that name are not one person in any expected sense. The cap is the
// same company_count <= 12 the connections layer (008_connections.sql) already uses to
// mean "this fold is not a mass collision" — well above the 4-9 a real party officer
// scores, well below a name shared by hundreds.
const PARTY_OFFICE_NAMESAKE_CAP = 12;

const samePartyOffice = (a: Mention, b: Mention): boolean =>
  (a.corroborants.partyOffice === true ||
    b.corroborants.partyOffice === true) &&
  a.nameParts === 3 &&
  b.nameParts === 3 &&
  !a.ambiguous &&
  !b.ambiguous &&
  a.namesakeRisk <= PARTY_OFFICE_NAMESAKE_CAP &&
  b.namesakeRisk <= PARTY_OFFICE_NAMESAKE_CAP &&
  !!a.patronymicFold &&
  a.patronymicFold === b.patronymicFold &&
  !!a.corroborants.party &&
  a.corroborants.party === b.corroborants.party;

// A DIFFERING patronymic that is present on BOTH records is disconfirming: "Иван Петров
// Х" and "Иван Стоянов Х" are different people, so no name-based corroborant (party+place
// or even a shared company) may merge them. The patronymic is the clearest same-name
// disambiguator — and the namesake machinery exists precisely because a bare given+family
// collides — so a real conflict VETOES a corroborant merge. Real data proves it: "Теньо
// Динев Тенев" and "Теньо Желязков Тенев" (same party/oblast) are NOT one candidate.
// Tier 0 (a shared MP id) is exempt — a gold key is the same person despite a spelling
// variance — and Tier 2 already unions only matching patronymics, so this guards Tier 1.
const patronymicConflict = (a: Mention, b: Mention): boolean =>
  a.nameParts === 3 &&
  b.nameParts === 3 &&
  !!a.patronymicFold &&
  !!b.patronymicFold &&
  a.patronymicFold !== b.patronymicFold;

/**
 * Decide merges + review-candidates for one block of same-fold mentions.
 *
 * Guarantees (the §7a invariants): a `MergeGroup` is only ever formed by a shared
 * hardId (Tier 0), a shared corroborant (Tier 1 — a company/birth date, party AND place,
 * or an identical full name sharing a party with a party office), or a globally-unique
 * clean fold (Tier 2, `namesakeRisk <= 1` AND all 3-part AND none ambiguous). A 2-part
 * name, an ambiguous name, or a colliding fold (`namesakeRisk > 1`) is NEVER merged
 * without a corroborant — it stays its own person and surfaces as a review candidate.
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

  // Tier 1 — a shared corroborant (pairwise; a block is small), UNLESS a present-on-both
  // patronymic conflicts (a hard negative that overrides any corroboration). The contested
  // seat-terms are computed over the WHOLE block first because one of the corroborants
  // (`sameLocalSeat`) rests on a condition transitive closure does not preserve.
  const contested = contestedSeatTerms(mentions);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (
        !patronymicConflict(mentions[i], mentions[j]) &&
        shareCorroborant(mentions[i], mentions[j], contested)
      )
        union(i, j);

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
    reviewCandidates.push({
      memberIds: mentions.map((m) => m.id),
      reason: "twopart_block",
    });
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
      if (g.roots.size >= 2)
        reviewCandidates.push({
          memberIds: g.ids,
          reason: "identical_fullname",
        });
  }

  return { merges, reviewCandidates };
}
