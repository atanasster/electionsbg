// The ONE parliamentary-group → canonical-nickname alias table.
//
// parliament.bg labels a парламентарна група with its own short name, and for
// most groups that string is already a nickname `canonical_parties.json` knows
// (ГЕРБ-СДС, БСП, ВЪЗРАЖДАНЕ …). For a handful it is not, and this table is the
// bridge — ПБ is the 52nd NS's largest group and the canonical table calls it
// ПрБ, so nothing resolves without it.
//
// WHY IT LIVES HERE, alone. Two consumers need it and they run in different
// places: `useCanonicalParties.tsx` in the browser (to colour a group label and
// to build the /party/<nickName> link) and `scripts/person/partyGroups.ts` on
// the server (to write `person_role.party` for MP roles). A second, hand-kept
// copy is the failure this repo already has a name for — `shlyo_query_fold()`
// is GENERATED from `src/lib/shlyoRules.ts` precisely so the browser and the
// server cannot disagree about a rule while both look like they work. Here the
// divergence would be quieter still: the client would link a group to its party
// page while the resolver wrote NULL into the ПАРТИЯ column.
//
// VALUES ARE NICKNAMES, NEVER IDS. Resolve through `byNickName` to get the
// canonical id. Storing `p_20` here instead would freeze an id that
// `canonicalParties.ts` generates — and generated ids move when memberships do.
// The nickname is the stable, human-checkable half.
//
// SHARING THE TABLE IS NOT ENOUGH — SHARE THE MATCHING RULE. The first draft of
// this file exported only the data and left each consumer to look keys up its
// own way. Measured over the 26 live `party_dim.short` values, 5 then diverged:
// the client's `resolveCanonicalId` did a raw exact lookup (missing `БСП - ОЛ`,
// `ГЕРБ - СДС`, `ДПС - НН`, `ПП - ДБ`) while `partyGroupShortLabel` normalised
// the INPUT and then matched it against an un-normalised KEY, so the
// `ДПС - ДПС` entry was dead on arrival. Two sides agreeing on the data and
// disagreeing on the lookup is the same "both look like they work" failure the
// single table exists to prevent, one level down. So the lookup lives here too:
// every consumer calls `resolveGroupAlias`, and nobody indexes the record
// directly. Add an entry only for a group short that `byNickName` genuinely
// cannot resolve; a normalisation bug is not an alias.
export const PARLIAMENT_GROUP_ALIASES: Record<string, string> = {
  // Прогресивна България — 143 seats in the 52nd, the largest group.
  ПБ: "ПрБ",
  "Прогресивна България": "ПрБ",
  // Long-form labels parliament.bg uses for groups the canonical table
  // indexes only by short nickname.
  "Демократична България": "ДБ",
  "Продължаваме Промяната": "ПП",
  // Изправи се.БГ! Ние идваме! — 47th NS.
  ИБГНИ: "Идваме",
  // Изправи се! Мутри вън! — 45th/46th NS.
  ИСМВ: "ПП ИСМВ",
  // parliament.bg doubles the short for the 51st NS's ДПС group.
  "ДПС - ДПС": "ДПС",
};

// Group shorts that are NOT a party — the absence of one.
//
//   НЕЗ         независим: left their group, sits unaffiliated
//   НЕЧЛ В ПГ   нечленуващ в ПГ: seated but in no group
//   НЕЧЛ ПГ     same, abbreviated differently across parliaments
//
// These must never resolve to a party id (that invents a membership) and must
// never resolve to NULL (that erases a defection, which is the most editorially
// interesting fact the roll-call corpus carries). They map to the `independent`
// sentinel — the same id `local_coalitions.ts` mints for an „Инициативен
// комитет" — so one `?party=independent` covers councillors and MPs alike
// instead of two half-sets.
export const PARLIAMENT_GROUP_SENTINELS: ReadonlySet<string> = new Set([
  "НЕЗ",
  "НЕЧЛ В ПГ",
  "НЕЧЛ ПГ",
]);

// The canonical id those sentinels resolve to, and the ONE declaration of it.
// `local_coalitions.ts` re-exports this rather than declaring its own — the
// dependency has to point this way round, because that module is a
// local-elections parser and importing it here would drag the CIK ingest into
// the browser bundle. Two hand-kept copies would be the same defect this file
// exists to prevent: if they drifted, MP sentinels would point at an id
// `canonical_parties.json` cannot label, which is §0g's Latin-token failure
// returning through the door §0g closed.
export const INDEPENDENT_CANONICAL_ID = "independent";

// Collapse whitespace and every dash variant, then upper-case. This is
// load-bearing rather than defensive: `party_dim`'s key is (ns, short), so
// `ГЕРБ-СДС` and `ГЕРБ - СДС` are SEPARATE rows by design, and any cross-NS
// join on the raw short splits that party in two.
export const normalizeGroupShort = (short: string): string =>
  short.toLocaleUpperCase("bg").replace(/[\s\-–—]+/g, "");

// Strip parliament.bg's „ПГ" / „ПГ на" prefix AND the quotes it wraps some
// names in. The quotes are not cosmetic: `ПГ "Прогресивна България"` is how
// index.json spells the 52nd NS's largest group, and a prefix-only strip leaves
// `"Прогресивна България"` — which matches no nickname and no alias key, so
// 143 of 240 sitting MPs rendered a quoted Cyrillic string with no colour and
// no /party link. Every dash variant is folded here too so the result is a
// clean nickname candidate.
export const stripGroupPrefix = (label: string): string =>
  label
    .replace(/^\s*ПГ(\s+на)?\s+/u, "")
    .replace(/^[„“"«»”'‘’\s]+|[„“"«»”'‘’\s]+$/gu, "")
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .trim();

// Alias keys indexed by their NORMALISED form, so `ДПС - ДПС` and `ДПС-ДПС`
// both hit the one entry. Built once at module load.
const ALIAS_BY_NORMALIZED: ReadonlyMap<string, string> = new Map(
  Object.entries(PARLIAMENT_GROUP_ALIASES).map(([k, v]) => [
    normalizeGroupShort(k),
    v,
  ]),
);

/**
 * The ONE alias lookup. Matches exactly first, then with both sides normalised.
 * Returns the canonical NICKNAME (not an id) or undefined.
 *
 * Every consumer — browser and server — must go through this rather than
 * indexing PARLIAMENT_GROUP_ALIASES, or the two drift on the matching rule
 * while sharing the data.
 */
export const resolveGroupAlias = (short: string): string | undefined => {
  if (!short) return undefined;
  return (
    PARLIAMENT_GROUP_ALIASES[short] ??
    ALIAS_BY_NORMALIZED.get(normalizeGroupShort(short))
  );
};

/** True when the short means "no group" rather than naming one. */
export const isGroupSentinel = (short: string): boolean => {
  if (!short) return false;
  if (PARLIAMENT_GROUP_SENTINELS.has(short)) return true;
  const n = normalizeGroupShort(short);
  for (const s of PARLIAMENT_GROUP_SENTINELS) {
    if (normalizeGroupShort(s) === n) return true;
  }
  return false;
};

// ── the shared RESOLUTION CHAIN ─────────────────────────────────────────────
//
// Sharing the alias table was not enough. The browser and the resolver each had
// their own lookup around it and diverged on 5 of the 26 live group shorts —
// the client returned nothing for `ГЕРБ - СДС`, `БСП - ОЛ`, `ДПС - НН` and
// `ПП - ДБ` because it never folded dashes against the NICKNAME side, while the
// server did. So the chain itself lives here and both sides call it; parity is
// then structural rather than something a test has to keep asserting.

/** Marks a normalised key two DIFFERENT lineages collapse onto. */
const AMBIGUOUS = Symbol("ambiguous-normalized-nickname");

type Folded = {
  lower: Map<string, string>;
  normalized: Map<string, string | typeof AMBIGUOUS>;
};

const foldCache = new WeakMap<object, Folded>();

const foldNicknames = (byNickName: Record<string, string>): Folded => {
  const cached = foldCache.get(byNickName);
  if (cached) return cached;
  const lower = new Map<string, string>();
  const normalized = new Map<string, string | typeof AMBIGUOUS>();
  for (const [nick, id] of Object.entries(byNickName)) {
    const lk = nick.toLocaleLowerCase("bg");
    if (!lower.has(lk)) lower.set(lk, id);
    const nk = normalizeGroupShort(nick);
    const prev = normalized.get(nk);
    if (prev === undefined) normalized.set(nk, id);
    else if (prev !== id) normalized.set(nk, AMBIGUOUS);
  }
  const folded = { lower, normalized };
  foldCache.set(byNickName, folded);
  return folded;
};

/** Normalised nicknames that two different lineages share — exposed for gates. */
export const ambiguousNormalizedNicknames = (
  byNickName: Record<string, string>,
): string[] =>
  [...foldNicknames(byNickName).normalized]
    .filter(([, v]) => v === AMBIGUOUS)
    .map(([k]) => k)
    .sort();

/**
 * Resolve a parliamentary group short (or any party nickname) to a canonical id.
 *
 * exact → case-insensitive → alias → normalised fold. Returns undefined rather
 * than throwing; callers decide what a miss means. A normalised key that two
 * lineages share resolves to nothing rather than to whichever came first in the
 * JSON, so an ambiguous spelling can never pick a party by file layout.
 */
export const resolveNicknameToId = (
  short: string,
  byNickName: Record<string, string> | undefined,
): string | undefined => {
  if (!short || !byNickName) return undefined;
  const raw = short.trim();
  if (!raw) return undefined;
  const { lower, normalized } = foldNicknames(byNickName);

  const exact = byNickName[raw] ?? lower.get(raw.toLocaleLowerCase("bg"));
  if (exact) return exact;

  // The alias is an explicit human decision about a specific short; the
  // normalised fold is a lossy heuristic. Alias first, or an unrelated nickname
  // that happens to normalise the same way silently overrides a curated entry.
  const alias = resolveGroupAlias(raw);
  if (alias) {
    const viaAlias =
      byNickName[alias] ?? lower.get(alias.toLocaleLowerCase("bg"));
    if (viaAlias) return viaAlias;
    const viaAliasNorm = normalized.get(normalizeGroupShort(alias));
    if (typeof viaAliasNorm === "string") return viaAliasNorm;
  }

  const hit = normalized.get(normalizeGroupShort(raw));
  return typeof hit === "string" ? hit : undefined;
};
