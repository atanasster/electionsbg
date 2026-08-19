// Load data/procurement/cprs.json into `cprs_licence` (migration 170).
//
//   npm run db:load:cprs:pg
//   npm run db:load:cprs:pg:cloud
//
// Pure-load: reads the committed artifact, never the network. The crawl half is
// `scripts/procurement/cprs/ingest.ts`, an operator action.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, end, withTx, allRows } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { vacuumAfterReload } from "./lib/pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, "schema/pg/170_cprs.sql");
const SRC = path.resolve(__dirname, "../../data/procurement/cprs.json");

type Licence = {
  eik: string;
  classCode: string;
  isGroup: boolean;
  firstProtocolNo: string | null;
  firstProtocolDate: string | null;
  unjoinable: boolean;
};
type Blob = {
  counts: { firms: number };
  /** class_code → the full ЗОП class sentence, held once rather than on each of
   *  106,508 rows (that cost 25 MB of artifact when it was per-row). */
  classes: Record<string, string>;
  /** eik → { name, oblast }. област is the firm's SEAT — see 170's header. */
  firms: Record<string, { name: string; oblast: string | null }>;
  licences: Licence[];
};

const main = async (): Promise<void> => {
  // DDL FIRST, capture second — the tender-dossier loader's rule. With the
  // guard first, a machine without the crawl prints „nothing to load", applies
  // no DDL and exits 0: a deploy that looks successful and creates nothing.
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  if (!fs.existsSync(SRC)) {
    console.warn(
      `⚠ ${path.relative(process.cwd(), SRC)} is absent — schema applied, no rows ` +
        `loaded. Run \`npx tsx scripts/procurement/cprs/ingest.ts --apply\` first.`,
    );
    return;
  }
  const blob = JSON.parse(fs.readFileSync(SRC, "utf8")) as Blob;
  const rows = blob.licences ?? [];
  if (!rows.length) throw new Error("cprs.json holds no licences");

  const [before] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM cprs_licence",
  );
  const prev = Number(before?.n ?? 0);
  // A shrink is a broken crawl, not a shrinking register — builders do not
  // leave the ЦПРС en masse. Same guard the budget merges carry.
  if (prev > 0 && rows.length < prev * 0.95)
    throw new Error(
      `cprs.json has ${rows.length} licences against ${prev} already loaded ` +
        `(>5% shrink). Re-crawl before loading, or pass --allow-shrink.`,
    );

  const firmRows = Object.entries(blob.firms ?? {});
  if (!firmRows.length) throw new Error("cprs.json holds no firms");
  // A licence whose class the artifact does not name would load with an empty
  // label and render as a blank eligibility class — refuse instead.
  const missingLabel = rows.find((l) => !blob.classes?.[l.classCode]);
  if (missingLabel)
    throw new Error(
      `class ${missingLabel.classCode} has no label in cprs.json — re-run the ingest`,
    );

  await withTx(async (c) => {
    await c.query("TRUNCATE cprs_licence");
    await c.query("TRUNCATE cprs_firm");
    await copyRows(
      c,
      "cprs_firm",
      ["eik", "name", "oblast"],
      firmRows.map(([eik, f]) => [eik, f.name, f.oblast]),
    );
    await copyRows(
      c,
      "cprs_licence",
      [
        "eik",
        "class_code",
        "class_label",
        "is_group",
        "first_protocol_no",
        "first_protocol_date",
        "unjoinable",
      ],
      rows.map((l) => [
        l.eik,
        l.classCode,
        blob.classes[l.classCode],
        l.isGroup,
        l.firstProtocolNo,
        l.firstProtocolDate,
        l.unjoinable,
      ]),
    );
  });
  // TRUNCATE + COPY in one transaction leaves relallvisible = 0 permanently,
  // so no index-only scan can ever be planned on this table again.
  await vacuumAfterReload("cprs_licence");
  await vacuumAfterReload("cprs_firm");

  const [after] = await allRows<{ n: string; firms: string; joinable: string }>(
    `SELECT count(*)::text n, count(DISTINCT eik)::text firms,
            count(DISTINCT eik) FILTER (WHERE NOT unjoinable)::text joinable
       FROM cprs_licence`,
  );
  console.log(
    `✓ cprs_licence: ${Number(after.n).toLocaleString()} licences · ` +
      `${Number(after.firms).toLocaleString()} firms ` +
      `(${Number(after.joinable).toLocaleString()} with a joinable ЕИК)`,
  );

  const [overlap] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT c.contractor_eik)::text n
       FROM contracts c JOIN cprs_licence l ON l.eik = c.contractor_eik
      WHERE c.tag = 'contract'`,
  );
  console.log(
    `  ${Number(overlap.n).toLocaleString()} of our contractors appear in the ЦПРС`,
  );
};

main()
  .then(() => end())
  .catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
