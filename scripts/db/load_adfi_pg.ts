// Load data/procurement/adfi.json into `adfi_inspection` + `adfi_coverage`
// (migration 173, plan P7), resolving each inspected body to an ЕИК by NAME.
//
//   npm run db:load:adfi:pg
//   npm run db:load:adfi:pg:cloud

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  adfiNameFold as fold,
  type AdfiInspection,
} from "../procurement/adfi/parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, "schema/pg/173_adfi.sql");
const SRC = path.resolve(__dirname, "../../data/procurement/adfi.json");

const main = async (): Promise<void> => {
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  if (!fs.existsSync(SRC)) {
    console.warn(
      `⚠ ${path.relative(process.cwd(), SRC)} is absent — schema applied, no ` +
        `rows loaded. Run \`npm run adfi:ingest -- --apply\`.`,
    );
    return;
  }
  const blob = JSON.parse(fs.readFileSync(SRC, "utf8")) as {
    coverage: { from: string; note: string };
    inspections: AdfiInspection[];
  };
  const rows = blob.inspections ?? [];
  if (!rows.length) throw new Error("adfi.json holds no inspections");

  // Every distinct spelling every awarder appears under, so a match can be made
  // against any of them rather than one arbitrary representative.
  const buyers = await allRows<{ eik: string; name: string }>(
    `SELECT DISTINCT awarder_eik AS eik, awarder_name AS name FROM contracts
      WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL`,
  );
  const byFold = new Map<string, Set<string>>();
  for (const b of buyers) {
    const k = fold(b.name);
    if (!k) continue;
    (byFold.get(k) ?? byFold.set(k, new Set()).get(k)!).add(String(b.eik));
  }

  let resolved = 0;
  let ambiguous = 0;
  const out = rows.map((r) => {
    const hits = byFold.get(fold(r.subject));
    // ⚠️ REFUSE, NEVER GRADE. One EIK or nothing: a name held by two buyers
    // cannot be attributed, and attaching a financial inspection to the wrong
    // public body is the most damaging error this dataset can make.
    let eik: string | null = null;
    if (hits && hits.size === 1) {
      eik = [...hits][0];
      resolved++;
    } else if (hits && hits.size > 1) ambiguous++;
    return [
      r.reportUrl,
      r.reportFile,
      r.subject,
      eik,
      r.legalBasis,
      r.publishedAt,
    ];
  });

  const [before] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM adfi_inspection",
  );
  const prev = Number(before?.n ?? 0);
  if (prev > 0 && out.length < prev * 0.95)
    throw new Error(
      `adfi.json has ${out.length} inspections against ${prev} loaded (>5% ` +
        `shrink). АДФИ does not withdraw reports — re-crawl before loading.`,
    );

  await withTx(async (c) => {
    await c.query("TRUNCATE adfi_inspection");
    await c.query("TRUNCATE adfi_coverage");
    await copyRows(
      c,
      "adfi_inspection",
      [
        "report_url",
        "report_file",
        "subject",
        "subject_eik",
        "legal_basis",
        "published_at",
      ],
      out,
    );
    await copyRows(
      c,
      "adfi_coverage",
      ["covered_from", "note"],
      [[blob.coverage.from, blob.coverage.note]],
    );
  });
  await vacuumAfterReload("adfi_inspection");
  await vacuumAfterReload("adfi_coverage");

  console.log(
    `✓ adfi_inspection: ${out.length.toLocaleString()} inspections · ` +
      `${resolved.toLocaleString()} resolved to an ЕИК ` +
      `(${((resolved / out.length) * 100).toFixed(1)}%) · ` +
      `${ambiguous} refused as ambiguous`,
  );
  console.log(
    `  coverage from ${blob.coverage.from} — an empty result for a buyer means ` +
      `„none since then", never „never inspected"`,
  );
};

main()
  .then(() => end())
  .catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
