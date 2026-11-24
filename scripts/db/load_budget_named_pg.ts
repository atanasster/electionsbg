// Load the State Budget Law's named investment projects (Приложение № 2 към чл. 110)
// into `budget_named_appropriation` + `budget_named_appropriation_amount`
// (migration 208, docs/plans/insait-gap-v1.md §4).
//
//   pnpm run db:load:budget-named:pg
//   pnpm run db:load:budget-named:pg:cloud
//
// Parses the cached Държавен вестник law HTML the budget ingest writes
// (raw_data/budget/law-<idMat>.html.gz, gitignored) for every year in
// LAW_DV_MATERIALS. Skips and warns when the cache is absent (a fresh clone):
// `pnpm run budget:ingest` fetches it. A law is immutable once promulgated, so each
// loaded year is REPLACED whole — RowExclusiveLock only, readers keep their snapshot.

import fs from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import { LAW_DV_MATERIALS } from "../budget/fetch_sources";
import {
  parseNamedAppropriations,
  type NamedAppropriation,
} from "../budget/named_appropriations";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "schema/pg");
const LAW_CACHE_DIR = path.resolve(__dirname, "../../raw_data/budget");

type YearRows = { year: number; idMat: string; rows: NamedAppropriation[] };

/** Parse every cached law, refusing a year whose annex did not read cleanly: a
 *  rejected row or a gap in a section's numbering means the page layout moved, and
 *  publishing the rest would understate that year without saying so. */
export const parseLaws = (
  read: (idMat: string) => string | null,
): { years: YearRows[]; missing: number[] } => {
  const years: YearRows[] = [];
  const missing: number[] = [];
  for (const [y, idMat] of Object.entries(LAW_DV_MATERIALS)) {
    const year = Number(y);
    const html = read(idMat);
    if (html == null) {
      missing.push(year);
      continue;
    }
    const { rows, rejected } = parseNamedAppropriations(html, year);
    if (rejected.length)
      throw new Error(
        `${year}: ${rejected.length} annex row(s) unreadable (first ${rejected[0].code}: ` +
          `${rejected[0].reason}) — the law's table layout changed; refusing to load.`,
      );
    // Every project code the law prints must have been read: a reworded heading or an
    // early stop would otherwise lose rows (or the whole annex) without a numbering gap.
    const printed = new Set(html.match(/NP-\d{2}\.\d{3}-\d{4}/g) ?? []);
    const parsed = new Set(rows.map((r) => r.projectCode));
    const lost = [...printed].filter((c) => !parsed.has(c));
    if (lost.length)
      throw new Error(
        `${year}: ${lost.length} project code(s) printed in the law were not read ` +
          `(first ${lost[0]}) — the annex layout changed; refusing to load.`,
      );
    for (const section of ["priority", "reserve"] as const) {
      const seqs = rows
        .filter((r) => r.section === section)
        .map((r) => r.seq)
        .sort((a, b) => a - b);
      if (seqs.some((s, i) => s !== i + 1))
        throw new Error(
          `${year} ${section}: row numbers are not 1..${seqs.length} — a row was lost; refusing to load.`,
        );
    }
    if (rows.length) years.push({ year, idMat, rows });
  }
  return { years, missing };
};

const main = async (): Promise<void> => {
  for (const f of [
    "005_ingest_tracking.sql",
    "208_budget_named_appropriation.sql",
  ])
    await exec(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  if (!existsSync(LAW_CACHE_DIR)) {
    console.warn(
      `→ schema applied; no ${path.relative(process.cwd(), LAW_CACHE_DIR)} — run ` +
        "`pnpm run budget:ingest` first.",
    );
    await end();
    return;
  }

  const { years, missing } = parseLaws((idMat) => {
    const f = path.join(LAW_CACHE_DIR, `law-${idMat}.html.gz`);
    return existsSync(f)
      ? gunzipSync(fs.readFileSync(f)).toString("utf8")
      : null;
  });
  if (missing.length)
    console.warn(`→ no cached law for ${missing.join(", ")} — skipped`);
  if (!years.length) {
    console.warn("→ no law in the cache carries the annex — nothing to load");
    await end();
    return;
  }

  let rowsNew = 0;
  await withTx(async (c) => {
    await c.query(
      "DELETE FROM budget_named_appropriation WHERE fiscal_year = ANY($1::int[])",
      [years.map((y) => y.year)],
    );
    const all = years.flatMap((y) =>
      y.rows.map((r) => ({ ...r, idMat: y.idMat })),
    );
    await copyRows(
      c,
      "budget_named_appropriation",
      [
        "fiscal_year",
        "section",
        "seq",
        "project_code",
        "title",
        "indicator",
        "institution",
        "currency",
        "dv_idmat",
      ],
      all.map((r) => [
        r.fiscalYear,
        r.section,
        r.seq,
        r.projectCode,
        r.title,
        r.indicator,
        r.institution,
        r.currency,
        r.idMat,
      ]),
    );
    await copyRows(
      c,
      "budget_named_appropriation_amount",
      [
        "fiscal_year",
        "section",
        "seq",
        "year",
        "kind",
        "amount_native",
        "amount_eur",
      ],
      all.flatMap((r) =>
        r.amounts.map((a) => [
          r.fiscalYear,
          r.section,
          r.seq,
          a.year,
          a.kind,
          a.native,
          a.eur,
        ]),
      ),
    );
    const n = Number(
      (
        await c.query<{ n: string }>(
          "SELECT count(*) AS n FROM budget_named_appropriation",
        )
      ).rows[0].n,
    );
    const r = await recordIngestBatch(c, {
      source: "budget_named_appropriation",
      table: "budget_named_appropriation",
      keyExpr: "t.fiscal_year || ':' || t.section || ':' || t.seq",
      nameExpr: "t.title",
      detailExpr: "t.institution",
      rowsTotal: n,
    });
    rowsNew = r.rowsNew;
  });
  await vacuumAfterReload(
    "budget_named_appropriation",
    "budget_named_appropriation_amount",
  );

  for (const y of years) {
    const sum = (kind: string) =>
      y.rows
        .flatMap((r) => r.amounts)
        .filter((a) => a.kind === kind && a.year === y.year)
        .reduce((s, a) => s + a.eur, 0);
    console.log(
      `✓ ${y.year}: ${y.rows.length} project(s) · appropriated €${Math.round(sum("appropriation")).toLocaleString("en")}` +
        (sum("indicative")
          ? ` · reserve (indicative) €${Math.round(sum("indicative")).toLocaleString("en")}`
          : ""),
    );
  }
  console.log(`  ${rowsNew} new`);
  await end();
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await end().catch(() => {});
    process.exit(1);
  });
