// Load external NGO funding into Postgres `ngo_funding` (migration 040): EU
// direct funds (FTS), domestic State-Budget subsidies to named ЮЛНЦ, and (later)
// foreign grantmakers. Every source is name-keyed, so we match to a BG EIK via
// VAT (FTS only) → exact folded-name → fuzzy trigram, scoped to the NGO surface.
//
//   npm run db:load:ngo-funding:pg
//
// Sources on disk:
//   raw_data/ngo_funding/fts/*.xlsx           — EU FTS per-year datasets
//     (download: https://ec.europa.eu/budget/financial-transparency-system/
//      download/{YEAR}_FTS_dataset_en.xlsx)
//   data/ngo/budget_subsidies.json            — curated State-Budget subsidies
//   data/ngo/foreign_grants.json              — curated ABF/NED grantee rows
// See docs/plans/ngo-final-implementation-plan.md (Phases 5a + 6).

import * as fs from "node:fs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { exec, withClient, end } from "../db/lib/pg";
import { recordIngestBatch } from "../db/lib/ingest_changelog";

// The ESM build of `xlsx` ships without Node fs bound — wire it so readFile works.
XLSX.set_fs(fs);

const FTS_DIR = fileURLToPath(
  new URL("../../raw_data/ngo_funding/fts", import.meta.url),
);
const BUDGET_JSON = fileURLToPath(
  new URL("../../data/ngo/budget_subsidies.json", import.meta.url),
);
const FOREIGN_JSON = fileURLToPath(
  new URL("../../data/ngo/foreign_grants.json", import.meta.url),
);
const ABF_PROJECTS = fileURLToPath(
  new URL("../../data/ngo/abf/projects.json", import.meta.url),
);
const ABF_ALIASES = fileURLToPath(
  new URL("../../data/ngo/abf_aliases.json", import.meta.url),
);
const BGN_PER_EUR = 1.95583;
const SCHEMA_SQL = fileURLToPath(
  new URL("../db/schema/pg/040_ngo_funding.sql", import.meta.url),
);
const TRACKING_SQL = fileURLToPath(
  new URL("../db/schema/pg/005_ingest_tracking.sql", import.meta.url),
);

type RawRow = {
  name_raw: string;
  source: string;
  funder: string | null;
  year: number | null;
  amount_eur: number | null;
  programme: string | null;
  vat: string | null;
  // Pre-resolved EIK (ABF grantees are English → matched via a curated alias map,
  // not the Cyrillic fold matcher). When set, it wins over VAT/fold/fuzzy.
  eik?: string | null;
};

// Robust column pick — FTS headers carry stray double-spaces / smart chars.
const pick = (row: Record<string, unknown>, re: RegExp): unknown => {
  for (const k of Object.keys(row)) if (re.test(k)) return row[k];
  return null;
};

const parseFts = (): RawRow[] => {
  if (!existsSync(FTS_DIR)) return [];
  const files = readdirSync(FTS_DIR).filter((f) => f.endsWith(".xlsx"));
  const out: RawRow[] = [];
  for (const f of files) {
    const wb = XLSX.readFile(`${FTS_DIR}/${f}`);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[wb.SheetNames[0]],
      { defval: null },
    );
    for (const r of rows) {
      const country = String(pick(r, /Beneficiary country/) ?? "");
      if (!country.includes("Bulgaria")) continue;
      const isNgo = String(pick(r, /Non-governmental/) ?? "") === "Yes";
      const isNfpo = String(pick(r, /Not-for-profit/) ?? "") === "Yes";
      if (!isNgo && !isNfpo) continue; // NGO surface only
      const name = String(pick(r, /Name of beneficiary/) ?? "").trim();
      if (!name) continue;
      const amt = Number(pick(r, /Commitment\s+total amount/));
      out.push({
        name_raw: name,
        source: "eu_fts",
        funder: "EU (direct)",
        year: Number(pick(r, /^Year/)) || null,
        amount_eur: Number.isFinite(amt) ? amt : null,
        programme: (pick(r, /Programme name/) as string) ?? null,
        vat: (pick(r, /VAT number/) as string) ?? null,
      });
    }
  }
  return out;
};

const parseCurated = (path: string, defaultSource: string): RawRow[] => {
  if (!existsSync(path)) return [];
  const arr = JSON.parse(readFileSync(path, "utf8")) as Array<{
    name: string;
    // Per-row `source` (e.g. 'abf' vs 'ned') — falls back to the file's default
    // so a mixed foreign-grants file labels each row correctly rather than
    // stamping the whole file with one funder.
    source?: string;
    funder?: string;
    year?: number;
    amountEur?: number;
    programme?: string;
    eik?: string;
  }>;
  return arr.map((r) => ({
    name_raw: r.name,
    source: r.source ?? defaultSource,
    funder: r.funder ?? null,
    year: r.year ?? null,
    amount_eur: r.amountEur ?? null,
    programme: r.programme ?? null,
    // A curated row may carry a hand-verified EIK — stash it in `vat` as
    // "BG<eik>" so the matcher treats it as an exact identifier.
    vat: r.eik ? `BG${r.eik}` : null,
  }));
};

// ABF (America for Bulgaria Fdn) Project Database — scraped English-named grantees
// (data/ngo/abf/projects.json, via scripts/ngo/abf_fetch.ts). English names can't
// join the Cyrillic register via the fold matcher, so a curated alias map
// (data/ngo/abf_aliases.json) resolves the top recipients → EIK; the rest stay
// unmatched (stored, but don't feed foreign_funded). BGN amounts → EUR.
const parseAbf = (): RawRow[] => {
  if (!existsSync(ABF_PROJECTS)) return [];
  const projects = JSON.parse(readFileSync(ABF_PROJECTS, "utf8")) as Array<{
    grantee?: string;
    name?: string;
    amount?: number | null;
    currency?: string | null;
    year?: number | null;
  }>;
  const aliases: Array<{ eik: string; en: string[] }> = existsSync(ABF_ALIASES)
    ? (JSON.parse(readFileSync(ABF_ALIASES, "utf8")).aliases ?? [])
    : [];
  const findEik = (grantee: string): string | null => {
    const g = grantee.toLowerCase();
    for (const a of aliases)
      if (a.en.some((s) => g.includes(s.toLowerCase()))) return a.eik;
    return null;
  };
  const out: RawRow[] = [];
  for (const p of projects) {
    if (!p.grantee || p.amount == null) continue;
    const eur =
      p.currency === "EUR"
        ? p.amount
        : p.currency === "BGN"
          ? p.amount / BGN_PER_EUR
          : null;
    // No trustworthy EUR conversion for other currencies (ABF grants are often
    // USD, whose rate is not pegged): skip rather than store a null amount that
    // silently zeroes the grant. Log so the drop is visible.
    if (eur == null) {
      console.warn(
        `ngo: skipping grant with unconvertible currency ${p.currency ?? "?"} (${p.grantee}, ${p.amount})`,
      );
      continue;
    }
    out.push({
      name_raw: p.grantee,
      source: "abf",
      funder: "America for Bulgaria Foundation",
      year: p.year ?? null,
      amount_eur: Math.round(eur),
      programme: p.name ?? null,
      vat: null,
      eik: findEik(p.grantee),
    });
  }
  return out;
};

export const loadNgoFundingPg = async (): Promise<{
  rows: number;
  matched: number;
}> => {
  await exec(readFileSync(SCHEMA_SQL, "utf8"));
  await exec(readFileSync(TRACKING_SQL, "utf8"));

  const rows = [
    ...parseFts(),
    ...parseCurated(BUDGET_JSON, "budget_subsidy"),
    // ABF now has its own scraped path (parseAbf); the curated foreign-grants file
    // is for OTHER funders (e.g. NED), so it must NOT default to 'abf' — two 'abf'
    // sources over the same grantees would double-count into foreign_eur.
    ...parseCurated(FOREIGN_JSON, "ned"),
    ...parseAbf(),
  ];
  if (!rows.length) {
    console.warn("[ngo-funding] no source rows found — nothing to load.");
    return { rows: 0, matched: 0 };
  }

  // Stage raw rows, then match to EIK in one SQL pass (VAT → exact fold → fuzzy).
  // A real (not TEMP) table so the later exec()s — which draw fresh pool
  // connections — can see it; dropped at the end.
  await exec("DROP TABLE IF EXISTS ngo_funding_stage");
  await exec(`CREATE TABLE ngo_funding_stage (
    name_raw text, source text, funder text, year int,
    amount_eur numeric, programme text, vat text, eik text
  )`);

  await withClient(async (c) => {
    await c.query("BEGIN");
    const cols = 8;
    const batch = Math.floor(60000 / cols);
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      const values = slice
        .map(
          (_, r) =>
            `(${Array.from({ length: cols }, (_, k) => `$${r * cols + k + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO ngo_funding_stage (name_raw, source, funder, year, amount_eur, programme, vat, eik) VALUES ${values}`,
        slice.flatMap((r) => [
          r.name_raw,
          r.source,
          r.funder,
          r.year,
          r.amount_eur,
          r.programme,
          r.vat,
          r.eik ?? null,
        ]),
      );
    }
    await c.query("COMMIT");
  });

  // Match. `nf` = the NGO surface with a folded name for comparison. FTS names
  // are already romanized, so translit_bg_latin(name_raw) lines up with our
  // name_fold. VAT "BG#########" → eik (verified to exist). Fuzzy uses pg_trgm
  // similarity, top-1, and only when comfortably above the ambiguity floor.
  // TRUNCATE + repopulate + changelog in ONE transaction so a mid-load failure
  // can't leave ngo_funding empty (orphan-free), and the changelog commits with
  // the data. ngo_funding's PK is a serial, so the changelog keys on an md5 of
  // the row's content columns (stable across reloads).
  let total = 0;
  let matched = 0;
  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE ngo_funding");
    await c.query(`
    WITH nf AS (
      SELECT uic, name_fold FROM tr_companies
      WHERE entity_class IN ('ngo_assoc','ngo_found','chitalishte','foreign_branch')
    ),
    -- Only folds that map to exactly ONE NGO are safe for an exact match; an
    -- ambiguous fold falls through to fuzzy/unmatched (equi-join, no row blow-up).
    uniq_fold AS (
      SELECT name_fold, MIN(uic) AS uic FROM nf
      GROUP BY name_fold HAVING count(*) = 1
    ),
    m AS (
      SELECT s.*,
        translit_bg_latin(s.name_raw) AS fold,
        CASE WHEN s.vat ~ '^BG\\d{9}$' THEN substr(s.vat, 3) END AS vat_eik
      FROM ngo_funding_stage s
    )
    INSERT INTO ngo_funding (eik, name_raw, source, funder, year, amount_eur, programme, match_method)
    SELECT
      COALESCE(m.eik, vh.uic, uf.uic, fz.uic) AS eik,
      m.name_raw, m.source, m.funder, m.year, m.amount_eur, m.programme,
      CASE
        WHEN m.eik IS NOT NULL THEN 'manual'
        WHEN vh.uic IS NOT NULL THEN 'vat'
        WHEN uf.uic IS NOT NULL THEN 'name_exact'
        WHEN fz.uic IS NOT NULL THEN 'name_fuzzy'
        ELSE 'unmatched'
      END AS match_method
    FROM m
    LEFT JOIN tr_companies vh ON vh.uic = m.vat_eik
    LEFT JOIN uniq_fold uf ON uf.name_fold = m.fold
    LEFT JOIN LATERAL (
      SELECT nf.uic FROM nf
      WHERE m.vat_eik IS NULL AND uf.uic IS NULL AND length(m.fold) > 4
        -- ABF grantee names are ENGLISH; translit_bg_latin can't fold them to
        -- Cyrillic, so fuzzy similarity there mis-attributes funding to
        -- similarly-named (often commercial EOOD/Ltd) NGOs — e.g. "Balkan Pro
        -- Travel Ltd." → "Балкан Травел СК". ABF matches via the curated alias
        -- map (m.eik) or exact fold only; never fuzzy.
        AND m.source <> 'abf'
        AND similarity(nf.name_fold, m.fold) > 0.55
      ORDER BY similarity(nf.name_fold, m.fold) DESC
      LIMIT 1
    ) fz ON true
  `);
    await c.query("DROP TABLE IF EXISTS ngo_funding_stage");

    total = (await c.query("SELECT count(*)::int AS n FROM ngo_funding"))
      .rows[0].n;
    matched = (
      await c.query(
        "SELECT count(*)::int AS n FROM ngo_funding WHERE eik IS NOT NULL",
      )
    ).rows[0].n;

    // "What changed" changelog — atomic with the reload.
    await recordIngestBatch(c, {
      source: "ngo_funding",
      table: "ngo_funding",
      keyExpr:
        "md5(concat_ws('|', t.source, coalesce(t.funder,''), coalesce(t.year::text,''), t.name_raw, coalesce(t.amount_eur::text,''), coalesce(t.programme,'')))",
      nameExpr: "t.name_raw",
      detailExpr: "concat_ws(' · ', t.funder, t.programme)",
      amountExpr: "t.amount_eur::double precision",
      rowsTotal: total,
    });
    await c.query("COMMIT");
  });
  // Funding feeds the NGO signals matview (foreign_funded / budget_subsidy).
  // Refresh it if it exists (created by load_tr_pg.ts / migration 080); a DB that
  // hasn't run the TR load yet simply has no matview to refresh — skip cleanly.
  await withClient(async (c) => {
    const present = await c
      .query("SELECT to_regclass('public.ngo_signals') AS t")
      .then((r) => r.rows[0]?.t != null)
      .catch(() => false);
    if (present) await c.query("REFRESH MATERIALIZED VIEW ngo_signals");
  });
  return { rows: total, matched };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const t0 = Date.now();
  loadNgoFundingPg()
    .then(async ({ rows, matched }) => {
      console.log(
        `ngo_funding: ${rows} rows, ${matched} matched to EIK (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
