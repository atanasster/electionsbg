// Automated cycle ingest for local elections — HTML-only path.
//
// The csv.zip bundle was the original plan but CIK serves it under different
// paths per cycle (mi2019's URL 404s for mi2023) and an aggressive per-resource
// Cloudflare Turnstile blocks programmatic download regardless. The HTML
// per-município pages, in contrast, clear the challenge cleanly under headed
// Playwright — and they contain everything the município tile needs (mayor
// elected, council with elected list + mandates, kmetstvo mayors). Section-
// level CSV ingest (votes per polling station) stays a manual operator step.
//
// Flow:
//   1. Discover OIK catalogue: load /<cycle>/tur1/rezultati/index.html, read
//      its #obl-select dropdown to find the 28 oblast entry-point município
//      OIK codes; for each, navigate and read #obs-select to get the full
//      município list for that oblast. Union → ~265 OIK codes.
//   2. Mirror per-município HTML pages (tur1 mandatory, tur2 allow-404).
//   3. Run parseLocalElection — it now works in HTML-only mode (CSV files
//      missing is no longer fatal; mayor/council/kmetstvo come from HTML).
//   4. Stamp state/ingest/cik_local.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  cikFetchText,
  readSelectOptions,
  readLocationSelectOptions,
  scrapeOikRefs,
  scrapeRayonRefs,
} from "./cik_fetch";
import { parseLocalElection } from "./parse_local_elections";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_ROOT = path.resolve(__dirname, "../../raw_data");
const INGEST_STATE = path.resolve(
  __dirname,
  "../../state/ingest/cik_local.json",
);

const REGULAR_DATES: Record<string, string> = {
  // 2007 is ingested by the dedicated ingest_mi2007 path (separate ЦИКМИ
  // archive + per-place HTML model), but keep the slug→folder mapping here so
  // cycleSlugToRawFolder stays total across every regular cycle.
  mi2007: "2007_10_28",
  mipvr2011: "2011_10_23",
  minr2015: "2015_10_25",
  mi2019: "2019_10_27",
  mi2023: "2023_10_29",
};

// CIK changed the per-município folder name between cycles: 2019+ uses
// /rezultati/<oik>.html, but the joint-cycle archives (2011 with president,
// 2015 with referendum) use /mestni/<oik>.html. Map per slug.
const RESULTS_PATH: Record<string, string> = {
  mipvr2011: "mestni",
  minr2015: "mestni",
  mi2019: "rezultati",
  mi2023: "rezultati",
};

const resultsPath = (cycleSlug: string): string =>
  RESULTS_PATH[cycleSlug] ?? "rezultati";

export const cycleSlugToRawFolder = (cycleSlug: string): string => {
  if (cycleSlug in REGULAR_DATES) return `${REGULAR_DATES[cycleSlug]}_mi`;
  // chmi*/<YYYY-MM-DD>_chastichen   = partial election in an existing município
  // chmi*/<YYYY-MM-DD>_nov          = new election triggered by município boundary changes
  // Treat both as chmi for storage purposes; the cycle slug is preserved in
  // the per-município bundle's `cycle` field so the source kind is still
  // recoverable.
  const m = cycleSlug.match(
    /chmi[^/]+\/(\d{4})-(\d{2})-(\d{2})_(chastichen|nov)$/,
  );
  if (m) {
    const suffix = m[4] === "nov" ? "_chmi_nov" : "_chmi";
    return `${m[1]}_${m[2]}_${m[3]}${suffix}`;
  }
  throw new Error(`Unrecognised CIK cycle slug: ${cycleSlug}`);
};

const ROOT = "https://results.cik.bg";

const oikFromOption = (raw: string): string | null => {
  // Option values look like "./0103.html" — extract the 4-digit OIK.
  const m = raw.match(/(\d{4})\.html$/);
  return m ? m[1] : null;
};

// 2011 (mipvr2011) is the outlier: its top-level dropdown lists 28 oblast
// codes as bare 2-digit values and a JS-constructed redirect picks the
// corresponding `mestni/XX.html` page. Recover the raw option value (2 or
// 4 digit) so the cascade can build the right URL per cycle.
const optionValueRaw = (raw: string): string | null => {
  const m = raw.match(/(?:\/)?(\d{2,4})(?:\.html)?$/);
  return m ? m[1] : null;
};

// "tur1/" for the usual two-round cycles; "" for roundless cycles — the
// single-round "нови избори за общински съветници" chmi partials publish
// results at `<cycle>/rezultati/...` with no tur1/tur2 split.
const roundSeg = (roundless: boolean, round: 1 | 2): string =>
  roundless ? "" : `tur${round}/`;

const oblastEntryUrl = (
  cycleSlug: string,
  inner: string,
  optionValue: string,
  roundless: boolean,
): string =>
  `${ROOT}/${cycleSlug}/${roundSeg(roundless, 1)}${inner}/${optionValue}.html`;

/**
 * Walk the oblast → município dropdowns on the rezultati index pages to
 * enumerate every OIK code that has a results page in the given cycle.
 */
// 2019/2023 AND every chmi partial use id'd dropdowns (#obl-select /
// #obs-select) — note the chmi dropdowns carry NO inline `onchange` (a JS
// listener drives navigation), so the `readLocationSelectOptions()` fallback
// (which keys off an onchange="window.location...") finds nothing for them.
// 2011/2015 publish the same cascading list under unnamed redirecting
// <select onchange=...> and rely on that fallback.
const usesIdSelects = (cycleSlug: string): boolean =>
  cycleSlug === "mi2019" ||
  cycleSlug === "mi2023" ||
  cycleSlug.startsWith("chmi");

const readOblastOptions = async (
  cycleSlug: string,
): Promise<{ value: string; text: string }[]> => {
  if (usesIdSelects(cycleSlug)) return readSelectOptions("obl-select");
  return readLocationSelectOptions();
};

// Per-oblast obshtina enumeration. 2019/2023 expose this as the #obs-select
// dropdown on the oblast entry page. 2015/2011 don't — instead, every
// município-page lists the other municípios of its oblast as inline anchor
// links. The scrape fallback unions all NNNN.html refs on the loaded page,
// filtered to the current oblast prefix so we don't drag in stray refs to
// other oblasts' default pages.
const readObshtinaOptions = async (
  cycleSlug: string,
  oblastPrefix: string,
): Promise<string[]> => {
  if (usesIdSelects(cycleSlug)) {
    const opts = await readSelectOptions("obs-select");
    return opts
      .map((o) => oikFromOption(o.value))
      .filter((c): c is string => !!c);
  }
  const refs = await scrapeOikRefs();
  return refs.filter((c) => c.startsWith(oblastPrefix));
};

const discoverOikCodes = async (
  cycleSlug: string,
  roundless: boolean,
): Promise<{ oikCodes: string[]; rayonStems: string[] }> => {
  const inner = resultsPath(cycleSlug);
  const indexUrl = `${ROOT}/${cycleSlug}/${roundSeg(roundless, 1)}${inner}/index.html`;
  await cikFetchText(indexUrl);
  const oblOptions = await readOblastOptions(cycleSlug);
  if (oblOptions.length === 0) {
    throw new Error(
      `Could not enumerate oblast dropdown on ${indexUrl} — page layout may have changed`,
    );
  }
  const oikCodes = new Set<string>();
  const rayonStems = new Set<string>();
  for (const opt of oblOptions) {
    const rawValue = optionValueRaw(opt.value);
    if (!rawValue) continue;
    // 2-digit oblast codes (2011) become oblast index pages; 4-digit codes
    // (2015/2019/2023) directly identify the oblast capital's município.
    const oblastPrefix = rawValue.slice(0, 2);
    if (rawValue.length === 4) {
      oikCodes.add(rawValue);
    }
    await cikFetchText(oblastEntryUrl(cycleSlug, inner, rawValue, roundless));
    const obshtinaCodes = await readObshtinaOptions(cycleSlug, oblastPrefix);
    for (const code of obshtinaCodes) oikCodes.add(code);
    // Harvest район refs while we're on the oblast capital page —
    // Sofia/Plovdiv/Varna 2015 split each район mayor race into a
    // separate `mestni/NNNN_NNNNNr.html` page that the bare 4-digit
    // OIK discovery misses. Free for cycles where no such pattern
    // exists (e.g. all 2011 pages).
    const stems = await scrapeRayonRefs();
    for (const s of stems) rayonStems.add(s);
  }
  // Targeted район sweep for the multi-район cities whose pages aren't
  // the alphabetically-first obshtina in their oblast (Plovdiv 1622 sits
  // mid-list, behind Асеновград 1601; Varna 0306 sits behind Аврен 0301).
  // Sofia (2246) happens to also be the oblast capital so the first pass
  // already covered it, but listing it here is idempotent. Only fired
  // for cycles where the inner folder is `mestni/` (pre-2019); 2019+
  // cycles publish район mayors as in-page sub-sections instead.
  if (inner === "mestni") {
    for (const oik of ["2246", "1622", "0306"]) {
      if (!oikCodes.has(oik)) continue;
      await cikFetchText(`${ROOT}/${cycleSlug}/tur1/${inner}/${oik}.html`);
      const stems = await scrapeRayonRefs();
      for (const s of stems) rayonStems.add(s);
    }
  }
  return {
    oikCodes: Array.from(oikCodes).sort(),
    rayonStems: Array.from(rayonStems).sort(),
  };
};

/**
 * Mirror each OIK's per-município HTML page for both tur1 and tur2.
 * Idempotent: already-downloaded files are skipped.
 */
const mirrorHtmlPages = async (opts: {
  cycleSlug: string;
  rawFolder: string;
  oikCodes: string[];
  roundless: boolean;
  delayMs?: number;
}): Promise<{ tur1: number; tur2: number; tur1Missing: string[] }> => {
  const { cycleSlug, rawFolder, oikCodes, roundless, delayMs = 200 } = opts;
  // Roundless cycles have a single round; we still store it under html/tur1
  // so the parser (which always reads html/tur1) finds it unchanged.
  const tur1Dir = path.join(rawFolder, "html", "tur1");
  const tur2Dir = path.join(rawFolder, "html", "tur2");
  fs.mkdirSync(tur1Dir, { recursive: true });
  fs.mkdirSync(tur2Dir, { recursive: true });
  let tur1 = 0;
  let tur2 = 0;
  const tur1Missing: string[] = [];
  const inner = resultsPath(cycleSlug);
  for (const oik of oikCodes) {
    const t1File = path.join(tur1Dir, `${oik}.html`);
    if (!fs.existsSync(t1File)) {
      const html = await cikFetchText(
        `${ROOT}/${cycleSlug}/${roundSeg(roundless, 1)}${inner}/${oik}.html`,
        { allow404: true },
      );
      if (html) {
        fs.writeFileSync(t1File, html, "utf-8");
        tur1++;
      } else {
        tur1Missing.push(oik);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      tur1++;
    }
    if (roundless) continue; // no tur2 for single-round cycles
    const t2File = path.join(tur2Dir, `${oik}.html`);
    if (!fs.existsSync(t2File)) {
      const html = await cikFetchText(
        `${ROOT}/${cycleSlug}/tur2/${inner}/${oik}.html`,
        { allow404: true },
      );
      if (html) {
        fs.writeFileSync(t2File, html, "utf-8");
        tur2++;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { tur1, tur2, tur1Missing };
};

const writeIngestState = (state: {
  lastSuccessfulIngest: string;
  lastCycles: string[];
  summary: string;
}): void => {
  fs.mkdirSync(path.dirname(INGEST_STATE), { recursive: true });
  fs.writeFileSync(
    INGEST_STATE,
    JSON.stringify(state, null, 2) + "\n",
    "utf-8",
  );
};

export type IngestResult = {
  cycleSlug: string;
  rawFolder: string;
  oikCount: number;
  tur1Mirrored: number;
  tur2Mirrored: number;
  tur1Missing: string[];
};

/**
 * End-to-end ingest of one CIK cycle. Discovers OIK codes from the rezultati
 * index dropdowns, mirrors every per-município HTML page, then invokes the
 * parser tree. Re-runs are idempotent for the mirror; the parser always
 * re-emits the JSON shards.
 */
export const ingestCycle = async (opts: {
  cycleSlug: string;
  publicFolder: string;
  stringify: (o: object) => string;
  delayMs?: number;
}): Promise<IngestResult> => {
  const { cycleSlug, publicFolder, stringify, delayMs } = opts;
  const folder = cycleSlugToRawFolder(cycleSlug);
  const rawFolder = path.join(RAW_ROOT, folder);
  fs.mkdirSync(rawFolder, { recursive: true });

  // Detect single-round ("roundless") cycles: the council-only "нови избори"
  // chmi partials publish at <cycle>/rezultati/... with no tur1/tur2 split, so
  // the usual tur1 index 404s. Probe it; fall back to the roundless layout.
  const inner = resultsPath(cycleSlug);
  const tur1Index = `${ROOT}/${cycleSlug}/tur1/${inner}/index.html`;
  const tur1IndexHtml = await cikFetchText(tur1Index, { allow404: true });
  const roundless = tur1IndexHtml === null;
  if (roundless) {
    console.log(
      `[ingest_cycle] ${cycleSlug} :: no tur1/ — single-round (roundless) cycle`,
    );
  }

  console.log(
    `[ingest_cycle] ${cycleSlug} → ${rawFolder} :: discovering OIK catalogue`,
  );
  const { oikCodes, rayonStems } = await discoverOikCodes(cycleSlug, roundless);
  console.log(
    `[ingest_cycle] ${cycleSlug} :: discovered ${oikCodes.length} OIK code(s)` +
      (rayonStems.length > 0 ? ` + ${rayonStems.length} район subpage(s)` : ""),
  );
  if (oikCodes.length === 0) {
    throw new Error(
      `${cycleSlug}: discovered 0 OIK codes — index layout unexpected?`,
    );
  }

  console.log(
    `[ingest_cycle] ${cycleSlug} :: mirroring HTML for ${oikCodes.length + rayonStems.length} page(s)`,
  );
  const { tur1, tur2, tur1Missing } = await mirrorHtmlPages({
    cycleSlug,
    rawFolder,
    oikCodes: [...oikCodes, ...rayonStems],
    roundless,
    delayMs,
  });
  console.log(
    `[ingest_cycle] ${cycleSlug} :: tur1=${tur1}, tur2=${tur2}, missing tur1=${tur1Missing.length}`,
  );

  await parseLocalElection({
    cycle: folder,
    rawDataRoot: RAW_ROOT,
    publicFolder,
    stringify,
  });

  return {
    cycleSlug,
    rawFolder,
    oikCount: oikCodes.length,
    tur1Mirrored: tur1,
    tur2Mirrored: tur2,
    tur1Missing,
  };
};

export const ingestCycles = async (opts: {
  cycleSlugs: string[];
  publicFolder: string;
  stringify: (o: object) => string;
}): Promise<IngestResult[]> => {
  const results: IngestResult[] = [];
  for (const slug of opts.cycleSlugs) {
    results.push(
      await ingestCycle({
        cycleSlug: slug,
        publicFolder: opts.publicFolder,
        stringify: opts.stringify,
      }),
    );
  }
  const summary = results
    .map(
      (r) =>
        `${r.cycleSlug}: ${r.tur1Mirrored} tur1 + ${r.tur2Mirrored} tur2 (${r.tur1Missing.length} tur1 missing)`,
    )
    .join("; ");
  writeIngestState({
    lastSuccessfulIngest: new Date().toISOString(),
    lastCycles: opts.cycleSlugs,
    summary,
  });
  return results;
};

export const cyclesChangedSinceLastIngest = (): {
  cycleSlugs: string[];
  watchLastChanged: string | null;
  ingestLastSuccess: string | null;
} => {
  const watchPath = path.resolve(
    __dirname,
    "../../state/watch/cik_results.json",
  );
  if (!fs.existsSync(watchPath)) {
    return {
      cycleSlugs: [],
      watchLastChanged: null,
      ingestLastSuccess: null,
    };
  }
  const watch = JSON.parse(fs.readFileSync(watchPath, "utf-8")) as {
    lastChanged: string;
    meta?: { cycles?: { cycle: string; status: number }[] };
  };
  const ingest = fs.existsSync(INGEST_STATE)
    ? (JSON.parse(fs.readFileSync(INGEST_STATE, "utf-8")) as {
        lastSuccessfulIngest: string;
      })
    : null;
  const ingestLastSuccess = ingest?.lastSuccessfulIngest ?? null;
  const watchLastChanged = watch.lastChanged ?? null;
  const reachable = (watch.meta?.cycles ?? [])
    .filter((c) => c.status === 200)
    .map((c) => c.cycle);
  const stale =
    !ingestLastSuccess ||
    (watchLastChanged && watchLastChanged > ingestLastSuccess);
  return {
    cycleSlugs: stale ? reachable : [],
    watchLastChanged,
    ingestLastSuccess,
  };
};
