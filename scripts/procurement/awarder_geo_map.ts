// Build EKATTE overrides for procurement awarders the OCDS feed never gave an
// address for — the ЦАИС ЕОП flat-feed gap-fill schools + legacy-only buyers.
// Without an address they have no `geo` and are dropped from by_settlement /
// the my-area place tiles. This writes a fill-missing override map that
// buildRollups consults (an address-derived geo always wins).
//
// Tiered resolution (see docs/plans/procurement-awarder-geo-v2.md):
//   B. МОН school register (data.egov.bg open data). The register no longer
//      carries an ЕИК column (only the НЕИСПУО school code + place), and there
//      is no НЕИСПУО→ЕИК crosswalk in the open data, so we can't key it by EIK
//      any more. Instead we match the school/kindergarten AWARDER NAME to the
//      register by legal-form-stripped name-core → settlement + oblast → EKATTE.
//      Accepted only when the name-core is globally unique, or when the buyer's
//      Tier-D modal oblast pins it to a single settlement (a shared school name
//      like „Св. св. Кирил и Методий" exists in dozens of villages). Needs
//      data.egov.bg reachable; skipped gracefully when the host blocks us.
//   A. Settlement embedded in the awarder name — a "гр.X" / "с.X" token or a
//      bare "- X" tail (e.g. "ДГС - Симитли", "Окръжен съд - варна"), in any
//      case. Resolved via the shared resolver (globally-unique or Tier-D
//      oblast-confirmed only); fully local. Also exercised: exact-EIK tiers
//      (TR registered seat, our schools register) and the OCDS/tenders
//      address maps — see the per-tier comments in main().
//
// EVERY tier is optional and degrades to zero entries when its input is
// unreachable. Left alone that SHRINKS the committed map — see the header of
// awarder_geo_merge.ts for the measured incident. So the run does not replace
// the committed file, it MERGES into it: a prior entry survives when the tier
// that produced it could not run, and is dropped only when that tier ran and no
// longer resolves the awarder. `tiers` in the output records which happened, so
// a consumer can tell "tier ran and found nothing" from "tier was down".
//
// Output: data/procurement/awarder_geo_overrides.json
//   { generatedAt, count,
//     sources:    { <label>: n },        // entries IN THE MAP, by tier label
//     run:        { candidates, resolved, unresolved },  // THIS RUN's tally
//     carriedOver:{ <label>: n },        // of `sources`, how many are inherited
//     tiers:      { <tier>: {status, reason?, lastFreshAt} },
//     notes: [...],
//     awarders:   { <eik>: {ekatte, source, confidence} } }
//
// `sources` and `run` are separate blocks on purpose: they disagree exactly when
// a tier is down, and that disagreement is the signal.
//
// Run: `npx tsx scripts/procurement/awarder_geo_map.ts`  (then rebuild rollups)
//   … -- --allow-shrink   write even though the merged map is materially
//                         smaller than the committed one (see SHRINK_TOLERANCE)
//   … -- --dry-run        report the merge, write nothing

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { DatabaseSync } from "node:sqlite";
import { getResolver } from "./resolve_ekatte";
import { canonicalJson } from "./validate";
import { getResourceData } from "../budget/lib/egov_api";
import { nameCore, settlNorm } from "../schools/school_name_match";
import {
  countSources,
  mergeGeoOverrides,
  producibleSources,
  shrinkVerdict,
  SHRINK_TOLERANCE,
  TIER_KEYS,
  TIER_LABELS,
  type GeoEntry,
  type TierInputs,
} from "./awarder_geo_merge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const OUT_FILE = path.join(PROCUREMENT_DIR, "awarder_geo_overrides.json");
// Tier F — the Търговски регистър state mirror (raw_data/tr/state.sqlite), a
// uic→seat table for ~1M legal entities. An EXACT-EIK registered seat — the
// highest-confidence source — but it only covers TR-registered entities
// (companies + читалища/ЮЛНЦ), NOT budget-funded schools/kindergartens, which
// live in the БУЛСТАТ register we don't ingest. Optional; skipped if absent.
const TR_SQLITE = path.resolve(__dirname, "../../raw_data/tr/state.sqlite");
// Tier S — our OWN schools register (data/schools/index.json, the source of the
// `schools` PG table). Each secondary school that match_eik.ts linked to a
// procurement EIK carries an EXACT, precision-verified eik→settlement (+ coords)
// — so for those buyers this beats the fuzzy МОН name-match below and even
// corrects it. Covers secondary schools only (no kindergartens — the register is
// built from ДЗИ/НВО exam data). Optional; skipped if the file is absent.
const SCHOOLS_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/schools/index.json",
);
// Tier R — the МОН institution register crosswalk (ri.mon.bg), eik → EKATTE
// taken from each institution's OWN registry card (the `bulstat` field). The
// most authoritative source for schools / kindergartens / ЦПЛР — an exact EIK
// join to an already-validated EKATTE, so it needs no name-matching and even
// corrects the fuzzy schools-register (Tier S) where they disagree. Built by
// scripts/procurement/mon_ri_crawl.ts (headed Playwright; ri.mon.bg is behind
// Cloudflare). Optional; skipped if the crosswalk file is absent.
const RI_CROSSWALK_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "mon_ri_eik_crosswalk.json",
);
// Tier D — buyer-EIK → modal oblast (NUTS3) from the tenders feed, built by
// build_tender_oblast_map.ts. Optional: present only after that crawl has run.
const OBLAST_MAP_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "buyer_oblast_map.json",
);
// Tier E — EIK → {locality, nuts} from the OCDS обявления party addresses, built
// by build_ocds_party_geo.ts. Optional.
const OCDS_PARTY_MAP_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "ocds_party_geo_map.json",
);

// МОН "Регистър на училищата, детските градини и обслужващите звена" — open data.
const MON_SCHOOL_RESOURCE = "cac4d569-529c-4209-b797-1cf5f69901f5";

// Province (oblast) name → NUTS3 code, the inverse of resolve_ekatte's
// NUTS_TO_PROVINCE — the resolver's `region` arg is a NUTS code.
const PROVINCE_TO_NUTS: Record<string, string> = {
  Видин: "BG311",
  Монтана: "BG312",
  Враца: "BG313",
  Плевен: "BG314",
  Ловеч: "BG315",
  "Велико Търново": "BG321",
  Габрово: "BG322",
  Русе: "BG323",
  Разград: "BG324",
  Силистра: "BG325",
  Варна: "BG331",
  Добрич: "BG332",
  Шумен: "BG333",
  Търговище: "BG334",
  Бургас: "BG341",
  Сливен: "BG342",
  Ямбол: "BG343",
  "Стара Загора": "BG344",
  "София (столица)": "BG411",
  София: "BG412",
  Благоевград: "BG413",
  Перник: "BG414",
  Кюстендил: "BG415",
  Пловдив: "BG421",
  Хасково: "BG422",
  Пазарджик: "BG423",
  Смолян: "BG424",
  Кърджали: "BG425",
};

const oblastToNuts = (raw: string): string | undefined => {
  const s = raw.replace(/^\s*обл(?:аст)?\.?\s*/i, "").trim();
  if (PROVINCE_TO_NUTS[s]) return PROVINCE_TO_NUTS[s];
  // "София-град" / "София град" → capital
  if (/^софия([\s-]*град)?$/i.test(s)) return "BG411";
  return undefined;
};

// Tier-A extracts settlement candidates embedded in the awarder name. Buyers
// frequently carry their own town — "ДГ „Пламъче" гр. Варна", "ДГС - Симитли",
// "Окръжен съд - варна", "… - ГР.ВИДИН", "ОУ „Христо Ботев" с.ЗИДАРОВО" — but in
// wildly inconsistent forms (all-caps / lowercase, with or without a гр./с.
// prefix, after a dash or a closing quote). We return an ordered candidate list;
// the caller resolves each through the shared EKATTE resolver, which only
// accepts a globally-unique (or oblast-confirmed) settlement, so junk tails and
// ambiguous names simply don't resolve.
//
// A settlement token: 3+ letters, any case on the first word (the raw data has
// "гр. гоце Делчев"), Title-case on any following word ("Стара Загора"). One
// optional following word covers the two-word oikonyms.
const SETTL_TOKEN = "[А-Яа-яЁё][А-Яа-яЁё]{2,}(?:[ -][А-ЯЁ][А-Яа-яЁё]+)?";
// гр./с./град/село prefix. The single-letter forms REQUIRE the dot so the
// preposition "с" ("СУ с изучаване на …") can't be read as "село".
const GS_PREFIX_RE = new RegExp(
  `(?:гр\\.|с\\.|град\\s|село\\s)\\s*(${SETTL_TOKEN})`,
  "gi",
);
// A bare "- Settlement" / "– Settlement" / ", Settlement" tail at the very end.
// Capital-initial only here (no гр./с. anchor to lean on), to avoid grabbing a
// trailing lowercase common word.
const BARE_TAIL_RE = new RegExp(
  `[-–,]\\s*([А-ЯЁ][А-Яа-яЁё]{2,}(?:[ -][А-ЯЁ][А-Яа-яЁё]+)?)\\s*$`,
);
// Legal-form / status tails that are never settlements.
const LEGAL_TAIL_RE =
  /^(ЕООД|ООД|АД|ЕАД|ДЗЗД|ЕТ|СД|КД|ДП|СНЦ|ЮЛНЦ|ЕИК|БУЛСТАТ|ликвидация|несъстоятелност)$/i;

// Drop quoted segments first so a personal name inside quotes ("… „Георги с.
// Раковски"") can never be mistaken for a "с. <settlement>" tail.
const stripQuoted = (s: string): string =>
  s
    .replace(/["„“”»«][^"„“”»«]*["„“”»«]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const settlementCandidates = (rawName: string): string[] => {
  const s = stripQuoted(rawName);
  const cands: string[] = [];
  // (a) the LAST гр./с./град/село-prefixed token (the buyer's own town usually
  // trails the institution name).
  const gs = [...s.matchAll(GS_PREFIX_RE)];
  if (gs.length) cands.push(gs[gs.length - 1][1]);
  // (b) a bare capital-initial tail after the final separator.
  const bare = s.match(BARE_TAIL_RE);
  if (bare) cands.push(bare[1]);
  return [...new Set(cands.map((c) => c.trim()))].filter(
    (c) => c.length >= 3 && !LEGAL_TAIL_RE.test(c),
  );
};

interface AwarderFile {
  eik: string;
  name: string;
  address?: unknown;
}

// What a tier loader returns. `ok: false` means "we could not read this input"
// — an absent file, a blocked host, a shape we don't recognise — which is NOT
// the same as a tier that ran and resolved nothing, and the merge treats the
// two oppositely. Every loader below is total: it reports rather than throws,
// because one unreachable tier must not abort the other six.
interface TierLoad<T> {
  ok: boolean;
  reason?: string;
  value: T;
}
const down = <T>(reason: string, value: T): TierLoad<T> => {
  console.warn(`  ${reason}`);
  return { ok: false, reason, value };
};

interface MonRow {
  settlement: string;
  oblast: string;
}

// The МОН register keyed by school name-core → the place(s) a school of that
// name exists. A name-core maps to MANY rows (e.g. „Св. св. Кирил и Методий" is
// in dozens of villages); the caller disambiguates by uniqueness / Tier-D
// oblast. An empty map means Tier B is skipped (fetch blocked or header drift).
type MonNameIndex = Map<string, MonRow[]>;

// Fetch the МОН register and index it by school name-core. Defensive: detects
// the settlement/oblast/name columns from the header row (the register's own
// header misspells Област as "Обаст" and carries no EIK), and returns an empty
// index (Tier B skipped) on any failure — incl. the data.egov.bg block that
// 403s non-pipeline IPs.
const fetchMonSchoolMap = async (): Promise<TierLoad<MonNameIndex>> => {
  const out: MonNameIndex = new Map();
  let rows: unknown[][];
  try {
    rows = await getResourceData(MON_SCHOOL_RESOURCE);
  } catch (e) {
    return down(
      `Tier B unavailable — МОН register fetch failed: ${(e as Error).message}`,
      out,
    );
  }
  if (!rows.length)
    return down("Tier B unavailable — МОН register returned no rows", out);
  const header = rows[0].map((c) => String(c ?? ""));
  const col = (re: RegExp): number => header.findIndex((h) => re.test(h));
  // "Населено място" (settlement), "Обаст"/"Област" (oblast, often misspelled),
  // "Име на училище/детска градина" (institution name).
  const setlCol = col(
    /населено\s*м[яe]ст|^град$|^село$|settlement|нас\.?\s*място/i,
  );
  // Match both the correct "Област" and the source's misspelled "Обаст".
  const oblCol = col(/об[л]?аст|oblast|region/i);
  const nameCol = col(/име.*(училищ|детск|заведени)|наименован|school|name/i);
  if (setlCol < 0 || nameCol < 0)
    return down(
      `Tier B unavailable — couldn't find settlement/name columns in МОН header: ${JSON.stringify(header).slice(0, 300)}`,
      out,
    );
  let rowCount = 0;
  for (const r of rows.slice(1)) {
    const core = nameCore(String(r[nameCol] ?? ""));
    const settlement = String(r[setlCol] ?? "").trim();
    if (!core || !settlement) continue;
    const list = out.get(core);
    const row: MonRow = {
      settlement,
      oblast: oblCol >= 0 ? String(r[oblCol] ?? "").trim() : "",
    };
    if (list) list.push(row);
    else out.set(core, [row]);
    rowCount += 1;
  }
  console.log(
    `  Tier B: МОН register indexed ${rowCount} institution(s) under ${out.size} name-core(s)`,
  );
  return { ok: true, value: out };
};

// Parse the settlement out of a TR registered seat, e.g.
// "БЪЛГАРИЯ, гр. Симитли, 2730" → "Симитли". Returns undefined when no
// гр./с. settlement token is present.
const parseTrSeat = (seat: string): string | undefined => {
  for (const part of seat.split(",").map((s) => s.trim())) {
    const m = part.match(/^(?:гр|с)\.?\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return undefined;
};

// Look up the TR registered seat (settlement) for a set of candidate EIKs.
// Exact match on uic — БУЛСТАТ codes are stored verbatim, so we try the EIK as
// given and its zero-stripped form. Defensive: returns an empty map when the
// state mirror isn't on disk (Tier F skipped).
const fetchTrSeatMap = (eiks: string[]): TierLoad<Map<string, string>> => {
  const out = new Map<string, string>();
  if (!fs.existsSync(TR_SQLITE))
    return down(
      `Tier F unavailable — no TR state mirror at ${path.relative(process.cwd(), TR_SQLITE)}`,
      out,
    );
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(TR_SQLITE, { readOnly: true });
  } catch (e) {
    return down(
      `Tier F unavailable — TR state mirror unreadable: ${(e as Error).message}`,
      out,
    );
  }
  try {
    const stmt = db.prepare("SELECT seat FROM companies WHERE uic = ?");
    for (const eik of eiks) {
      const row = (stmt.get(eik) ?? stmt.get(eik.replace(/^0+/, ""))) as
        | { seat?: string }
        | undefined;
      const settlement = row?.seat ? parseTrSeat(String(row.seat)) : undefined;
      if (settlement) out.set(eik, settlement);
    }
  } catch (e) {
    // A half-read mirror is an unavailable tier, not an empty one: whatever we
    // did collect before the throw is a partial answer we must not treat as the
    // tier's verdict.
    return down(
      `Tier F unavailable — TR query failed: ${(e as Error).message}`,
      new Map<string, string>(),
    );
  } finally {
    db.close();
  }
  console.log(`  Tier F: TR register supplied ${out.size} registered seat(s)`);
  return { ok: true, value: out };
};

// The one reader for every JSON-backed tier (R, S, D, E). It owns all four ways
// an input can fail to be an answer — absent, unparseable, missing its payload
// key, or EMPTY — so the `TierLoad` contract above is true of all of them and
// not just of `fetchMonSchoolMap`.
//
// THE EMPTY CASE IS THE LOAD-BEARING ONE. `ok: true` is what makes a tier's
// labels producible, which is the single state in which the merge may DROP a
// prior entry. Every one of these files is written by an upstream builder that
// emits its payload key unconditionally — `build_tender_oblast_map.ts` and
// `build_ocds_party_geo.ts` both write `awarders: {}` whenever their gz cache
// yields nothing, and neither has a completeness guard — so a valid-but-empty
// file is indistinguishable from a failed rebuild and must not be read as "the
// tier ran and found nothing". Measured: emptying `buyer_oblast_map.json` (the
// exact shape those builders write) dropped 16 unrecoverable entries at 0.7%,
// under the shrink guard, at exit 0. The pre-merge code used entry COUNT as the
// availability signal; this keeps that signal, on the payload rather than the
// derived output.
const readTierJson = <T>(
  file: string,
  tier: string,
  pick: (parsed: Record<string, unknown>) => Record<string, T> | undefined,
): TierLoad<Record<string, T>> => {
  const rel = path.relative(process.cwd(), file);
  if (!fs.existsSync(file))
    return down(`${tier} unavailable — no file at ${rel}`, {});
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return down(
      `${tier} unavailable — ${rel} unreadable: ${(e as Error).message}`,
      {},
    );
  }
  const payload = pick(parsed);
  if (!payload)
    return down(
      `${tier} unavailable — ${rel} carries no recognised payload (shape drift?)`,
      {},
    );
  if (!Object.keys(payload).length)
    return down(
      `${tier} unavailable — ${rel} is empty; an empty derived file cannot be ` +
        `told from a failed rebuild, so it is not read as "ran, found nothing"`,
      {},
    );
  return { ok: true, value: payload };
};

// Our schools register → eik → settlement (from the school's own `address`,
// e.g. "ГР.БАНСКО"). Only schools that match_eik.ts linked to a procurement EIK
// contribute — so the OUTPUT is legitimately tiny (1 today) while the PAYLOAD
// checked above is the whole register; the emptiness guard is on the latter.
const fetchSchoolSeatMap = (): TierLoad<Map<string, string>> => {
  const load = readTierJson<{ eik?: string; address?: string }[]>(
    SCHOOLS_INDEX_FILE,
    "Tier S",
    (j) =>
      j.schoolsByObshtina as
        | Record<string, { eik?: string; address?: string }[]>
        | undefined,
  );
  const out = new Map<string, string>();
  if (!load.ok) return { ...load, value: out };
  for (const recs of Object.values(load.value)) {
    for (const r of recs) {
      const settlement = r.eik ? settlNorm(r.address) : "";
      if (r.eik && settlement) out.set(r.eik, settlement);
    }
  }
  console.log(`  Tier S: schools register supplied ${out.size} eik→settlement`);
  return { ok: true, value: out };
};

// The ri.mon.bg crosswalk → eik → EKATTE (already a validated registry code,
// so no resolver step).
const fetchRiCrosswalk = (): TierLoad<Map<string, string>> => {
  const load = readTierJson<{ ekatte?: string }>(
    RI_CROSSWALK_FILE,
    "Tier R",
    (j) => j.awarders as Record<string, { ekatte?: string }> | undefined,
  );
  const out = new Map<string, string>();
  if (!load.ok) return { ...load, value: out };
  for (const [eik, rec] of Object.entries(load.value))
    if (rec.ekatte) out.set(eik, rec.ekatte);
  console.log(
    `  Tier R: RI register crosswalk supplied ${out.size} eik→EKATTE`,
  );
  return { ok: true, value: out };
};

// Tiers D and E are both `{ awarders: { <eik>: … } }` derived files.
const loadAwarderJson = <T>(
  file: string,
  tier: string,
): TierLoad<Record<string, T>> =>
  readTierJson<T>(
    file,
    tier,
    (j) => j.awarders as Record<string, T> | undefined,
  );

// The committed map we merge into. A missing file is a first build (no prior,
// nothing to carry); a MALFORMED one is refused rather than silently treated as
// empty, because "no prior" is exactly the state that disables every guard below.
const readPrior = (): {
  awarders: Record<string, GeoEntry>;
  generatedAt?: string;
  tiers?: Record<string, { lastFreshAt?: string }>;
} => {
  if (!fs.existsSync(OUT_FILE)) {
    console.log("  no committed map — first build, nothing to merge");
    return { awarders: {} };
  }
  let j: {
    awarders?: Record<string, GeoEntry>;
    generatedAt?: string;
    tiers?: Record<string, { lastFreshAt?: string }>;
  };
  try {
    j = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch (e) {
    // Deliberately fatal. Degrading to an empty prior would disable the merge
    // AND the shrink guard at once — the file would be rewritten from this
    // run alone, which is precisely the silent loss all of this exists to stop.
    throw new Error(
      `${path.relative(process.cwd(), OUT_FILE)} is unreadable (${(e as Error).message}). ` +
        `Restore it from git before rebuilding — treating it as empty would rewrite the map ` +
        `from this run alone and drop every entry a currently-unavailable tier produced.`,
    );
  }
  return {
    awarders: j.awarders ?? {},
    generatedAt: j.generatedAt,
    tiers: j.tiers,
  };
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(AWARDERS_DIR)) {
    console.error(`no awarders dir at ${AWARDERS_DIR} — run the ingest first`);
    process.exitCode = 1;
    return;
  }
  // Both preconditions up front: readPrior() is the one call that can be fatal,
  // and it used to run after the МОН fetch, a 2,758-EIK sqlite scan, ~4,400
  // awarder reads and the whole resolve loop — i.e. the operator paid five
  // minutes to be told to `git checkout` one file.
  const prior = readPrior();
  const priorCount = Object.keys(prior.awarders).length;

  // Candidates: awarders the OCDS feed gave no address for. `knownEiks` is
  // every awarder in the dir, which is what lets the merge tell an awarder that
  // GAINED an address from one that vanished with a half-rebuilt dir.
  const candidates: AwarderFile[] = [];
  const knownEiks = new Set<string>();
  for (const f of fs.readdirSync(AWARDERS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const a = JSON.parse(
      fs.readFileSync(path.join(AWARDERS_DIR, f), "utf8"),
    ) as AwarderFile;
    knownEiks.add(a.eik);
    if (!a.address) candidates.push({ eik: a.eik, name: a.name });
  }
  console.log(
    `→ ${candidates.length} awarder(s) with no OCDS address (override candidates)`,
  );

  const resolver = getResolver();
  const monLoad = await fetchMonSchoolMap();
  const monMap = monLoad.value;
  // Tier F — exact-EIK registered seats from the TR state mirror.
  const trLoad = fetchTrSeatMap(candidates.map((c) => c.eik));
  const trSeatMap = trLoad.value;
  // Tier S — exact-EIK settlements from our own schools register.
  const schoolLoad = fetchSchoolSeatMap();
  const schoolSeatMap = schoolLoad.value;
  // Tier R — exact-EIK EKATTE from the МОН institution register crosswalk.
  const riLoad = fetchRiCrosswalk();
  const riCrosswalk = riLoad.value;

  // Tier D — optional buyer→oblast map (disambiguates the Tier-A name parse).
  const oblastLoad = loadAwarderJson<{ nuts: string }>(
    OBLAST_MAP_FILE,
    "Tier D",
  );
  const oblastMap = oblastLoad.value;
  if (oblastLoad.ok)
    console.log(
      `  Tier D: ${Object.keys(oblastMap).length} buyer→oblast hint(s) loaded (tenders feed)`,
    );

  // Tier E — optional EIK → {locality, nuts} from OCDS party addresses.
  const ocdsLoad = loadAwarderJson<{ locality: string; nuts: string }>(
    OCDS_PARTY_MAP_FILE,
    "Tier E",
  );
  const ocdsMap = ocdsLoad.value;
  if (ocdsLoad.ok)
    console.log(
      `  Tier E: ${Object.keys(ocdsMap).length} EIK→locality address(es) loaded (OCDS parties)`,
    );

  const awarders: Record<string, GeoEntry> = {};
  const counts = {
    ri: 0,
    tr: 0,
    school: 0,
    ocds: 0,
    mon: 0,
    monOblast: 0,
    name: 0,
    nameOblast: 0,
    unresolved: 0,
  };

  for (const a of candidates) {
    // Tier R — МОН institution register crosswalk (exact EIK → validated
    // EKATTE from the institution's own registry card). The single most
    // authoritative source; wins over everything below.
    const riEkatte = riCrosswalk.get(a.eik);
    if (riEkatte) {
      awarders[a.eik] = { ekatte: riEkatte, source: "ri", confidence: "exact" };
      counts.ri++;
      continue;
    }

    // Tier F — TR registered seat (exact EIK). The most authoritative source:
    // an official registry address keyed by the entity's own БУЛСТАТ, so it
    // ranks above the name-matched / declared-address tiers below.
    const trSettlement = trSeatMap.get(a.eik);
    if (trSettlement) {
      const res = resolver.resolve({ locality: trSettlement });
      if (res.ekatte && res.confidence !== "unresolved") {
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: "tr",
          confidence: res.confidence,
        };
        counts.tr++;
        continue;
      }
    }

    // Tier S — our schools register (exact, precision-verified eik→settlement).
    // Authoritative for the schools it covers, so it ranks above the fuzzy МОН
    // name-match (Tier B) and corrects it where they disagree.
    const schoolSettlement = schoolSeatMap.get(a.eik);
    if (schoolSettlement) {
      const res = resolver.resolve({ locality: schoolSettlement });
      if (res.ekatte && res.confidence !== "unresolved") {
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: "school",
          confidence: res.confidence,
        };
        counts.school++;
        continue;
      }
    }

    // Tier E — OCDS party address (locality + NUTS). A REAL declared address, so
    // a high-quality signal; it wins over the name-matched Tier B below.
    const ocds = ocdsMap[a.eik];
    if (ocds && ocds.locality) {
      const res = resolver.resolve({
        locality: ocds.locality,
        region: ocds.nuts || undefined,
      });
      if (res.ekatte && res.confidence !== "unresolved") {
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: "ocds",
          confidence: res.confidence,
        };
        counts.ocds++;
        continue;
      }
    }

    // Tier B — МОН school register, matched by name-core. The register carries no
    // EIK, so we can only join by the awarder's (school) name. Accept when the
    // name-core is globally unique, or when the buyer's Tier-D modal oblast pins
    // the (otherwise shared) name to a single settlement.
    const monRows = monMap.get(nameCore(a.name));
    if (monRows && monRows.length) {
      // Candidate {settlement, oblast} pairs, deduped on settlement so a school
      // listed twice in the same place doesn't read as ambiguous.
      const bySettl = new Map<string, MonRow>();
      for (const r of monRows) bySettl.set(`${r.oblast}|${r.settlement}`, r);
      const oblastNuts = oblastMap[a.eik]?.nuts;
      let pick: MonRow | undefined;
      let oblastPinned = false;
      if (bySettl.size === 1) {
        // Globally-unique school name → unambiguous.
        pick = [...bySettl.values()][0];
      } else if (oblastNuts) {
        // Shared name: keep only the rows in the buyer's modal oblast. Accept
        // only if that pins a single settlement.
        const inObl = [...bySettl.values()].filter(
          (r) => oblastToNuts(r.oblast) === oblastNuts,
        );
        const settls = new Set(inObl.map((r) => r.settlement.toUpperCase()));
        if (settls.size === 1) {
          pick = inObl[0];
          oblastPinned = true;
        }
      }
      if (pick) {
        const res = resolver.resolve({
          locality: pick.settlement,
          region: oblastToNuts(pick.oblast),
        });
        if (res.ekatte && res.confidence !== "unresolved") {
          awarders[a.eik] = {
            ekatte: res.ekatte,
            source: oblastPinned ? "mon+oblast" : "mon",
            confidence: res.confidence,
          };
          if (oblastPinned) counts.monOblast++;
          else counts.mon++;
          continue;
        }
      }
    }

    // Tier A — settlement embedded in the awarder name. Try each candidate; for
    // each, Tier D disambiguation feeds the buyer's modal oblast (from the
    // tenders feed) as the resolver's `region` hint. For a unique settlement
    // that's a no-op; for one shared across oblasti it picks the EKATTE in the
    // buyer's oblast (higher confidence). We re-resolve without the hint when
    // the hint yields nothing so the bare-name path still applies. First
    // candidate that resolves wins.
    const oblastNuts = oblastMap[a.eik]?.nuts;
    let matched = false;
    for (const settlement of settlementCandidates(a.name)) {
      const hinted = oblastNuts
        ? resolver.resolve({ locality: settlement, region: oblastNuts })
        : undefined;
      const res =
        hinted && hinted.ekatte && hinted.confidence !== "unresolved"
          ? hinted
          : resolver.resolve({ locality: settlement });
      if (res.ekatte && res.confidence !== "unresolved") {
        const oblastConfirmed = !!(hinted && hinted.ekatte === res.ekatte);
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: oblastConfirmed ? "name+oblast" : "name",
          confidence: res.confidence,
        };
        if (oblastConfirmed) counts.nameOblast++;
        else counts.name++;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    counts.unresolved++;
  }

  const resolved =
    counts.ri +
    counts.tr +
    counts.school +
    counts.mon +
    counts.monOblast +
    counts.ocds +
    counts.name +
    counts.nameOblast;
  console.log(
    `  this run resolved ${resolved}/${candidates.length} ` +
      `(RI ${counts.ri}, TR ${counts.tr}, school ${counts.school}, МОН ${counts.mon}, МОН+oblast ${counts.monOblast}, OCDS ${counts.ocds}, name ${counts.name}, name+oblast ${counts.nameOblast}); ${counts.unresolved} unresolved`,
  );

  // ── MERGE INTO THE COMMITTED MAP ──────────────────────────────────────────
  // `name` is absent from TierInputs: Tier A is a parse of the awarder's own
  // name, so it runs whenever the builder does and can never be unavailable.
  const inputs: TierInputs = {
    ri: riLoad.ok,
    tr: trLoad.ok,
    school: schoolLoad.ok,
    ocds: ocdsLoad.ok,
    mon: monLoad.ok,
    oblast: oblastLoad.ok,
  };
  const reasons: Record<string, string | undefined> = {
    ri: riLoad.reason,
    tr: trLoad.reason,
    school: schoolLoad.reason,
    ocds: ocdsLoad.reason,
    mon: monLoad.reason,
    oblast: oblastLoad.reason,
  };
  const { awarders: merged, report } = mergeGeoOverrides(
    prior.awarders,
    awarders,
    producibleSources(inputs),
    new Set(candidates.map((c) => c.eik)),
    knownEiks,
  );
  const finalCount = Object.keys(merged).length;
  const carriedTotal = Object.values(report.carried).reduce((a, b) => a + b, 0);

  const generatedAt = new Date().toISOString();
  const notes: string[] = [];
  const tiers: Record<string, unknown> = {};
  for (const key of TIER_KEYS) {
    const ok = key === "name" ? true : inputs[key];
    // How stale a down tier's carried-over entries are. A tier that ran is
    // fresh as of now; one that did not keeps whatever the last good run
    // stamped, so "unavailable since <date>" is answerable from the file alone.
    const lastFreshAt = ok
      ? generatedAt
      : (prior.tiers?.[key]?.lastFreshAt ?? prior.generatedAt);
    tiers[key] = {
      status: ok ? "ok" : "unavailable",
      ...(ok ? {} : { reason: reasons[key] }),
      ...(lastFreshAt ? { lastFreshAt } : {}),
    };
  }
  for (const key of TIER_KEYS) {
    if (key === "name" || inputs[key]) continue;
    // Attribute by the labels this tier gates. `mon+oblast` is gated by both
    // `mon` and `oblast`, so with both down it is named in both notes — the
    // note attributes, it does not sum.
    const carried = (TIER_LABELS[key] ?? [])
      .map((label) => `${label} ${report.carried[label] ?? 0}`)
      .join(", ");
    notes.push(
      `Tier ${key} was unavailable on ${generatedAt.slice(0, 10)} (${reasons[key] ?? "no reason recorded"}); ` +
        `entries carried over from the previous build: ${carried}.`,
    );
  }
  if (report.unknownSources.length)
    notes.push(
      `Carried over entries with unrecognised source label(s): ${report.unknownSources.join(", ")} — ` +
        `this build cannot tell whether the tier that produced them ran.`,
    );

  if (carriedTotal || report.retired || report.unresolved || report.changed)
    console.log(
      `  merge: ${carriedTotal} carried over` +
        (carriedTotal
          ? ` (${Object.entries(report.carried)
              .sort()
              .map(([s, n]) => `${s} ${n}`)
              .join(", ")})`
          : "") +
        `, ${report.retired} retired (awarder gained an address), ` +
        `${report.vanished} vanished (gone from the awarders dir), ` +
        `${report.unresolved} dropped (tier ran, no longer resolves), ` +
        `${report.malformed} malformed, ` +
        `${report.changed} re-resolved to a different EKATTE`,
    );
  for (const n of notes) console.warn(`  ! ${n}`);

  // The verdict lives in awarder_geo_merge.ts so it is testable — see
  // shrinkVerdict's header for why it counts GROSS loss rather than net size.
  const { refuse, lost, pct } = shrinkVerdict(priorCount, report);
  if (refuse && !process.argv.includes("--allow-shrink")) {
    console.error(
      `\nREFUSING TO WRITE: ${lost} of ${priorCount} prior entries would be dropped ` +
        `(${(pct * 100).toFixed(1)}% > ${SHRINK_TOLERANCE * 100}%) — ` +
        `${report.retired} retired (gained an address), ${report.vanished} vanished ` +
        `from the awarders dir, ${report.unresolved} no longer resolve, ` +
        `${report.malformed} malformed.\n` +
        `  map size ${priorCount} → ${finalCount}.\n` +
        `Re-run when every tier is reachable, or pass --allow-shrink if the contraction is real.`,
    );
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--dry-run")) {
    console.log(`\n--dry-run: nothing written (would write ${finalCount}).`);
    return;
  }

  fs.writeFileSync(
    OUT_FILE,
    canonicalJson({
      generatedAt,
      count: finalCount,
      // Recomputed from what is actually WRITTEN — a merged map's source counts
      // must describe the map, not the run that built it.
      sources: countSources(merged),
      // …and the run's own tally is a SEPARATE block, because the two disagree
      // whenever a tier is down and the difference is the whole point. With
      // Tier B blocked the map holds 93 `mon` entries while this run resolved
      // none of them; one block with both numbers in it invites reading the
      // carried entries as freshly resolved, or `unresolved` as a gap in the map.
      run: {
        candidates: candidates.length,
        resolved,
        unresolved: counts.unresolved,
      },
      carriedOver: report.carried,
      tiers,
      ...(notes.length ? { notes } : {}),
      awarders: merged,
    }),
  );
  console.log(
    `✓ wrote ${OUT_FILE} — ${finalCount} entr${finalCount === 1 ? "y" : "ies"}` +
      (priorCount ? ` (was ${priorCount})` : ""),
  );
  console.log(`→ now rebuild: npm run procurement:ingest (applies overrides)`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
