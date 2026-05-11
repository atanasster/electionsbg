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
//   - Parses the dokladi-subsidii page the same way.
//   - Writes data/financing/index.json so the frontend (or future deeper
//     ingest) has a starting catalogue. The watcher already detects when the
//     parent page changes structurally; this script just turns that signal
//     into structured data.
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

const SECTIONS = [
  {
    id: "otcheti",
    label: "Годишни финансови отчети",
    url: "https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/",
  },
  {
    id: "subsidii",
    label: "Доклади за субсидии",
    url: "https://www.bulnao.government.bg/bg/kontrol-partii/dokladi-subsidii/",
  },
];

interface YearEntry {
  year: number;
  label: string;
  externalUrl: string | null;
}

interface SectionResult {
  id: string;
  label: string;
  url: string;
  years: YearEntry[];
}

interface FinancingIndex {
  scrapedAt: string;
  sections: SectionResult[];
}

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
};

const parseSection = (html: string): YearEntry[] => {
  // Each year entry is shaped like:
  //   <p><strong><a href="https://gfopp.../?year=YYYY">Годишни ... за YYYY г. …
  // …with optional nested <strong>/<a> reorderings the upstream CMS injects.
  // We find each "Годишни ... за YYYY г." occurrence and look back ~250
  // chars for the nearest <a href="..."> to pair it with. Anchors with no
  // year nearby are ignored.
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

const main = async (args: { upload: boolean }): Promise<void> => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sections: SectionResult[] = [];
  for (const s of SECTIONS) {
    console.log(`→ ${s.label} (${s.url})`);
    const html = await fetchHtml(s.url);
    const years = parseSection(html);
    console.log(`  found ${years.length} year(s)`);
    sections.push({ ...s, years });
  }

  const out: FinancingIndex = {
    scrapedAt: new Date().toISOString(),
    sections,
  };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ wrote ${INDEX_FILE}`);

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
