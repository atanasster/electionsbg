// АДФИ ingest (plan P7) — fetch the inspection listing and write
// data/procurement/adfi.json.
//
//   npx tsx scripts/procurement/adfi/ingest.ts            # dry run
//   npx tsx scripts/procurement/adfi/ingest.ts --apply
//
// One page, one request. There is nothing to paginate and nothing to rate-limit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADFI_COVERAGE, ADFI_PAGES, BROWSER_UA } from "./sources";
import { parseAdfiTable, type AdfiInspection } from "./parse";
import { fetchText } from "../../watch/fingerprint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../../data/procurement/adfi.json");
const RAW = path.resolve(__dirname, "../../../raw_data/procurement/adfi");

/** Below this the page has changed shape; АДФИ does not un-publish reports. */
const MIN_ROWS = 500;

const main = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");
  const offline = process.argv.includes("--offline");

  const all: AdfiInspection[] = [];
  for (const page of ADFI_PAGES) {
    const cache = path.join(RAW, `${page.id}.html`);
    let html: string;
    if (offline) {
      if (!fs.existsSync(cache))
        throw new Error(`--offline but no cached copy at ${cache}`);
      html = fs.readFileSync(cache, "utf8");
    } else {
      const got = await fetchText(page.url, {
        headers: { "User-Agent": BROWSER_UA },
      });
      if (!got) throw new Error(`${page.id}: no body from ${page.url}`);
      html = got;
      fs.mkdirSync(RAW, { recursive: true });
      fs.writeFileSync(cache, html);
    }
    const rows = parseAdfiTable(html, page.url);
    console.log(`  ${page.id}: ${rows.length.toLocaleString()} inspections`);
    all.push(...rows);
  }

  if (all.length < MIN_ROWS)
    throw new Error(
      `only ${all.length} inspections parsed (floor ${MIN_ROWS}). АДФИ does not ` +
        `withdraw reports, so this is a page-shape change — refusing to write.`,
    );

  const subjects = new Set(all.map((r) => r.subject));
  console.log(
    `\n  ${all.length.toLocaleString()} inspections · ` +
      `${subjects.size.toLocaleString()} distinct bodies · ` +
      `${all.filter((r) => r.publishedAt).length.toLocaleString()} dated`,
  );

  if (!apply) {
    console.log(
      "\n(dry run — pass --apply to write data/procurement/adfi.json)",
    );
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        source: {
          pages: ADFI_PAGES.map((p) => ({
            id: p.id,
            url: p.url,
            label: p.label,
          })),
          fetchedAt: new Date().toISOString().slice(0, 10),
        },
        coverage: ADFI_COVERAGE,
        counts: { inspections: all.length, bodies: subjects.size },
        inspections: all.sort(
          (a, b) =>
            (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "") ||
            a.reportFile.localeCompare(b.reportFile),
        ),
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\n✓ wrote ${path.relative(process.cwd(), OUT)}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
