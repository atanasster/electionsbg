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

import { OFFICIAL_DECLARATION_SOURCES } from "../../src/lib/officialSources";

/**
 * The only sources Tier 2b may merge — the ones its two people-counts actually COVER.
 *
 * `mpPeople` counts distinct mp ids on the fold, so `mp` is covered. `registerPeople`
 * counts distinct Сметна палата declarants, so the Court-of-Audit roster sources are
 * covered — and `OFFICIAL_DECLARATION_SOURCES` is imported rather than restated because
 * that set is already the answer to "whose ref is a declaration slug", and a hand-copied
 * list here would silently omit `president` / `mep` / `diplomat` exactly as the
 * `startsWith("official")` test once did.
 *
 * Everything else — `candidate`, `local`, `tr`, `donor`, `magistrate`, `ngo` — is OUTSIDE
 * both counts. A person of that name can exist there without ever appearing in either
 * register, so "unique in the register" is not evidence about them. See condition (3) in
 * Tier 2b.
 */
const COUNTED_SOURCES: ReadonlySet<string> = new Set<string>([
  "mp",
  ...OFFICIAL_DECLARATION_SOURCES,
]);

/**
 * "This fold is not a mass collision" — `officer_name_counts.company_count <= 12`, the value
 * `008_connections.sql` already uses for that sentence.
 *
 * FOUR rules cap on it and each keeps its own NAME, because each may legitimately diverge —
 * `sameLocalSeat` already does, dropping the cap entirely on an exclusive seat. What the alias
 * buys is that they are visibly ONE decision today, so a change to the shared meaning cannot
 * move three of them and quietly miss the fourth. That is the "someone missed one" shape
 * `declared_label()` and `magistrate_current` are documented as fixing elsewhere in this repo.
 */
const MASS_COLLISION_CAP = 12;

/** The source `sameCandidacyParty` is argued for, named rather than inlined for the reason
 *  `COUNTED_SOURCES` is: the gate is load-bearing — it is what stops a future mention type
 *  inheriting a licence nobody argued for it — so it should not be a bare literal. */
const CANDIDACY_SOURCE = "candidate";

/**
 * Mass-name backstop for Tier 2b. NOT a return to the company-count gate 2b replaces — the
 * difference is the threshold's job. Tier 2a asks `namesakeRisk <= 1`, which refuses a man
 * for sitting on two boards; this asks `<= 12`, the same value `samePartyOffice` and
 * councillor-`sameLocalSeat` already use to mean "this fold is not a mass collision".
 *
 * It is here because 2b's licence is weakest exactly where the name is commonest, and for a
 * reason the counts cannot see: the register only knows people who have FILED. On
 * „Владимир Иванов Иванов" (44 companies) or „Петър Георгиев Петров" (70), one declarant of
 * the name is evidence about that declarant and very little about whether the MP is him.
 * Every other name-based rule in this file carries such a cap; 2b was the only one without.
 * The mayor exemption in `sameLocalSeat` does not transfer — it rests on one village having
 * one mayor, and no seat is exclusive here.
 */
const TIER2B_NAMESAKE_CAP = MASS_COLLISION_CAP;

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
  /**
   * For `candidate` mentions: WHICH ELECTION this candidacy belongs to (`2022_10_02`).
   *
   * The same shape as `localCycle` and for the same reason — it is what lets
   * `sameCandidacyParty` require two candidacies to be in DIFFERENT elections, which is the
   * whole guard on a rule that otherwise rests on name + party alone. NULL means the mention
   * is not a candidacy, and the rule then cannot fire.
   */
  candidacyElection?: string | null;
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
  /** Distinct-company count for the folded name — the namesake / defamation guard.
   *  NOT a count of people; see Tier 2b in `clusterBlock` for why that matters. */
  namesakeRisk: number;
  /**
   * How many DIFFERENT people the Сметна палата register knows by this exact full name —
   * distinct per-declarant filing GUIDs on the fold (`PERSON_GUID_SQL_PATTERN`). A real
   * person key, unlike `namesakeRisk`.
   *
   * **0 means the register has never seen this name, NOT that the name is unique**, which
   * is why Tier 2b demands exactly 1 rather than `<= 1`. Measured 2026-08-11: a `<= 1`
   * reading would newly permit merges on 3,142 folds, 1,469 of them with no register
   * presence at all — i.e. it would read absence of evidence as evidence of uniqueness, on
   * folds where nothing has ever attested who these people are.
   *
   * Optional so existing callers and fixtures default to "not attested" (no new merge).
   */
  registerPeople?: number;
  /** Distinct parliament mp ids carrying this exact full name fold — the other real
   *  per-person key. Unlike the register count this may legitimately be 0 (most people are
   *  not MPs), so Tier 2b only requires it not to exceed 1. */
  mpPeople?: number;
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
  contested: Contested,
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
    sameLocalSeat(a, b, contested.seatTerms) ||
    sameCandidacyParty(a, b, contested)
  );
};

/**
 * The two BLOCK-LEVEL exclusion sets. Both rules that rest on "the same X in two DIFFERENT
 * cycles" need one, for the reason `sameLocalSeat` states at length: "different cycle" is an
 * ANTI-condition, and union-find closes over edges regardless, so it cannot be enforced
 * pairwise. Computed once over the whole block and passed down.
 */
type Contested = {
  /** Seat-terms more than one mention claims — `sameLocalSeat`. */
  seatTerms: ReadonlySet<string>;
  /** (party, election) ballots more than one mention claims — `sameCandidacyParty`. */
  ballots: ReadonlySet<string>;
  /**
   * TRUE when this block's fold is PROVABLY more than one person — see `provenMultiPerson`.
   * Not a doubt like the two sets above; a fact, and it disables `sameCandidacyParty`
   * outright for the block.
   */
  multiPerson: boolean;
};

/**
 * Does the corpus PROVE this fold is at least two people?
 *
 * Изборен кодекс чл. 254 ал. 2 registers a candidate for the National Assembly by ONE
 * party or coalition per election. So the same full name standing under TWO canonical
 * parties in ONE election is not an ambiguity — it is two different people, stated by the
 * register itself.
 *
 * That is a hard NEGATIVE, the shape `patronymicConflict` already has, and it is the one
 * piece of disconfirming evidence this corpus supplies for free. It matters here for a
 * reason beyond the obvious: `sameCandidacyParty` does not merge across a party change, so
 * it never asserts such a pair directly — but it LENGTHENS CHAINS, and a single pre-existing
 * strong edge (a shared company uic between two of the members) then fuses the whole
 * component. Measured: the same uic edge unions 2 mentions without this rule and 4 with it,
 * two of which are same-election candidacies of different parties. Refusing the rule on such
 * a fold removes the amplification at its source.
 *
 * ⚠️ It cannot be a pairwise test. The disconfirmation is a fact about the FOLD, not about
 * the pair being considered — the two mentions that prove it are usually not the two being
 * merged — so it is computed over the block, exactly like the contested sets.
 *
 * Measured over the corpus: 120 folds are in this state, and 7 of the 266 groups this rule
 * would otherwise merge sit on one.
 */
const provenMultiPerson = (mentions: Mention[]): boolean => {
  const partiesByElection = new Map<string, Set<string>>();
  for (const m of mentions) {
    const e = m.corroborants.candidacyElection;
    if (m.source !== CANDIDACY_SOURCE || !e || !m.corroborants.party) continue;
    (
      partiesByElection.get(e) ?? partiesByElection.set(e, new Set()).get(e)!
    ).add(m.corroborants.party);
  }
  return [...partiesByElection.values()].some((s) => s.size > 1);
};

/**
 * The four name-shape guards every name-based merge rule in this file carries: an identical,
 * unambiguous THREE-part name (the patronymic present on both sides and equal, which is what
 * pins the full name once the caller has blocked on given+family), and a namesake cap.
 *
 * Extracted so `TIER2B_NAMESAKE_CAP`'s claim — "every other name-based rule in this file
 * carries such a cap" — is upheld by CONSTRUCTION rather than by inspection: a new rule that
 * forgets one cannot silently omit it, it has to opt out by passing `NO_NAMESAKE_CAP` and say
 * why. `sameLocalSeat` is the one existing opt-out, on a seat only one person can hold.
 */
const nameShapeOk = (a: Mention, b: Mention, cap: number): boolean =>
  a.nameParts === 3 &&
  b.nameParts === 3 &&
  !a.ambiguous &&
  !b.ambiguous &&
  !!a.patronymicFold &&
  a.patronymicFold === b.patronymicFold &&
  a.namesakeRisk <= cap &&
  b.namesakeRisk <= cap;

/** The deliberate opt-out — see `sameLocalSeat`'s EXCLUSIVE_SEAT argument for the only case
 *  that has earned it: where the SEAT identifies, the name only has to agree. */
const NO_NAMESAKE_CAP = Number.POSITIVE_INFINITY;

/** `<seat>\t<cycle>` — one TERM of one seat, the unit `contested.seatTerms` counts. */
const seatTerm = (m: Mention): string | null =>
  m.corroborants.localSeat && m.corroborants.localCycle
    ? `${m.corroborants.localSeat}\t${m.corroborants.localCycle}`
    : null;

/** `<party>\t<election>` — one party's ballot in one election, the unit
 *  `contested.ballots` counts. Candidacies only; a non-candidate mention has no ballot. */
const ballot = (m: Mention): string | null =>
  m.source === CANDIDACY_SOURCE &&
  m.corroborants.party &&
  m.corroborants.candidacyElection
    ? `${m.corroborants.party}\t${m.corroborants.candidacyElection}`
    : null;

/** The keys in a block that MORE THAN ONE mention claims — the mentions each rule must
 *  refuse to touch. Read `sameLocalSeat` / `sameCandidacyParty` for why. */
const contestedKeys = (
  mentions: Mention[],
  key: (m: Mention) => string | null,
): Set<string> => {
  const seen = new Map<string, number>();
  for (const m of mentions) {
    const k = key(m);
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
const LOCAL_SEAT_NAMESAKE_CAP = MASS_COLLISION_CAP;

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
  return nameShapeOk(
    a,
    b,
    EXCLUSIVE_SEAT.test(seat) ? NO_NAMESAKE_CAP : LOCAL_SEAT_NAMESAKE_CAP,
  );
};

// The CANDIDACY-CONTINUITY rule: the same full name, standing for the same party, in two
// DIFFERENT elections.
//
// Why it was needed. `weakBoth` wants party AND place, and for a candidacy the place is the
// МИР — so a candidate who moved district between elections became one person record per
// election. That is the reported case: Боян Иванов Бойчев stood for БСП in София 24 МИР in
// 2022 and 2024 and in София 23 МИР in 2023, and was published as TWO people, indistinguishable
// in the header search. Measured over the whole corpus: 317 (fold, party) groups are split
// across ≥2 active public persons this way, 266 of them clearing the shape and namesake gates
// below — 580 person records that are 266 people. docs/plans/person-search-duplicate-rows-v1.md §4.
//
// Why the election is the guard, and not a detail. Within ONE election a party may run two
// same-named people on two МИР lists, and nothing in the CIK shards distinguishes them — name,
// ballot number, oblast and a preference count is the whole record. Across elections the claim
// is the far weaker "the X who stood for P in 2022 is the X who stood for P in 2024", which is
// what re-standing looks like. So DIFFERENT elections is required, exactly as `sameLocalSeat`
// requires different cycles.
//
// ⚠️ THE SAME-ELECTION GUARD CANNOT BE PAIRWISE — this is the trap `sameLocalSeat`'s header
// documents and it applies here unchanged. "Different election" is an ANTI-condition, and
// union-find closes over edges regardless: three candidacies of one party, two of them in 2022,
// still fuse, because 2024–2022a and 2024–2022b are each legal pairs and the two 2022 rows
// arrive in one component through the 2024 row without ever being compared. And the damage is
// not merely a bad merge — `reviewCandidates` is computed from the FINAL components, so a
// single root also DELETES the `identical_fullname` flag that was supposed to carry the case to
// a human. Hence the block-level `contested.ballots`: any (party, election) claimed by more
// than one mention excludes every mention claiming it, including against a third, uncontested
// election. We cannot say WHICH of two same-named 2022 candidates is the 2024 one, so merging
// either is a coin flip; all three stay separate and Tier 3 flags them.
//
// ⚠️ AND `contested.ballots` CANNOT SEE THE CASE THE PARAGRAPH ABOVE OPENS WITH — do not read
// it as covering "one party runs two same-named people in one election". `buildGroups`
// (src/data/candidates/resolveCore.ts) buckets CIK rows by `${normalize(name)}|${partyNum}`
// and emits ONE shard per bucket with an `oblasts` ARRAY, so two such people collapse upstream
// into a single by-slug shard and therefore a single mention: `contestedKeys` counts 1, and
// `resolve_persons` then reads `oblasts[0]` and discards the rest. The measured "0 contested
// groups" is a property of that key, not evidence the collision is absent — 10,679 of 67,075
// shards (15.9%) span two or more МИР and are indistinguishable from two people. The guard
// stays because it is load-bearing against what it CAN see (a fold reaching one ballot through
// two different shards), but the conflation it cannot see is upstream of this file.
//
// ACCEPTED RESIDUE, stated rather than implied, as `sameLocalSeat` does:
//   • the upstream shard conflation above — one mention that is really two people, on a fold
//     where nothing downstream can tell. 4 shards of 67,075 span ≥3 МИР, which no lawful
//     candidacy can (ИК admits at most two), and even those are not separated here.
//   • a father and son of identical full name, both standing for the same party in different
//     elections, neither ever filing a declaration. The patronymic guard excludes father/son
//     only when the patronymics differ, which by construction they do not here.
// Both are judged acceptable against publishing 580 records for 266 people; revisit if a
// wrong merge is ever reported.
//
// ⚠️ THE PARTY MUST BE THE CANONICAL ID, never the ballot number. `partyNum` is positional and
// changes every election — in the reported case it is 28, then 1, then 28 — so a rule reading
// it would refuse the real continuity and, worse, occasionally assert it between two unrelated
// parties that happened to draw the same number twice.
//
// THREE GUARDS, and the namesake cap is the WEAKEST of them — read them in the order the body
// applies them, not in the order of precedent:
//
//   1. `provenMultiPerson` — the fold stands under two parties in one election, so the
//      register itself says these are several people. A hard negative, not a doubt.
//   2. `registerPeople` / `mpPeople` — real per-person ids, applied as a VETO. This rule has
//      no exclusivity to lean on (`sameLocalSeat` has "one община, one кмет";
//      `samePartyOffice` has "a handful of officeholders per party"), so unlike them it
//      cannot afford to skip the counts that measure people rather than companies.
//   3. `namesakeRisk <= 12` — the same value `samePartyOffice` and councillor-`sameLocalSeat`
//      use for "this fold is not a mass collision". It is kept, and it does remove 46 of the
//      312 eligible groups (the uncontested 3-part population reaches 220, and "two ГЕРБ
//      candidates named Георги Иванов Георгиев" is not one person in any expected sense) —
//      but it counts COMPANIES, which this file's own Tier 2b comment calls the wrong
//      instrument, so it is a backstop here and never the licence.
//
// Measured on the shipped population: 312 eligible groups, 266 clear the cap, 258 clear all
// three — 580 person records that are 258 people.
//
// What this rule deliberately does NOT do: cross a party change. That is the strictly weaker
// case analysed in docs/plans/person-cross-party-candidate-merge-v1.md, whose conclusion —
// adjudicate it per-ref rather than automate it — stands. Party continuity is the one piece of
// evidence here that is not simply the name again.
const CANDIDACY_NAMESAKE_CAP = MASS_COLLISION_CAP;

const sameCandidacyParty = (
  a: Mention,
  b: Mention,
  contested: Contested,
): boolean => {
  const ka = ballot(a);
  const kb = ballot(b);
  if (!ka || !kb) return false;
  // The fold is PROVABLY several people (ИК чл. 254 ал. 2) — nothing here can say which of
  // them either candidacy belongs to. See `provenMultiPerson`.
  if (contested.multiPerson) return false;
  if (contested.ballots.has(ka) || contested.ballots.has(kb)) return false;
  if (a.corroborants.party !== b.corroborants.party) return false;
  if (a.corroborants.candidacyElection === b.corroborants.candidacyElection)
    return false;
  // ⚠️ THE REAL PER-PERSON COUNTS COME FIRST, and they are a VETO rather than a requirement.
  // `namesakeRisk` counts COMPANIES — this file's own Tier 2b comment already calls it the
  // wrong instrument — and on THIS rule it is the whole licence, because nothing else here
  // identifies anybody: a party runs hundreds of candidates per election. `registerPeople`
  // and `mpPeople` are real per-person ids and sit unused on every mention.
  //
  // A VETO (`> 1`), not Tier 2b's requirement (`=== 1`): 0 means the register has never seen
  // this name, which is true of most candidates and is evidence of nothing, so demanding 1
  // would refuse nearly every real merge. Measured on the shipped population: this removes
  // the ONE fold of 248 that the register positively contradicts — „Йордан Александров
  // Димитров", two distinct declarant GUIDs — and that one is a wrong PUBLIC merge, which
  // this file's header calls an accusation.
  if ((a.registerPeople ?? 0) > 1 || (b.registerPeople ?? 0) > 1) return false;
  if ((a.mpPeople ?? 0) > 1 || (b.mpPeople ?? 0) > 1) return false;
  return nameShapeOk(a, b, CANDIDACY_NAMESAKE_CAP);
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
const PARTY_OFFICE_NAMESAKE_CAP = MASS_COLLISION_CAP;

const samePartyOffice = (a: Mention, b: Mention): boolean =>
  (a.corroborants.partyOffice === true ||
    b.corroborants.partyOffice === true) &&
  nameShapeOk(a, b, PARTY_OFFICE_NAMESAKE_CAP) &&
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
  // seat-terms and ballots are computed over the WHOLE block first because TWO of the
  // corroborants (`sameLocalSeat`, `sameCandidacyParty`) rest on a "different cycle"
  // condition transitive closure does not preserve.
  const contested: Contested = {
    seatTerms: contestedKeys(mentions, seatTerm),
    ballots: contestedKeys(mentions, ballot),
    multiPerson: provenMultiPerson(mentions),
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (
        !patronymicConflict(mentions[i], mentions[j]) &&
        shareCorroborant(mentions[i], mentions[j], contested)
      )
        union(i, j);

  // Tier 2 — same UNIQUE full name. given+family are equal across the whole block, so the
  // full name is fixed by the patronymic. Two arms, both requiring a 3-part, non-ambiguous
  // name with a present patronymic.
  const shapeEligible = (m: Mention): boolean =>
    m.nameParts === 3 && !m.ambiguous && !!m.patronymicFold;

  const byPatronymic = new Map<string, number[]>();
  mentions.forEach((m, i) => {
    if (!shapeEligible(m)) return;
    const arr =
      byPatronymic.get(m.patronymicFold!) ??
      byPatronymic.set(m.patronymicFold!, []).get(m.patronymicFold!)!;
    arr.push(i);
  });

  // Tier 2a (the original rule) — merge when the full name is globally unique
  // (namesakeRisk <= 1). A common full name is NOT safe to merge on the name alone.
  //
  // Kept even though the number is the wrong one, because dropping it would UN-merge
  // people who are merged today — a separate decision from adding merges, and one that
  // re-splits live public profiles. `namesakeRisk` is
  // `officer_name_counts.company_count`: how many COMPANIES an officer of this name
  // appears on, not how many people bear it. So it refuses a man for sitting on two
  // boards (Ивайло Ангелов Московски scores 2; both companies are his) and accepts one
  // whose name happens to touch no company at all — measured, 11 MP profiles are merged
  // today on a fold the register itself knows two declarants for.
  for (const idxs of byPatronymic.values()) {
    const legacy = idxs.filter((i) => mentions[i].namesakeRisk <= 1);
    for (let j = 1; j < legacy.length; j++) union(legacy[0], legacy[j]);
  }

  // Tier 2b — the same question asked of PEOPLE instead of companies: does either register
  // we are joining know two different people by this exact full name? Both counts are real
  // per-person ids (the Сметна палата filing GUID, the parliament mp id), so this measures
  // the thing the tier is about rather than a proxy for it. Same claim shape as 2a — "no
  // alternative candidate exists", never positive proof — on a directly measured variable.
  //
  // It is the same move Bridge B already made when it replaced this proxy with a direct
  // people-uniqueness test, and it exists because 2a leaves an MP's ministerial or mayoral
  // declarations sitting on a person row of their own: 172 such pairs, every one of them
  // blocked by `namesakeRisk` alone and by nothing else.
  //
  // FIVE conditions, and each removes a specific way of being wrong:
  //  0. `namesakeRisk <= TIER2B_NAMESAKE_CAP` — the mass-name backstop. See the constant for
  //     why a cap is not a return to the proxy this arm replaces.
  //  1. `registerPeople === 1` — POSITIVE attestation. Not `<= 1`: see the field's comment,
  //     0 means the register has never seen the name.
  //  2. `mpPeople <= 1` — the parliament roster must not hold two of them either. May be 0;
  //     most people are not MPs.
  //  3. EACH OF THE TWO COMPONENTS is ANCHORED by a source one of the counts actually
  //     COVERS. This is the condition that makes the licence sound, and getting its scope
  //     right took two attempts.
  //
  //     Why it is needed: `registerPeople = 1` means "exactly one person of this name has
  //     ever FILED a declaration", which says nothing about how many people of that name
  //     exist outside the register. A `candidate` row is a name on a ЦИК list and a `local`
  //     row a name on a council roll; neither implies a filing, so a namesake who never
  //     declared is invisible to the count and would be merged into the one who did.
  //     Measured without this condition: 145 unlicensed cross-source merges — none of them
  //     MPs — including „Александър Иванов Иванов" (a mass name, 47 companies) folded
  //     across `candidate` + `official_exec`. `person_resolve.data.test.ts`'s cross-source
  //     invariant caught every one.
  //
  //     Why it is per-COMPONENT and not per-mention: nearly every MP also holds `candidate`
  //     mentions, gold-keyed to the same mp id by Tier 0. Demanding that EVERY mention be
  //     counted therefore rejected the whole group over rows already proven to be the same
  //     person — measured, it took this arm from 42 merged pairs to 2. A mention sitting
  //     inside a component is there because a gold key or a corroborant put it there, so it
  //     adds no unvouched-for identity; what must be anchored is each IDENTITY being joined.
  //     A component that is candidate-only or local-only has no counted anchor and is still
  //     refused.
  //  4. the group must resolve to EXACTLY TWO components. This is the conservative variant
  //     of docs/plans/mp-declaration-split-v1.md §2: a third identity on the fold is a third
  //     decision, and merging two of three is picking one without evidence. Measured, it
  //     costs little now — after the register gold key stopped being lost to per-document
  //     guids, the crowded folds it excludes had mostly collapsed anyway.
  //
  // A `tr` mention is excluded by (3) as a side effect, and that is the right reason: a TR
  // officer row is a name on a company filing with no person key behind it, so it is exactly
  // what neither count can vouch for. Bridge B attaches a public person's own TR footprint
  // under its own people-uniqueness guard instead.
  // The component split every group is judged against is SNAPSHOT FIRST, before any 2b
  // union runs. Reading it live made the tier order-dependent: 2b's own unions change what
  // `find()` returns, patronymic groups can share a component (a 2-part mention merged into
  // one of them by Tier 1 carries no patronymic and sits in no group of its own), and the
  // iteration order descends from unordered `SELECT`s over `official_roster` / `magistrate`.
  // Identical input could therefore produce different merges from run to run — on public
  // identity, which must be reproducible.
  const rootBefore = mentions.map((_, i) => find(i));
  for (const idxs of byPatronymic.values()) {
    if (idxs.length < 2) continue;
    const group = idxs.map((i) => mentions[i]);
    if (!group.every((m) => m.namesakeRisk <= TIER2B_NAMESAKE_CAP)) continue;
    if (!group.every((m) => m.registerPeople === 1)) continue;
    if (!group.every((m) => (m.mpPeople ?? 0) <= 1)) continue;
    const components = new Map<number, Mention[]>();
    for (const i of idxs) {
      const root = rootBefore[i];
      (components.get(root) ?? components.set(root, []).get(root)!).push(
        mentions[i],
      );
    }
    if (components.size !== 2) continue;
    const anchored = [...components.values()].every((ms) =>
      ms.some((m) => COUNTED_SOURCES.has(m.source)),
    );
    if (!anchored) continue;
    for (let j = 1; j < idxs.length; j++) union(idxs[0], idxs[j]);
  }

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
