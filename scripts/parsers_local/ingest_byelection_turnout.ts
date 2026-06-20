// Backfill exact turnout onto by-election (chmi) mayor bundles.
//
// The chmi rezultati summary pages publish candidate vote tallies only — no
// voter-list / turnout protocol — so a by-election bundle ships with a zeroed
// `protocol` and the dashboard can only *estimate* turnout. But ЦИК DOES serve
// the "Числови данни от протокол" as clean HTML at
//   <cycle>/tur{1,2}/protokoli/<el>/<oik>/<aggId>.html
// (one aggregate page per ОИК — район / kmetstvo / община). This step fetches
// that page for every район/община-mayor bundle and writes the real
// registered-voter + actual-voter totals into the bundle's `protocol`, so the
// дашборд shows the exact official активност instead of the estimate.
//
// Kmetstvo by-elections are skipped: their turnout never surfaces on the
// `ВОТ ЗА КМЕТ` card (only район/община mayor by-elections do), and the
// aggregate page is per-kmetstvo, not per-bundle.
//
// Network: headed Playwright via cik_fetch (pops a window). Idempotent.

import fs from "fs";
import path from "path";
import { cikFetchText, shutdownCikFetch } from "./cik_fetch.js";
import { cycleSlugToRawFolder } from "./ingest_cycle.js";
import { parseChisloviHtml } from "./parse_protocol_chislovi.js";
import { buildChmiHistory } from "./build_chmi_history.js";
import type {
  LocalMunicipalityBundle,
  LocalSectionResult,
  LocalSectionShard,
} from "./types.js";

const ROOT = "https://results.cik.bg";

type HasPdf = Record<string, Record<string, string[]>>;

const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[".,„""]/g, "")
    .trim();

/**
 * The bundle stores the synthetic obshtinaCode (e.g. "S2401") as its oikCode,
 * not the 4-digit CIK ОИК needed for the protocol URL. Recover that from the
 * already-downloaded raw rezultati HTML, which carries `data-ik="<oik>"` and
 * the place name ("избор на кмет на район/община <NAME>"). Key by name so the
 * bundle (matched on obshtinaName) can look the OIK up.
 */
const buildOikByName = (rawCycleDir: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const round of ["tur1", "tur2"]) {
    const dir = path.join(rawCycleDir, "html", round);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(dir, file), "utf8");
      const ik = html.match(/data-ik="(\d{4})"/)?.[1];
      if (!ik) continue;
      const text = html
        .replace(/<[^>]+>/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ");
      const m = text.match(
        /избор на кмет на (?:район|община)\s+(.+?)\s+(?:Обобщени|Числови|изборен|№)/,
      );
      if (m && !map.has(normName(m[1]))) map.set(normName(m[1]), ik); // tur1 wins
    }
  }
  return map;
};

/** Fetch + parse `HAS_PDF` from a round's pdf/data.js manifest. */
const fetchHasPdf = async (base: string): Promise<HasPdf> => {
  const raw =
    (await cikFetchText(`${base}/pdf/data.js`, { allow404: true })) ?? "";
  const body = raw
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const m = body.match(/HAS_PDF\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as HasPdf;
  } catch {
    return {};
  }
};

/**
 * Locate the aggregate-protocol (el, file) for a bundle's OIK.
 * Each `HAS_PDF[el][oik]` array ends with an "ik" / "ik-<dst>" sentinel marking
 * the aggregate; the file stem drops the "ik-" prefix ("ik-2201" → "2201",
 * bare "ik" → "ik"). Kmetstvo (el 4) is excluded — a район/община bundle's
 * aggregate is the whole OIK.
 */
const findAggregate = (
  hasPdf: HasPdf,
  oik: string,
  isRayon: boolean,
): { el: string; file: string } | null => {
  const hits: { el: string; file: string }[] = [];
  for (const [el, byOik] of Object.entries(hasPdf)) {
    if (el === "4") continue; // kmetstvo
    const entries = byOik[oik];
    if (!entries) continue;
    const ik = entries.find((e) => /^ik(-\d+)?$/.test(e));
    if (!ik) continue;
    hits.push({ el, file: ik === "ik" ? "ik" : ik.replace(/^ik-/, "") });
  }
  if (hits.length === 0) return null;
  // район mayor is election type 8; otherwise take the first non-kmetstvo type.
  return hits.find((h) => h.el === "8") ?? (isRayon ? null : hits[0]);
};

/**
 * Find the most recent regular `_mi` cycle that has a section shard for this
 * obshtinaCode. Its sections give us the 9-digit code list AND the lat/lon +
 * address + ekatte (a by-election reuses the same physical stations), which the
 * по-протокол HTML doesn't carry — so the by-election section map can render
 * without re-running the coords backfill.
 */
const findRegularShard = (
  publicFolder: string,
  obshtinaCode: string,
): LocalSectionShard | null => {
  const cycles = fs
    .readdirSync(publicFolder)
    .filter((d) => /^\d{4}_\d{2}_\d{2}_mi$/.test(d))
    .sort()
    .reverse();
  for (const c of cycles) {
    const p = path.join(publicFolder, c, "sections", `${obshtinaCode}.json`);
    if (fs.existsSync(p))
      return JSON.parse(fs.readFileSync(p, "utf8")) as LocalSectionShard;
  }
  return null;
};

/**
 * Build + write a by-election section shard (data/<cycle>/sections/<code>.json)
 * from the per-section "Числови данни" HTML. Per section: registered/voted from
 * the protocol, per-candidate votes as the mayor-vote field, coords joined from
 * the latest regular shard. Enables the per-section mayor map on the partial.
 */
const buildSectionShard = async (opts: {
  cycleSlug: string;
  round: 1 | 2;
  el: string;
  oik: string;
  rawFolder: string;
  bundle: LocalMunicipalityBundle;
  publicFolder: string;
  stringify: (o: object) => string;
}): Promise<number> => {
  const {
    cycleSlug,
    round,
    el,
    oik,
    rawFolder,
    bundle,
    publicFolder,
    stringify,
  } = opts;
  const regular = findRegularShard(publicFolder, bundle.obshtinaCode);
  if (!regular) {
    console.log(
      `[byelection-turnout]   ${bundle.obshtinaCode}: no regular shard for coords — section map skipped`,
    );
    return 0;
  }
  const isRayon = /^S2\d{3}$/.test(bundle.obshtinaCode);
  const base = `${ROOT}/${cycleSlug}/tur${round}/protokoli/${el}/${oik}`;
  const sections: LocalSectionResult[] = [];
  for (const rs of regular.sections) {
    const code = rs.sectionCode;
    let parsed = null;
    // Form-index suffix is ".0" for the common case; ".1" covers paper-only
    // sections. A station present in the regular cycle but not this by-election
    // 404s on both — skipped (no marker).
    for (const k of ["0", "1"]) {
      const h = await cikFetchText(`${base}/${code}.${k}.html`, {
        allow404: true,
      });
      if (!h) continue;
      const p = parseChisloviHtml(h);
      if (p && (p.candidateVotes.length > 0 || p.totalActualVoters > 0)) {
        parsed = p;
        break;
      }
    }
    if (!parsed) continue;
    const votes = parsed.candidateVotes.map((c) => ({
      localPartyNum: c.num,
      votes: c.votes,
    }));
    const valid = votes.reduce((a, v) => a + v.votes, 0);
    const result: LocalSectionResult = {
      sectionCode: code,
      settlement: rs.settlement,
      ekatte: rs.ekatte,
      isMobile: rs.isMobile,
      numRegisteredVoters: parsed.numRegisteredVoters,
      totalActualVoters: parsed.totalActualVoters,
      numValidVotes: valid,
      partyVotes: [],
      address: rs.address,
      longitude: rs.longitude,
      latitude: rs.latitude,
    };
    if (isRayon) {
      result.rayonMayorVotes = votes;
      result.rayonMayorValid = valid;
    } else {
      result.mayorVotes = votes;
      result.mayorValid = valid;
    }
    sections.push(result);
  }
  if (sections.length === 0) return 0;
  const shard: LocalSectionShard = {
    cycle: rawFolder,
    obshtinaCode: bundle.obshtinaCode,
    oikCode: regular.oikCode || oik,
    obshtinaName: bundle.obshtinaName,
    // Legend = the mayor candidates (their № == localPartyNum); colours are
    // resolved screen-side from the canonical id, so leave blank here.
    parties: bundle.mayor.round1.map((m) => ({
      localPartyNum: m.localPartyNum,
      localPartyName: m.localPartyName,
      primaryCanonicalId: m.primaryCanonicalId ?? null,
      color: "",
    })),
    sections,
  };
  const dir = path.join(publicFolder, rawFolder, "sections");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${bundle.obshtinaCode}.json`),
    stringify(shard),
    "utf8",
  );
  return sections.length;
};

export const ingestByElectionTurnout = async (opts: {
  cycleSlug: string;
  publicFolder: string;
  rawDataRoot: string;
  stringify: (o: object) => string;
}): Promise<void> => {
  const { cycleSlug, publicFolder, rawDataRoot, stringify } = opts;
  const rawFolder = cycleSlugToRawFolder(cycleSlug);
  const muniDir = path.join(publicFolder, rawFolder, "municipalities");
  if (!fs.existsSync(muniDir)) {
    console.log(`[byelection-turnout] no bundles at ${muniDir}`);
    return;
  }
  const oikByName = buildOikByName(path.join(rawDataRoot, rawFolder));

  const hasPdfByRound: Record<1 | 2, HasPdf | undefined> = {
    1: undefined,
    2: undefined,
  };
  const getHasPdf = async (round: 1 | 2): Promise<HasPdf> => {
    if (!hasPdfByRound[round])
      hasPdfByRound[round] = await fetchHasPdf(
        `${ROOT}/${cycleSlug}/tur${round}`,
      );
    return hasPdfByRound[round]!;
  };

  const files = fs.readdirSync(muniDir).filter((f) => f.endsWith(".json"));
  let written = 0;
  let skipped = 0;
  try {
    for (const file of files) {
      const full = path.join(muniDir, file);
      const bundle = JSON.parse(
        fs.readFileSync(full, "utf8"),
      ) as LocalMunicipalityBundle;
      // Only район / община mayor by-elections carry a mayor ballot here;
      // kmetstvo races live in `kmetstva` (mayor.round1 is empty).
      if (!bundle.mayor?.round1?.length) continue;

      const round: 1 | 2 = bundle.mayor.round2?.length ? 2 : 1;
      const oik = oikByName.get(normName(bundle.obshtinaName));
      if (!oik) {
        console.log(
          `[byelection-turnout] ${bundle.obshtinaCode} (${bundle.obshtinaName}): no OIK in raw HTML — skip`,
        );
        skipped++;
        continue;
      }
      const isRayon = /^S2\d{3}$/.test(bundle.obshtinaCode);
      const hasPdf = await getHasPdf(round);
      const agg = findAggregate(hasPdf, oik, isRayon);
      if (!agg) {
        console.log(
          `[byelection-turnout] ${bundle.obshtinaCode} (oik ${oik}): no aggregate protocol — skip`,
        );
        skipped++;
        continue;
      }

      const url = `${ROOT}/${cycleSlug}/tur${round}/protokoli/${agg.el}/${oik}/${agg.file}.html`;
      const html = await cikFetchText(url, { allow404: true });
      const parsed = html ? parseChisloviHtml(html) : null;
      if (!parsed || parsed.numRegisteredVoters <= 0) {
        console.log(
          `[byelection-turnout] ${bundle.obshtinaCode}: protocol unreadable at ${url} — skip`,
        );
        skipped++;
        continue;
      }

      const numValidVotes = bundle.mayor.round1.reduce(
        (a, m) => a + (m.votes || 0),
        0,
      );
      bundle.protocol = {
        numRegisteredVoters: parsed.numRegisteredVoters,
        totalActualVoters: parsed.totalActualVoters,
        numValidVotes,
      };
      fs.writeFileSync(full, stringify(bundle), "utf8");
      const pct = parsed.numRegisteredVoters
        ? (
            (parsed.totalActualVoters / parsed.numRegisteredVoters) *
            100
          ).toFixed(2)
        : "?";
      console.log(
        `[byelection-turnout] ${bundle.obshtinaCode} tur${round}: registered=${parsed.numRegisteredVoters} voted=${parsed.totalActualVoters} → ${pct}%`,
      );
      written++;

      // Per-section shard → the by-election mayor map.
      const nSections = await buildSectionShard({
        cycleSlug,
        round,
        el: agg.el,
        oik,
        rawFolder,
        bundle,
        publicFolder,
        stringify,
      });
      if (nSections > 0)
        console.log(
          `[byelection-turnout]   ${bundle.obshtinaCode}: wrote section shard (${nSections} stations)`,
        );
    }
  } finally {
    await shutdownCikFetch();
  }
  // Regenerate the chmi history feed so the now-backfilled turnout flows into
  // local_chmi_history.json (+ per-município shards) — the in-ingest build ran
  // before this backfill, against the zeroed protocol. Idempotent, no network.
  if (written > 0) buildChmiHistory({ stringify });
  console.log(
    `[byelection-turnout] done: ${written} written, ${skipped} skipped`,
  );
};
