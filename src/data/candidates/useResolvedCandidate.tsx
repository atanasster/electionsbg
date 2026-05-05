import { useMemo } from "react";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useMps, type MpIndexEntry } from "@/data/parliament/useMps";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import type { CandidatesInfo } from "@/data/dataTypes";
import {
  cikSlug,
  mpSlug,
  nameSlug,
  parseSlug,
  type ParsedSlug,
} from "./candidateSlug";
import { transliterateName } from "./transliterateName";

/** A single (name, partyNum) bucket of CIK candidate rows merged with the
 * parliament.bg MP we matched it to (when any). Used by the candidate page,
 * the namesake chooser, and any caller that needs to render the actual
 * person behind a /candidate/* URL. */
export type ResolvedCandidate = {
  /** The canonical, *unambiguous* slug for this person — `mp-{id}` when we
   * have an MP match, otherwise `c-{partyNum}-{nameSlug}`. */
  slug: string;
  /** Title-case full name from the CIK roster, or the MP profile name when
   * no CIK row exists (e.g. a former MP not running this cycle). */
  name: string;
  /** Title-case English form. Prefers the matched MP's name_en (sourced from
   * parliament.bg's EN API) so well-known politicians show their canonical
   * Wikipedia spelling; falls back to the CIK row's name_en (a Streamlined-
   * System transliteration). Always populated. */
  name_en: string;
  /** Election partyNum if we found CIK rows. May be null for former MPs
   * with no current candidacy. */
  partyNum: number | null;
  /** All CIK regions where this person is on the ballot under partyNum. */
  oblasts: string[];
  /** oblast → preference number (rendered on the candidate page table). */
  prefs: Record<string, string>;
  /** Raw CIK rows that belong to this person, in input order. */
  cikRows: CandidatesInfo[];
  /** parliament.bg id when we matched. Drives the MP profile header,
   * connections subgraph, declarations, etc. */
  mpId: number | null;
  /** parliament.bg index entry when matched — saves callers a second lookup. */
  mpEntry: MpIndexEntry | null;
};

const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

/** Build the set of party-name tokens we'll try to substring-match against
 * an MP's `currentPartyGroupShort`. Coalitions splinter once seated — e.g.
 * CIK `ПП-ДБ` (#7) becomes parliamentary groups `ПГ ПП` and `ПГ ДБ` — so
 * the CIK nickname alone won't substring into the parliamentary label.
 * `commonName` from canonical-parties carries the alternative tokens
 * (`["ПП", "ДБ", "ДаБГ", "ДСБ"]`); we add the nickname itself plus any
 * dash-separated pieces so e.g. `ПП-ДБ` also tries `ПП` and `ДБ`. */
const partyHintTokens = (
  nickName: string | null,
  commonName: string[] | undefined,
): string[] => {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t) out.add(t);
  };
  if (nickName) {
    add(nickName);
    for (const piece of nickName.split(/[-/+,]/)) add(piece);
  }
  for (const alt of commonName ?? []) add(alt);
  return Array.from(out);
};

const groupMatchesAnyHint = (
  groupShort: string | null,
  hints: string[],
): boolean => {
  if (!groupShort) return false;
  const g = groupShort.toLowerCase();
  return hints.some((h) => g.includes(h));
};

/** Find the MP that best matches a (name, partyNum) candidate group.
 *
 * Party hints are a **soft** signal — `currentPartyGroupShort` is only
 * populated for the MP's latest term, and former MPs leave it null. So:
 *
 * - Multiple MPs share the name → require any hint to substring-match
 *   one of their groups (homonym case; e.g. four "Георги Иванов
 *   Георгиев" candidates on different parties must not all collapse
 *   onto the GERB MP).
 * - Unique MP with a recorded group that doesn't match any hint →
 *   treat as a homonym and return null (likely a different person
 *   sharing the name).
 * - Unique MP with no recorded group (former MP) → trust the name
 *   match; the alternative would strip MP profiles off historical
 *   election pages and candidate-history charts. */
const matchMp = (
  candidates: MpIndexEntry[],
  hints: string[],
): MpIndexEntry | null => {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const only = candidates[0];
    if (hints.length > 0 && only.currentPartyGroupShort) {
      if (!groupMatchesAnyHint(only.currentPartyGroupShort, hints)) return null;
    }
    return only;
  }
  if (hints.length > 0) {
    const matched = candidates.filter((m) =>
      groupMatchesAnyHint(m.currentPartyGroupShort, hints),
    );
    if (matched.length === 0) return null;
    if (matched.length === 1) return matched[0];
    return matched.find((m) => m.isCurrent) ?? matched[0];
  }
  return candidates.find((m) => m.isCurrent) ?? candidates[0];
};

/** Group CIK rows by (name, partyNum) and resolve each group to a person. */
const buildGroups = (
  rows: CandidatesInfo[],
  mpsByNormalizedName: Map<string, MpIndexEntry[]>,
  hintsFor: (partyNum: number) => string[],
): ResolvedCandidate[] => {
  const buckets = new Map<string, CandidatesInfo[]>();
  for (const row of rows) {
    const key = `${normalize(row.name)}|${row.partyNum}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(row);
  }

  const out: ResolvedCandidate[] = [];
  for (const bucket of buckets.values()) {
    const sample = bucket[0];
    const hints = hintsFor(sample.partyNum);
    const candidatesForName =
      mpsByNormalizedName.get(normalize(sample.name)) ?? [];
    const mp = matchMp(candidatesForName, hints);
    const oblasts = bucket.map((r) => r.oblast);
    const prefs: Record<string, string> = {};
    for (const r of bucket) prefs[r.oblast] = r.pref;
    out.push({
      slug: mp ? mpSlug(mp.id) : cikSlug(sample.partyNum, sample.name),
      name: sample.name,
      name_en: mp?.name_en ?? sample.name_en ?? transliterateName(sample.name),
      partyNum: sample.partyNum,
      oblasts,
      prefs,
      cikRows: bucket,
      mpId: mp?.id ?? null,
      mpEntry: mp ?? null,
    });
  }
  return out;
};

const buildMpsByName = (
  mps: MpIndexEntry[] | undefined,
): Map<string, MpIndexEntry[]> => {
  const m = new Map<string, MpIndexEntry[]>();
  if (!mps) return m;
  for (const mp of mps) {
    const list = m.get(mp.normalizedName);
    if (list) list.push(mp);
    else m.set(mp.normalizedName, [mp]);
  }
  return m;
};

/** Find an MP with no CIK row (e.g. former MPs not running this cycle). */
const buildResolvedFromMp = (
  mp: MpIndexEntry,
  cikGroups: ResolvedCandidate[],
): ResolvedCandidate => {
  // Prefer a CIK row already linked to this mpId (we built groups above; the
  // matchMp step may have attached the link).
  const existing = cikGroups.find((g) => g.mpId === mp.id);
  if (existing) return existing;
  return {
    slug: mpSlug(mp.id),
    name: mp.name,
    name_en: mp.name_en ?? transliterateName(mp.name),
    partyNum: null,
    oblasts: [],
    prefs: {},
    cikRows: [],
    mpId: mp.id,
    mpEntry: mp,
  };
};

export type ResolveResult = {
  isLoading: boolean;
  matches: ResolvedCandidate[];
  /** Convenience: matches[0] when matches.length === 1. */
  canonical: ResolvedCandidate | null;
  /** The parsed shape of the input, for callers that want to know whether
   * the URL was a slug or a bare name. */
  parsed: ParsedSlug | null;
};

export const useResolvedCandidate = (
  idParam: string | undefined | null,
): ResolveResult => {
  const { candidates } = useCandidates();
  const { mps, findMpById } = useMps();
  const { findParty } = usePartyInfo();

  const mpsByName = useMemo(() => buildMpsByName(mps), [mps]);

  const hintsFor = useMemo(() => {
    return (partyNum: number): string[] => {
      const party = findParty(partyNum);
      if (!party) return [];
      return partyHintTokens(
        party.nickName ?? party.name ?? null,
        party.commonName,
      );
    };
  }, [findParty]);

  const cikGroups = useMemo(() => {
    if (!candidates) return null;
    return buildGroups(candidates, mpsByName, hintsFor);
  }, [candidates, mpsByName, hintsFor]);

  const parsed = useMemo(() => parseSlug(idParam), [idParam]);

  return useMemo<ResolveResult>(() => {
    const isLoading = cikGroups === null || mps === undefined; // mps may be empty array; undefined = loading
    if (!parsed) {
      return { isLoading, matches: [], canonical: null, parsed: null };
    }

    if (parsed.kind === "mp") {
      const mp = findMpById(parsed.mpId);
      if (!mp) {
        // Index loaded but MP not found — return zero matches, not loading.
        if (mps !== undefined)
          return { isLoading: false, matches: [], canonical: null, parsed };
        return { isLoading: true, matches: [], canonical: null, parsed };
      }
      const groups = cikGroups ?? [];
      const resolved = buildResolvedFromMp(mp, groups);
      return {
        isLoading: false,
        matches: [resolved],
        canonical: resolved,
        parsed,
      };
    }

    if (parsed.kind === "cik") {
      if (cikGroups === null)
        return { isLoading: true, matches: [], canonical: null, parsed };
      const wantPartyNum = parsed.partyNum;
      const wantSlug = parsed.nameSlug;
      const match = cikGroups.find(
        (g) => g.partyNum === wantPartyNum && nameSlug(g.name) === wantSlug,
      );
      if (!match)
        return { isLoading: false, matches: [], canonical: null, parsed };
      return {
        isLoading: false,
        matches: [match],
        canonical: match,
        parsed,
      };
    }

    // Legacy bare-name lookup. Match by normalized name across CIK groups
    // (covers the typical "candidate ran this cycle" case) and also
    // surface MPs without a CIK row (former MPs).
    if (cikGroups === null)
      return { isLoading: true, matches: [], canonical: null, parsed };
    const target = normalize(parsed.name);
    const cikMatches = cikGroups.filter((g) => normalize(g.name) === target);
    if (cikMatches.length > 0) {
      // Filter out duplicate slugs (same person via mpId match).
      const seen = new Set<string>();
      const unique: ResolvedCandidate[] = [];
      for (const m of cikMatches) {
        if (seen.has(m.slug)) continue;
        seen.add(m.slug);
        unique.push(m);
      }
      return {
        isLoading: false,
        matches: unique,
        canonical: unique.length === 1 ? unique[0] : null,
        parsed,
      };
    }
    // No CIK row — try parliament index for former MPs.
    const mpHits = mpsByName.get(target) ?? [];
    if (mpHits.length === 0)
      return { isLoading: false, matches: [], canonical: null, parsed };
    const mpResolved = mpHits.map((mp) => buildResolvedFromMp(mp, cikGroups));
    return {
      isLoading: false,
      matches: mpResolved,
      canonical: mpResolved.length === 1 ? mpResolved[0] : null,
      parsed,
    };
  }, [cikGroups, parsed, findMpById, mpsByName, mps]);
};

/** Convenience for sub-route screens (regions / sections / donations / etc.)
 * — they only need the canonical display name, not the full record. Returns
 * the resolved name when the URL is unambiguous; null while loading or when
 * we can't pick a single candidate (caller should fall back to the bare
 * URL param so the page still renders something for legacy links). */
export const useResolvedCandidateName = (
  idParam: string | undefined | null,
): {
  name: string | null;
  name_en: string | null;
  isLoading: boolean;
  ambiguous: boolean;
} => {
  const { isLoading, canonical, matches } = useResolvedCandidate(idParam);
  return {
    isLoading,
    name: canonical?.name ?? null,
    name_en: canonical?.name_en ?? null,
    ambiguous: matches.length > 1,
  };
};
