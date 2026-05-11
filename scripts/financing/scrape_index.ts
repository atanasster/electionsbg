// Сметна палата party-financing index scraper.
//
// The Court of Audit splits party-financing oversight across two systems:
//
//   1. https://www.bulnao.government.bg/bg/kontrol-partii/
//      A Django CMS section with menu pages for:
//        - otcheti-na-partii — annual financial reports of parties
//        - dokladi-subsidii — state-subsidy reports
//        - spisyci — lists of registered parties
//        - syobshtenija-za-vrychvane-partii — official notifications
//        - obrazci-na-otcheti — report templates (forms)
//
//   2. https://gfopp.bulnao.government.bg/
//      "Годишни финансови отчети на политическите партии" — a legacy ASP.NET
//      WebForms application holding the actual per-year, per-party filings.
//      Each year lands on a per-status sub-page (s1.aspx ... s4.aspx):
//        s1 — filed on time, compliant
//        s2 — not filed
//        s3 — filed late, compliant
//        s4 — filed on time but non-compliant
//      Direct fetches of s*.aspx return 403 without a session cookie obtained
//      from the year landing. Deep ingest needs __VIEWSTATE handling — out of
//      scope for v1.
//
// What v1 does:
//   - Parses the otcheti-na-partii page for the list of available years and
//     the gfopp URL each year links to.
//   - Writes data/financing/index.json so the frontend (or future deeper
//     ingest) has a starting catalogue.
//
// Data-integrity contract:
//   - HTTP errors → throw (script exits non-zero).
//   - Sections with `minimumYears` that parse fewer rows than expected →
//     throw with a clear message naming the section and the page URL. This
//     is the upstream-restructure signal: better to fail than silently write
//     a near-empty index that the frontend would then trust.
//   - Sections marked `notImplemented` are emitted with `status: "not_implemented"`
//     and skipped entirely (no fetch). The frontend can distinguish "we tried
//     and found nothing" from "we haven't built this yet".
//
// CLI:
//   tsx scripts/financing/scrape_index.ts                # ingest
//   tsx scripts/financing/scrape_index.ts --upload       # ingest + GCS push

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { uploadText } from "../lib/upload";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "../../data/financing");
const INDEX_FILE = path.join(OUT_DIR, "index.json");

const UA =
  "Mozilla/5.0 (compatible; electionsbg-financing/1.0; +https://electionsbg.com)";

type SectionConfig = {
  id: string;
  label: string;
  url: string;
} & (
  | { notImplemented: true }
  | { notImplemented?: false; minimumYears: number }
);

// `minimumYears`: how many year entries we MUST find for this section to
// count as a successful scrape. Set with a safety margin below the known
// historical archive size — when the upstream page restructures and our
// regex stops matching, we want a loud failure, not a silently-empty index.
//
// otcheti-na-partii historically goes back to 2011 → ≥ 15 entries.
//   Setting min=10 leaves room for the CMS to legitimately collapse the
//   older years into an archive page without us crying wolf.
const SECTIONS: SectionConfig[] = [
  {
    id: "otcheti",
    label: "Годишни финансови отчети",
    url: "https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/",
    minimumYears: 10,
  },
  {
    id: "subsidii",
    label: "Доклади за субсидии",
    url: "https://www.bulnao.government.bg/bg/kontrol-partii/dokladi-subsidii/",
    // AJAX-rendered listing, no static anchors. Surface explicitly as
    // "not implemented" rather than fetching and writing an empty result —
    // an empty result here looks identical to "all entries removed", which
    // is a real failure mode we must NOT mask.
    notImplemented: true,
  },
];

interface YearEntry {
  year: number;
  label: string;
  externalUrl: string | null;
}

type SectionStatus = "ok" | "not_implemented";

interface SectionResult {
  id: string;
  label: string;
  url: string;
  status: SectionStatus;
  years: YearEntry[];
  note?: string;
}

interface FinancingIndex {
  scrapedAt: string;
  // Top-level status. "ok" if every required section met its minimum;
  // never written as anything else — failures throw before we write.
  status: "ok";
  sections: SectionResult[];
}

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length < 1000) {
    throw new Error(
      `GET ${url} returned only ${text.length} bytes — likely a redirect or error page`,
    );
  }
  return text;
};

const parseSection = (html: string): YearEntry[] => {
  // Each year entry is shaped like:
  //   <p><strong><a href="https://gfopp.../?year=YYYY">Годишни ... за YYYY г. …
  // …with optional nested <strong>/<a> reorderings the upstream CMS injects.
  // We find each "Годишни ... за YYYY г." occurrence and look back ~250
  // chars for the nearest <a href="..."> to pair it with.
  const out: YearEntry[] = [];
  const seen = new Set<number>();
  const yearRegex = /Годишни[^<]*?за\s*(20\d{2})\s*г\.?/g;
  for (const m of html.matchAll(yearRegex)) {
    const year = parseInt(m[1], 10);
    if (seen.has(year)) continue;
    seen.add(year);
    const startIdx = Math.max(0, (m.index ?? 0) - 300);
    const lookback = html.slice(startIdx, m.index ?? 0);
    const hrefMatches = [...lookback.matchAll(/<a[^>]+href="([^"]+)"/g)];
    const externalUrl =
      hrefMatches.length > 0 ? hrefMatches[hrefMatches.length - 1][1] : null;
    out.push({
      year,
      label: m[0].replace(/\s+/g, " ").trim(),
      externalUrl,
    });
  }
  out.sort((a, b) => b.year - a.year);
  return out;
};

const ingestSection = async (s: SectionConfig): Promise<SectionResult> => {
  if ("notImplemented" in s && s.notImplemented) {
    console.log(`· ${s.label}: not implemented (skipped, see SKILL.md)`);
    return {
      id: s.id,
      label: s.label,
      url: s.url,
      status: "not_implemented",
      years: [],
      note: "Static HTML has no year anchors; ingest requires Playwright or upstream API access. Not yet implemented.",
    };
  }

  console.log(`→ ${s.label} (${s.url})`);
  const html = await fetchHtml(s.url);
  const years = parseSection(html);
  console.log(`  parsed ${years.length} year(s) (minimum ${s.minimumYears})`);

  if (years.length < s.minimumYears) {
    throw new Error(
      `${s.label} (${s.url}): parsed only ${years.length} year(s), expected at least ${s.minimumYears}. ` +
        `The upstream page structure likely changed — open the URL in a browser and update the parser in scripts/financing/scrape_index.ts. ` +
        `Refusing to overwrite data/financing/index.json with a near-empty result.`,
    );
  }

  return {
    id: s.id,
    label: s.label,
    url: s.url,
    status: "ok",
    years,
  };
};

const main = async (args: { upload: boolean }): Promise<void> => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sections: SectionResult[] = [];
  for (const s of SECTIONS) {
    sections.push(await ingestSection(s));
  }

  const out: FinancingIndex = {
    scrapedAt: new Date().toISOString(),
    status: "ok",
    sections,
  };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(out, null, 2) + "\n");

  // Final summary so a glance at stdout (or the orchestrator's log) tells
  // the truth without re-reading the JSON.
  console.log(`✓ wrote ${INDEX_FILE}`);
  for (const s of sections) {
    const tag = s.status === "ok" ? `${s.years.length} years` : s.status;
    console.log(`  · ${s.label}: ${tag}`);
  }

  if (args.upload) {
    await uploadText(INDEX_FILE, "financing/index.json");
    console.log(`✓ uploaded`);
  }
};

const cli = command({
  name: "scrape_index",
  args: {
    upload: flag({
      type: optional(boolean),
      long: "upload",
      defaultValue: () => false,
    }),
  },
  handler: (args) => main({ upload: !!args.upload }),
});

run(cli, process.argv.slice(2));
