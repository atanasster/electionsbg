/**
 * Scrape MPs (Народно събрание) from parliament.bg via its public /api/v1 endpoints.
 *
 * Two modes:
 *   1. CURRENT  (default)   — pulls only the active NS via /coll-list-ns/bg
 *   2. ALL HISTORY (--all)  — walks every MP profile id (1..maxId) so we get every
 *                              MP parliament.bg has on file (back to ~38th NS)
 *
 * Typical workflows:
 *   # First-time / full re-scrape (~10 min). Output is committed to git.
 *   tsx scripts/parliament/scrape_mps.ts --all
 *
 *   # Incremental update after a new NS is seated (~30 sec).
 *   # Re-fetches the 240 sitting MPs (their oldnsList grows when their NS becomes
 *   # "past") plus any new ids beyond the last max. Cached former-MP profiles reused.
 *   tsx scripts/parliament/scrape_mps.ts --all --refresh-current
 *
 *   # Pull just current NS into the per-election folder (used pre-merge).
 *   tsx scripts/parliament/scrape_mps.ts --profiles --photos
 *
 * Endpoints (no auth required, return JSON):
 *   GET /api/v1/coll-list-ns/bg                  → { colListMP: [...] } current NS
 *   GET /api/v1/mp-profile/bg/{mpId}             → full profile incl. oldnsList
 *   GET /images/Assembly/{mpId}.png              → photo
 *
 * Output (--all):
 *   public/parliament/index.json                 → flat lookup: id, name, photoUrl, nsFolders[]
 *   public/parliament/profiles/{id}.json         → trimmed profile per MP (frontend fields only)
 *
 * Caveat: parliament.bg's profile gives only the MP's CURRENT region/party. For past
 * terms it tells you which NSes they served in (oldnsList) but not the seat detail.
 * For original election-day winners use the CIK seat page (Cloudflare-protected).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, string, option, optional, flag, boolean } from "cmd-ts";
import sharp from "sharp";
import { titleCaseBgName } from "./name_case";
import { transliterateName } from "../../src/data/candidates/transliterateName";

const API = "https://www.parliament.bg/api/v1";
const PHOTO_BASE = "https://www.parliament.bg/images/Assembly/";
const PROFILE_BASE = "https://www.parliament.bg/bg/MP/";

// Local relative path under /data/parliament/photos/ that the SPA fetches
// (after dataUrl resolution → bucket). Stored alongside the MP profile so
// the page doesn't have to round-trip to parliament.bg, which sets
// Cache-Control: 0 on its photos and was the single biggest perf hit
// (~4 MB re-downloaded every visit per Lighthouse before this change).
const localPhotoUrl = (id: number): string => `/parliament/photos/${id}.webp`;

// parliament.bg returns "mp_blank.png" (a generic silhouette) for MPs without
// a real photo. The URL loads fine, so the frontend's <AvatarImage> never
// fails — meaning <AvatarFallback> with initials never shows. Strip it here so
// photoUrl is empty when there's no real photo.
const hasRealPhoto = (img: string | null | undefined): img is string =>
  !!img && !/blank/i.test(img);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "bg,en;q=0.7",
};

type RawMp = {
  A_ns_C_id: number;
  A_ns_MP_id: number;
  A_ns_MSP_date_F: string;
  A_ns_MSP_date_T: string;
  A_ns_MPL_Name1: string;
  A_ns_MPL_Name2: string;
  A_ns_MPL_Name3: string;
  A_ns_CL_value: string; // long party group name
  A_ns_CL_value_short: string;
  A_ns_MP_PosL_value: string | null;
  A_ns_MP_PosL_value1: string | null;
  A_ns_Va_name: string; // "23-СОФИЯ"
  A_ns_MP_img: string | null; // "4833.png"
};

type RawProfile = RawMp & {
  A_ns_MP_BDate?: string;
  A_ns_B_Country?: string;
  A_ns_B_City?: string;
  A_ns_MP_Email?: string;
  A_ns_MP_fbook?: string;
  A_ns_MP_url?: string;
  A_ns_MPL_CV?: string;
  A_ns_MPL_Spec?: string;
  A_ns_MPL_Prof?: string;
  A_ns_MPL_wBranch?: string;
  A_ns_MPL_City?: string;
  A_ns_CoalL_value?: string;
  A_ns_MRL_value?: string;
  A_ns_Va_id?: number;
  // English-locale name parts. Backfilled from /api/v1/mp-profile/en/{id}
  // when available, otherwise transliterated from the Bulgarian fields. We
  // store the raw EN tokens (uppercase, as parliament.bg returns them) so the
  // index/profile consumers can title-case consistently with the BG ones.
  A_ns_MPL_Name1_en?: string;
  A_ns_MPL_Name2_en?: string;
  A_ns_MPL_Name3_en?: string;
  oldnsList?: {
    A_nsL_value: string;
    A_nsL_value_short: string;
    A_ns_folder: string;
  }[];
  munList?: { A_ns_Va_M_id: number; A_ns_Va_M_name: string }[];
  lngList?: { LngL_value?: string; A_LngL_value?: string }[];
};

type CollListNs = {
  A_ns_C_id: number;
  A_ns_CL_value: string;
  A_ns_CL_value_short: string;
  A_ns_C_active_count: number;
  colListMP: RawMp[];
};

type Mp = {
  id: number;
  name: string;
  givenName: string;
  middleName: string;
  familyName: string;
  region: { code: string; name: string };
  partyGroup: string;
  partyGroupShort: string;
  position: string | null;
  positionInGroup: string | null;
  termFrom: string;
  termTo: string;
  photoUrl: string;
  profileUrl: string;
};

type MpProfile = Mp & {
  birthDate: string | null;
  birthCountry: string | null;
  birthCity: string | null;
  residenceCity: string | null;
  email: string | null;
  facebook: string | null;
  website: string | null;
  cv: string | null;
  specialization: string | null;
  profession: string | null;
  workBranch: string | null;
  coalition: string | null;
  languages: string[];
  pastTerms: { ns: string; nsShort: string; folder: string }[];
  municipalities: string[];
};

type SeatsByRegion = {
  scrapedAt: string;
  ns: string;
  total: number;
  regions: {
    code: string;
    name: string;
    seats: number;
    parties: { partyShort: string; partyFull: string; count: number }[];
    mps: { id: number; name: string; partyShort: string }[];
  }[];
};

const fetchJson = async <T>(url: string, attempt = 0): Promise<T> => {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return fetchJson<T>(url, attempt + 1);
    }
    throw new Error(`fetch failed for ${url}: ${(e as Error).message}`);
  }
};

const parseRegion = (vaName: string): { code: string; name: string } => {
  // "23-СОФИЯ"  or  "1-БЛАГОЕВГРАД"
  const m = vaName.match(/^(\d{1,2})-(.+)$/);
  if (!m) return { code: "", name: vaName };
  return { code: m[1].padStart(2, "0"), name: m[2].trim() };
};

const toMp = (raw: RawMp): Mp => {
  const id = raw.A_ns_MP_id;
  const rawName = [raw.A_ns_MPL_Name1, raw.A_ns_MPL_Name2, raw.A_ns_MPL_Name3]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    name: titleCaseBgName(rawName),
    givenName: titleCaseBgName(raw.A_ns_MPL_Name1 ?? ""),
    middleName: titleCaseBgName(raw.A_ns_MPL_Name2 ?? ""),
    familyName: titleCaseBgName(raw.A_ns_MPL_Name3 ?? ""),
    region: parseRegion(raw.A_ns_Va_name ?? ""),
    partyGroup: raw.A_ns_CL_value ?? "",
    partyGroupShort: (raw.A_ns_CL_value_short ?? "").trim(),
    position: raw.A_ns_MP_PosL_value ? raw.A_ns_MP_PosL_value.trim() : null,
    positionInGroup: raw.A_ns_MP_PosL_value1
      ? raw.A_ns_MP_PosL_value1.trim()
      : null,
    termFrom: raw.A_ns_MSP_date_F,
    termTo: raw.A_ns_MSP_date_T === "9999-12-31" ? "" : raw.A_ns_MSP_date_T,
    photoUrl: hasRealPhoto(raw.A_ns_MP_img) ? localPhotoUrl(id) : "",
    profileUrl: `${PROFILE_BASE}${id}`,
  };
};

const toProfile = (base: Mp, raw: RawProfile): MpProfile => ({
  ...base,
  birthDate: raw.A_ns_MP_BDate || null,
  birthCountry: raw.A_ns_B_Country || null,
  birthCity: raw.A_ns_B_City || null,
  residenceCity: raw.A_ns_MPL_City || null,
  email: raw.A_ns_MP_Email || null,
  facebook: raw.A_ns_MP_fbook || null,
  website: raw.A_ns_MP_url || null,
  cv: raw.A_ns_MPL_CV ? raw.A_ns_MPL_CV.trim() : null,
  specialization: raw.A_ns_MPL_Spec ? raw.A_ns_MPL_Spec.trim() : null,
  profession: raw.A_ns_MPL_Prof ? raw.A_ns_MPL_Prof.trim() : null,
  workBranch: raw.A_ns_MPL_wBranch ? raw.A_ns_MPL_wBranch.trim() : null,
  coalition: raw.A_ns_CoalL_value ? raw.A_ns_CoalL_value.trim() : null,
  languages: (raw.lngList ?? [])
    .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
    .filter(Boolean),
  pastTerms: (raw.oldnsList ?? []).map((t) => ({
    ns: t.A_nsL_value ?? "",
    nsShort: t.A_nsL_value_short ?? "",
    folder: t.A_ns_folder ?? "",
  })),
  municipalities: (raw.munList ?? [])
    .map((m) => m.A_ns_Va_M_name)
    .filter(Boolean),
});

const aggregateByRegion = (mps: Mp[], nsName: string): SeatsByRegion => {
  const byRegion = new Map<string, Mp[]>();
  for (const mp of mps) {
    const key = `${mp.region.code}|${mp.region.name}`;
    const arr = byRegion.get(key) ?? [];
    arr.push(mp);
    byRegion.set(key, arr);
  }
  const regions: SeatsByRegion["regions"] = [];
  for (const [key, regMps] of [...byRegion.entries()].sort()) {
    const [code, name] = key.split("|");
    const partyMap = new Map<string, { full: string; count: number }>();
    for (const mp of regMps) {
      const k = mp.partyGroupShort || mp.partyGroup;
      const cur = partyMap.get(k) ?? { full: mp.partyGroup, count: 0 };
      cur.count += 1;
      partyMap.set(k, cur);
    }
    regions.push({
      code,
      name,
      seats: regMps.length,
      parties: [...partyMap.entries()]
        .map(([partyShort, v]) => ({
          partyShort,
          partyFull: v.full,
          count: v.count,
        }))
        .sort((a, b) => b.count - a.count),
      mps: regMps.map((m) => ({
        id: m.id,
        name: m.name,
        partyShort: m.partyGroupShort,
      })),
    });
  }
  return {
    scrapedAt: new Date().toISOString(),
    ns: nsName,
    total: mps.length,
    regions,
  };
};

// Download an MP photo from parliament.bg and re-encode to WebP at quality 82.
// Source PNGs are ~200 KB each; WebP brings them to ~50-80 KB without visible
// loss at the avatar sizes we use. Stored at `${file}` (caller picks the path,
// expected to end in .webp).
const downloadPhoto = async (id: number, file: string): Promise<boolean> => {
  try {
    const res = await fetch(`${PHOTO_BASE}${id}.png`, { headers: HEADERS });
    if (!res.ok) return false;
    const src = Buffer.from(await res.arrayBuffer());
    if (src.length < 100) return false;
    const out = await sharp(src).webp({ quality: 82 }).toBuffer();
    fs.writeFileSync(file, out);
    return true;
  } catch {
    return false;
  }
};

type IndexEntry = {
  id: number;
  name: string;
  name_en: string; // title-cased English name (parliament.bg EN API or transliterated)
  normalizedName: string; // upper, single-spaced
  normalizedName_en: string; // upper, single-spaced English form
  photoUrl: string;
  currentRegion: { code: string; name: string } | null;
  currentPartyGroup: string | null;
  currentPartyGroupShort: string | null;
  position: string | null;
  birthDate: string | null;
  nsFolders: string[]; // e.g. ["38","39","40","41"]
  isCurrent: boolean;
  // Stamped only on the run that fetched this MP from parliament.bg (cache miss
  // or --refresh-current for sitting MPs). Preserved verbatim across re-runs
  // when we serve from cache, so the index is byte-stable for unchanged MPs.
  scrapedAt: string;
};

// Build the English display name for an MP. Prefers parliament.bg's EN API
// fields (already a Streamlined-System transliteration with the well-known
// politician spellings — "BOYKO METODIEV BORISOV" → "Boyko Metodiev Borisov").
// Falls back to algorithmic transliteration of the Bulgarian name when the
// EN API returned nothing for this id (rare, but happens for older records).
const buildEnglishName = (raw: RawProfile, bgName: string): string => {
  const en = [
    raw.A_ns_MPL_Name1_en ?? "",
    raw.A_ns_MPL_Name2_en ?? "",
    raw.A_ns_MPL_Name3_en ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (en) return titleCaseBgName(en);
  return transliterateName(bgName);
};

const buildIndexEntry = (
  mp: Mp | null,
  raw: RawProfile,
  isCurrent: boolean,
  scrapedAt: string,
): IndexEntry => {
  const id = raw.A_ns_MP_id ?? mp?.id;
  const givenName = raw.A_ns_MPL_Name1 ?? mp?.givenName ?? "";
  const middleName = raw.A_ns_MPL_Name2 ?? mp?.middleName ?? "";
  const familyName = raw.A_ns_MPL_Name3 ?? mp?.familyName ?? "";
  const rawName = [givenName, middleName, familyName].filter(Boolean).join(" ");
  const titleCased = titleCaseBgName(rawName);
  const nameEn = buildEnglishName(raw, titleCased);
  const folders = (raw.oldnsList ?? [])
    .map((t) => t.A_ns_folder)
    .filter((f): f is string => !!f);
  return {
    id,
    name: titleCased,
    name_en: nameEn,
    normalizedName: rawName.toUpperCase().replace(/\s+/g, " ").trim(),
    normalizedName_en: nameEn.toUpperCase().replace(/\s+/g, " ").trim(),
    photoUrl: hasRealPhoto(raw.A_ns_MP_img) ? localPhotoUrl(id) : "",
    currentRegion: mp?.region ?? null,
    currentPartyGroup: mp?.partyGroup ?? null,
    currentPartyGroupShort: mp?.partyGroupShort ?? null,
    position: mp?.position ?? null,
    birthDate: raw.A_ns_MP_BDate || null,
    nsFolders: folders,
    isCurrent,
    scrapedAt,
  };
};

// Strip parliament.bg profile down to the fields the frontend actually uses
// (importActList / controlList / mshipList etc. are massive and unused).
// 4030 files: 118 MB → 4.9 MB after trimming.
const PROFILE_KEEP = new Set([
  "A_ns_MP_id",
  "A_ns_MPL_Name1",
  "A_ns_MPL_Name2",
  "A_ns_MPL_Name3",
  "A_ns_MPL_Name1_en",
  "A_ns_MPL_Name2_en",
  "A_ns_MPL_Name3_en",
  "A_ns_MP_BDate",
  "A_ns_B_Country",
  "A_ns_B_City",
  "A_ns_MPL_City",
  "A_ns_MP_Email",
  "A_ns_MP_fbook",
  "A_ns_MP_url",
  "A_ns_MPL_CV",
  "A_ns_MPL_Spec",
  "A_ns_MPL_Prof",
  "A_ns_CoalL_value",
  "A_ns_Va_name",
  "A_ns_MP_img",
  "oldnsList",
  "munList",
  "lngList",
]);
const OLDNS_KEEP = new Set(["A_nsL_value", "A_nsL_value_short", "A_ns_folder"]);
const MUN_KEEP = new Set(["A_ns_Va_M_id", "A_ns_Va_M_name"]);
const LNG_KEEP = new Set(["LngL_value", "A_LngL_value"]);
const subsetObj = (
  o: Record<string, unknown>,
  keep: Set<string>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (keep.has(k)) out[k] = o[k];
  return out;
};
const trimProfile = (raw: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (!PROFILE_KEEP.has(k)) continue;
    const v = raw[k];
    if (k === "oldnsList" && Array.isArray(v))
      out[k] = v.map((o) =>
        subsetObj(o as Record<string, unknown>, OLDNS_KEEP),
      );
    else if (k === "munList" && Array.isArray(v))
      out[k] = v.map((o) => subsetObj(o as Record<string, unknown>, MUN_KEEP));
    else if (k === "lngList" && Array.isArray(v))
      out[k] = v.map((o) => subsetObj(o as Record<string, unknown>, LNG_KEEP));
    else out[k] = v;
  }
  return out;
};

const runHistory = async (opts: {
  out: string;
  maxId: number;
  concurrency: number;
  refreshCurrent: boolean;
  photos: boolean;
}) => {
  const profilesDir = path.join(opts.out, "profiles");
  fs.mkdirSync(profilesDir, { recursive: true });

  const nowIso = new Date().toISOString();

  // Load existing index (if any) so we can preserve scrapedAt for MPs whose
  // profile JSON we end up serving from cache. Without this, every re-run
  // would stamp every MP with today's timestamp, churning the file even when
  // no underlying data changed.
  //
  // Bootstrap: older index files only have a single top-level scrapedAt. For
  // MPs that were already in that index (i.e. they appear by id or normalized
  // name) but lack their own scrapedAt, we fall back to the old top-level
  // value as their "first known scrape" — better than stamping everyone with
  // today on the first run that introduces per-MP scrapedAt.
  const indexFile = path.join(opts.out, "index.json");
  const oldScrapedByName = new Map<string, string>();
  const oldScrapedById = new Map<number, string>();
  let oldTopScrapedAt: string | null = null;
  if (fs.existsSync(indexFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (typeof old.scrapedAt === "string") oldTopScrapedAt = old.scrapedAt;
      for (const m of old.mps ?? []) {
        const stamp =
          typeof m.scrapedAt === "string" ? m.scrapedAt : oldTopScrapedAt;
        if (!stamp) continue;
        if (m.normalizedName) oldScrapedByName.set(m.normalizedName, stamp);
        if (typeof m.id === "number") oldScrapedById.set(m.id, stamp);
      }
    } catch {
      // unparseable index → just treat as missing; everyone gets nowIso
    }
  }

  // 1. Pull current NS to know who's active and capture their region/party
  console.log(`→ fetching current parliament metadata`);
  const list = await fetchJson<CollListNs>(`${API}/coll-list-ns/bg`);
  const currentMps = new Map<number, Mp>();
  for (const raw of list.colListMP) {
    const mp = toMp(raw);
    currentMps.set(mp.id, mp);
  }
  console.log(
    `  ${list.A_ns_CL_value}: ${list.A_ns_C_active_count} active members captured`,
  );

  // Walk at least up to the highest currently-sitting id so newly-elected MPs
  // with ids past the last scrape's max are not silently dropped.
  if (currentMps.size > 0) {
    const highestCurrent = Math.max(...currentMps.keys());
    if (highestCurrent > opts.maxId) {
      console.log(
        `  bumping max-id ${opts.maxId} → ${highestCurrent} to cover all sitting MPs`,
      );
      opts.maxId = highestCurrent;
    }
  }

  // 2. Walk every MP id
  console.log(
    `→ walking MP profile ids 1..${opts.maxId} (concurrency ${opts.concurrency})`,
  );
  const index: IndexEntry[] = [];
  let next = 1;
  let done = 0;
  let empty = 0;
  let failed = 0;

  const worker = async () => {
    while (true) {
      const id = next++;
      if (id > opts.maxId) return;
      try {
        const profileFile = path.join(profilesDir, `${id}.json`);
        const isCurrent = currentMps.has(id);
        // Force re-fetch for currently-sitting MPs when --refresh-current is set:
        // their oldnsList grows when a new NS is seated, so cached files go stale.
        const useCache =
          fs.existsSync(profileFile) && !(opts.refreshCurrent && isCurrent);
        let raw: RawProfile;
        let fetchedFresh = false;
        if (useCache) {
          raw = JSON.parse(fs.readFileSync(profileFile, "utf8"));
        } else {
          raw = await fetchJson<RawProfile>(`${API}/mp-profile/bg/${id}`);
          // empty response = "[]" or {}
          if (
            !raw ||
            (Array.isArray(raw) && (raw as unknown as unknown[]).length === 0)
          ) {
            empty++;
            continue;
          }
          if (!raw.A_ns_MP_id) {
            empty++;
            continue;
          }
          fetchedFresh = true;
        }
        // Backfill English name parts from /api/v1/mp-profile/en/{id}. Fetched
        // once per MP and persisted into the same trimmed profile JSON so
        // subsequent runs serve from cache. Older cached profiles miss these
        // keys; treat them as a one-time backfill on the next run.
        const needsEnFetch =
          fetchedFresh || !raw.A_ns_MPL_Name1_en || !raw.A_ns_MPL_Name3_en;
        if (needsEnFetch) {
          try {
            const rawEn = await fetchJson<RawProfile>(
              `${API}/mp-profile/en/${id}`,
            );
            if (rawEn && rawEn.A_ns_MPL_Name1) {
              raw.A_ns_MPL_Name1_en = rawEn.A_ns_MPL_Name1;
              raw.A_ns_MPL_Name2_en = rawEn.A_ns_MPL_Name2;
              raw.A_ns_MPL_Name3_en = rawEn.A_ns_MPL_Name3;
            }
          } catch {
            // EN profile missing — buildIndexEntry will fall back to the
            // transliterator. No-op.
          }
        }
        const mp = currentMps.get(id) ?? null;
        // If we re-fetched from the API, this MP's data is "now". If we served
        // from cache, preserve whatever scrapedAt we had on file (by id, then
        // by normalized name). Brand-new ids with no prior record → nowIso.
        const stamp = !useCache
          ? nowIso
          : (oldScrapedById.get(id) ??
            // normalizedName lookup is computed below after entry is built
            nowIso);
        const entry = buildIndexEntry(mp, raw, isCurrent, stamp);
        if (!entry.name) {
          empty++;
          continue;
        }
        // For cache-served entries, prefer the by-name lookup if id missed
        // (parliament.bg occasionally re-keys an MP across NSes).
        if (useCache && !oldScrapedById.has(id)) {
          const byName = oldScrapedByName.get(entry.normalizedName);
          if (byName) entry.scrapedAt = byName;
        }
        index.push(entry);
        // Persist trimmed profile (one file per MP — small, lazily fetched by
        // frontend). Re-write cached files too when EN fields were backfilled,
        // so subsequent runs don't re-hit the EN API for the same MP.
        if (!useCache || needsEnFetch) {
          fs.writeFileSync(
            profileFile,
            JSON.stringify(
              trimProfile(raw as unknown as Record<string, unknown>),
            ),
          );
        }
      } catch (e) {
        failed++;
        if (failed % 20 === 0)
          console.warn(
            `  ! ${failed} failures so far (last: id=${id} ${(e as Error).message})`,
          );
      } finally {
        done++;
        if (done % 200 === 0)
          console.log(
            `  ${done}/${opts.maxId} (kept ${index.length}, empty ${empty}, failed ${failed})`,
          );
      }
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  index.sort((a, b) => a.id - b.id);

  // Dedupe: parliament.bg creates a new MP record per NS for the same person, so a
  // single individual can have 5+ entries. Merge them so name lookups return one
  // unified record (latest id has the richest data).
  const byName = new Map<string, IndexEntry>();
  for (const e of index) {
    const cur = byName.get(e.normalizedName);
    if (!cur) {
      byName.set(e.normalizedName, e);
      continue;
    }
    // pick the entry with most info: prefer isCurrent, then more nsFolders, then highest id
    const score = (x: IndexEntry) =>
      (x.isCurrent ? 1_000_000 : 0) + x.nsFolders.length * 1000 + x.id;
    const winner = score(e) > score(cur) ? e : cur;
    const loser = winner === e ? cur : e;
    // Union of nsFolders so we never lose a term
    const folders = new Set<string>([...winner.nsFolders, ...loser.nsFolders]);
    winner.nsFolders = [...folders].sort(
      (a, b) => parseInt(a, 10) - parseInt(b, 10),
    );
    // Most-recent scrapedAt across the merged records — if either side was
    // re-fetched today, the merged record reflects that.
    if (loser.scrapedAt > winner.scrapedAt) {
      winner.scrapedAt = loser.scrapedAt;
    }
    byName.set(e.normalizedName, winner);
  }
  const deduped = [...byName.values()].sort((a, b) => a.id - b.id);
  // Add current NS folder for currently-sitting MPs (parliament.bg's oldnsList only
  // covers PAST parliaments — the current one is implicit). The folder of the 51st
  // NS is "51".
  const currentMatch = list.A_ns_CL_value.match(/^(\d+)/);
  const currentFolder = currentMatch ? currentMatch[1] : null;
  if (currentFolder) {
    for (const e of deduped) {
      if (e.isCurrent && !e.nsFolders.includes(currentFolder)) {
        e.nsFolders = [...e.nsFolders, currentFolder].sort(
          (a, b) => parseInt(a, 10) - parseInt(b, 10),
        );
      }
    }
  }

  // Top-level scrapedAt = max of per-MP timestamps so the file is byte-stable
  // when no MPs were re-fetched (rather than always becoming "now").
  const topScrapedAt = deduped.reduce(
    (mx, m) => (m.scrapedAt > mx ? m.scrapedAt : mx),
    "",
  );

  // Minimum-deduped-MPs guard. Bulgarian parliaments since 1991 have had
  // 240 seats; the deduped index (everyone who has ever served) accumulates
  // to ~2000+. Anything below 200 means the parliament.bg API mass-failed,
  // returned a different shape, or our walker bailed early — refuse to
  // overwrite the on-disk index with a near-empty result that would erase
  // all historical MPs the frontend joins against.
  const MIN_DEDUPED = 200;
  if (deduped.length < MIN_DEDUPED) {
    throw new Error(
      `safety check: deduped MP count ${deduped.length} < ${MIN_DEDUPED} (kept ${index.length} raw, ${empty} empty ids, ${failed} failures). ` +
        `Likely parliament.bg API mass-failed or returned a different shape. ` +
        `Refusing to overwrite ${path.join(opts.out, "index.json")} with a near-empty roster.`,
    );
  }

  // Minified — ships to /data/parliament/ and is fetched client-side.
  fs.writeFileSync(
    path.join(opts.out, "index.json"),
    JSON.stringify({
      scrapedAt: topScrapedAt || nowIso,
      currentNs: list.A_ns_CL_value,
      total: deduped.length,
      rawTotal: index.length,
      mps: deduped,
    }),
  );
  console.log(
    `\n✓ kept ${index.length} raw → ${deduped.length} deduped, ${empty} empty ids, ${failed} failures`,
  );
  console.log(`✓ wrote ${path.join(opts.out, "index.json")}`);
  console.log(`✓ wrote ${index.length} files under ${profilesDir}/`);

  // Photos — same logic as `main()`. Re-encoded to .webp under
  // <out>/photos/ so the SPA can serve them from the bucket with our long
  // immutable cache instead of round-tripping to parliament.bg on every
  // visit (their server sets Cache-Control: 0). Skip if file already exists.
  if (opts.photos) {
    const photoDir = path.join(opts.out, "photos");
    fs.mkdirSync(photoDir, { recursive: true });
    const candidates = deduped.filter((m) => m.photoUrl);
    console.log(
      `→ downloading ${candidates.length} MP photos to ${photoDir} (webp)`,
    );
    let ok = 0;
    let miss = 0;
    let idx = 0;
    const next = async (): Promise<void> => {
      while (idx < candidates.length) {
        const i = idx++;
        const mp = candidates[i];
        const file = path.join(photoDir, `${mp.id}.webp`);
        if (fs.existsSync(file)) {
          ok++;
          continue;
        }
        const got = await downloadPhoto(mp.id, file);
        if (got) ok++;
        else miss++;
        if ((ok + miss) % 100 === 0) {
          console.log(
            `  ${ok + miss}/${candidates.length} (${ok} ok, ${miss} missing)`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency }, next));
    console.log(`✓ photos: ${ok} downloaded/cached, ${miss} missing`);

    // Clear photoUrl on the index for any MP whose .webp didn't materialise
    // on disk (download failed this run AND no successful prior cache).
    // Keeps cached profile JSONs intact so a later --refresh-current run
    // can still retry, but stops the SPA from claiming a photo we can't
    // serve — avoids the broken-image-then-fallback flash on candidate
    // strips and dashboard tiles for MPs whose parliament.bg photo link
    // is dead.
    let cleared = 0;
    for (const mp of deduped) {
      if (!mp.photoUrl) continue;
      const file = path.join(photoDir, `${mp.id}.webp`);
      if (!fs.existsSync(file)) {
        mp.photoUrl = "";
        cleared++;
      }
    }
    if (cleared > 0) {
      console.log(
        `→ cleared photoUrl on ${cleared} MPs without a usable .webp file`,
      );
      fs.writeFileSync(
        path.join(opts.out, "index.json"),
        JSON.stringify({
          scrapedAt: topScrapedAt || nowIso,
          currentNs: list.A_ns_CL_value,
          total: deduped.length,
          rawTotal: index.length,
          mps: deduped,
        }),
      );
      console.log(`✓ rewrote ${path.join(opts.out, "index.json")}`);
    }
  }
};

const main = async (opts: {
  out: string;
  photos: boolean;
  profiles: boolean;
}) => {
  fs.mkdirSync(opts.out, { recursive: true });

  console.log(`→ fetching parliament list from ${API}/coll-list-ns/bg`);
  const list = await fetchJson<CollListNs>(`${API}/coll-list-ns/bg`);
  console.log(
    `  ${list.A_ns_CL_value}: ${list.A_ns_C_active_count} active members`,
  );

  const mps = list.colListMP.map(toMp);

  // Optional: enrich with full profile (240 sequential calls, throttled)
  let profiles: MpProfile[] | null = null;
  if (opts.profiles) {
    console.log(`→ fetching ${mps.length} MP profiles (concurrency 6)`);
    profiles = [];
    const concurrency = 6;
    let idx = 0;
    const next = async (): Promise<void> => {
      while (idx < mps.length) {
        const i = idx++;
        const mp = mps[i];
        try {
          const raw = await fetchJson<RawProfile>(
            `${API}/mp-profile/bg/${mp.id}`,
          );
          profiles!.push(toProfile(mp, raw));
        } catch (e) {
          console.warn(`  ! mp ${mp.id} (${mp.name}): ${(e as Error).message}`);
          profiles!.push(toProfile(mp, {} as RawProfile));
        }
        if ((i + 1) % 30 === 0) console.log(`  ${i + 1}/${mps.length}`);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, next));
    profiles.sort((a, b) => a.id - b.id);
  }

  const seats = aggregateByRegion(mps, list.A_ns_CL_value);

  // Minified — these ship to /data/parliament/ and are fetched client-side.
  fs.writeFileSync(
    path.join(opts.out, "seats_by_region.json"),
    JSON.stringify(seats),
  );
  fs.writeFileSync(
    path.join(opts.out, "mps.json"),
    JSON.stringify({
      scrapedAt: new Date().toISOString(),
      ns: list.A_ns_CL_value,
      mps,
    }),
  );
  if (profiles) {
    // Minified — ships to /data/parliament/ and is fetched client-side.
    fs.writeFileSync(
      path.join(opts.out, "mp_profiles.json"),
      JSON.stringify({
        scrapedAt: new Date().toISOString(),
        ns: list.A_ns_CL_value,
        profiles,
      }),
    );
  }
  console.log(`✓ wrote ${path.join(opts.out, "seats_by_region.json")}`);
  console.log(`✓ wrote ${path.join(opts.out, "mps.json")}`);
  if (profiles)
    console.log(`✓ wrote ${path.join(opts.out, "mp_profiles.json")}`);

  if (opts.photos) {
    const photoDir = path.join(opts.out, "photos");
    fs.mkdirSync(photoDir, { recursive: true });
    console.log(`→ downloading ${mps.length} photos to ${photoDir} (webp)`);
    let ok = 0;
    let miss = 0;
    const concurrency = 8;
    let idx = 0;
    const next = async (): Promise<void> => {
      while (idx < mps.length) {
        const i = idx++;
        const mp = mps[i];
        // .webp — re-encoded from the parliament.bg PNG via sharp inside
        // downloadPhoto. ~3-4× smaller than the source PNG.
        const file = path.join(photoDir, `${mp.id}.webp`);
        if (fs.existsSync(file)) {
          ok++;
          continue;
        }
        const got = await downloadPhoto(mp.id, file);
        if (got) ok++;
        else miss++;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, next));
    console.log(`✓ photos: ${ok} downloaded, ${miss} missing`);
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cli = command({
  name: "scrape_mps",
  args: {
    out: option({
      type: string,
      long: "out",
      short: "o",
      defaultValue: () =>
        path.resolve(__dirname, "../../data/2024_10_27/parliament"),
    }),
    photos: flag({
      type: optional(boolean),
      long: "photos",
      // Default true so every scrape downloads/refreshes MP photos. Each is
      // re-encoded to .webp under data/parliament/photos/, served from the
      // bucket with our 1-year immutable cache (much better than the
      // Cache-Control: 0 parliament.bg sets on its PNGs).
      defaultValue: () => true,
    }),
    profiles: flag({
      type: optional(boolean),
      long: "profiles",
      defaultValue: () => false,
    }),
    all: flag({
      type: optional(boolean),
      long: "all",
      defaultValue: () => false,
    }),
    refreshCurrent: flag({
      type: optional(boolean),
      long: "refresh-current",
      defaultValue: () => false,
    }),
    maxId: option({
      type: optional(string),
      long: "max-id",
      defaultValue: () => "5200",
    }),
    concurrency: option({
      type: optional(string),
      long: "concurrency",
      defaultValue: () => "8",
    }),
  },
  handler: async (args) => {
    // cmd-ts's `flag({type: optional(boolean), defaultValue})` doesn't
    // populate `defaultValue` when the flag is omitted — it just leaves the
    // value undefined. So we have to apply the "default true" semantics here:
    // photos run unless the user explicitly passes `--no-photos`. (We don't
    // currently expose --no-photos; just don't pass --photos to skip — but
    // since the flag is positive, omitting it means "do the default", which
    // is now: download.)
    const wantsPhotos = args.photos !== false;
    if (args.all) {
      const out = args.out.endsWith("/2024_10_27/parliament")
        ? path.resolve(__dirname, "../../data/parliament")
        : args.out;
      await runHistory({
        out,
        maxId: parseInt(args.maxId ?? "5200", 10),
        concurrency: parseInt(args.concurrency ?? "8", 10),
        refreshCurrent: !!args.refreshCurrent,
        photos: wantsPhotos,
      });
      return;
    }
    await main({
      out: args.out,
      photos: wantsPhotos,
      profiles: !!args.profiles,
    });
  },
});

run(cli, process.argv.slice(2));
