// The person resolver (plan §3) — reads the PG-resident office-holder sources, parses
// + blocks + clusters them (nameParts.ts + cluster.ts), and rebuilds the person /
// person_role / person_alias tables. Idempotent: a full TRUNCATE+rebuild with
// DETERMINISTIC slugs, so re-running yields the same person_ids (like
// rebuild_ngo_board_links). SLUG PERSISTENCE is implemented (migration 099 +
// slugLock.ts): the name-hash tier reuses each person's locked slug across re-resolves,
// so /person URLs and the watchlist survive cluster drift instead of churning ~a third
// of non-MP slugs each rebuild.
//
// Scope so far: magistrate + officials (executive + municipal) + MPs + candidates (CIK,
// per-election by-slug shards) + donors (ЕРИК campaign finance) + local mayors/councillors
// (mi/chmi elected office holders) + sanctions (OFAC/EU, curated)
// + regulators (curated rosters of independent bodies). The mp id is the
// cross-source GOLD KEY — Tier 0 — carried by MPs and by any candidacy resolved to a seat
// (mpId), and is unioned across blocks so a name variant can't scatter one MP. Cross-source
// merges are the safe ones: same mp id (Tier 0), a name-independent corroborant (Tier 1:
// shared company / birth date / party+place, VETOED by a conflicting patronymic), or a
// globally-unique full name (Tier 2). Donors are 2-part and never auto-merge (privacy:
// public_default=false → internal-only). TR officers are BRIDGED two ways, never materialized
// on their own: Bridge A (shared company) attaches a person's TR footprint on a company they
// already declare/link to (magistrate_company + company_politicians) via the strong shared-uic
// corroborant; Bridge B (unique full name) discovers the footprint of a globally-unique-named
// public person on the one company their exact name appears on (Tier-2, double-gated). Review
// candidates (§3 tier 3) persist to person_review_candidate. Human adjudications
// (person_link_override) apply LAST (Tier 4, scripts/person/overrides.ts): a fold-level
// merge/split, and a ref-level split that ISOLATES one mention — the only key specific enough
// to undo a wrong Tier-0 gold union (a candidacy matchMp()'d onto the wrong same-name MP).
//
//   npx tsx scripts/person/resolve_persons.ts
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/person/resolve_persons.ts
//
// A successful run stamps state/ingest/update-persons.json and appends a
// data-changes row. `--no-stamp` suppresses both — the cloud publish passes it,
// and a scratch run should too. Via npm it needs the `--` separator:
//
//   npx tsx scripts/person/resolve_persons.ts --no-stamp
//   npm run db:resolve:persons -- --no-stamp

import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, withTx, end, exec } from "../db/lib/pg";
import { collapseSlugRedirectChainsVerbose } from "./collapse_slug_chains";
import {
  isOfficialSource,
  personSourceForOfficial,
} from "../../src/lib/officialSources";
import { copyRows } from "../db/lib/copy";
import { parseName } from "./nameParts";
import { writeIngestState } from "../lib/ingest-state";
import { appendDataChange } from "../lib/data-changes";
import { clusterBlock, type Mention } from "./cluster";
import { applyOverrides, parseOverrides, type OverrideRow } from "./overrides";
import { chooseStableSlug } from "./slugLock";
import { candidacyRegions, pickPrimaryMir } from "./candidateRegions";
import { mirToOblast } from "../../src/data/parliament/nsFolders";
import { canonicalObshtina } from "../../src/lib/obshtinaPlace";
import { foldJudicialName } from "../judiciary/judicialBodies";
import { normPlaceName } from "../parsers_local/oblastNames";
import {
  type LocalMayorMention,
  pickLocalWinner,
  mayorRef,
  councillorRef,
  kmetstvoRef,
  districtRef,
  districtsAreShardedElsewhere,
  councilShardReplicatesSofia,
  localSeatKey,
} from "../parsers_local/localPersonRefs";

import { buildLocalTermIndex, localTermBounds } from "./localTerms";
import { seatsForMp } from "./mpSeats";
import { NS_TERM_START } from "../../src/data/parliament/nsFolders";
import {
  UnmappedGroupShortError,
  groupShortToCanonical,
  loadCanonicalIndex,
} from "./partyGroups";

// Re-exported for resolve_persons_sofia_council.test.ts, which imports it from here.
export { councilShardReplicatesSofia };

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// ── MP party (mp-party-affiliation-v1 T2) ───────────────────────────────────
//
// One row per person, carrying the group they ENTERED their most recent covered
// parliament with. `latestSeatForMp` has already applied the §0f nsFolders
// guard, so a recycled mp id cannot hand this person another member's group.
//
// v1 is deliberately career-SCALAR — the per-NS rows are T3, which needs the
// `ref` widening. For a multi-parliament MP that means the column shows their
// latest group and `party_codes` under-reports the earlier ones; T3 fixes both.
//
// NULL is the honest answer for 1,559 of the 2,122 roles: NS 39-43 predate the
// roll-call corpus entirely, so there is no group to look up rather than a
// group we failed to resolve. An UNMAPPED short is the opposite case and
// THROWS — see partyGroups.ts for why silence there would hide a whole
// parliament among the legitimate blanks.
let canonicalIndexForMp: ReturnType<typeof loadCanonicalIndex> | undefined;
const mpPartyUnmapped: string[] = [];

const canonicalGroup = (
  short: string,
  mpId: number,
  ns: number,
): string | null => {
  canonicalIndexForMp ??= loadCanonicalIndex();
  try {
    return groupShortToCanonical(short, canonicalIndexForMp);
  } catch (e) {
    if (e instanceof UnmappedGroupShortError) {
      // Collected and re-thrown after the loop rather than on first sight, so
      // one run names every unmapped short instead of making the operator
      // rediscover them one re-run at a time.
      mpPartyUnmapped.push(`${short} (mp ${mpId}, NS ${ns})`);
      return null;
    }
    throw e;
  }
};

// ── NS term bounds (T3) ─────────────────────────────────────────────────────
//
// NOT derived from the votes. `min(vote_item.date)` for NS 44 is 2020-10-28,
// but the 44th convened in 2017 — the roll-call corpus starts mid-term — so
// dating a seat from its first sitting would put every NS-44 row three years
// late and make `top_party`'s `start_date DESC` order careers wrongly.
// `NS_TERM_START` is keyed off the ELECTION that seated each parliament, which
// is the only source that tells a short parliament from a partially ingested
// one (the 45th sat 17 days and we hold all of them).
//
// A term ends the day before the next begins. The newest parliament has no
// successor, so its `end_date` is NULL — still sitting, not unknown.
const NS_TERM_BOUNDS: Map<number, { start: string; end: string | null }> =
  (() => {
    const starts = Object.entries(NS_TERM_START)
      .map(([ns, d]) => ({ ns: Number(ns), start: d }))
      .filter((x) => Number.isFinite(x.ns))
      .sort((a, b) => a.ns - b.ns);
    const out = new Map<number, { start: string; end: string | null }>();
    starts.forEach((cur, i) => {
      const next = starts[i + 1];
      let end: string | null = null;
      if (next) {
        const d = new Date(`${next.start}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        end = d.toISOString().slice(0, 10);
      }
      out.set(cur.ns, { start: cur.start, end });
    });
    return out;
  })();

type MpRoleRow = {
  ref: string;
  party: string | null;
  startDate: string | null;
  endDate: string | null;
};

/**
 * The person_role rows for ONE mp mention — one per parliament they actually
 * sat in, keyed `'<mpId>:<ns>'` (T3).
 *
 * An MP with no roll-call coverage keeps a SINGLE row with the bare `'<mpId>'`
 * ref and a NULL party: NS 39-43 predate the corpus and 1,263 profiles carry no
 * `nsFolders` at all. That mixed shape is deliberate and safe — every consumer
 * reads the id with `split_part(ref, ':', 1)`, which returns the whole string
 * when there is no colon. Minting a `'<mpId>:0'` would be worse: it would claim
 * a parliament that does not exist.
 */
const mpRoleRowsFor = (ref: string): MpRoleRow[] => {
  const bare = [{ ref, party: null, startDate: null, endDate: null }];
  const mpId = Number.parseInt(ref, 10);
  if (!Number.isFinite(mpId)) return bare;
  const seats = seatsForMp(mpId);
  if (!seats.length) return bare;
  return seats.map((s) => {
    const bounds = NS_TERM_BOUNDS.get(s.ns);
    return {
      ref: `${mpId}:${s.ns}`,
      party: canonicalGroup(s.entryGroupShort, mpId, s.ns),
      startDate: bounds?.start ?? null,
      endDate: bounds?.end ?? null,
    };
  });
};

type Raw = {
  id: string;
  source: string;
  ref: string;
  role: string;
  hardId: string | null; // cross-source gold key (parliament MP id) — Tier 0
  // The Сметна палата register's OWN per-person id (`cacbg:<GUID>`), recovered from the
  // declaration source_url. A second, independent gold key — see `registerIdByRef`.
  regId: string | null;
  display: string;
  given: string;
  patr: string | null;
  family: string;
  nameParts: 2 | 3;
  ambiguous: boolean;
  // The TYPED place (migration 115): which namespace, and the canonical id in it.
  // `placeKind` is NULL exactly when `placeCode` is (DB CHECK), so a source with no place
  // for a given row writes both as NULL rather than a half-filled state.
  //
  // NO DISPLAY STRING for a place that RESOLVES: 082_person_api.sql joins place_dim (117)
  // for mir/obshtina and judicial_body (116) for judicial, so the resolver records WHICH
  // PLACE, not what it is called.
  //
  // `placeRaw` is the exception, and is not a label: it is the declaration's OWN
  // institution text, kept only when no dictionary can resolve it (43 magistrate rows —
  // source typos, plus "Върховна прокуратура", which could be ВКП or ПРБ). That text
  // exists nowhere else, so dropping it would blank a badge rather than de-duplicate one.
  placeKind: "mir" | "obshtina" | "judicial" | "settlement" | null;
  placeCode: string | null;
  placeRaw: string | null;
  // Matching corroborants (kept SEPARATE from `place` display — a magistrate's court
  // is a display place but not a reliable cross-person corroborant).
  cParty: string | null;
  cPlace: string | null;
  cBirth: string | null;
  // `cParty` comes from a NATIONAL PARTY OFFICE (chair / deputy / statutory
  // representative), which qualifies it as strong-against-an-identical-full-name — see
  // samePartyOffice in cluster.ts.
  cPartyOffice: boolean;
  uics: string[]; // declared/linked company EIKs — the strong shared-company corroborant
  sourceRow: unknown | null; // provenance jsonb for the role (e.g. a sanctions designation)
};

// djb2 → 6 base36 chars. Deterministic disambiguator for magistrate-only slugs.
const hash6 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6).padStart(6, "0");
};
const kebab = (s: string): string =>
  s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// `councilShardReplicatesSofia` moved to ../parsers_local/localPersonRefs (shared with the
// personSlug bake) and is re-exported below so its existing unit test keeps its import path.

// A TR role that is board membership of a ЮЛНЦ (association / foundation / читалище) is
// the `ngo` facet, not a company (`tr`) officership — the two carry different meaning on a
// profile (civic board seat vs business interest). These role codes only ever occur on
// NGO entity classes (verified), so the role name is a clean, entity-independent classifier.
const NGO_ROLES = new Set(["ngo_board", "ngo_representative"]);
const trOrNgo = (role: string): "tr" | "ngo" =>
  NGO_ROLES.has(role) ? "ngo" : "tr";

// (election, partyNum) -> canonicalId — a party corroborant that is STABLE across
// elections (partyNum is re-assigned every cycle). Lets a person's candidacies for the
// same party in the same oblast merge across elections (weak-both corroboration, §3
// Tier 1). Degrades to no-party when data/canonical_parties.json is absent.
function buildPartyMap(): Map<string, string> {
  const m = new Map<string, string>();
  const p = path.join(REPO_ROOT, "data/canonical_parties.json");
  if (!fs.existsSync(p)) return m;
  const cp = JSON.parse(fs.readFileSync(p, "utf8")) as {
    parties: {
      id: string;
      history: { election: string; partyNum: number }[];
    }[];
  };
  for (const party of cp.parties)
    for (const h of party.history)
      m.set(`${h.election}#${h.partyNum}`, party.id);
  return m;
}

// Fold a party NAME to a comparison key: uppercase, drop punctuation and quoting (the
// register writes `ПП„Продължаваме промяната"` where the ballot writes `ПП ПРОДЪЛЖАВАМЕ
// ПРОМЯНАТА`), then drop one leading legal-form token so `ПП "X"`, `Политическа партия
// "X"` and a bare `X` all land on `X`.
const partyKey = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^А-ЯЁA-Z0-9]+/g, " ")
    .trim()
    .replace(
      /^(ПОЛИТИЧЕСКА ПАРТИЯ|ПОЛИТИЧЕСКО ДВИЖЕНИЕ|ПОЛИТИЧЕСКА КОАЛИЦИЯ|КОАЛИЦИЯ|ПАРТИЯ|ПП|ПК|ПД) /,
      "",
    )
    .trim();

// Party NAME -> canonicalId, so the institution a party officer files under
// (`ПП "ИМА ТАКЪВ НАРОД"`) lands in the SAME namespace as a candidacy's party
// corroborant (`p_0`) — otherwise the two could never be compared. Built from every name
// the canonical file carries: the display name, and each cycle's ballot name + nickname.
// First key wins, so a name shared by two canonical parties resolves to one of them
// rather than flapping; a party the file does not know simply gets no key, and the
// officer mention then carries no party corroborant at all.
function buildPartyNameMap(): Map<string, string> {
  const m = new Map<string, string>();
  const p = path.join(REPO_ROOT, "data/canonical_parties.json");
  if (!fs.existsSync(p)) return m;
  const cp = JSON.parse(fs.readFileSync(p, "utf8")) as {
    parties: {
      id: string;
      displayName: string | null;
      history: { name: string | null; nickName: string | null }[];
    }[];
  };
  for (const party of cp.parties)
    for (const raw of [
      party.displayName,
      ...party.history.flatMap((h) => [h.name, h.nickName]),
    ]) {
      const k = raw ? partyKey(raw) : "";
      if (k && !m.has(k)) m.set(k, party.id);
    }
  return m;
}

// The typed place, as one unit — every source either fills kind+code or neither
// (migration 115 enforces kind-iff-code). `placeRaw` is independent of the pair: it is set
// only when a source named a place that no dictionary resolves.
type TypedPlace = Pick<Raw, "placeKind" | "placeCode" | "placeRaw">;

const NO_PLACE: TypedPlace = {
  placeKind: null,
  placeCode: null,
  placeRaw: null,
};

// Build the typed obshtina place for a source-native code. Canonicalises Sofia's
// city-wide synonym (`SOF` → `SFO_CITY`) so the officials roster and the local-election
// shards agree on ONE code for the Столична община — without which the /person offices
// tile lists a Sofia councillor's single seat twice.
//
// Module scope, not a closure inside collect(): T2 adds magistrate places ABOVE the
// point where the closure used to be declared, and a helper only some sources can see is
// a footgun rather than a convenience.
const obshtinaPlaceFor = (raw: string | null | undefined): TypedPlace => {
  const code = canonicalObshtina(raw);
  if (!code) return NO_PLACE;
  return { placeKind: "obshtina", placeCode: code, placeRaw: null };
};

// The кметство → settlement index (migration 117, db:load:place-dim:pg), keyed
// `<obshtina_code>\t<folded settlement name>` because a settlement name is unique only
// within its община.
//
// A value of `null` marks the key AMBIGUOUS — two settlements in one община share a name
// (7 pairs today: SFO17 "Елин Пелин" the town and the village, VID16 "Орешец",
// SHU19 "Каспичан", …). Ambiguous keys resolve to nothing, so the caller falls back to the
// община: a coarse place beats a coin-flip between two villages on a named person's page.
//
// Module scope, like judicialPlaceFor, so the decision is reachable from a unit test without
// a database.
export const buildSettlementIndex = (
  rows: readonly { obshtina_code: string; name_bg: string; code: string }[],
): Map<string, string | null> => {
  const idx = new Map<string, string | null>();
  const put = (key: string, code: string) =>
    idx.set(key, idx.has(key) && idx.get(key) !== code ? null : code);
  for (const s of rows) {
    put(`${s.obshtina_code}\t${normPlaceName(s.name_bg)}`, s.code);
    // Sofia's own settlements are filed under their РАЙОН (Владая → S2317, Бусманци →
    // S2414), while the local-election bundle for the city is the single `SOF` shard, which
    // never names a район. Without a second key all 132 Sofia кметства across the cycles
    // resolve to nothing — the largest single block of misses.
    //
    // Safe because it is a lookup, not a guess: the city's 58 settlement names are unique
    // across all 24 районни (measured), and `put` collapses any future collision to
    // ambiguous rather than picking one.
    if (s.obshtina_code.startsWith("S2"))
      put(`SFO_CITY\t${normPlaceName(s.name_bg)}`, s.code);
  }
  return idx;
};

/** CIK writes a кметство's name either bare ("Церово") or prefixed ("кметство Церово"), and
 *  the two spellings sit in different cycles of the SAME seat. Left alone, one cycle resolves
 *  to the settlement and the other falls back to the община — so `PersonProfileScreen`, which
 *  dedupes offices on (role, placeCode), prints two "Кмет на кметство" rows for one job. It
 *  did so for 69 people. */
const stripKmetstvoPrefix = (name: string): string =>
  name.replace(/^\s*кметство\s+/i, "");

/**
 * The кметство's own settlement, falling back to its община when the name does not resolve.
 *
 * A village mayor's seat is a SETTLEMENT: publishing "Тунджа" on the profile of the кмет на
 * кметство of с. Безмер names a place he does not govern and an office (кмет на община) that
 * belongs to somebody else. All 10,721 village-mayor roles read that way before this.
 *
 * The fallback is deliberate and is today's behaviour, so nothing regresses where the name
 * does not resolve. Coverage measured 2026-08-03: 10,538 of 10,721 village-mayor seats
 * (98.3%). The remaining misses are multiword names the catalogue spells differently
 * ("Гара Бов", "Хаджи Димитрово") and, until §T0 lands, the nine Бяла-Русе villages filed
 * under VAR05 — which correctly fail to resolve rather than landing in обл. Варна.
 */
export const settlementPlaceFor = (
  index: ReadonlyMap<string, string | null>,
  obshtinaCode: string | null | undefined,
  kmetstvoName: string | null | undefined,
): TypedPlace => {
  const obshtina = obshtinaPlaceFor(obshtinaCode);
  if (!kmetstvoName || obshtina.placeKind !== "obshtina") return obshtina;
  const code = index.get(
    `${obshtina.placeCode}\t${normPlaceName(stripKmetstvoPrefix(kmetstvoName))}`,
  );
  return code
    ? { placeKind: "settlement", placeCode: code, placeRaw: null }
    : obshtina;
};

// Build a typed judicial place by folding a free-text court name onto a judicial_body.
//
// Module scope for the same reason as its two siblings — and because this is the only one
// of the three with a real decision in it, so it needs to be reachable from a unit test
// without a database.
export const judicialPlaceFor = (
  byAlias: Map<string, { code: string }>,
  court: string | null,
): TypedPlace => {
  if (!court) return NO_PLACE;
  // The RAW string first, the fold second. The loader keys judicial_body_alias with the
  // vocabulary-ful fold and there is no vocabulary here, so the one construct that needs
  // it — a glued abbreviation, "РПКюстендил" — folds to a DIFFERENT key on this side and
  // misses a body that was resolved perfectly well at load time. judicial_body_source_name
  // holds the un-folded string, which needs no vocabulary to match.
  const body = byAlias.get(court) ?? byAlias.get(foldJudicialName(court));
  // An institution the dictionary cannot classify (~43 magistrates: source typos, and
  // "Върховна прокуратура", which could be ВКП or ПРБ) gets NO code — a guessed court on a
  // named person's profile is a misstatement. But it keeps the declaration's OWN text in
  // place_raw: that is the source speaking, not us inferring, and dropping it would blank a
  // badge rather than de-duplicate a label. kind/code stay NULL, which is what every
  // consumer keys on; 082 falls back to place_raw only because they are.
  if (!body) return { ...NO_PLACE, placeRaw: court.trim() || null };
  // Resolved — 082 joins judicial_body for the name. Those names are Bulgarian-only: there
  // is no official English register of Bulgarian courts to translate against, and inventing
  // one would be worse than showing an English reader the Bulgarian.
  return { placeKind: "judicial", placeCode: body.code, placeRaw: null };
};

// Build a typed МИР place from a site oblast/МИР code (`BLG`, `S23`, `PDV-00`).
const mirPlaceFor = (code: string | null | undefined): TypedPlace => {
  if (!code) return NO_PLACE;
  return { placeKind: "mir", placeCode: code, placeRaw: null };
};

// Build the parse-derived + defaulted fields shared by every source, so each source
// only spells out what differs (id/source/ref/role + any hardId/corroborants).
const fields = (
  p: NonNullable<ReturnType<typeof parseName>>,
  over: Partial<Raw>,
): Omit<Raw, "id" | "source" | "ref" | "role"> => ({
  hardId: null,
  regId: null,
  display: p.displayName,
  given: p.given,
  patr: p.patronymic,
  family: p.family,
  nameParts: p.nameParts,
  ambiguous: p.ambiguous,
  placeKind: null,
  placeCode: null,
  placeRaw: null,
  cParty: null,
  cPlace: null,
  cBirth: null,
  cPartyOffice: false,
  uics: [],
  sourceRow: null,
  ...over,
});

// The Сметна палата register (register.cacbg.bg) stamps every declaration filename with
// its OWN per-person GUID — `<GUID><per-filing sequence>.xml` — so every filing by one
// declarant, across years AND across tiers (exec / muni / mp), carries the same GUID. That
// makes it a second gold key alongside the parliament MP id, and a strictly better one than
// the name: the officials slug is `hash(canonicalDeclarantName(rawName)|institution)`
// (scripts/officials/shared.ts). Canonicalisation levels the cheap drift — the register
// merely re-casing a name between harvests ("Станислав Тодоров Трифонов" → "СТАНИСЛАВ
// ТОДОРОВ ТРИФОНОВ"), or re-spacing a hyphen, or dropping a "д-р" — which used to mint a
// SECOND slug for the same person. It does NOT level a typo ("Руфат" → "Руфад"), and it
// cannot: the two are indistinguishable from two same-named people. The GUID is immune to
// both, which is why it stays the gold key. Also immune to marriage renames
// that change the fold itself (MP 3861 "Галя Стоянова Желязкова" and MP 5334 "Галя Стоянова
// Василева" are one person — different blocks, so no name-based tier could ever see them).
//
// Keyed on declaration.subject_ref, which IS person_role.ref (the officials slug / the MP
// id) — the same join load_declarations_pg's phase 2 uses. A ref carrying MORE than one
// GUID is two register persons collapsed onto one slug (the case
// scripts/officials/_slug_collisions.json exists to split); it is SKIPPED rather than
// guessed at, so an unlisted collision can never union two people through this key.
async function registerIdByRef(): Promise<Map<string, string>> {
  const present = await allRows<{ reg: string | null }>(
    `SELECT to_regclass('public.declaration')::text AS reg`,
  );
  if (!present[0]?.reg) return new Map(); // cold bootstrap — declarations not loaded yet
  // UNION the dropped duplicates (migration 101). `declaration` holds at most ONE row
  // per source_url, so a slug whose every filing was written under another slug too —
  // an official holding two posts — has no row here at all and would get NO gold key,
  // which is exactly how one man became two person rows with his role on one and his
  // wealth on the other. The alias table is the evidence the loader would otherwise
  // discard. The HAVING guard below is unchanged and still decides everything: a ref
  // that ends up carrying two distinct GUIDs is still SKIPPED, so widening the input
  // can only add a union the register itself asserts, never invent one.
  const rows = await allRows<{ subject_ref: string; guid: string }>(
    `SELECT subject_ref, min(guid) AS guid
       FROM (SELECT subject_ref,
                    upper(substring(source_url from
                      '([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})')) AS guid
               FROM (SELECT subject_ref, source_url FROM declaration
                     UNION
                     -- FOLD-AGREEMENT GATE. Accept an alias only when the register printed
                     -- the SAME name on both listings (compared on translit_bg_latin, so
                     -- re-casing / re-spacing / a dropped "д-р" still agree). A shared
                     -- source_url is the register's own claim that the two listings are one
                     -- filing, but this key overrides every namesake veto downstream, so a
                     -- bad row must not be able to merge two differently-named people on
                     -- the strength of a URL alone. An alias whose name disagrees is simply
                     -- not used — the ref keeps whatever key its own filings give it.
                     SELECT a.subject_ref, a.source_url
                       FROM declaration_subject_alias a
                       JOIN declaration d2 ON d2.source_url = a.source_url
                      WHERE a.declarant_name IS NULL
                         OR translit_bg_latin(a.declarant_name)
                            = translit_bg_latin(d2.declarant_name)) u) d
      WHERE guid IS NOT NULL
      GROUP BY subject_ref
     HAVING count(DISTINCT guid) = 1`,
  );
  return new Map(rows.map((r) => [r.subject_ref, `cacbg:${r.guid}`]));
}

// subject_ref -> the canonical party this official is a NATIONAL OFFICER of, for the
// `party_leader` category only (chair / deputy chair / statutory representative — the
// register bundles the three). The institution on such a filing IS a party, so it maps
// into the canonical party namespace and becomes the party-office corroborant
// (samePartyOffice in cluster.ts). Officers of a party the canonical file does not carry,
// and officers whose filings name two different canonical parties (they moved), are left
// without one rather than guessed at.
async function partyOfficeByRef(
  byName: Map<string, string>,
): Promise<Map<string, string>> {
  const present = await allRows<{ reg: string | null }>(
    `SELECT to_regclass('public.declaration')::text AS reg`,
  );
  if (!present[0]?.reg) return new Map();
  const rows = await allRows<{ subject_ref: string; institution: string }>(
    `SELECT DISTINCT subject_ref, institution FROM declaration
      WHERE category = 'party_leader' AND institution IS NOT NULL`,
  );
  const seen = new Map<string, Set<string>>();
  let unmatched = 0;
  for (const r of rows) {
    const id = byName.get(partyKey(r.institution));
    if (!id) {
      unmatched++;
      continue;
    }
    const s =
      seen.get(r.subject_ref) ??
      seen.set(r.subject_ref, new Set()).get(r.subject_ref)!;
    s.add(id);
  }
  const out = new Map<string, string>();
  for (const [ref, ids] of seen) if (ids.size === 1) out.set(ref, [...ids][0]);
  if (unmatched)
    console.log(
      `  ${unmatched} party-officer filing(s) name a party absent from canonical_parties.json — no party corroborant`,
    );
  return out;
}

async function collect(): Promise<Raw[]> {
  const out: Raw[] = [];
  let skipped = 0;
  const regId = await registerIdByRef();
  const partyOffice = await partyOfficeByRef(buildPartyNameMap());
  const add = (
    name: string,
    r: Omit<Raw, keyof ReturnType<typeof fields>>,
    over: Partial<Raw> = {},
  ) => {
    const p = parseName(name);
    if (!p) {
      skipped++;
      return;
    }
    out.push({ ...r, ...fields(p, over) });
  };

  // Person → linked-company (EIK) maps, for the TR-officer bridge (Bridge A). These are
  // the authoritative person↔company links already in PG: magistrate holdings
  // (ИВСС чл.175а) + the curated company_politicians (MP/official). A TR officer on one
  // of these EIKs whose name matches the linked person is that person's own TR footprint,
  // bridged via the STRONG shared-uic corroborant. eikExpected caps the bridge to the
  // linked person's (given, family) so co-owners of the same company are NOT swept in.
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  };
  const magEik = new Map<string, string[]>(); // magistrate name -> eik[]
  const refEik = new Map<string, string[]>(); // 'mp:{id}' | 'off:{slug}' -> eik[]
  const eikExpected = new Map<string, Set<string>>(); // eik -> {givenLc\tfamilyLc}
  const expect = (eik: string, name: string): void => {
    const p = parseName(name);
    if (!p) return;
    const k = `${p.given.toLowerCase()}\t${p.family.toLowerCase()}`;
    (eikExpected.get(eik) ?? eikExpected.set(eik, new Set()).get(eik)!).add(k);
  };
  for (const r of await allRows<{ magistrate_name: string; eik: string }>(
    `SELECT magistrate_name, eik FROM magistrate_company
      WHERE eik IS NOT NULL AND NOT eik_ambiguous`,
  )) {
    push(magEik, r.magistrate_name, r.eik);
    expect(r.eik, r.magistrate_name);
  }
  for (const r of await allRows<{
    eik: string;
    politician: string;
    ref: string;
  }>(`SELECT eik, politician, ref FROM company_politicians`)) {
    const mp = /\/candidate\/mp-(\d+)/.exec(r.ref);
    const off = /\/officials\/(.+)$/.exec(r.ref);
    if (mp) push(refEik, `mp:${mp[1]}`, r.eik);
    else if (off) push(refEik, `off:${off[1]}`, r.eik);
    else continue;
    expect(r.eik, r.politician);
  }

  // The canonical judicial institution behind each raw court string (migration 116,
  // db:load:judicial-bodies:pg). Keyed on the SAME fold the loader wrote, so a spelling
  // it could not classify simply misses and the magistrate keeps a NULL place — never a
  // guessed court on a named person's public profile.
  //
  // The schema is APPLIED (in SCHEMA_FILES) rather than the query being wrapped in a
  // catch-all: on a cold bootstrap the tables then exist and are simply empty, which is
  // the same outcome, while a genuinely broken query or a dropped connection still
  // fails loudly instead of silently NULLing all ~2,700 magistrate places.
  const judicialByAlias = new Map<
    string,
    { code: string; name: string; kind: string }
  >();
  for (const b of await allRows<{
    alias_norm: string;
    body_code: string;
    name: string;
    kind: string;
  }>(
    `SELECT a.alias_norm, a.body_code, b.name, b.kind
       FROM judicial_body_alias a JOIN judicial_body b USING (body_code)
     UNION ALL
     SELECT s.source_name, s.body_code, b.name, b.kind
       FROM judicial_body_source_name s JOIN judicial_body b USING (body_code)`,
  ))
    judicialByAlias.set(b.alias_norm, {
      code: b.body_code,
      name: b.name,
      kind: b.kind,
    });

  const judicialPlace = (court: string | null): TypedPlace =>
    judicialPlaceFor(judicialByAlias, court);

  // The кметство → settlement dictionary (migration 117, db:load:place-dim:pg). A village
  // mayor's seat is a SETTLEMENT, not the община it sits in: publishing "Тунджа" on the
  // profile of the кмет на кметство of с. Безмер names a place he does not govern and a job
  // (кмет на община) that belongs to somebody else. All 10,721 village-mayor roles read that
  // way before this.
  //
  // Keyed (obshtina_code, folded name) because a settlement name is unique only within its
  // община. Loaded ONCE for the whole walk — 5,366 rows.
  //
  // Ambiguity is DROPPED, not guessed: 7 (obshtina, name) pairs are genuinely two settlements
  // (SFO17 "Елин Пелин" the town and the village, VID16 "Орешец", SHU19 "Каспичан"…). Those
  // fall back to the obshtina place, which is today's behaviour — a coarse place beats a
  // coin-flip between two villages on a named person's page.
  const settlementByObshtinaName = buildSettlementIndex(
    await allRows<{ obshtina_code: string; name_bg: string; code: string }>(
      `SELECT obshtina_code, name_bg, code FROM place_dim
        WHERE kind = 'settlement' AND obshtina_code IS NOT NULL`,
    ),
  );

  const settlementPlace = (
    obshtinaCode: string | null | undefined,
    kmetstvoName: string | null | undefined,
  ): TypedPlace =>
    settlementPlaceFor(settlementByObshtinaName, obshtinaCode, kmetstvoName);

  const mags = await allRows<{ name: string; court: string | null }>(
    `SELECT name, court FROM magistrate`,
  );
  for (const m of mags)
    add(
      m.name,
      {
        id: `magistrate:${m.name}`,
        source: "magistrate",
        ref: m.name,
        role: "magistrate",
      },
      {
        ...judicialPlace(m.court),
        uics: magEik.get(m.name) ?? [],
      },
    );

  // No label maps here any more: the resolver records WHICH place, and 082_person_api.sql
  // joins place_dim (117) / judicial_body (116) for the name. scripts/person/places.ts
  // still owns those label maps — it is what BUILDS place_dim.

  const offs = await allRows<{
    name: string;
    slug: string;
    role: string | null;
    tier: string | null;
    obshtina: string | null;
  }>(`SELECT name, slug, role, tier, obshtina FROM official_roster`);
  // A few executive categories have their own person_source — see
  // src/lib/officialSources.ts for which, and for why the others deliberately
  // stay on the generic one.
  for (const o of offs)
    add(
      o.name,
      {
        id: `official:${o.slug}`,
        source: personSourceForOfficial(o.tier, o.role),
        ref: o.slug,
        role: o.role ?? "official",
      },
      {
        // The obshtina code for a municipal official (NULL elsewhere). Leaving it NULL
        // is what stopped the municipal roster from being servable out of Postgres —
        // the code exists nowhere else in the DB. Set here rather than derived
        // downstream: only the roster knows it.
        ...obshtinaPlaceFor(o.obshtina),
        uics: refEik.get(`off:${o.slug}`) ?? [],
        regId: regId.get(o.slug) ?? null,
        cParty: partyOffice.get(o.slug) ?? null,
        cPartyOffice: partyOffice.has(o.slug),
      },
    );

  // MPs (data/parliament/index.json) — the mp id is the cross-source GOLD KEY (Tier 0),
  // and birthDate is a strong name-independent corroborant. Degrades gracefully if the
  // file is absent (fresh clone without the parliament data).
  // mp id → parliament.bg's 2-digit seated-МИР number. Rule 1 of §3a needs it on the
  // CANDIDATE loop below as well as on the mp roles, because a candidacy that seated
  // someone should show the МИР they were seated from rather than the one they happened
  // to poll best in.
  const seatedMirByMpId = new Map<number, string>();
  const mpPath = path.join(REPO_ROOT, "data/parliament/index.json");
  if (fs.existsSync(mpPath)) {
    const idx = JSON.parse(fs.readFileSync(mpPath, "utf8")) as {
      mps: {
        id: number;
        name: string;
        // currentRegion is a bare region NAME on most rows but a {code,name} object on
        // some — normalize to the name string so it never renders as raw JSON.
        currentRegion: string | { code?: string; name?: string } | null;
        // The МИР the MP was SEATED from — present for ALL 2,122 MPs where
        // currentRegion covers only the 240 sitting ones (T3a). This is Rule 1 of
        // §3a, and it is read from index.json rather than mp_profile because
        // db:refresh loads that table TWO STEPS AFTER this resolver runs.
        seatedRegion?: { code?: string; name?: string } | null;
        currentPartyGroupShort: string | null;
        birthDate: string | null;
      }[];
    };
    for (const mp of idx.mps) {
      if (mp.seatedRegion?.code)
        seatedMirByMpId.set(mp.id, mp.seatedRegion.code);
      const region =
        typeof mp.currentRegion === "object" && mp.currentRegion !== null
          ? (mp.currentRegion.name ?? null)
          : (mp.currentRegion ?? null);
      add(
        mp.name,
        { id: `mp:${mp.id}`, source: "mp", ref: String(mp.id), role: "mp" },
        {
          hardId: `mp:${mp.id}`,
          regId: regId.get(String(mp.id)) ?? null,
          // Rule 1 (§3a): the seated МИР, mapped from parliament.bg's own 2-digit
          // number onto the site's МИР code. Takes `mp` fill from 11.3% to 100%.
          ...mirPlaceFor(mirToOblast(mp.seatedRegion?.code)),
          cParty: mp.currentPartyGroupShort,
          cPlace: region,
          cBirth: mp.birthDate,
          uics: refEik.get(`mp:${mp.id}`) ?? [],
        },
      );
    }
  }

  // Sanctions (data/person/sanctions.json) — OFFICIAL OFAC/EU designations of Bulgarian
  // individuals (public record, §5 T1 `sanctions` facet). To never implicate the WRONG
  // same-named person, an entry attaches ONLY via a stable disambiguator (mpId → Tier-0
  // gold key); a name-ambiguous designee (`resolved:false`, no mpId) is documented in the
  // file but NOT emitted, so no ambiguous public accusation is minted.
  const sanctionsPath = path.join(REPO_ROOT, "data/person/sanctions.json");
  if (fs.existsSync(sanctionsPath)) {
    const sx = JSON.parse(fs.readFileSync(sanctionsPath, "utf8")) as {
      designees: {
        name: string;
        mpId?: number;
        resolved?: boolean;
        program: string;
        authority: string;
        date: string;
        url: string;
      }[];
    };
    let heldSanctions = 0;
    for (const d of sx.designees) {
      // Strictest gate on the most defamation-sensitive source: attach ONLY via the mpId
      // gold key, and never if the entry is explicitly held (resolved:false).
      if (d.mpId == null || d.resolved === false) {
        heldSanctions++;
        continue;
      }
      add(
        d.name,
        {
          id: `sanctions:mp:${d.mpId}`,
          source: "sanctions",
          ref: `mp:${d.mpId}`,
          role: "sanctioned",
        },
        {
          hardId: `mp:${d.mpId}`,
          sourceRow: {
            program: d.program,
            authority: d.authority,
            date: d.date,
            url: d.url,
          },
        },
      );
    }
    if (heldSanctions)
      console.log(
        `  held ${heldSanctions} name-ambiguous sanction(s) for manual disambiguation`,
      );
  }

  // ДС / COMDOS (data/person/ds.json) — OFFICIAL findings of the Комисия по досиетата
  // (comdos.bg) naming public-office holders established affiliated to State Security /
  // БНА intelligence (public record, §5 T1 `ds` facet). These are government verdicts,
  // not our claim. SAME defamation posture as sanctions: comdos.bg has no bulk feed, so
  // the register is HAND-CURATED from the published решения, and an entry attaches ONLY
  // via the parliament MP id (Tier-0 gold key) AND with an exact birth-date match against
  // the решение — a name-ambiguous namesake (`resolved:false`, no mpId; e.g. a решение-14
  // person whose birth date differs from the current same-named MP) is documented in the
  // file but NOT emitted, so no ambiguous public accusation is minted.
  const dsPath = path.join(REPO_ROOT, "data/person/ds.json");
  if (fs.existsSync(dsPath)) {
    const dx = JSON.parse(fs.readFileSync(dsPath, "utf8")) as {
      affiliations: {
        name: string;
        mpId?: number;
        resolved?: boolean;
        decisionNo: string;
        decisionDate: string;
        category?: string;
        pseudonyms?: string[];
        bodyContext: string;
        url: string;
      }[];
    };
    let heldDs = 0;
    for (const d of dx.affiliations) {
      // Strictest gate: attach a State-Security finding ONLY via the mpId gold key, and
      // never if the entry is explicitly held (resolved:false).
      if (d.mpId == null || d.resolved === false) {
        heldDs++;
        continue;
      }
      add(
        d.name,
        {
          id: `ds:mp:${d.mpId}`,
          source: "ds",
          ref: `mp:${d.mpId}`,
          role: "ds_affiliation",
        },
        {
          hardId: `mp:${d.mpId}`,
          sourceRow: {
            decisionNo: d.decisionNo,
            decisionDate: d.decisionDate,
            bodyContext: d.bodyContext,
            category: d.category ?? null,
            pseudonyms: d.pseudonyms ?? [],
            url: d.url,
          },
        },
      );
    }
    if (heldDs)
      console.log(
        `  held ${heldDs} name-ambiguous ДС affiliation(s) for manual disambiguation`,
      );
  }

  // Regulators (data/person/regulators.json) — curated ROSTERS of the independent /
  // regulatory bodies (Конституционен съд, Сметна палата, КФН, БНБ УС, СЕМ, КЗК,
  // Омбудсман…), the §5 T1 `regulator` "кой решава" facet. Same accuracy discipline as
  // sanctions: an entry attaches ONLY via a stable disambiguator — a parliament `mpId`
  // (Tier-0 gold merge) OR a name the register author has confirmed globally-unique — so
  // a seat is never pinned to the WRONG same-named person. An entry with `resolved:false`
  // (name-ambiguous, no mpId) is documented in the file but NOT emitted. The seat name is
  // the `role`, the body the display `place`, and {body, seat, termStart, url} the
  // provenance jsonb. Most regulators are NOT MPs, so most attach by unique name (the
  // resolver's Tier-2, namesake-gated) or mint their own regulator-only person — either
  // way clustering (cluster.ts) can never false-merge them onto a common namesake.
  const regulatorsPath = path.join(REPO_ROOT, "data/person/regulators.json");
  if (fs.existsSync(regulatorsPath)) {
    const rg = JSON.parse(fs.readFileSync(regulatorsPath, "utf8")) as {
      members: {
        name: string;
        mpId?: number;
        body: string;
        seat: string;
        termStart?: string;
        url: string;
        resolved?: boolean;
      }[];
    };
    let heldReg = 0;
    for (const m of rg.members) {
      // Emit only stable-disambiguator entries: an mpId (gold key) OR resolved:true (a
      // name the author verified unique). Everything else is held for review.
      if (m.mpId == null && m.resolved !== true) {
        heldReg++;
        continue;
      }
      add(
        m.name,
        {
          id:
            m.mpId != null
              ? `regulator:mp:${m.mpId}:${m.seat}`
              : `regulator:${m.seat}:${m.name}`,
          source: "regulator",
          ref:
            m.mpId != null ? `mp:${m.mpId}:${m.seat}` : `${m.seat}:${m.name}`,
          role: m.seat,
        },
        {
          hardId: m.mpId != null ? `mp:${m.mpId}` : null,
          sourceRow: {
            body: m.body,
            seat: m.seat,
            termStart: m.termStart ?? null,
            url: m.url,
          },
        },
      );
    }
    if (heldReg)
      console.log(
        `  held ${heldReg} name-ambiguous regulator seat(s) for manual disambiguation`,
      );
  }

  const partyMap = buildPartyMap();

  // Candidates (data/{election}/candidates/by-slug/*.json). Each file is one candidacy in
  // one election, already resolved to an MP id when the candidate was seated (`mpId`) —
  // the Tier-0 GOLD link into the MP person. Non-MP candidacies (c-*) carry party+oblast,
  // the cross-election corroborant. ~67k files across ~10 elections; skipped on a fresh
  // clone without the candidate shards.
  for (const dir of globSync(
    path.join(REPO_ROOT, "data/2*/candidates/by-slug"),
  )) {
    const election = path.basename(path.dirname(path.dirname(dir)));
    // `data/{election}/candidates` — the per-name folders holding regions.json.
    const candidatesRoot = path.dirname(dir);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const c = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        slug: string;
        name: string;
        partyNum: number | null;
        oblasts: string[];
        mpId: number | null;
      };
      const canon =
        c.partyNum != null
          ? (partyMap.get(`${election}#${c.partyNum}`) ?? null)
          : null;
      const oblast = c.oblasts[0] ?? null;
      // The PRIMARY МИР for this candidacy (§3a). `oblasts[0]` is not it: the array is
      // built from preference-vote rows and its order is arbitrary, so on the 15.9% of
      // candidacies that span more than one МИР it picks the seated one just 47% of the
      // time. Rule 1 — the МИР the person was actually seated from — wins when this
      // candidacy put them in parliament; otherwise Rule 2, the МИР where they drew the
      // most preference votes.
      const regions = candidacyRegions(
        candidatesRoot,
        c.name,
        c.partyNum,
      ).regions;
      // Both rules of §3a, in order — see pickPrimaryMir for why Rule 1 may only
      // disambiguate among the МИР this candidacy actually contested.
      const primaryMir = pickPrimaryMir(
        regions,
        c.mpId != null ? mirToOblast(seatedMirByMpId.get(c.mpId)) : null,
        oblast,
      );
      add(
        c.name,
        {
          id: `candidate:${election}:${c.slug}`,
          source: "candidate",
          ref: `${election}:${c.slug}`,
          role: "candidate",
        },
        {
          hardId: c.mpId != null ? `mp:${c.mpId}` : null,
          ...mirPlaceFor(primaryMir),
          cParty: canon,
          cPlace: oblast,
        },
      );
    }
  }

  // Donors (data/{election}/parties/financing/{partyNum}/filing.json → data.fromDonors[]).
  // ЕРИК campaign-finance donors are 2-part names (§2a) with no place, so they never
  // auto-merge (Tier-2 needs a 3-part name; weak-both needs a place) — same-name donors
  // surface only as review candidates, exactly as the plan expects. public_default=false
  // (person_source), so a donor-only person is NOT public. One role per (donor, party,
  // election): a donor giving multiple times folds to one row.
  for (const fin of globSync(
    path.join(REPO_ROOT, "data/2*/parties/financing"),
  )) {
    const election = path.basename(path.dirname(path.dirname(fin)));
    for (const partyNum of fs.readdirSync(fin)) {
      const filing = path.join(fin, partyNum, "filing.json");
      if (!fs.existsSync(filing)) continue;
      const f = JSON.parse(fs.readFileSync(filing, "utf8")) as {
        data?: { fromDonors?: { name: string }[] };
      };
      const canon = partyMap.get(`${election}#${partyNum}`) ?? null;
      const seenDonor = new Set<string>();
      for (const d of f.data?.fromDonors ?? []) {
        const p = parseName(d.name);
        if (!p) {
          skipped++;
          continue;
        }
        if (seenDonor.has(p.displayName)) continue; // one role per distinct donor
        seenDonor.add(p.displayName);
        out.push({
          id: `donor:${election}:${partyNum}:${p.displayName}`,
          source: "donor",
          ref: `${election}:${partyNum}:${p.displayName}`,
          role: "donor",
          ...fields(p, { cParty: canon }),
        });
      }
    }
  }

  // Winner resolution + the `ref` keys shared with the personSlug bake live in
  // ../parsers_local/localPersonRefs so the two walks cannot drift. See LocalMayorMention,
  // pickLocalWinner, mayorRef/councillorRef/kmetstvoRef/districtRef above the imports.
  // Local mayors & councillors (data/<cycle>/municipalities/<code>.json → the ELECTED
  // office holders: `mayor.elected`, each council party's `candidates[isElected]`, each
  // `kmetstva[]`'s elected village mayor (кмет на кметство) and each `districts[]`'s elected
  // район mayor). The canonical party (`primaryCanonicalId`) + obshtina are corroborants — so
  // a councillor re-elected across cycles merges, and a councillor who later became an MP
  // links by name. Only ELECTED winners are materialized (losing candidates get no page).
  // Regular (mi) and partial (chmi) cycles share this structure. `source='local'` is
  // public_default=true (081_person_identity.sql), so these people are servable /person pages.
  for (const file of globSync(
    path.join(REPO_ROOT, "data/*mi*/municipalities/*.json"),
  )) {
    const d = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cycle: string;
      obshtinaCode: string;
      obshtinaName: string | null;
      mayor?: {
        elected?: {
          candidateName?: string;
          primaryCanonicalId?: string | null;
        };
      };
      council?: {
        localPartyNum: number;
        primaryCanonicalId: string | null;
        candidates?: { listPos: number; name: string; isElected?: boolean }[];
      }[];
      // Village-mayor (кмет на кметство) and район-mayor contests. `elected` is the
      // resolved winner (CIK marks both runoff finalists elected in round 1, so prefer it);
      // fall back to the round-1 outright winner. `ekatte`/`districtCode` can be empty.
      kmetstva?: {
        kmetstvoName?: string;
        ekatte?: string;
        candidates?: LocalMayorMention[];
        round2?: LocalMayorMention[];
      }[];
      districts?: {
        districtName?: string;
        districtCode?: string;
        candidates?: LocalMayorMention[];
        round2?: LocalMayorMention[];
      }[];
    };
    const place = d.obshtinaName ?? d.obshtinaCode;
    // The council on a Sofia район shard is a replica of the city-wide СОС —
    // skip it (see councilShardReplicatesSofia). The район's own кмет stands.
    const councilIsReplica = councilShardReplicatesSofia(d.obshtinaCode);
    const mayor = d.mayor?.elected;
    if (mayor?.candidateName) {
      const ref = mayorRef(d.cycle, d.obshtinaCode);
      add(
        mayor.candidateName,
        { id: `local:${ref}`, source: "local", ref, role: "mayor" },
        {
          ...obshtinaPlaceFor(d.obshtinaCode),
          cParty: mayor.primaryCanonicalId ?? null,
          cPlace: place,
        },
      );
    }
    for (const party of councilIsReplica || !Array.isArray(d.council)
      ? []
      : d.council)
      for (const c of party.candidates ?? [])
        if (c.isElected && c.name) {
          const ref = councillorRef(
            d.cycle,
            d.obshtinaCode,
            party.localPartyNum,
            c.listPos,
          );
          add(
            c.name,
            { id: `local:${ref}`, source: "local", ref, role: "councillor" },
            {
              ...obshtinaPlaceFor(d.obshtinaCode),
              cParty: party.primaryCanonicalId ?? null,
              cPlace: place,
            },
          );
        }
    // Elected village mayors (кмет на кметство). `ekatte` is empty on every bundle row today
    // and `kmetstvoName` is NOT unique within a município (older cycles repeat it), so key the
    // mention/lock on the array index — unique within a frozen bundle and recomputed
    // identically by the Phase 2 personSlug decorate walk (same file, same order). Prefer
    // `ekatte` once a future ingest backfills it.
    (d.kmetstva ?? []).forEach((k, i) => {
      const el = pickLocalWinner(k.candidates, k.round2);
      if (!el?.candidateName) return;
      const ref = kmetstvoRef(d.cycle, d.obshtinaCode, k.ekatte, i);
      add(
        el.candidateName,
        { id: `local:${ref}`, source: "local", ref, role: "village_mayor" },
        {
          // The SETTLEMENT, not the община — see settlementPlaceFor. The `ref` deliberately
          // keeps its array index even when the ekatte is now known: changing it would churn
          // all 10,721 mentions and their slug locks for no gain, and the index-vs-name key
          // is what local_person_roles.data.test.ts pins.
          ...settlementPlace(d.obshtinaCode, k.kmetstvoName),
          cParty: el.primaryCanonicalId ?? null,
          cPlace: place,
        },
      );
    });
    // Directly-elected район mayors. SKIP the Sofia parent bundle (`SOF`): its 24 районни are
    // already materialized as role 'mayor' from the per-район `S2***` shards' `mayor.elected`,
    // so re-reading them here would double-count. Plovdiv/Varna районни have no per-район
    // shards, so they legitimately come from this bundle's districts[].
    if (!districtsAreShardedElsewhere(d.obshtinaCode))
      (d.districts ?? []).forEach((dist, i) => {
        const el = pickLocalWinner(dist.candidates, dist.round2);
        if (!el?.candidateName) return;
        const ref = districtRef(d.cycle, d.obshtinaCode, dist.districtCode, i);
        add(
          el.candidateName,
          { id: `local:${ref}`, source: "local", ref, role: "rayon_mayor" },
          {
            ...obshtinaPlaceFor(d.obshtinaCode),
            cParty: el.primaryCanonicalId ?? null,
            cPlace: place,
          },
        );
      });
  }

  // TR-officer BRIDGE (Bridge A, plan §3 "share a company"). For every EIK a person is
  // linked to, pull the TR officer/owner rows on that company and keep only those whose
  // name matches the linked person's (given, family) — that is the person's own
  // authoritative TR footprint. These mentions carry the EIK as a strong `uics`
  // corroborant, so they merge into the linked person (Tier 1 strong), patronymic-guarded.
  // We do NOT materialize a person per TR officer: a TR mention that fails to bridge
  // (patronymic conflict, or an unrelated same-EIK co-owner) forms a tr-only group that is
  // dropped in main(). ~1.5k rows on ~360 linked EIKs — bounded, not the 748k-officer set.
  const linkedEiks = [...eikExpected.keys()];
  if (linkedEiks.length) {
    const trRows = await allRows<{ uic: string; name: string; role: string }>(
      `SELECT uic, name, role FROM tr_person_roles WHERE uic = ANY($1::text[])`,
      [linkedEiks],
    );
    const seenTr = new Set<string>();
    for (const t of trRows) {
      const p = parseName(t.name);
      if (!p) continue;
      const key = `${p.given.toLowerCase()}\t${p.family.toLowerCase()}`;
      if (!eikExpected.get(t.uic)?.has(key)) continue; // only the linked person's name
      const dedup = `${t.uic}\t${key}\t${t.role}`;
      if (seenTr.has(dedup)) continue;
      seenTr.add(dedup);
      const src = trOrNgo(t.role); // NGO board seat → `ngo` facet, else company `tr`
      out.push({
        id: `${src}:${t.uic}:${p.displayName}:${t.role}`,
        source: src,
        ref: t.uic, // the company / ЮЛНЦ EIK
        role: t.role,
        ...fields(p, { uics: [t.uic] }),
      });
    }
  }

  if (skipped) console.log(`  skipped ${skipped} un-parseable name(s)`);
  return out;
}

// Fold the raw name parts and full names with the ONE normalizer (SQL), and look up
// the namesake company-count — one round trip each, keyed by the distinct strings.
async function foldAndScore(
  raw: Raw[],
): Promise<{ fold: Map<string, string>; namesake: Map<string, number> }> {
  const strs = new Set<string>();
  for (const r of raw) {
    strs.add(r.given);
    strs.add(r.family);
    strs.add(r.display);
    if (r.patr) strs.add(r.patr);
  }
  const foldRows = await allRows<{ s: string; f: string }>(
    `SELECT s, translit_bg_latin(s) AS f FROM unnest($1::text[]) AS s`,
    [[...strs]],
  );
  const fold = new Map(foldRows.map((r) => [r.s, r.f]));

  const fullFolds = [...new Set(raw.map((r) => fold.get(r.display)!))];
  const ncRows = await allRows<{ name_fold: string; company_count: string }>(
    `SELECT name_fold, company_count FROM officer_name_counts WHERE name_fold = ANY($1::text[])`,
    [fullFolds],
  );
  const namesake = new Map(
    ncRows.map((r) => [r.name_fold, Number(r.company_count)]),
  );
  return { fold, namesake };
}

type M = Mention & { raw: Raw; nameFold: string };

// The person-layer schema files, applied (idempotent CREATE … IF NOT EXISTS) before every
// resolve so `db:refresh` / a fresh clone can rebuild from an empty DB — nothing else wires
// these in. Order matters: core tables → election tables → serving fns → review queue.
// 085 (candidate_person / person_election_stats) MUST precede 082, because 082's person_search
// reads person_election_stats in a LATERAL and a LANGUAGE-sql body is validated at CREATE time
// — so on a fresh DB (a new clone or the first Cloud SQL deploy) applying 082 before the 085
// table exists fails with `relation "person_election_stats" does not exist`. The
// db:load:person-elections:pg loader re-applies 085 (idempotently) and fills the rows.
const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/schema/pg",
);
const SCHEMA_FILES = [
  "081_person_identity.sql",
  // The typed place columns (115). Sits between 081 (which creates person_role) and
  // 082, whose serving functions WILL read the new columns in plan T4 — a LANGUAGE sql
  // body is validated at CREATE time, so the wrong order would fail loudly then. The
  // ordering is locked in now so that step is a one-line change.
  "115_person_role_place.sql",
  // The judicial dimension (116). Applied — not merely read — so a cold bootstrap finds
  // EMPTY tables rather than missing ones, which lets the magistrate lookup below fail
  // loudly on a real error instead of being wrapped in a catch-all that cannot tell a
  // missing table from a broken query. db:load:judicial-bodies:pg fills them.
  "116_judicial_body.sql",
  // The canonical place dimension (117). Applied for the same reason as 116, and it MUST
  // precede 082, whose roles array now JOINs it for the mir/obshtina labels: a LANGUAGE
  // sql body is validated at CREATE time, so the wrong order fails loudly right here.
  // db:load:place-dim:pg fills it; an empty table only costs blank labels, never an error.
  "117_place_dim.sql",
  "085_person_elections.sql",
  "082_person_api.sql",
  "083_person_review.sql",
  "084_person_connections.sql",
  // Persistent slug locks (099) — NOT truncated by the rebuild; keeps /person URLs stable
  // across re-resolves. Applied here so the table exists before the locks are read below.
  "099_person_slug_lock.sql",
  // The dropped-duplicate subject aliases (101) registerIdByRef UNIONs into its gold-key
  // query. load_declarations_pg phase 1 also applies and fills it, but the resolver can
  // run against a DB where that has never happened (cold bootstrap), and the query must
  // not fail on a missing relation. CREATE TABLE IF NOT EXISTS, so applying it twice is
  // a no-op and an empty table simply contributes no aliases.
  "101_declaration_subject_alias.sql",
  // Retired-slug redirects (103). Written below from the PREVIOUS lock, so the table must
  // exist before the write; CREATE TABLE IF NOT EXISTS makes re-applying it a no-op.
  "103_person_slug_retired.sql",
  // The /officials/<slug> -> /person/<slug> lookup (106). Applied AFTER 103 because its
  // body references person_officials_sources() and person_slug_redirect(), and Postgres
  // validates a LANGUAGE sql body at CREATE time — a wrong order fails loudly, which is
  // the good outcome, but there is no reason to court it.
  "106_officials_redirect.sql",
];

// The skill /process-watch-report queues for the person layer. The marker file
// MUST be named for it — the orchestrator looks up state/ingest/<skill>.json,
// so a marker filed under any other name is a marker it never finds.
const INGEST_SKILL = "update-persons";

// Skip the marker and the changelog row. `db:resolve:persons:cloud` passes it:
// that run re-derives the layer on Cloud SQL, and the marker answers "when was
// the LOCAL layer last rebuilt" — letting a cloud-only publish advance it would
// make the orchestrator consider a stale local layer current. Also the escape
// hatch for a scratch run.
const skipStamp = process.argv.includes("--no-stamp");

async function main(): Promise<void> {
  console.log(
    "resolving persons (magistrate + officials + MPs + candidates + donors + local + tr-bridge)…",
  );
  for (const f of SCHEMA_FILES)
    await exec(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));
  const raw = await collect();
  const { fold, namesake } = await foldAndScore(raw);

  // §6 privacy gate: a person is public only if some source they hold defaults public
  // (person_source.public_default). All current sources are public, but tr/donor/ngo
  // (public_default=false) must NOT mint a public page for a private individual.
  const publicDefault = new Map(
    (
      await allRows<{ key: string; public_default: boolean }>(
        `SELECT key, public_default FROM person_source`,
      )
    ).map((r) => [r.key, r.public_default]),
  );

  // Human adjudication (plan §3 tier 4) — the audited person_link_override rows, applied as
  // the LAST tier below so a hand-decided merge/split always wins over the automatic result.
  // The schema is already applied above (SCHEMA_FILES), so the ref columns exist.
  const overrides = parseOverrides(
    await allRows<OverrideRow>(
      `SELECT kind, fold_a, fold_b, ref_a, ref_b FROM person_link_override`,
    ),
  );

  // GOLD-KEY ALIASING. A mention can carry TWO independent gold keys — the parliament MP
  // id and the Сметна палата register person id — and when both sit on the SAME mention
  // they name one identity by construction (that MP filed that declaration). Fold the two
  // key spaces into one canonical key here, so the rest of the resolver keeps its simple
  // single-hardId model: clusterBlock's Tier 0 and main()'s cross-block union then stitch
  // an MP to their declarations, and a register person to every slug the officials ingest
  // minted for them, without either tier learning about the second key space.
  const kp = new Map<string, string>();
  const kfind = (x: string): string => {
    const p = kp.get(x);
    if (p === undefined || p === x) return x;
    const r = kfind(p);
    kp.set(x, r);
    return r;
  };
  const kunion = (a: string, b: string): void => {
    const [ra, rb] = [kfind(a), kfind(b)];
    // Smallest key wins, so the canonical representative is deterministic across runs.
    if (ra !== rb) kp.set(ra > rb ? ra : rb, ra > rb ? rb : ra);
  };
  for (const r of raw) if (r.hardId && r.regId) kunion(r.hardId, r.regId);
  const regKeyed = raw.filter((r) => r.regId).length;
  const aliased = new Set(
    raw.flatMap((r) => (r.hardId && r.regId ? [kfind(r.hardId)] : [])),
  ).size;

  const mentions: M[] = raw.map((r) => ({
    id: r.id,
    source: r.source,
    hardId: ((k) => (k == null ? null : kfind(k)))(r.hardId ?? r.regId),
    givenFold: fold.get(r.given)!,
    familyFold: fold.get(r.family)!,
    patronymicFold: r.patr ? fold.get(r.patr)! : null,
    nameParts: r.nameParts,
    ambiguous: r.ambiguous,
    namesakeRisk: namesake.get(fold.get(r.display)!) ?? 0,
    nameFold: fold.get(r.display)!,
    corroborants: {
      party: r.cParty,
      place: r.cPlace,
      birthDate: r.cBirth,
      uics: r.uics,
      partyOffice: r.cPartyOffice,
      // DERIVED here rather than plumbed through every `add()` call: everything needed is
      // already on the row, so no source can forget to set it and none can set it
      // inconsistently. `localSeatKey` lives beside the ref BUILDERS (localPersonRefs.ts)
      // because which half of the row names the seat is a fact about the ref shapes — and
      // for кметства and райони the ref is NOT the answer. Local refs are
      // `<cycle>:<obshtinaCode>:…` by construction, which is what makes the cycle readable.
      localSeat:
        r.source === "local"
          ? localSeatKey(r.role, r.ref, r.placeKind, r.placeCode)
          : null,
      localCycle: r.source === "local" ? r.ref.split(":")[0] : null,
    },
    raw: r,
  }));

  // Block on (given_fold, family_fold); cluster each block.
  const blocks = new Map<string, M[]>();
  for (const m of mentions) {
    const k = `${m.givenFold}\t${m.familyFold}`;
    const arr = blocks.get(k) ?? blocks.set(k, []).get(k)!;
    arr.push(m);
  }

  type Group = { ids: string[]; confidence: "exact_id" | "high" | "manual" };
  const groups: Group[] = [];
  type Review = {
    blockKey: string;
    memberIds: string[];
    reason: "twopart_block" | "identical_fullname";
  };
  const reviews: Review[] = [];
  for (const [blockKey, block] of blocks) {
    const res = clusterBlock(block);
    const merged = new Set<string>();
    for (const mg of res.merges) {
      groups.push({ ids: mg.memberIds, confidence: mg.confidence });
      mg.memberIds.forEach((id) => merged.add(id));
    }
    for (const m of block)
      if (!merged.has(m.id)) groups.push({ ids: [m.id], confidence: "high" });
    for (const rc of res.reviewCandidates)
      reviews.push({ blockKey, memberIds: rc.memberIds, reason: rc.reason });
  }

  const byId = new Map(mentions.map((m) => [m.id, m]));

  // Global GOLD-KEY union (Tier 0, cross-block). A parliament MP id is the same person
  // under ANY name spelling, but blocking is on (given_fold, family_fold) — so a name
  // variant (marriage, transliteration) can scatter one MP's candidacies across blocks.
  // Merge any groups that share a hardId, regardless of block; a shared gold key ⇒
  // exact_id. (Within-block same-hardId mentions already merged in clusterBlock; this
  // only stitches the cross-block remainder.)
  const gp = groups.map((_, i) => i);
  const gfind = (x: number): number =>
    gp[x] === x ? x : (gp[x] = gfind(gp[x]));
  const firstByHard = new Map<string, number>();
  groups.forEach((g, i) => {
    const hard = new Set<string>();
    for (const id of g.ids) {
      const h = byId.get(id)!.hardId;
      if (h) hard.add(h);
    }
    for (const h of hard) {
      const seen = firstByHard.get(h);
      if (seen === undefined) firstByHard.set(h, i);
      else {
        const a = gfind(seen);
        const b = gfind(i);
        if (a !== b) gp[a] = b;
      }
    }
  });
  const unionComps = new Map<number, string[]>();
  groups.forEach((g, i) => {
    const r = gfind(i);
    (unionComps.get(r) ?? unionComps.set(r, []).get(r)!).push(...g.ids);
  });
  const mergedGroups: Group[] = [...unionComps.values()].map((ids) => {
    // exact_id iff a gold key is shared by >=2 members of the final group.
    const hs = ids
      .map((id) => byId.get(id)!.hardId)
      .filter((h): h is string => h != null);
    return {
      ids,
      confidence: new Set(hs).size < hs.length ? "exact_id" : "high",
    };
  });

  // TIER 4 — human overrides (plan §3), applied LAST so a hand-decided merge/split always
  // wins: a fold-level merge unions two persons the automatic tiers left in different blocks,
  // a fold-level split peels apart a wrong cross-block union, and a ref-level split ISOLATES
  // one mention — vetoing even a Tier-0 gold union, the mis-merge a name fold is too coarse
  // to target (a CIK candidacy bound by matchMp() to the wrong same-name MP). A no-override
  // corpus returns mergedGroups untouched.
  const ovMentions = mentions.map((m) => ({
    id: m.id,
    source: m.source,
    ref: m.raw.ref,
    hardId: m.hardId ?? null,
    nameFold: m.nameFold,
  }));
  const overriddenGroups = applyOverrides(mergedGroups, ovMentions, overrides);

  // Persisted slug locks (099): mention id -> the slug last assigned to the person that
  // mention belonged to. Lets a name-hash person keep their /person URL across re-resolves
  // even as their cluster drifts. Empty on the first run — then every slug is the derived
  // one and the lock is simply seeded, so nothing changes.
  let retiredSlugCount = 0;
  const slugLocks = new Map<string, { slug: string; firstSeen: number }>();
  for (const r of await allRows<{
    mention_id: string;
    slug: string;
    first_seen: string;
  }>("SELECT mention_id, slug, first_seen FROM person_slug_lock")) {
    slugLocks.set(r.mention_id, {
      slug: r.slug,
      firstSeen: new Date(r.first_seen).getTime(),
    });
  }

  // Build person rows with deterministic slugs, then sort by slug and assign ids so a
  // rebuild is stable.
  type Built = {
    slug: string;
    display: string;
    given: string;
    patr: string | null;
    family: string;
    nameParts: number;
    namesake: number;
    confidence: "exact_id" | "high" | "manual";
    isPublic: boolean;
    members: M[];
  };
  const built: Built[] = overriddenGroups
    // Drop bridge-only groups: a TR/NGO officer that failed to bridge to a real person (a
    // same-EIK co-owner, or a patronymic conflict) is NOT materialized (plan §3 bounded
    // universe). Both `tr` and `ngo` are bridge sources — never a standalone person.
    .filter((g) =>
      g.ids.some((id) => {
        const s = byId.get(id)!.source;
        return s !== "tr" && s !== "ngo";
      }),
    )
    .map((g) => {
      const members = g.ids.map((id) => byId.get(id)!);
      // Slug priority: the mp id gold key (stable, /candidate/mp-{id} lineage) > an
      // official's existing slug > a derived name+hash. Deterministic across runs.
      const mpMember = members
        .filter((m) => m.source === "mp")
        .sort((a, b) => Number(a.raw.ref) - Number(b.raw.ref))[0];
      const officialMember = members
        .filter((m) => isOfficialSource(m.source))
        .sort((a, b) => a.raw.ref.localeCompare(b.raw.ref))[0];
      const key = members[0];
      const best = members
        .map((m) => m.raw)
        .sort(
          (a, b) =>
            b.nameParts - a.nameParts || b.display.length - a.display.length,
        )[0];
      // MP / official slugs are stable by construction. The name-hash tier is not: its hash
      // is over the exact member set, so any cluster drift reassigns it. Anchor it to a
      // persisted lock instead — reuse the slug of the person's OLDEST previously-seen member
      // (the "founding" anchor), so the URL survives cluster drift; the derived hash is only
      // the fallback for a wholly new person. chooseStableSlug (unit-tested in slugLock.ts)
      // holds the rule, incl. the first_seen-tie tiebreak that keeps the choice deterministic.
      const naturalSlug = mpMember
        ? `mp-${mpMember.raw.ref}`
        : officialMember
          ? officialMember.raw.ref
          : `${kebab(`${key.givenFold}-${key.familyFold}`)}-${hash6(
              g.ids.slice().sort().join("|"),
            )}`;
      const slug = chooseStableSlug(
        naturalSlug,
        Boolean(mpMember || officialMember),
        g.ids,
        slugLocks,
      );
      return {
        slug,
        display: best.display,
        given: key.givenFold,
        patr: members.find((m) => m.patronymicFold)?.patronymicFold ?? null,
        family: key.familyFold,
        nameParts: members.some((m) => m.nameParts === 3) ? 3 : 2,
        namesake: Math.max(...members.map((m) => m.namesakeRisk)),
        confidence: g.confidence,
        isPublic: members.some((m) => publicDefault.get(m.source) ?? false),
        members,
      };
    });

  // Guarantee slug uniqueness (belt-and-suspenders — a magistrate slug could in theory
  // collide with an official slug).
  const seen = new Set<string>();
  for (const b of built) {
    let s = b.slug;
    let i = 2;
    while (seen.has(s)) s = `${b.slug}-${i++}`;
    b.slug = s;
    seen.add(s);
  }
  built.sort((a, b) => a.slug.localeCompare(b.slug));

  // Persist the slug locks so the NEXT re-resolve keeps every person's slug. Upsert each
  // member mention -> its person's final slug; first_seen is kept on conflict (never moved
  // forward), so the anchor a person is pinned to stays the oldest. person_slug_lock is not
  // truncated, so this accumulates. On a first run this simply records the current slugs.
  const lockIds: string[] = [];
  const lockSlugs: string[] = [];
  for (const b of built)
    for (const m of b.members) {
      lockIds.push(m.id);
      lockSlugs.push(b.slug);
    }
  // Retired slugs (103), computed BEFORE the upsert below overwrites the lock. `slugLocks`
  // still holds each mention's PREVIOUS slug, and `built` has its new one, so a slug that
  // some mention used to serve and that no live person now carries is retired — and the
  // person those mentions belong to today is where it should redirect.
  //
  // Recomputed in full from the whole lock every run, not just for mentions that moved this
  // time.
  //
  // ⚠️ That is NOT by itself enough to keep a chain (A merged into B, later B into C)
  // pointing at C. The lock is destructively overwritten each run, so this diff only ever
  // knows the pairs it just computed — an older row still saying A→B is never revisited, and
  // becomes a 301 into a 404 the moment B is retired. collapseSlugRedirectChainsVerbose(),
  // called after the person rebuild further down, is what flattens those.
  //
  // Only mentions still present in `built` are considered, so a slug whose members have ALL
  // left the person universe (an official dropped from the roster entirely) is not retired
  // here — there is no person left to redirect it to, and inventing one would be worse than
  // the 404. The lock keeps such rows indefinitely, so they are visible if that ever needs
  // handling.
  const liveSlugs = new Set(built.map((b) => b.slug));
  const retired = new Map<string, string>();
  for (const b of built)
    for (const m of b.members) {
      const prev = slugLocks.get(m.id)?.slug;
      if (prev && prev !== b.slug && !liveSlugs.has(prev))
        retired.set(prev, b.slug);
    }

  // ORPHANED LOCK ROWS — the gap this diff structurally cannot see, reported rather than
  // ignored. The loop above only visits mentions present in `built`, and an officials
  // mention id IS `official:<slug>`: when the officials ingest re-slugs a declarant, the
  // OLD lock row is not diffed, it is orphaned — a new row appears under the new mention
  // id and the old one is never revisited again. That silently stranded 20,057 dead
  // /person slugs with no redirect until a review found them (T1.4a).
  //
  // The pairing cannot be recovered here: at this point the old mention does not exist,
  // and nothing in declaration / declaration_subject_alias / person_role remembers the old
  // ref (measured: 0 of 20,057). The thing that knows both sides is whatever renamed the
  // shards — migrate_slug_normalisation.ts --redirects — and
  // scripts/person/load_slug_redirects.ts loads that map. So: count them, name the fix,
  // and never let the number sit at "unknown" again. The probe itself sits AFTER the write
  // below — see the comment there for why its position is load-bearing.
  //
  // The `live` CTE is not cosmetic either: `l.slug <> ALL($1)` over a 58k array rescans
  // that array for each of the 132k lock rows (measured 10.3 s, on every resolve, purely
  // to emit a warning). As a hash anti-join it is 55 ms.
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO person_slug_lock (mention_id, slug)
         SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (mention_id) DO UPDATE SET slug = EXCLUDED.slug`,
      [lockIds, lockSlugs],
    );
    if (retired.size)
      await c.query(
        `INSERT INTO person_slug_retired (slug, target_slug)
           SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (slug) DO UPDATE SET target_slug = EXCLUDED.target_slug`,
        [[...retired.keys()], [...retired.values()]],
      );
    // A slug that came BACK (a merge undone by a split override) must stop redirecting,
    // or a live person 301s to whoever absorbed them.
    await c.query(
      `DELETE FROM person_slug_retired r
        WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) s WHERE s = r.slug)`,
      [[...liveSlugs]],
    );
  });
  if (retired.size) retiredSlugCount = retired.size;

  // RUN THE PROBE AFTER THE WRITE ABOVE, NOT BEFORE IT. Both clauses depend on it:
  //
  //   - `person_slug_retired` must already hold THIS run's retirements, or every slug the
  //     run just redirected is reported as having no redirect. That is not a small skew —
  //     on the §A3 continuity merge it made the two counters read "624 slug(s) retired to a
  //     redirect; 624 dead slug(s) with no redirect" off one set of 624, when the true
  //     orphan count was 0, and pointed the operator at a --redirects rebuild that is both
  //     unnecessary and wrong for those slugs. A loud false alarm on the exact runs that
  //     retire the most slugs is worse than no alarm: it trains the reader to skip the line.
  //   - `person_slug_lock` must already be upserted, which is what makes the remaining rows
  //     EXACTLY the orphans. Every mention in `built` has just had its row rewritten to a
  //     live slug; a row still naming a dead one is therefore a mention that no longer
  //     exists — precisely the population this warning is about, rather than a superset of
  //     it that happens to include the healthy ones.
  //
  // Liveness still comes from `liveSlugs`, NOT from `person`: the person table is not
  // rebuilt until the transaction ~150 lines below, so it would still answer from the
  // PREVIOUS run's rows and mask a fresh orphan behind its own stale row, reporting it a
  // run late — i.e. never on the run an operator is watching.
  // `person_slug_retired.data.test.ts` asks the same question against `person`, correctly:
  // by the time it runs, the rebuild has happened.
  const orphanedDeadSlugs = await allRows<{ slug: string }>(
    `WITH live(slug) AS (SELECT unnest($1::text[]))
     SELECT DISTINCT l.slug
       FROM person_slug_lock l
      WHERE NOT EXISTS (SELECT 1 FROM live s WHERE s.slug = l.slug)
        AND NOT EXISTS (SELECT 1 FROM person_slug_retired r WHERE r.slug = l.slug)`,
    [[...liveSlugs]],
  );
  if (orphanedDeadSlugs.length) {
    console.warn(
      `  ⚠ ${orphanedDeadSlugs.length} /person slug(s) are dead with no redirect — their ` +
        `mention id no longer exists, so the lock diff cannot pair them ` +
        `(e.g. ${orphanedDeadSlugs
          .slice(0, 3)
          .map((r) => r.slug)
          .join(
            ", ",
          )}). If an officials re-slug caused this, rebuild the map with ` +
        `migrate_slug_normalisation.ts --redirects and load it with ` +
        `\`npm run person:slug-redirects -- <map.json>\` BEFORE /person is prerendered.`,
    );
  }

  const personRows: unknown[][] = [];
  const roleRows: unknown[][] = [];
  const aliasRows: unknown[][] = [];
  const aliasSeen = new Set<string>();
  const mentionToPid = new Map<string, number>(); // mention id -> its person's pid

  // WHICH local elections happened, and which seats each by-election contested — built once
  // from every local mention in the run, because a mandate's end is a fact about the NEXT
  // election rather than about the row itself. Whole-corpus by construction: a person whose
  // own rows stop in 2019 is still ended by the 2023 general election somebody else's row
  // records.
  const localTermIndex = buildLocalTermIndex(
    built.flatMap((b) =>
      b.members
        .filter((m) => m.source === "local" && m.corroborants.localCycle)
        .map((m) => ({
          cycle: m.corroborants.localCycle!,
          seat: m.corroborants.localSeat ?? null,
        })),
    ),
  );

  built.forEach((b, idx) => {
    const pid = idx + 1;
    for (const m of b.members) mentionToPid.set(m.id, pid);
    personRows.push([
      pid,
      b.display,
      b.given,
      b.patr,
      b.family,
      b.nameParts,
      b.slug,
      b.isPublic, // §6 privacy gate — derived from person_source.public_default
      b.namesake,
      "active",
    ]);
    for (const m of b.members) {
      // T3: an `mp` mention expands to ONE ROW PER PARLIAMENT they sat in
      // (`ref = '<mpId>:<ns>'`), every other source stays 1:1. The place is
      // REPLICATED across an MP's rows — index.json carries a single
      // `seatedRegion` per person with no per-NS variant, so a member who
      // changed МИР between parliaments gets their latest one on every row.
      // That is a known inaccuracy, chosen over leaving historical rows
      // place-less because it keeps `person_role_place`'s 100%-fill invariant
      // and every `?oblast=` consumer working; `person_role_place.data.test.ts`
      // states it so the gate cannot be read as proving more than it does.
      //
      // A `local` mention is dated from the cycle already in its own ref (T1 of
      // person-enrichment-v1): start = that election, end = the next regular cycle or the
      // next by-election for the SAME seat, whichever is sooner. No new source — see
      // localTerms.ts for why a partial must not end anything but its own seat.
      const localBounds =
        m.source === "local"
          ? localTermBounds(
              m.corroborants.localCycle ?? "",
              m.corroborants.localSeat ?? null,
              localTermIndex,
            )
          : null;
      const expanded: MpRoleRow[] =
        m.source === "mp"
          ? mpRoleRowsFor(m.raw.ref)
          : [
              {
                ref: m.raw.ref,
                party: m.raw.cParty,
                startDate: localBounds?.start ?? null,
                endDate: localBounds?.end ?? null,
              },
            ];
      for (const row of expanded) {
        roleRows.push([
          pid,
          m.source,
          row.ref,
          m.raw.role,
          // The CANONICAL party id behind this role. Candidacies, local mandates,
          // donations and a party officer's institution all speak that namespace
          // already, so they pass `cParty` straight through.
          //
          // `mp` is the exception, and the reason it USED to be NULL: its
          // corroborant (`cParty` at the mention, from index.json's
          // `currentPartyGroupShort`) is a parliamentary-GROUP short name, not a
          // party id, and mixing the two vocabularies in one column would make
          // them look comparable. mp-party-affiliation-v1 removes that objection
          // by translating instead of dropping — `mpPartyForRef` folds the group
          // to a canonical id through the same table the browser uses.
          //
          // TRANSLATED HERE, AT THE WRITE — never where the MP mention sets
          // `cParty: mp.currentPartyGroupShort` (§8c). `cParty` feeds
          // `corroborants.party`, which `cluster.ts` uses for the weak (party AND
          // place) merge signal. Today an MP's raw Cyrillic short can never equal
          // a candidacy's canonical id, so that corroborant is inert between the
          // two sources; folding it to a canonical id at the MENTION would
          // silently switch it ON and start merging PEOPLE as a side effect of a
          // display fix. Gate 5.9 (`person_identity_stability.data.test.ts`)
          // proves the active-person count and the name-fold fragmentation are
          // unmoved. (Referred to by what the code DOES, not by line number —
          // the MP `cParty` assignment has already moved once.)
          row.party,
          m.raw.placeKind,
          m.raw.placeCode,
          m.raw.placeRaw,
          row.startDate,
          row.endDate,
          // WHAT the two dates above measure (081 person_role.date_basis). Written HERE,
          // by the writer that produces the dates, and not left to 081's backfill: this
          // rebuild DELETEs person_role and re-COPYs it, so a basis that only ever came
          // from the backfill would be dropped on every resolve — and because the renderer
          // shows nothing without a basis, the dates would silently stop appearing rather
          // than fail. The 081 backfill stays, for warm databases between resolves.
          //
          // 'term' only where an mp mandate actually filled the columns. A later source
          // that fills a date without declaring what it measures stays visibly NULL rather
          // than being relabelled a mandate.
          m.source === "mp" && (row.startDate || row.endDate)
            ? "term"
            : m.source === "local" && (row.startDate || row.endDate)
              ? "election"
              : null,
          b.confidence,
          m.raw.sourceRow == null ? null : JSON.stringify(m.raw.sourceRow),
        ]);
      }
      const ak = `${pid}\t${m.raw.display}\t${m.source}`;
      if (!aliasSeen.has(ak)) {
        aliasSeen.add(ak);
        aliasRows.push([pid, m.raw.display, m.source]);
      }
    }
  });

  // ── MP party preflight (T2) ───────────────────────────────────────────────
  // Both checks run BEFORE the transaction, so a bad build refuses rather than
  // publishing a degraded column.
  if (mpPartyUnmapped.length) {
    throw new Error(
      `mp party: ${mpPartyUnmapped.length} unmapped parliamentary group short(s) — ` +
        `add them to PARLIAMENT_GROUP_ALIASES or PARLIAMENT_GROUP_SENTINELS ` +
        `(src/data/parties/parliamentGroupAliases.ts). Writing NULL instead would be ` +
        `indistinguishable from the 1,559 roles that legitimately have no group:\n  ` +
        [...new Set(mpPartyUnmapped)].join("\n  "),
    );
  }
  const mpRolesWithParty = roleRows.filter(
    (r) => r[1] === "mp" && r[4] != null,
  ).length;
  // Floor, not equality — a new session file legitimately raises it. Measured
  // 1,522 after T3 (one row per seat; it was 563 while the shape was still
  // career-scalar). A collapse to zero is the shape a missing data/parliament
  // corpus takes, and mpSeats.ts only warns about that.
  //
  // RE-BASELINE THIS WITH THE SHAPE. Leaving it at T2's 563 would have tolerated
  // losing 63% of the party corpus — the exact partial collapse the next
  // paragraph argues a preflight exists to stop. It is deliberately the same
  // number as gate 5.1: a preflight below its own gate lets bad data publish and
  // leaves the gate to find it afterwards.
  const MP_PARTY_FLOOR = 1_400;
  if (
    roleRows.some((r) => r[1] === "mp") &&
    mpRolesWithParty < MP_PARTY_FLOOR
  ) {
    throw new Error(
      `mp party: only ${mpRolesWithParty} mp role(s) resolved a group, expected >= ${MP_PARTY_FLOOR} ` +
        `— check data/parliament/index.json (nsFolders) and data/parliament/votes/sessions/`,
    );
  }
  console.log(
    `  mp party: ${mpRolesWithParty} of ${roleRows.filter((r) => r[1] === "mp").length} mp role(s) carry a parliamentary group`,
  );

  // Persist the review queue (plan §3 tier 3, aggressive-merge holding area). Map each
  // ambiguous group's mentions to the persons they landed in; a group is real only if it
  // spans >=2 DISTINCT persons (mentions that actually merged, or dropped tr mentions,
  // aren't ambiguous). group_key is a deterministic hash of the sorted member slugs, so a
  // re-run addresses the same group. NOTHING is merged here — each person stays active.
  const reviewRows: unknown[][] = [];
  const reviewSeen = new Set<string>();
  const reviewGroups = new Set<string>();
  for (const rc of reviews) {
    const pids = [
      ...new Set(
        rc.memberIds
          .map((id) => mentionToPid.get(id))
          .filter((p): p is number => p !== undefined),
      ),
    ];
    if (pids.length < 2) continue;
    const slugs = pids.map((p) => built[p - 1].slug).sort();
    const groupKey = `${kebab(rc.blockKey.replace("\t", "-"))}-${hash6(slugs.join("|"))}`;
    const namesake = Math.max(...pids.map((p) => built[p - 1].namesake));
    reviewGroups.add(groupKey);
    for (const p of pids) {
      const rk = `${groupKey}\t${p}`;
      if (reviewSeen.has(rk)) continue;
      reviewSeen.add(rk);
      reviewRows.push([groupKey, p, rc.blockKey, namesake, rc.reason]);
    }
  }

  let bridgeBRoles = 0;
  let tierVPersons = 0;
  let aliasesInserted = 0;
  await withTx(async (c) => {
    // Rebuild only the derived tables. DELETE, not TRUNCATE … CASCADE: five tables carry
    // an FK to person and they do NOT want the same treatment. person_role / person_alias
    // / person_review_candidate / person_link_evidence are ON DELETE CASCADE — derived,
    // rebuilt below. But `declaration` is ON DELETE SET NULL on purpose: the filings are
    // an INGESTED corpus that outlives any one resolve, and phase 2 of
    // load_declarations_pg re-attaches person_id afterwards. TRUNCATE ignores per-FK
    // delete actions and truncates every referencing table outright, so it wiped the whole
    // declaration tree (declaration + its four ON DELETE CASCADE children) on every run —
    // silently, because phase 2 then reports "filled 0; 0/0 still NULL" and the wealth
    // matview refreshes to 0 rows, both of which read like success. DELETE honours SET
    // NULL. person_link_override is human-authored (fold-keyed, no FK) and survives either
    // way. The person_id sequence is re-set by the setval at the end of this tx.
    await c.query(`DELETE FROM person`);
    await copyRows(
      c,
      "person",
      [
        "person_id",
        "display_name",
        "given_fold",
        "patronymic_fold",
        "family_fold",
        "name_parts",
        "slug",
        "is_public_figure",
        "namesake_risk",
        "status",
      ],
      personRows,
    );
    await copyRows(
      c,
      "person_role",
      [
        "person_id",
        "source",
        "ref",
        "role",
        "party",
        "place_kind",
        "place_code",
        "place_raw",
        "start_date",
        "end_date",
        "date_basis",
        "confidence",
        "source_row",
      ],
      roleRows,
    );
    // person_alias is keyed on (person_id, alias_fold, source) where alias_fold
    // is GENERATED from translit_bg_latin(alias_raw). One person can hold
    // several officials slugs — slugify() folds in the institution, so a
    // minister who moves ministries gets one slug per posting — and the
    // ten-year officials backfill made that ordinary rather than rare. Those
    // rows carry the same name for the same person and source, so they collide
    // on the fold. Dedupe through a staging table using the same PG function
    // rather than approximating the transliteration in JS.
    await c.query(
      `CREATE TEMP TABLE tmp_person_alias (
         person_id bigint NOT NULL,
         alias_raw text   NOT NULL,
         source    text   NOT NULL
       ) ON COMMIT DROP`,
    );
    await copyRows(
      c,
      "tmp_person_alias",
      ["person_id", "alias_raw", "source"],
      aliasRows,
    );
    const aliasIns = await c.query(
      `INSERT INTO person_alias (person_id, alias_raw, source)
       SELECT DISTINCT ON (person_id, translit_bg_latin(alias_raw), source)
              person_id, alias_raw, source
         FROM tmp_person_alias
        ORDER BY person_id, translit_bg_latin(alias_raw), source, alias_raw`,
    );
    aliasesInserted = aliasIns.rowCount ?? 0;
    await copyRows(
      c,
      "person_review_candidate",
      ["group_key", "person_id", "block_key", "namesake_risk", "reason"],
      reviewRows,
    );

    // Bridge B (name-based TR discovery). A public person with a globally-unique 3-part
    // name whose full-name fold matches a TR officer/owner is unambiguously that person —
    // Tier-2 (unique fold), name-independent of any block co-collision. Discovers the TR
    // footprint BEYOND Bridge A's curated links. Attaches the person's WHOLE small footprint
    // (all companies under the fold), not just a single-company name:
    //   • the fold maps to exactly ONE known person (NOT EXISTS a second person on it) — a
    //     direct people-uniqueness guard that supersedes the old namesake_risk<=1 proxy
    //     (officer_name_counts.company_count), which conflated one person's multiple companies
    //     with distinct namesakes and so capped a real footprint at a single company; and
    //   • that footprint is ≤ FOOTPRINT_CAP companies — small enough that a globally-unique
    //     3-part name across a handful of firms is that one person, not colliding owners.
    // The residual risk (a 3-part name shared with an unrelated private owner) is bounded by
    // the cap and carried by the name-match caveat shown on the person page. Runs in SQL (the
    // folds live in PG); ON CONFLICT dedups against Bridge-A rows on the same (person, company,
    // role).
    // Narrow to eligible persons FIRST (people-unique public 3-part folds — ~14k), THEN cap
    // the footprint per fold via the idx_tr_person_roles_fold index. Counting distinct uics
    // over the whole 1.2M-row table before filtering is a table-scan; this is index-driven.
    const FOOTPRINT_CAP = 5;
    const bridgeB = await c.query(
      `WITH elig AS (
         SELECT p.person_id, p.name_fold
           FROM person p
          WHERE p.name_parts = 3 AND p.is_public_figure
            AND NOT EXISTS (
              SELECT 1 FROM person p2
               WHERE p2.name_fold = p.name_fold AND p2.person_id <> p.person_id)
       ),
       capped AS (
         SELECT e.person_id, e.name_fold FROM elig e
          WHERE (SELECT count(DISTINCT t.uic) FROM tr_person_roles t
                  WHERE t.name_fold = e.name_fold) BETWEEN 1 AND $1
       )
       INSERT INTO person_role (person_id, source, ref, role, confidence)
       SELECT DISTINCT c.person_id,
              CASE WHEN t.role IN ('ngo_board','ngo_representative') THEN 'ngo' ELSE 'tr' END,
              t.uic, t.role, 'high'
         FROM capped c
         JOIN tr_person_roles t ON t.name_fold = c.name_fold
       ON CONFLICT (person_id, source, ref, role) DO NOTHING`,
      [FOOTPRINT_CAP],
    );
    bridgeBRoles = bridgeB.rowCount ?? 0;

    await c.query(
      `SELECT setval(pg_get_serial_sequence('person','person_id'), (SELECT COALESCE(max(person_id),1) FROM person))`,
    );

    // ── TIER-V: money-linked private owners (S4) ────────────────────────────────────────────
    // Mint a person for each VERIFIED name-fold private owner — a person-shaped (exactly 3
    // all-letter folded tokens, no company legal-form word), ≤5-firm, money-linked (contracts ∪
    // subsidies ∪ funds) Commerce-Registry owner whose fold is NOT already a person. These are
    // ADDITIVE and PRIVATE: is_public_figure stays FALSE (never a public /person page by default)
    // and identity_confidence='verified' (a strong but NAME-only identity). Runs AFTER the public
    // COPY + setval, so the sequence assigns fresh ids and the public set is byte-identical — the
    // reconciliation summary below still counts only the public personRows. The 3-token/no-suffix
    // gate is the SAME one 120's name-fold browse arm uses; the ≤5-firm cap is Bridge B's
    // FOOTPRINT_CAP (a fold shared by several owners sums past 5 and is excluded, so this is a
    // one-owner-per-fold proxy). Consumers: 120 places them in the tier-V частен-сектор slice via
    // is_public_figure=false; 082 serves them on /person via the identity_confidence='verified'
    // gate; person_search folds them into its V (money) tier by real slug.
    await c.query(
      `CREATE TEMP TABLE tmp_tierv (name_fold text PRIMARY KEY, name text) ON COMMIT DROP`,
    );
    await c.query(
      `INSERT INTO tmp_tierv (name_fold, name)
       WITH money_eik AS (
         SELECT eik, sum(eur) AS eur FROM (
           SELECT contractor_eik AS eik, amount_eur AS eur FROM contracts
            WHERE contractor_eik <> '' AND tag='contract' AND consortium_role IS DISTINCT FROM 'member'
           UNION ALL SELECT eik, total_eur FROM agri_subsidies     WHERE eik IS NOT NULL
           UNION ALL SELECT eik, paid_eur  FROM fund_beneficiaries WHERE eik IS NOT NULL
         ) x WHERE eur IS NOT NULL GROUP BY eik
       )
       -- LEFT JOIN + bool_or(money): the fold must be money-linked, but the ≤5 cap is on TOTAL
       -- firms (matching 120's browse companies_n ≤ 5 = the verified subset), NOT just the
       -- money-linked ones — a person with 3 money firms and 20 dormant ones is not "verified".
       SELECT o.name_fold, min(o.name)
         FROM tr_officers o
         LEFT JOIN money_eik m ON m.eik = o.uic
        WHERE o.name_fold NOT IN (SELECT name_fold FROM person WHERE name_fold IS NOT NULL)
          AND o.name_fold ~ '^[a-z]+ [a-z]+ [a-z]+$'
          AND o.name_fold !~ '(^| )(eood|ood|ad|ead|et|dzzd|kd|sd|zad|ndp|zzd)( |$)'
        GROUP BY o.name_fold
       HAVING bool_or(m.eik IS NOT NULL) AND count(DISTINCT o.uic) <= 5`,
    );
    const tierVIns = await c.query(
      `INSERT INTO person (display_name, given_fold, patronymic_fold, family_fold,
                           name_parts, slug, is_public_figure, namesake_risk, status,
                           identity_confidence)
       SELECT name,
              split_part(name_fold,' ',1), split_part(name_fold,' ',2), split_part(name_fold,' ',3),
              3,
              replace(name_fold,' ','-') || '-' || substr(md5(name_fold),1,6),
              false, 0, 'active', 'verified'
         FROM tmp_tierv
       -- DEFEND THE SLUG. The slug shape (kebab(fold)+'-'+md5[:6]) is the SAME family as
       -- officialSlug()/the public name-hash path, and NOT IN person guards the FOLD, not the
       -- SLUG — a Tier-V fold genuinely absent from person can still land on an existing public/
       -- official slug (different transliterator + a 6-hex coincidence, birthday-style over ~53k
       -- mints). person.slug is UNIQUE, so without this ONE collision aborts the whole multi-hour
       -- rebuild. DO NOTHING skips just that fold (it stays a name-fold browse row); the role
       -- INSERT below joins on name_fold + identity_confidence='verified', so a skipped fold gets
       -- no person and therefore no orphan role.
       ON CONFLICT (slug) DO NOTHING`,
    );
    tierVPersons = tierVIns.rowCount ?? 0;
    // Attach every company of each minted owner. Joined back through the shared fold; confidence
    // 'high' so 120's roles CTE (confidence IN exact_id/high/manual) surfaces them. tr_person_roles
    // is the full-history officer/owner table (same fold as tr_officers).
    await c.query(
      `INSERT INTO person_role (person_id, source, ref, role, confidence)
       SELECT DISTINCT p.person_id, 'tr', t.uic, t.role, 'high'
         FROM person p
         JOIN tmp_tierv v ON v.name_fold = p.name_fold
         JOIN tr_person_roles t ON t.name_fold = v.name_fold
        WHERE p.identity_confidence = 'verified'
       ON CONFLICT (person_id, source, ref, role) DO NOTHING`,
    );
    // Re-anchor the sequence past the just-minted ids.
    await c.query(
      `SELECT setval(pg_get_serial_sequence('person','person_id'), (SELECT COALESCE(max(person_id),1) FROM person))`,
    );
  });

  // Refresh planner statistics on the just-rebuilt tables. A TRUNCATE+COPY leaves stats
  // stale until autovacuum's autoanalyze catches up (minutes to hours later on Cloud SQL),
  // and in that window person-serving queries pick bad plans — person_connections ran at
  // ~2.5s instead of ~0.25s on a freshly re-resolved prod DB. ANALYZE here so the layer is
  // fast the moment the rebuild finishes.
  await exec("ANALYZE person");
  await exec("ANALYZE person_role");
  await exec("ANALYZE person_alias");

  // Collapse redirect chains — AFTER the rebuild above, never before it.
  //
  // A retirement this run produced can land on a slug an EARLIER run already
  // pointed somebody at (A→B written then, B→C now), leaving that older row as a
  // 301 into a 404. The lock diff cannot see it: it only knows the pairs it just
  // computed. So the sweep has to run against the whole table.
  //
  // ⚠️ Placement is load-bearing. This reads `person` to decide what is live, and
  // `person` is not rebuilt until the transaction above commits — the same trap
  // this file documents for the orphaned-dead-slug warning. Called any earlier it
  // sees the PREVIOUS run's people and reports "0 re-pointed" while the gate
  // fails; measured exactly that way before it was moved here.
  await collapseSlugRedirectChainsVerbose();

  // NB: do NOT refresh declaration_stake_company (096) or person_cohort_wealth (097) here.
  // This run's `DELETE FROM person` nulls declaration.person_id table-wide (ON DELETE SET
  // NULL), and both matviews depend on that column (096 directly, 097 via person_wealth_year)
  // — so a refresh at THIS point rebuilds them from all-NULL joins to EMPTY. They are
  // correctly (re)built by the separate `load_declarations_pg --resolve` step, the only one
  // that re-attaches declaration.person_id. See docs/plans/persons-audit-gaps-v1.md (B1/B2).

  const ovCount =
    overrides.merges.length +
    overrides.foldSplits.length +
    overrides.refSplits.size;
  const summary =
    `${personRows.length} persons, ${roleRows.length} roles (+${bridgeBRoles} tr bridge-B), ` +
    `+${tierVPersons} tier-V private owners minted; ` +
    `${regKeyed} mention(s) keyed by the register person id (${aliased} aliased to an MP id); ` +
    `${aliasesInserted} aliases (${aliasRows.length - aliasesInserted} dup folds collapsed); ` +
    `${reviewGroups.size} review group(s) over ${reviewRows.length} person(s); ` +
    `${retiredSlugCount} slug(s) retired to a redirect; ` +
    // Always printed, including the healthy 0 — the number this guard exists to surface
    // must not be indistinguishable from "not measured" when it is fine.
    `${orphanedDeadSlugs.length} dead slug(s) with no redirect; ` +
    `${ovCount} human override(s) applied ` +
    `(${overrides.merges.length} merge, ${overrides.foldSplits.length} fold-split, ${overrides.refSplits.size} ref-split)`;
  console.log(`  ${summary}`);

  // Stamp the marker /process-watch-report compares against, from the run
  // itself rather than from a step an operator has to remember. The person
  // layer is a pure re-derivation downstream of every people source, so
  // whenever one of those changes the orchestrator queues `update-persons` —
  // and with no marker under that name it queued it forever, on every run.
  //
  // Guarded on a non-empty result: the rebuild TRUNCATEs first, so a run
  // against upstreams that were never loaded (fresh clone, wrong DATABASE_URL)
  // resolves zero rows. Stamping that would tell the orchestrator the layer is
  // current and make it skip the layer SILENTLY — the mirror of the bug this
  // marker exists to fix, and the harder one to notice.
  //
  // The marker records THIS re-derivation. The skill also runs
  // `db:load:person-elections:pg` afterwards; that loader is a separate step
  // and the summary says so rather than implying it ran.
  if (skipStamp) {
    // nothing to record — cloud publish or scratch run
  } else if (personRows.length === 0) {
    console.warn(
      "  0 persons resolved — marker NOT stamped; the upstream tables look empty",
    );
  } else {
    writeIngestState(INGEST_SKILL, {
      summary: `db:resolve:persons: ${summary}. person-elections load runs separately.`,
    });
    // The person_* tables are Postgres-only and write nothing under data/, so
    // the orchestrator's `git diff --stat data/` gate never sees this layer.
    // Self-report, the way every other PG-migrated dataset does.
    appendDataChange({
      skill: INGEST_SKILL,
      summary: `Профилите на публичните лица преизчислени — ${personRows.length.toLocaleString("bg-BG")} лица, ${roleRows.length.toLocaleString("bg-BG")} длъжности`,
      source: "Регистър на лицата (обединена самоличност)",
      dedupeSameDay: true,
    });
  }
  await end();
}

// Direct-run entry point. Guarded so importing this module (e.g. from a unit
// test, for the exported pure helpers) does not kick off the full resolve.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
