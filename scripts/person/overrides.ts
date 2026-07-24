// The human-adjudication tier (plan §3 tier 4). `person_link_override` is the DATA escape
// hatch for identity decisions the deterministic tiers (cluster.ts + the resolver's
// cross-block gold union) get WRONG — so a genuine mis-merge is undone by inserting a row,
// never by editing resolver code. Applied LAST, after every automatic tier, so it always
// wins.
//
// PURE + hermetic — no DB — so the logic is unit-tested on synthetic groups. The resolver
// loads the rows (SELECT from person_link_override) and hands them here; the operator tool
// scripts/person/add_override.ts writes them.
//
// THREE kinds of override, in one table (081_person_identity.sql):
//
//   1. MERGE (kind='merge', fold_a + fold_b)      — the two NAME FOLDS are one person; union
//        their persons. Bridges a gap no automatic tier can (a marriage rename, a
//        transliteration variant that scatters one person across two blocks). The union is
//        stamped confidence='manual' (a human decided it).
//
//   2. FOLD-SPLIT (kind='split', fold_a + fold_b) — the two NAME FOLDS must NOT be auto-merged.
//        Peels every fold_b mention out of any component that also holds a fold_a mention
//        into its own person. Undoes a wrong CROSS-BLOCK gold/merge union of two DIFFERENT
//        folds. Note this cannot separate two people who share ONE fold — for that use:
//
//   3. REF-SPLIT (kind='split', ref_a) — ISOLATE ONE mention, keyed by its source-native ref
//        (`{election}:{slug}` for a candidacy, `mp:{id}` for an MP mention, the officials
//        slug, …) — the resolver matches ref_a against the mention's id, its ref, and
//        `{source}:{ref}`. The isolated mention never unions into any person, VETOING even a
//        Tier-0 GOLD (mp id) union — the case a fold-level key is too coarse for: a CIK
//        candidacy that `matchMp()` bound to the WRONG same-name MP carries that MP's gold
//        hardId, so it and the real MP share both fold AND hardId; only a mention-specific
//        veto can pull that one candidacy off the MP's person. The isolated mention forms its
//        own person.
//
// Precedence within this tier: MERGE first, then FOLD-SPLIT, then REF-SPLIT — a split always
// wins over a merge (a correction is more specific than a bulk join). No override rows ⇒ a
// pure no-op (the automatic result is returned unchanged), so the tier can never regress the
// baseline.

/** One row of person_link_override, as the resolver SELECTs it. */
export type OverrideRow = {
  kind: "merge" | "split";
  fold_a: string | null;
  fold_b: string | null;
  ref_a: string | null;
  ref_b: string | null;
};

export type ParsedOverrides = {
  /** Name-fold pairs to union into one person. */
  merges: [string, string][];
  /** Name-fold pairs forbidden from auto-merging (fold_b is peeled off fold_a). */
  foldSplits: [string, string][];
  /** Mention match-keys to isolate — a ref-split vetoes even a gold union. */
  refSplits: Set<string>;
};

export const EMPTY_OVERRIDES: ParsedOverrides = {
  merges: [],
  foldSplits: [],
  refSplits: new Set(),
};

/** Split the raw rows into the three operations. A `split` carrying a ref is a REF-split
 *  (the ref is the target); a fold-pair `split`/`merge` is a fold-level op. */
export function parseOverrides(rows: OverrideRow[]): ParsedOverrides {
  const merges: [string, string][] = [];
  const foldSplits: [string, string][] = [];
  const refSplits = new Set<string>();
  for (const r of rows) {
    if (r.kind === "split" && r.ref_a) {
      refSplits.add(r.ref_a);
      if (r.ref_b) refSplits.add(r.ref_b);
      continue;
    }
    if (r.fold_a && r.fold_b) {
      if (r.kind === "merge") merges.push([r.fold_a, r.fold_b]);
      else foldSplits.push([r.fold_a, r.fold_b]);
    }
  }
  return { merges, foldSplits, refSplits };
}

/** A resolved person cluster: the mention ids it holds + the strongest edge that formed it. */
export type OGroup = {
  ids: string[];
  confidence: "exact_id" | "high" | "manual";
};

/** The mention fields the override tier needs (a projection of the resolver's Mention). */
export type OvMention = {
  id: string;
  source: string;
  ref: string;
  hardId: string | null;
  nameFold: string;
};

// A ref-split's ref_a is matched against ALL three of these per mention, so an operator can
// name a mention by whichever id they have in front of them: the resolver mention id
// (`candidate:2024_06_09:c-26-…`), the bare source-native ref (`2024_06_09:c-26-…`), or the
// source-qualified ref.
const matchKeys = (m: OvMention): string[] => [
  m.id,
  m.ref,
  `${m.source}:${m.ref}`,
];

/**
 * Apply the human overrides as the LAST resolution tier.
 *
 * @param groups    the automatic result (post cross-block gold union)
 * @param mentions  every mention, projected to {id, source, ref, hardId, nameFold}
 * @param ov        the parsed overrides
 * @returns the adjusted groups, confidence recomputed (exact_id > manual > high)
 */
export function applyOverrides(
  groups: OGroup[],
  mentions: OvMention[],
  ov: ParsedOverrides,
): OGroup[] {
  if (!ov.merges.length && !ov.foldSplits.length && !ov.refSplits.size)
    return groups; // no overrides — exact no-op, never regress the baseline

  const byId = new Map(mentions.map((m) => [m.id, m]));
  // Original (automatic) group index per mention — lets the confidence recompute below tell
  // an override-merged component (spans >= 2 automatic groups) from an untouched one.
  const origIdx = new Map<string, number>();
  groups.forEach((g, i) => g.ids.forEach((id) => origIdx.set(id, i)));

  let comps: string[][] = groups.map((g) => g.ids.slice());

  // 1. MERGE — union components that carry fold_a with those that carry fold_b.
  if (ov.merges.length) {
    const foldToComps = new Map<string, number[]>();
    comps.forEach((ids, ci) => {
      const folds = new Set(
        ids.map((id) => byId.get(id)?.nameFold).filter((f): f is string => !!f),
      );
      for (const f of folds)
        (foldToComps.get(f) ?? foldToComps.set(f, []).get(f)!).push(ci);
    });
    const parent = comps.map((_, i) => i);
    const find = (x: number): number =>
      parent[x] === x ? x : (parent[x] = find(parent[x]));
    const uni = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (const [fa, fb] of ov.merges)
      for (const a of foldToComps.get(fa) ?? [])
        for (const b of foldToComps.get(fb) ?? []) uni(a, b);
    const merged = new Map<number, string[]>();
    comps.forEach((ids, ci) => {
      const r = find(ci);
      (merged.get(r) ?? merged.set(r, []).get(r)!).push(...ids);
    });
    comps = [...merged.values()];
  }

  // 2. FOLD-SPLIT — peel every fold_b mention out of a component that also holds fold_a.
  for (const [fa, fb] of ov.foldSplits) {
    const next: string[][] = [];
    for (const ids of comps) {
      const hasA = ids.some((id) => byId.get(id)?.nameFold === fa);
      const peel = hasA
        ? ids.filter((id) => byId.get(id)?.nameFold === fb)
        : [];
      if (!peel.length) {
        next.push(ids);
        continue;
      }
      const rest = ids.filter((id) => byId.get(id)?.nameFold !== fb);
      if (rest.length) next.push(rest);
      next.push(peel);
    }
    comps = next;
  }

  // 3. REF-SPLIT — isolate each matching mention into its own component (vetoes gold union).
  if (ov.refSplits.size) {
    const isolated: string[] = [];
    const next: string[][] = [];
    for (const ids of comps) {
      const keep: string[] = [];
      for (const id of ids) {
        const m = byId.get(id);
        if (m && matchKeys(m).some((k) => ov.refSplits.has(k)))
          isolated.push(id);
        else keep.push(id);
      }
      if (keep.length) next.push(keep);
    }
    for (const id of isolated) next.push([id]);
    comps = next;
  }

  // Recompute confidence from the FINAL members: a shared hard id is exact_id; else an
  // override-merged component (spans >= 2 automatic groups) is manual; else high. This
  // mirrors the resolver's own rule for untouched components, so a no-override component
  // keeps its baseline confidence.
  return comps.map((ids) => {
    const hs = ids
      .map((id) => byId.get(id)?.hardId)
      .filter((h): h is string => !!h);
    const sharedHard = new Set(hs).size < hs.length;
    const spans = new Set(ids.map((id) => origIdx.get(id))).size > 1;
    const confidence: OGroup["confidence"] = sharedHard
      ? "exact_id"
      : spans
        ? "manual"
        : "high";
    return { ids, confidence };
  });
}
