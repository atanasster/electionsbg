// Cross-parliament arcs for the party-correlation heatmap: how one PAIR of groups has
// moved from parliament to parliament, and which pairs moved most into the current one.
//
// Costs nothing to serve. `party_correlation.json` is 17 KB and already carries all nine
// parliaments (44th-52nd); usePartyCorrelation downloads the whole file and slices one NS
// out of it, so the history is already in the browser — this module is arithmetic over
// bytes that were fetched anyway.
//
// FIVE RULES DECIDE WHETHER THE ARC IS TRUE, and every one of them is about identity rather
// than arithmetic. Getting any of them wrong produces a chart that is confidently wrong
// rather than empty, which is why they live here with their evidence instead of inline.
//
// Rules 1-3 are conservative: they refuse to equate anything the source did not. Rules 4-5
// deliberately do equate — a coalition with its parts, a group with its former name — and
// are therefore CURATED BY HAND, never inferred from the names. Every point they produce
// carries `via` so the join is visible on the page rather than asserted silently.

import { isGroupSentinel } from "@/data/parties/parliamentGroupAliases";
import type { PartyCorrelationFile, PartyCorrelationSlice } from "./types";

/** RULE 1 — fold SPELLINGS, never merge NAMES.
 *
 *  The roll-call source spells one group several ways: the 51st NS carries both
 *  „ГЕРБ - СДС" (3,698 items) and „ГЕРБ-СДС" (177), and both „ПП - ДБ" and „ПП-ДБ". Left
 *  unfolded, one group is two series and its arc breaks for no reason.
 *
 *  What this must NOT do is equate two different names. „ДПС" and „ДПС - НН" are not the
 *  same group — ДПС–Ново начало is one side of a split, and the 51st seats it alongside
 *  „ДПС - ДПС" and „АПС". „БСП" and „БСП - ОЛ" are likewise different coalitions. So the
 *  fold is purely typographic: whitespace around a hyphen, and repeated whitespace. A
 *  group that renames therefore ENDS its series and a new one begins, which is the honest
 *  reading of a party that split. */
export const canonGroupKey = (raw: string): string =>
  raw
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** RULE 2 — the unaffiliated are not a group.
 *
 *  „НЕЗ" and „НЕЧЛ В ПГ" are members WITHOUT a group, so a similarity between them and a
 *  party is a number about unrelated individuals who happen to be filed together. 135's
 *  party_cohesion matview already filters the same two buckets, for the same reason.
 *
 *  The membership test is `isGroupSentinel`, imported rather than restated: it folds through
 *  normalizeGroupShort before comparing, so a spelling this module has not seen still reads
 *  as a sentinel. A local exact-match set would fail in the worst direction — an unaffiliated
 *  bucket becoming a "party" with an arc across parliaments and a row on the movement board,
 *  which is the thing this rule exists to prevent. It is tested on the RAW spelling, before
 *  canonGroupKey, because the helper does its own folding. */

/** RULE 3 — a residue is not a group either.
 *
 *  The 51st also carries „ДПС" with THIRTEEN items against a busiest group of 3,862. A
 *  cosine over 13 items is not a small sample, it is a parse residue, and it charts as a
 *  real point: before this floor the ГЕРБ-СДС↔ДПС arc showed a dramatic collapse to 0 in
 *  the 51st that was entirely this row. Both floors are needed — the relative one alone
 *  would keep a residue in a short parliament (the 45th sat 17 days), the absolute one
 *  alone would keep it in a long one.
 *
 *  EXPORTED because the on-page caveat quotes both numbers. Interpolated rather than
 *  re-typed into two locale files, so moving a floor cannot leave the page asserting the
 *  old one in two languages at a 200. */
export const MIN_ITEMS = 20;
export const MIN_SHARE_OF_BUSIEST = 0.05;

/** RULE 4 — a coalition STANDS IN for its components while they sit as one group.
 *
 *  ПП and ДБ sat as ПП-ДБ through the 49th, 50th and 51st, so on rule 1 alone the
 *  ГЕРБ-СДС↔ПП arc has a three-parliament hole in the middle of the period it is most
 *  interesting for. There IS an answer for those years — the coalition's own row, which is
 *  by construction how both of them voted — so the coalition lends its vector to whichever
 *  of its components is not sitting separately.
 *
 *  This is the one place the module equates two different names, and it is safe only
 *  because the relationship is CONTAINMENT and is curated here by hand. It must never be
 *  extended to a split: ДПС-НН and ДПС-ДПС are rival successors, not a whole and its part,
 *  and lending one of them ДПС's arc would assert a continuity that is precisely what is in
 *  dispute.
 *
 *  A group that merely CHANGED ITS NAME is rule 5's business, not this one. */
export const COALITION_COMPONENTS: Record<string, readonly string[]> = {
  "ПП-ДБ": ["ПП", "ДБ"],
};

/** RULE 5 — a group that changed NAME keeps its arc, under the name it has now.
 *
 *  Distinct from rule 4 and it needs saying: this is a RENAME, not a containment. ДПС-НН
 *  is not part of ДПС, it is what that parliamentary group was called in the 51st, so the
 *  identity is substituted rather than lent — the group has one row and one arc, spelled
 *  two ways across nine parliaments.
 *
 *  This is a CURATED EDITORIAL CLAIM about which successor continues a brand, and in this
 *  one case that claim is contested: the 51st seats ДПС-НН, ДПС-ДПС and АПС at once, i.e.
 *  the split's two sides both sitting. Threading ДПС's pre-2024 arc through ДПС-НН says the
 *  Ново начало wing is the continuation, which is a defensible reading (it holds the plain
 *  ДПС name again in the 52nd) and not a neutral one. The other successors keep their own
 *  identities and are never merged into anything, so the page shows the split rather than
 *  hiding it — and every point that came from a differently-named row is marked `via`, so
 *  a reader can see the join instead of inferring a continuity we asserted for them.
 *
 *  The other two entries are quieter and both are junior-partner rebrands rather than
 *  splits: ГЕРБ picked up СДС after the 44th, and БСП ran as „БСП - ОБЕДИНЕНА ЛЕВИЦА" in
 *  the 51st. Neither has a rival successor sitting beside it, so neither carries the ДПС
 *  entry's editorial weight — but they are curated here all the same, because the rule that
 *  would have inferred them („X - Y continues X") is exactly the rule that would swallow
 *  ДПС - ДПС.
 *
 *  Keys are the OLD name, values the name the group goes by now — so an arc is spelled the
 *  way a reader would search for it today, not the way it began.
 *
 *  A rename is REFUSED when the target name is already sitting in the same parliament: two
 *  groups cannot be one row, and in that case the literal names are the honest answer.
 *  Verified against the artifact: none of these three pairs ever co-occurs above the floor. */
export const GROUP_CONTINUATIONS: Record<string, string> = {
  "ДПС-НН": "ДПС",
  ГЕРБ: "ГЕРБ-СДС",
  "БСП-ОЛ": "БСП",
};

export interface PairPoint {
  ns: string;
  /** Cosine in [-1, 1] — the artifact's own scale, not a percentage. */
  score: number;
  /** Set when this point is the COALITION's value standing in for a component that did not
   *  sit separately (rule 4) — the coalition's display name. A point with a `via` is a
   *  different kind of observation from one without, so every surface marks it. */
  via?: string;
}

export interface PairSeries {
  id: string;
  /** Canonical keys, sorted, so `id` is stable regardless of matrix order. */
  a: string;
  b: string;
  /** Raw spellings from the MOST RECENT parliament in the series — what to display. */
  aRaw: string;
  bRaw: string;
  /** Ascending by parliament. Absent parliaments are absent, never zero-filled: a pair
   *  that did not exist and a pair that voted orthogonally are different facts. */
  points: PairPoint[];
}

export interface PairMovement extends PairSeries {
  score: number;
  /** The most recent EARLIER parliament in which this pair existed — which is often not
   *  the immediately preceding one, since ПП and ДБ sat as one group in the 49th and 50th.
   *  A caption that says „спрямо предишното НС" would be wrong for those; consumers must
   *  print this. Null for a pair with no predecessor at all. */
  prevNs: string | null;
  prevScore: number | null;
  delta: number | null;
  /** Coalition names when either end of the comparison is a stood-in point (rule 4), so a
   *  row can say „спрямо 51-во НС (като ПП-ДБ)" rather than implying a like-for-like. */
  via: string | null;
  prevVia: string | null;
}

export interface PartyIdentity {
  key: string;
  raw: string;
  /** The row/column this identity reads in the parliament's matrix. Two identities lent by
   *  the same coalition share it, which is how their own pair is suppressed. */
  index: number;
  participation: number;
  via?: string;
}

type Group = Omit<PartyIdentity, "via">;

/** The groups of one parliament, keyed canonically, residues and non-groups removed.
 *  When several spellings fold to one key the busiest wins — it is the same group, and its
 *  own dominant row is the best available vector for it. */
export const groupsForSlice = (slice: PartyCorrelationSlice): Group[] => {
  const busiest = Math.max(0, ...Object.values(slice.participation ?? {}));
  const byKey = new Map<string, Group>();
  slice.parties.forEach((raw, index) => {
    if (isGroupSentinel(raw)) return;
    const key = canonGroupKey(raw);
    const participation = slice.participation?.[raw] ?? 0;
    const prev = byKey.get(key);
    if (!prev || participation > prev.participation) {
      byKey.set(key, { key, raw, index, participation });
    }
  });
  return [...byKey.values()].filter(
    (g) =>
      g.participation >= MIN_ITEMS &&
      (busiest === 0 || g.participation / busiest >= MIN_SHARE_OF_BUSIEST),
  );
};

/** The groups of one parliament as the identities the ARCS are keyed on — rule 4 applied.
 *
 *  A coalition never keeps an identity of its own alongside the ones it lends: that would
 *  be the same votes counted twice, once as ПП-ДБ↔ГЕРБ-СДС and again as ПП↔ГЕРБ-СДС, and
 *  the movement board would list both rows. When every component sits separately the
 *  coalition has nothing to lend and drops out entirely.
 *
 *  LENDING IS ALL-OR-NOTHING. If either component sits separately BESIDE the coalition, the
 *  coalition's row already contains that component, so it cannot stand in for the other
 *  without pairing a group against itself: ПП↔ДБ would resolve to matrix[ПП][ПП-ДБ], a
 *  partial self-correlation inflated upward, and only the ДБ end would carry a `via` — so it
 *  would read as an ordinary observation. No parliament in the corpus seats that shape today
 *  (49th-51st seat only the coalition, 47th/48th/52nd only the components), which is exactly
 *  why the guard is worth having in writing rather than in the data. */
export const identitiesForSlice = (
  slice: PartyCorrelationSlice,
): PartyIdentity[] => {
  const groups = groupsForSlice(slice);
  const literal = new Set(groups.map((g) => g.key));

  // Rule 5 first: a rename changes what is "present", which is what rule 4 then reads.
  // `raw` becomes the CURRENT name so one group reads the same on every row — the old
  // name survives on `via`, which is where a reader can see the join.
  const renamed: PartyIdentity[] = groups.map((g) => {
    const to = GROUP_CONTINUATIONS[g.key];
    if (!to || literal.has(to)) return g;
    return { ...g, key: to, raw: to, via: g.raw };
  });

  const present = new Set(renamed.map((g) => g.key));
  const out: PartyIdentity[] = [];
  for (const g of renamed) {
    const components = COALITION_COMPONENTS[g.key];
    if (!components) {
      out.push(g);
      continue;
    }
    // All-or-nothing (see the header): one component sitting separately makes this row a
    // container for it, not a stand-in for its sibling.
    if (components.some((key) => present.has(key))) continue;
    for (const key of components) {
      // `raw` is the component's own name: the label says ПП, and `via` is what qualifies
      // it. Naming the coalition here instead would put ПП-ДБ on an axis labelled ПП.
      out.push({ ...g, key, raw: key, via: g.raw });
    }
  }
  return out;
};

export const pairId = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/** Every pair's arc across every parliament in the file, ordered oldest-first. */
export const buildPairSeries = (
  file: PartyCorrelationFile | undefined,
): Map<string, PairSeries> => {
  const out = new Map<string, PairSeries>();
  if (!file?.byNs) return out;
  // Numeric, not lexicographic: the file's keys are NS numbers as strings.
  const nsKeys = Object.keys(file.byNs).sort((x, y) => Number(x) - Number(y));
  for (const ns of nsKeys) {
    const slice = file.byNs[ns];
    if (!slice?.parties || !slice.matrix) continue;
    const groups = identitiesForSlice(slice);
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const g1 = groups[i];
        const g2 = groups[j];
        // Both lent by the same coalition — ПП and ДБ in the 49th. The matrix's diagonal
        // is 1 by definition, so without this the pair that most needs care would report a
        // perfect 100% agreement in exactly the years the two were not voting separately.
        if (g1.index === g2.index) continue;
        const score = slice.matrix[g1.index]?.[g2.index];
        if (typeof score !== "number" || Number.isNaN(score)) continue;
        const [lo, hi] = g1.key < g2.key ? [g1, g2] : [g2, g1];
        const id = pairId(g1.key, g2.key);
        const prev = out.get(id);
        // Raws come from the newest parliament seen so far — the loop is ascending, so
        // the last write wins and the label follows the group's current spelling.
        const entry: PairSeries = prev ?? {
          id,
          a: lo.key,
          b: hi.key,
          aRaw: lo.raw,
          bRaw: hi.raw,
          points: [],
        };
        entry.aRaw = lo.raw;
        entry.bRaw = hi.raw;
        // Distinct rather than first-wins: with one curated coalition only one end can be
        // lent, but two coalitions each lending an end is the same kind of observation and
        // the point should name both.
        const via = [...new Set([g1.via, g2.via].filter(Boolean))].join(" / ");
        entry.points.push(via ? { ns, score, via } : { ns, score });
        out.set(id, entry);
      }
    }
  }
  return out;
};

/** The movement board for one parliament: every pair it seats, against the last parliament
 *  that seated the same pair. Biggest absolute move first — a collapse is as much news as a
 *  convergence — then the pairs with no predecessor, by current score. */
export const movementFor = (
  series: Map<string, PairSeries>,
  ns: string | null,
): PairMovement[] => {
  if (!ns) return [];
  const rows: PairMovement[] = [];
  for (const s of series.values()) {
    const here = s.points.find((p) => p.ns === ns);
    if (!here) continue;
    const prior = [...s.points]
      .filter((p) => Number(p.ns) < Number(ns))
      .sort((x, y) => Number(y.ns) - Number(x.ns))[0];
    rows.push({
      ...s,
      score: here.score,
      prevNs: prior?.ns ?? null,
      prevScore: prior?.score ?? null,
      delta: prior ? here.score - prior.score : null,
      via: here.via ?? null,
      prevVia: prior?.via ?? null,
    });
  }
  return rows.sort((x, y) => {
    if (x.delta === null || y.delta === null) {
      if (x.delta === null && y.delta === null) return y.score - x.score;
      return x.delta === null ? 1 : -1;
    }
    return Math.abs(y.delta) - Math.abs(x.delta);
  });
};

/** Parliaments the file covers, ascending — the arc's x-axis, so that a pair which skips
 *  one shows a GAP at the right place rather than a straight line through it. */
export const parliamentsIn = (
  file: PartyCorrelationFile | undefined,
): string[] =>
  Object.keys(file?.byNs ?? {}).sort((x, y) => Number(x) - Number(y));
