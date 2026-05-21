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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, "../..");
export const REGISTER_BASE = "https://register.cacbg.bg";
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
export const normalize = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// "Бойко Методиев Борисов" → "boyko-metodiev-borisov-2641". Stable across runs.
// A short hash of the name + a disambiguator (institution, or institution +
// role) keeps two officials with the same legal name from colliding.
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

// Fetch with a small retry — the municipal ingest makes ~6,700 sequential
// requests, so a single transient blip should not kill a 30-minute run.
export const fetchText = async (url: string): Promise<string> => {
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

const cachePath = (year: number, xmlFile: string): string =>
  path.join(RAW_DIR, String(year), xmlFile);

// Fetch one declaration XML, caching it under raw_data/officials/<year>/.
export const fetchDeclaration = async (
  year: number,
  xmlFile: string,
  sourceUrl: string,
): Promise<string> => {
  const out = cachePath(year, xmlFile);
  if (fs.existsSync(out)) return fs.readFileSync(out, "utf-8");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const xml = await fetchText(sourceUrl);
  fs.writeFileSync(out, xml, "utf-8");
  return xml;
};

export const writeJson = (file: string, obj: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf-8");
};
