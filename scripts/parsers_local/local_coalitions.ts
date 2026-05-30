// Resolve a local-party name (often a "Местна коалиция X - Y - Z" string)
// against the canonical-parties table built from parliamentary cycles.
//
// Strategy: split on coalition separators, look each fragment up via the
// canonical `byNickName` index (case-insensitive). Primary credit goes to
// the first fragment that matches (per the design decision). Independent
// committees ("Инициативен комитет ...") bucket as `independent` and never
// hit the splitter.
//
// Unmatched fragments are returned (not thrown) so the orchestrator can
// aggregate them into _unmatched_coalitions.json for hand-curated overrides.

import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  LocalCoalitionFragmentOverride,
  LocalCoalitionRawOverride,
  localCoalitionFragmentOverrides,
  localCoalitionRawOverrides,
} from "./local_coalition_overrides";

export const INDEPENDENT_CANONICAL_ID = "independent";

export type CoalitionResolution = {
  primaryCanonicalId: string | null;
  memberCanonicalIds: string[];
  isIndependent: boolean;
  unmatchedFragments: string[];
};

// Detect "Инициативен комитет за издигане на …" and variants. CIK uses
// mixed capitalisations so do a case-insensitive prefix check.
const INDEPENDENT_PREFIX_RE = /^\s*инициативен\s+комитет/i;

// Coalition prefix strings that should be stripped before splitting.
// "Местна коалиция " / "Коалиция " / "МК " / "КП " / "ПП " label parts but
// aren't part of the party identity.
const COALITION_PREFIX_RE = /^(местна\s+коалиция|коалиция|мк|кп|пп)\s+/i;

// Separators between member parties inside a coalition name. The Bulgarian
// dash variants are common; we also split on `/` / `(` / `)` so wrapper
// forms like "ГЕРБ /СДС/" and "ВМРО (БДЦ)" decompose into their members.
// The bare dash (no surrounding spaces) covers tight joins like
// "ПРОДЪЛЖАВАМЕ ПРОМЯНАТА- ДЕМОКРАТИЧНА БЪЛГАРИЯ" — but ONLY when the
// adjacent character is whitespace on one side, so we don't split hyphenated
// last names ("Петкова-Иванова") that show up in candidate fields.
const SPLIT_RE =
  /\s+[-–—]\s+|\s+[-–—]|[-–—]\s+|\s*\+\s*|\s*\/\s*|\s*\(\s*|\s*\)\s*/;

const stripPrefixes = (s: string): string =>
  s
    .replace(COALITION_PREFIX_RE, "")
    .replace(/^[„“"]/g, "")
    .replace(/[„“"]$/g, "")
    .trim();

// Normalise a coalition name for direct-lookup matching. The same parties
// surface in CIK data with varying formatting:
//   - "ГЕРБ /СДС/"         (slash-wrapped sub-party)
//   - "ГЕРБ-СДС"           (canonical nickname)
//   - "ГЕРБ (СДС)"         (parens-wrapped sub-party)
// Normalising slashes/parens to `-` (and trimming whitespace) lets these
// all match the same canonical entry on a direct lookup. We try this BEFORE
// splitting so consolidated coalitions don't get fragmented unnecessarily.
const normaliseCoalitionForm = (s: string): string =>
  s
    .replace(/\s*[/()]\s*/g, "-")
    .replace(/[„“"]/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const lookupCanonicalIdLower = (
  byNickNameLower: Map<string, string>,
  raw: string,
): string | null => {
  if (!raw) return null;
  const key = raw.toLocaleLowerCase("bg").trim();
  if (!key) return null;
  return byNickNameLower.get(key) ?? null;
};

const applyFragmentOverrides = (
  fragment: string,
  fragmentOverrides: LocalCoalitionFragmentOverride[],
): string | null => {
  const lower = fragment.toLocaleLowerCase("bg");
  for (const ov of fragmentOverrides) {
    if (lower.includes(ov.fragment.toLocaleLowerCase("bg"))) {
      return ov.canonicalId;
    }
  }
  return null;
};

const applyRawOverrides = (
  rawName: string,
  rawOverrides: LocalCoalitionRawOverride[],
): CoalitionResolution | null => {
  const trimmed = rawName.trim();
  const found = rawOverrides.find((o) => o.rawName.trim() === trimmed);
  if (!found) return null;
  return {
    primaryCanonicalId: found.primaryCanonicalId,
    memberCanonicalIds: found.memberCanonicalIds ?? [found.primaryCanonicalId],
    isIndependent: found.primaryCanonicalId === INDEPENDENT_CANONICAL_ID,
    unmatchedFragments: [],
  };
};

// Strip Bulgarian party-form prefixes ("ПП ", "КП ", "КПП ", "Партия ",
// "Коалиция ", "Местна коалиция ") from a lowered key so local-ballot
// strings like "ПП СЪЮЗ НА СВОБОДНИТЕ ДЕМОКРАТИ" match a canonical
// history.name registered without the prefix (and vice versa).
const STRIP_FORM_PREFIX_RE =
  /^(пп|кп|кпп|партия|коалиция|местна\s+коалиция)\s+/u;

export const buildByNickNameLower = (
  canonical: CanonicalPartiesIndex | undefined,
): Map<string, string> => {
  const map = new Map<string, string>();
  if (!canonical) return map;
  // Prefer the strict byNickName lineage so direct hits stay on their
  // contemporary brand (ДПС stays ДПС, doesn't roll up into a later
  // successor coalition's lineage).
  if (canonical.byNickName) {
    for (const [nick, id] of Object.entries(canonical.byNickName)) {
      const key = nick.toLocaleLowerCase("bg");
      if (!map.has(key)) map.set(key, id);
    }
  }
  // Then layer in consolidation aliases (commonName entries like
  // "ПРОДЪЛЖАВАМЕ ПРОМЯНАТА" → "ПП-ДБ") ONLY for keys byNickName hasn't
  // already claimed. This gives us extra coverage on coalition fragments
  // without rewriting established brand → lineage mappings.
  if (canonical.consolidationByNickName) {
    for (const [nick, id] of Object.entries(
      canonical.consolidationByNickName,
    )) {
      const key = nick.toLocaleLowerCase("bg");
      if (!map.has(key)) map.set(key, id);
    }
  }
  // Finally, fold in every history.name across every canonical party — both
  // verbatim (lower-trim) and with the Bulgarian party-form prefix stripped.
  // This is what catches "ПП СЪЮЗ НА СВОБОДНИТЕ ДЕМОКРАТИ" on chmi rows
  // against the canonical ССД entry whose history.name is the same string.
  // Stops the ingest from leaving primaryCanonicalId=null and forcing the
  // frontend to re-resolve at render time.
  if (canonical.parties) {
    for (const party of canonical.parties) {
      for (const h of party.history) {
        if (!h.name) continue;
        const key = h.name.toLocaleLowerCase("bg").trim();
        if (key && !map.has(key)) map.set(key, party.id);
        const stripped = key.replace(STRIP_FORM_PREFIX_RE, "");
        if (stripped && stripped !== key && !map.has(stripped)) {
          map.set(stripped, party.id);
        }
      }
    }
  }
  return map;
};

export const resolveLocalParty = (
  rawName: string,
  byNickNameLower: Map<string, string>,
  rawOverrides: LocalCoalitionRawOverride[] = localCoalitionRawOverrides,
  fragmentOverrides: LocalCoalitionFragmentOverride[] = localCoalitionFragmentOverrides,
): CoalitionResolution => {
  // 1. Hand-curated overrides win.
  const raw = applyRawOverrides(rawName, rawOverrides);
  if (raw) return raw;

  // 2. Independent committee → bucket; skip splitting entirely.
  if (INDEPENDENT_PREFIX_RE.test(rawName)) {
    return {
      primaryCanonicalId: INDEPENDENT_CANONICAL_ID,
      memberCanonicalIds: [INDEPENDENT_CANONICAL_ID],
      isIndependent: true,
      unmatchedFragments: [],
    };
  }

  // 3. Direct full-name match (handles non-coalition party names like
  //    "ПП ГЕРБ" that the canonical table already knows).
  const direct = lookupCanonicalIdLower(byNickNameLower, rawName);
  if (direct) {
    return {
      primaryCanonicalId: direct,
      memberCanonicalIds: [direct],
      isIndependent: false,
      unmatchedFragments: [],
    };
  }

  // 3a. Try a normalised form first — "Местна коалиция ГЕРБ /СДС/" →
  //     "ГЕРБ-СДС", which matches the canonical nickname directly. This
  //     avoids splitting consolidated coalitions when the unified form is
  //     in the canonical table.
  const stripped = stripPrefixes(rawName);
  const normalised = normaliseCoalitionForm(stripped);
  if (normalised && normalised !== stripped) {
    const id = lookupCanonicalIdLower(byNickNameLower, normalised);
    if (id) {
      return {
        primaryCanonicalId: id,
        memberCanonicalIds: [id],
        isIndependent: false,
        unmatchedFragments: [],
      };
    }
  }

  // 4. Coalition: strip prefix, split, resolve each fragment. After the
  //    first split, if a fragment still contains a bare dash (no surrounding
  //    spaces — e.g. "БЪЛГАРИЯ-СПАСИ СОФИЯ"), re-split it on that dash
  //    too so each member-party name surfaces independently. Safe for
  //    party-name parsing — canonical nicknames containing dashes
  //    ("ГЕРБ-СДС", "ПП-ДБ") are already resolved by step 1.
  const fragments = stripped
    .split(SPLIT_RE)
    .flatMap((f) => f.split(/[-–—]/))
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  const memberIds: string[] = [];
  const unmatchedFragments: string[] = [];
  for (const fragment of fragments) {
    const id =
      lookupCanonicalIdLower(byNickNameLower, fragment) ??
      lookupCanonicalIdLower(byNickNameLower, stripPrefixes(fragment)) ??
      applyFragmentOverrides(fragment, fragmentOverrides);
    if (id) {
      if (!memberIds.includes(id)) memberIds.push(id);
    } else {
      unmatchedFragments.push(fragment);
    }
  }

  const primary = memberIds[0] ?? null;
  return {
    primaryCanonicalId: primary,
    memberCanonicalIds: memberIds,
    isIndependent: false,
    unmatchedFragments,
  };
};
