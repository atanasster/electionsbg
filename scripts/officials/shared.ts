// Shared helpers for the register.cacbg.bg declaration pipelines.
//
// Both ingests — executive officials (./index.ts) and municipal officials
// (./municipal.ts) — pull from the same registry, transliterate names the
// same way and cache raw XML the same way. This module holds that common
// ground. It deliberately exports no CLI so either ingest can import it
// without triggering the other's `run(...)`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Agent } from "undici";
import { REGISTER_BASE } from "../lib/cacbg_register";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, "../..");
// Re-exported, not redeclared: registerFolderYear() matches source URLs against
// this exact origin, so a private copy drifting here would silently disable the
// declaration-year fallback rather than fail.
export { REGISTER_BASE };
// Raw per-declaration XML cache (gitignored). Shared by both ingests — keyed
// on the registry's GUID xmlFile name, so executive and municipal never
// collide even though they land in the same year directory.
export const RAW_DIR = path.join(ROOT, "raw_data", "officials");

const UA = "electionsbg.com officials pipeline";

// register.cacbg.bg serves an incomplete TLS chain — accept it explicitly
// rather than disabling verification process-wide.
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Match parliament.bg's canonical form so the SPA can later cross-reference
// "is this official also a sitting MP?" without a second normalization.
//
// Also the base of canonicalDeclarantName() below, and therefore of every
// officials profile URL: a tweak made for the parliament cross-reference
// re-slugs all 21,161 profiles. official_slug.test.ts pins a full slug string
// so that lands as a red test rather than as a silent mass rename.
export const normalize = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// "Бойко Методиев Борисов" → "boyko-metodiev-borisov-2641". Stable across runs.
// A short hash of the name + a disambiguator (institution, or institution +
// role) keeps two officials with the same legal name from colliding.
//
// RAW in, deliberately: this is the historical primitive, and
// ./remerge_collision_slugs.ts reproduces already-published slugs with it.
// Callers that mint a profile slug want ./officialSlug below, which feeds this
// the CANONICAL name.
export const slugify = (name: string, disambiguator: string): string => {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ьъ]/g, "")
    .replace(/[а-яё]/g, (ch) => {
      const map: Record<string, string> = {
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
        ю: "yu",
        я: "ya",
      };
      return map[ch] ?? ch;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Short stable suffix: first 6 hex chars of a 32-bit FNV-1a over the
  // name + disambiguator.
  let h = 2166136261;
  for (const ch of `${name}|${disambiguator}`) {
    h = (h ^ ch.charCodeAt(0)) >>> 0;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const suffix = h.toString(16).padStart(8, "0").slice(0, 6);
  return `${base}-${suffix}`;
};

// The register spells the same declarant differently between folder years, and
// `slugify` above turns every spelling into a different profile. It lowercases
// and collapses punctuation for the slug BODY but hashes the string it was
// handed, so two spellings that produce a byte-identical body still land on
// different 6-hex suffixes: "АЛДИН ХИТОВ КАРАГЬОЗОВ" (2022-23) and "Алдин Хитов
// Карагьозов" (2024-25) are one person under two profiles, each publishing part
// of his wealth. 270 register person-GUIDs are split that way across 587 shards,
// 185 of them by letter-case alone — the register moved from ALL-CAPS to Title
// Case between the 2023 and 2024 folders.
//
// The prefix the register sometimes prepends does the same: Ася Русева Генева of
// РЗИ filed as "д-р …" through 2023, "Д-Р …" in 2024 and "…" in 2025 — three
// profiles for one person. A title is not part of a legal name, so it goes.
//
// Deliberately ONLY "д-р": it is the single title the corpus carries, on 13 of
// the profiles this function actually governs. (Counting the DECLARATION XML's
// name instead gives 114 filings — a different population, and not the one the
// slug is minted from: both ingests hash the register list.xml name, while the
// shards store the name parsed out of each XML.) Every extra alternative is
// another chance to swallow a real given name, so add one here only after
// confirming it appears in the LIST names.
//
// Two XML-name spellings would not match this rule even if it were applied
// there — "д-рНягол Минчев Няголов" (glued, 4 filings) and "д- Васил Николаев
// Попов" (truncated, 1). Left deliberately unmatched: loosening the regex far
// enough to catch them is how it starts eating given names. They belong to the
// person-GUID alias table instead.
const TITLE_PREFIX = /^Д-Р\s+/;

// What is NOT stripped, and must not be: a trailing digit. It looks like noise
// and is not — it is the register's OWN disambiguator for two same-named people
// in one group label, and it means different things in different rows. Under
// "Училища", "Стоян Георгиев Стоянов1" (AF888636…) and "Стоян Георгиев Стоянов"
// (A571FD82…) are two different people, so stripping the 1 MERGES them and
// publishes one man's property under the other's name. Under "Държавни
// предприятия" the same suffix is noise on ONE person (F8462CC8… holds both a
// "…Христов1" and a "…Христов" shard) while the bare name is shared with a
// second person entirely. No textual rule can tell those apart — the seven
// digit-suffixed names in the corpus are resolved by person-GUID in
// ./_declarant_guid_aliases.json instead.

/** The declarant name reduced to what identifies the PERSON, so that the
 *  register's spelling drift between folder years cannot fork one official into
 *  several profiles. Case, inner whitespace and hyphen spacing are levelled by
 *  `normalize`; an academic title is dropped on top of that. */
export const canonicalDeclarantName = (name: string): string =>
  // No trailing .trim(): `normalize` already trimmed, and TITLE_PREFIX eats its
  // own trailing whitespace.
  normalize(name).replace(TITLE_PREFIX, "");

/** The slug an official's profile is published under. Same hash as `slugify`,
 *  but over the canonical name — so a re-spelling lands on the slug the person
 *  already has.
 *
 *  For a case, whitespace or hyphen re-spelling only the 6-hex suffix moves:
 *  `slugify` already lowercased and collapsed those out of the body. Dropping a
 *  TITLE is the exception — it shortens the body too
 *  (`d-r-asya-ruseva-geneva-888eb6` → `asya-ruseva-geneva-20d334`), on 13 of the
 *  21,161 profiles on disk. So a rename migration must key on the whole old
 *  slug; matching old to new by a shared body would silently miss exactly the
 *  profiles the title rule exists to merge. */
export const officialSlug = (name: string, disambiguator: string): string =>
  slugify(canonicalDeclarantName(name), disambiguator);

// Fetch with a small retry — the municipal ingest makes ~6,700 sequential
// requests, so a single transient blip should not kill a 30-minute run.
//
// `allow404` returns null instead of throwing, and never burns retries on it:
// a 404 is a permanent statement that the file is not there, unlike the
// transient failures the retry loop exists for. The register's list.xml does
// reference declarations whose XML is missing (seen in the 2018 and 2024
// folders), so callers that walk a whole year need to survive it.
const fetchTextInner = async (
  url: string,
  allow404: boolean,
): Promise<string | null> => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/xml, text/xml, */*",
        },
        // @ts-expect-error: dispatcher is undici-only, not in fetch's typings
        dispatcher: url.startsWith(REGISTER_BASE)
          ? insecureDispatcher
          : undefined,
      });
      if (res.status === 404 && allow404) return null;
      if (!res.ok) {
        throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
      }
      return res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(2000 * attempt);
    }
  }
};

export const fetchText = async (url: string): Promise<string> =>
  (await fetchTextInner(url, false)) as string;

export const fetchTextOptional = (url: string): Promise<string | null> =>
  fetchTextInner(url, true);

const cachePath = (year: number, xmlFile: string): string =>
  path.join(RAW_DIR, String(year), xmlFile);

// Fetch one declaration XML, caching it under raw_data/officials/<year>/.
// `xml` is null when the register lists a declaration whose file is missing
// (404) — the caller decides whether that is tolerable. Nothing is cached in
// that case, so a later re-run retries the file in case upstream restores it.
//
// `fromCache` lets the caller skip the politeness sleep on a cache hit: it only
// exists to be kind to register.cacbg.bg between real requests, and a re-derive
// from a warm cache makes none. Sleeping on every one of ~9,000 cached reads
// added ~22 minutes per year to an otherwise CPU-bound pass.
export const fetchDeclaration = async (
  year: number,
  xmlFile: string,
  sourceUrl: string,
): Promise<{ xml: string | null; fromCache: boolean }> => {
  const out = cachePath(year, xmlFile);
  if (fs.existsSync(out))
    return { xml: fs.readFileSync(out, "utf-8"), fromCache: true };
  const xml = await fetchTextOptional(sourceUrl);
  if (xml == null) return { xml: null, fromCache: false };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, xml, "utf-8");
  return { xml, fromCache: false };
};

export const writeJson = (file: string, obj: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf-8");
};
