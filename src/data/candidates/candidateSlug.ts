// Disambiguating /candidate/{id} URLs.
//
// CIK candidate data only carries full names — no IDs — so multiple distinct
// people can share the same three-name string. Two slug forms make the
// candidate page lookup unambiguous:
//
//   mp-{mpId}              — points at a parliament.bg MP record (gold key)
//   c-{partyNum}-{slug}    — CIK candidate within the current election,
//                            scoped by partyNum so namesakes on different
//                            party lists land on different pages
//
// Bare-name URLs (legacy, external links) still resolve via the chooser in
// Candidate.tsx when more than one candidate matches.
//
// Notes on the name slug:
//   - We transliterate Cyrillic to ASCII so the URL is shareable and stable.
//   - We do NOT round-trip slug→name. The slug is only used for matching
//     ("does this CIK candidate's name slugify to this string?"), so the
//     transliteration table just needs to be deterministic.

const CYR_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

const transliterate = (s: string): string => {
  let out = "";
  for (const ch of s.toLowerCase()) {
    out += CYR_TO_LATIN[ch] ?? ch;
  }
  return out;
};

export const nameSlug = (name: string): string =>
  transliterate(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const mpSlug = (mpId: number): string => `mp-${mpId}`;

export const cikSlug = (partyNum: number, name: string): string =>
  `c-${partyNum}-${nameSlug(name)}`;

export type ParsedSlug =
  | { kind: "mp"; mpId: number }
  | { kind: "cik"; partyNum: number; nameSlug: string }
  | { kind: "name"; name: string };

export const parseSlug = (
  raw: string | undefined | null,
): ParsedSlug | null => {
  if (!raw) return null;
  const s = decodeURIComponent(raw);
  const mpMatch = s.match(/^mp-(\d+)$/);
  if (mpMatch) return { kind: "mp", mpId: Number(mpMatch[1]) };
  const cikMatch = s.match(/^c-(\d+)-(.+)$/);
  if (cikMatch)
    return {
      kind: "cik",
      partyNum: Number(cikMatch[1]),
      nameSlug: cikMatch[2],
    };
  return { kind: "name", name: s };
};

export const candidateUrlForMp = (mpId: number): string =>
  `/candidate/${mpSlug(mpId)}`;

export const candidateUrlForCik = (partyNum: number, name: string): string =>
  `/candidate/${cikSlug(partyNum, name)}`;

export const candidateUrlForName = (name: string): string =>
  `/candidate/${encodeURIComponent(name)}`;

// Preferred URL for an MP if we know the id, falling back to name. Used by
// every link site that has either at hand — keeps callers from caring about
// the slug shape.
export const candidateUrlFor = (opts: {
  mpId?: number | null;
  partyNum?: number | null;
  name: string;
}): string => {
  if (opts.mpId != null) return candidateUrlForMp(opts.mpId);
  if (opts.partyNum != null)
    return candidateUrlForCik(opts.partyNum, opts.name);
  return candidateUrlForName(opts.name);
};
