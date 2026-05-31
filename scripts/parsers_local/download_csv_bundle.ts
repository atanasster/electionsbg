// Acquire the per-cycle section-level CSV bundle (votes.txt / sections.txt /
// protocols.txt) from results.cik.bg via the CF-clearing headed Playwright
// session, then extract it (CP866-aware) under raw_data/<folder>/ТУР1/ so the
// orchestrator's CSV-augment path can read it.
//
// This is a flag-gated operator step (`npm run data -- --local-csv <slug>`),
// NOT part of the automatic watcher flow — the bundles are large and the
// download pops a desktop browser window (per the project's "one-off backfills
// stay manual / behind flags" convention).
//
// Bundle URLs are NOT a uniform csv.zip across cycles — see the per-cycle map
// below (and reference_cik_csv_bundle_urls in memory).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cikDownloadFile } from "./cik_fetch";
import { extractZipCp866 } from "./extract_bundle";
import { cycleSlugToRawFolder } from "./ingest_cycle";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_ROOT = path.resolve(__dirname, "../../raw_data");

type BundleSource = {
  /** The round-1 ZIP (council is decided in round 1; that's what we need). */
  url: string;
  /** A sibling HTML page of the same cycle to warm CF on before downloading. */
  warmUrl: string;
};

// Confirmed round-1 bundle URLs (probed 2026-05, see memory reference).
const BUNDLE_SOURCES: Record<string, BundleSource> = {
  mipvr2011: {
    url: "https://results.cik.bg/mipvr2011/el2011_t1.zip",
    warmUrl: "https://results.cik.bg/mipvr2011/tur1/mestni/index.html",
  },
  minr2015: {
    url: "https://results.cik.bg/minr2015/tur1/mi2015.zip",
    warmUrl: "https://results.cik.bg/minr2015/tur1/mestni/index.html",
  },
  mi2019: {
    url: "https://results.cik.bg/mi2019/csv.zip",
    warmUrl: "https://results.cik.bg/mi2019/tur1/rezultati/index.html",
  },
  mi2023: {
    // The bundle lives under tur1/opendata/ (the csv.html page's visible
    // "export.zip" link drops the /opendata/ segment and 404s — the real path
    // is tur1/opendata/export.zip; round 2 is tur2/opendata/export.zip).
    url: "https://results.cik.bg/mi2023/tur1/opendata/export.zip",
    warmUrl: "https://results.cik.bg/mi2023/tur1/csv.html",
  },
};

/**
 * Extract the bundle, normalising to a `ТУР1/<race>/...` layout under the raw
 * folder. Some cycles (2011/2015) ship race folders (ОС/КО/КК/КР) at the zip
 * root; others (mi2019/mi2023 single csv.zip) already carry a `ТУР1/` prefix.
 */
const extractNormalised = (zipPath: string, rawFolder: string): number => {
  // Peek the layout: a temp extract is wasteful, so we extract to a staging
  // dir then move. Simpler: extract to staging, detect the ТУР prefix, and
  // relocate into rawFolder accordingly.
  const staging = path.join(rawFolder, "_csv_staging");
  fs.rmSync(staging, { recursive: true, force: true });
  const written = extractZipCp866(zipPath, staging);
  const hasTurPrefix = written.some((w) => /^ТУР[12]\//.test(w));
  const targetRoot = hasTurPrefix ? rawFolder : path.join(rawFolder, "ТУР1");
  for (const rel of written) {
    const from = path.join(staging, rel);
    const to = path.join(targetRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  fs.rmSync(staging, { recursive: true, force: true });
  return written.length;
};

export const downloadCsvBundle = async (
  cycleSlug: string,
): Promise<{ rawFolder: string; fileCount: number } | null> => {
  const source = BUNDLE_SOURCES[cycleSlug];
  if (!source) {
    throw new Error(
      `No CSV bundle URL known for cycle "${cycleSlug}". Known: ${Object.keys(BUNDLE_SOURCES).join(", ")}`,
    );
  }
  const folder = cycleSlugToRawFolder(cycleSlug);
  const rawFolder = path.join(RAW_ROOT, folder);
  fs.mkdirSync(rawFolder, { recursive: true });
  const zipPath = path.join(rawFolder, "_bundle.zip");

  console.log(
    `[download_csv_bundle] ${cycleSlug} :: downloading ${source.url}`,
  );
  const saved = await cikDownloadFile(source.url, zipPath, {
    warmUrl: source.warmUrl,
    timeoutMs: 180_000,
  });
  if (!saved) {
    console.warn(
      `[download_csv_bundle] ${cycleSlug} :: download failed (CF / 404). ` +
        `Fall back to the manual operator drop (see README).`,
    );
    return null;
  }
  const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(
    `[download_csv_bundle] ${cycleSlug} :: got ${sizeMb} MB, extracting (cp866)`,
  );
  const fileCount = extractNormalised(zipPath, rawFolder);
  fs.rmSync(zipPath, { force: true });
  console.log(
    `[download_csv_bundle] ${cycleSlug} :: extracted ${fileCount} file(s) under ${rawFolder}/ТУР1`,
  );
  return { rawFolder, fileCount };
};
