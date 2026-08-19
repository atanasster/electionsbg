// Load data/procurement/ted.json into `ted_notice` + `ted_coverage`
// (migration 172, plan P10).
//
//   npm run db:load:ted:pg
//   npm run db:load:ted:pg:cloud
//
// Pure-load: reads the committed artifact, never the network. The crawl half is
// `scripts/procurement/ted/ingest.ts`, an operator action.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import type { TedNotice } from "../procurement/ted/parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, "schema/pg/172_ted.sql");
const SRC = path.resolve(__dirname, "../../data/procurement/ted.json");

const main = async (): Promise<void> => {
  // DDL first, capture second — a machine without the crawl must still get the
  // tables, or a `deploy:db` shipping a route that reads them 42P01s.
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  if (!fs.existsSync(SRC)) {
    // The EXPECTED state on a fresh clone: ted.json is gitignored (73 MB), so
    // the schema exists and the tables are empty until an operator crawls.
    console.warn(
      `⚠ ${path.relative(process.cwd(), SRC)} is absent — schema applied, no ` +
        `rows loaded. It is gitignored; run \`npm run ted:ingest -- --apply\` ` +
        `(open EU API, ~15 min). This is the expected state on a fresh clone.`,
    );
    return;
  }
  const blob = JSON.parse(fs.readFileSync(SRC, "utf8")) as {
    counts: { notices: number; firstYear: number; lastYear: number };
    byYear: Record<string, TedNotice[]>;
  };
  const years = Object.entries(blob.byYear ?? {});
  if (!years.length) throw new Error("ted.json holds no years");

  // De-duplicate on the publication number. A notice can legitimately be
  // returned under two year queries when TED's publication date sits on a
  // boundary, and the PK would otherwise abort the whole COPY.
  const byPub = new Map<string, TedNotice>();
  for (const [, rows] of years)
    for (const r of rows) byPub.set(r.publicationNumber, r);
  const rows = [...byPub.values()];

  const [before] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM ted_notice",
  );
  const prev = Number(before?.n ?? 0);
  if (prev > 0 && rows.length < prev * 0.95)
    throw new Error(
      `ted.json has ${rows.length} notices against ${prev} already loaded ` +
        `(>5% shrink). TED does not un-publish; re-crawl before loading.`,
    );

  await withTx(async (c) => {
    await c.query("TRUNCATE ted_notice");
    await c.query("TRUNCATE ted_coverage");
    await copyRows(
      c,
      "ted_notice",
      [
        "publication_number",
        "publication_date",
        "buyer_eik",
        "buyer_name",
        "notice_type",
        "contract_nature",
        "procedure_type",
        "cpv",
        "total_value",
      ],
      rows.map((r) => [
        r.publicationNumber,
        r.publicationDate,
        r.buyerEik,
        r.buyerName,
        r.noticeType,
        r.contractNature,
        r.procedureType,
        r.cpv,
        r.totalValue,
      ]),
    );
    await copyRows(
      c,
      "ted_coverage",
      ["year", "notices"],
      years.map(([y, rs]) => [Number(y), rs.length]),
    );
  });
  await vacuumAfterReload("ted_notice");
  await vacuumAfterReload("ted_coverage");

  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*)::text n,
            count(DISTINCT buyer_eik)::text buyers,
            count(*) FILTER (WHERE buyer_eik IS NULL)::text no_eik
       FROM ted_notice`,
  );
  console.log(
    `✓ ted_notice: ${Number(r.n).toLocaleString()} notices · ` +
      `${Number(r.buyers).toLocaleString()} buyers · ${r.no_eik} without an ЕИК`,
  );
  const [j] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT t.buyer_eik)::text n FROM ted_notice t
      WHERE EXISTS (SELECT 1 FROM contracts c
                     WHERE c.tag='contract' AND c.awarder_eik = t.buyer_eik)`,
  );
  console.log(
    `  ${Number(j.n).toLocaleString()} of them also award contracts in our corpus`,
  );
  console.log(
    `  coverage: ${blob.counts.firstYear}–${blob.counts.lastYear} ` +
      `(earlier years return nothing — TED's index ramp, not a lack of procurement)`,
  );
};

main()
  .then(() => end())
  .catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
