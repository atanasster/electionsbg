// Load the Commerce-Registry (TR) companies + officers into Postgres for name
// search. Reads raw_data/tr/state.sqlite (the existing TR store), folds names via
// translit_bg_latin (a generated column), and builds GIN trigram indexes after
// the bulk load. Officers are deduped to one row per (uic, name).
//
//   npm run db:load:tr:pg        (needs `npm run db:pg:up` first)
//
// See docs/plans/postgres-migration-v1.md (Feature 1).

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { getPool, exec, withClient, end } from "./lib/pg";
import { rebuildRiskGradeScoped } from "./lib/riskGradeScoped";

const TR_DB = fileURLToPath(
  new URL("../../raw_data/tr/state.sqlite", import.meta.url),
);
const FN_SQL = fileURLToPath(
  new URL("./schema/pg/000_search_fns.sql", import.meta.url),
);
const TR_SQL = fileURLToPath(
  new URL("./schema/pg/003_tr_search.sql", import.meta.url),
);
const API_SQL = fileURLToPath(
  new URL("./schema/pg/004_search_api.sql", import.meta.url),
);
const BUILDERS_SQL = fileURLToPath(
  new URL("./schema/pg/007_query_builders.sql", import.meta.url),
);
const CONN_SQL = fileURLToPath(
  new URL("./schema/pg/008_connections.sql", import.meta.url),
);
const RELATED_SQL = fileURLToPath(
  new URL("./schema/pg/019_related_companies.sql", import.meta.url),
);
const OFFICERS_SQL = fileURLToPath(
  new URL("./schema/pg/022_company_officers.sql", import.meta.url),
);
const PERSON_API_SQL = fileURLToPath(
  new URL("./schema/pg/024_person_api.sql", import.meta.url),
);
const MP_JSON = fileURLToPath(
  new URL("../../data/procurement/derived/mp_connected.json", import.meta.url),
);
const PEP_JSON = fileURLToPath(
  new URL("../../data/procurement/derived/pep_connected.json", import.meta.url),
);

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

// Batched multi-row INSERT — cap each statement well under PG's 65535 params.
const bulkInsert = async (
  table: string,
  cols: string[],
  rows: unknown[][],
): Promise<void> => {
  const n = cols.length;
  const batch = Math.floor(60000 / n);
  await withClient(async (c) => {
    await c.query("BEGIN");
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      const values = slice
        .map(
          (_, r) =>
            `(${cols.map((_, col) => `$${r * n + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
        slice.flat(),
      );
    }
    await c.query("COMMIT");
  });
};

export const loadTrPg = async (): Promise<{
  companies: number;
  officers: number;
}> => {
  await waitForPg();
  await exec(readFileSync(FN_SQL, "utf8"));
  await exec(readFileSync(TR_SQL, "utf8"));

  const tr = new DatabaseSync(TR_DB, { readOnly: true });

  const companies = tr
    .prepare(
      "SELECT uic, name, legal_form, seat, status, funds_amount, funds_currency, last_updated, objectives, means, public_benefit, private_benefit FROM companies WHERE name IS NOT NULL AND name <> ''",
    )
    .all() as Array<Record<string, string | number | null>>;
  await bulkInsert(
    "tr_companies",
    [
      "uic",
      "name",
      "legal_form",
      "seat",
      "status",
      "funds_amount",
      "funds_currency",
      "last_updated",
    ],
    companies.map((r) => [
      r.uic,
      r.name,
      r.legal_form,
      r.seat,
      r.status,
      r.funds_amount,
      r.funds_currency,
      r.last_updated || null, // '' → NULL for the timestamptz column
    ]),
  );

  // ЮЛНЦ metadata sidecar — only rows that actually carry NGO fields.
  const ngoDetails = companies.filter(
    (r) =>
      r.objectives != null ||
      r.means != null ||
      r.public_benefit != null ||
      r.private_benefit != null,
  );
  if (ngoDetails.length)
    await bulkInsert(
      "ngo_details",
      ["uic", "public_benefit", "private_benefit", "objectives", "means"],
      ngoDetails.map((r) => [
        r.uic,
        r.public_benefit == null ? null : r.public_benefit === 1,
        r.private_benefit == null ? null : r.private_benefit === 1,
        r.objectives,
        r.means,
      ]),
    );

  const officers = tr
    .prepare(
      `SELECT uic, name,
              group_concat(DISTINCT role) AS roles,
              MAX(CASE WHEN erased_at IS NULL THEN 1 ELSE 0 END) AS active,
              MAX(COALESCE(NULLIF(erased_at, ''), NULLIF(added_at, ''))) AS changed_at
       FROM company_persons
       WHERE name IS NOT NULL AND name <> ''
       GROUP BY uic, name`,
    )
    .all() as Array<Record<string, string | number | null>>;
  await bulkInsert(
    "tr_officers",
    ["uic", "name", "roles", "active", "changed_at"],
    officers.map((r) => [
      r.uic,
      r.name,
      r.roles,
      r.active,
      r.changed_at || null,
    ]),
  );

  // Raw per-role records for the person page's history (from/to dates + share).
  const roles = tr
    .prepare(
      `SELECT uic, name, role, country, share_percent, share_amount, share_currency, added_at, erased_at
       FROM company_persons
       WHERE name IS NOT NULL AND name <> ''`,
    )
    .all() as Array<Record<string, string | number | null>>;
  await bulkInsert(
    "tr_person_roles",
    [
      "uic",
      "name",
      "role",
      "country",
      "share",
      "share_amount",
      "share_currency",
      "added_at",
      "erased_at",
    ],
    roles.map((r) => [
      r.uic,
      r.name,
      r.role,
      r.country,
      r.share_percent,
      r.share_amount,
      r.share_currency,
      r.added_at || null,
      r.erased_at || null,
    ]),
  );
  tr.close();

  // One-shot index build (cheaper than incremental during load).
  await exec(
    "CREATE INDEX idx_tr_companies_fold ON tr_companies USING gin (name_fold gin_trgm_ops)",
  );
  await exec(
    "CREATE INDEX idx_tr_officers_fold ON tr_officers USING gin (name_fold gin_trgm_ops)",
  );
  await exec("CREATE INDEX idx_tr_officers_uic ON tr_officers (uic)");
  // Entity-class facet (NGO browse/segmentation) + NGO metadata lookup. The
  // composite (entity_class, name) also serves the /procurement/ngos browse's
  // default name-sort — a single-category facet becomes an index-only scan
  // (~0.2ms vs a ~190ms top-N sort over 30k rows).
  await exec(
    "CREATE INDEX idx_tr_companies_entity_class ON tr_companies (entity_class)",
  );
  await exec(
    "CREATE INDEX idx_tr_companies_class_name ON tr_companies (entity_class, name)",
  );
  // Btree for exact-fold person lookup (person_profile / connection_between).
  await exec("CREATE INDEX idx_tr_officers_fold_eq ON tr_officers (name_fold)");
  await exec(
    "CREATE INDEX idx_tr_person_roles_fold ON tr_person_roles (name_fold)",
  );
  await exec("CREATE INDEX idx_tr_person_roles_uic ON tr_person_roles (uic)");
  // Timestamp indexes for recent_updates' day-window filter.
  await exec(
    "CREATE INDEX idx_tr_companies_updated ON tr_companies (last_updated)",
  );
  await exec(
    "CREATE INDEX idx_tr_officers_changed ON tr_officers (changed_at)",
  );
  await exec("ANALYZE tr_companies");
  await exec("ANALYZE tr_officers");

  // Search API + multi-table builders (idempotent; depend on the tables +
  // contracts + contract_first_seen + contractor_search).
  await exec(readFileSync(API_SQL, "utf8"));
  await exec(readFileSync(BUILDERS_SQL, "utf8"));
  await exec(readFileSync(CONN_SQL, "utf8"));

  // Related-companies (same-owner) namesake index + fn. Matview is refreshed so
  // re-runs don't leave the owner→company counts stale.
  await exec(readFileSync(RELATED_SQL, "utf8"));
  await exec("REFRESH MATERIALIZED VIEW owner_name_counts");

  // Deduped officers relation for the server-side officers table.
  await exec(readFileSync(OFFICERS_SQL, "utf8"));
  await exec("REFRESH MATERIALIZED VIEW company_person_roles");
  // Officer namesake counts (hub pruning for the multi-hop path finder).
  await exec("REFRESH MATERIALIZED VIEW officer_name_counts");

  // Person-page portfolio rollups (procurement / by-cabinet / inner circle) —
  // depend on tr_officers + contracts + cabinets + officer_name_counts (above).
  await exec(readFileSync(PERSON_API_SQL, "utf8"));

  // Curated company↔politician links (from mp_connected / pep_connected) → PG,
  // so the person page's political connections come straight from the DB.
  const links: Array<
    [string, string, string, string, string | null, number | null, string]
  > = [];
  if (existsSync(MP_JSON)) {
    const mp = JSON.parse(readFileSync(MP_JSON, "utf8")) as {
      entries: Array<{
        mpId: number;
        mpName: string;
        contractorEik: string;
        relations?: Array<{ kind?: string }>;
        totalEur?: number;
      }>;
    };
    for (const e of mp.entries)
      links.push([
        e.contractorEik,
        e.mpName,
        `/candidate/mp-${e.mpId}`,
        "mp",
        e.relations?.[0]?.kind ?? null,
        e.totalEur ?? null,
        JSON.stringify(e.relations ?? []),
      ]);
  }
  if (existsSync(PEP_JSON)) {
    const pep = JSON.parse(readFileSync(PEP_JSON, "utf8")) as {
      entries: Array<{
        slug: string;
        name: string;
        contractorEik: string;
        role?: string;
        totalEur?: number;
        relations?: Array<{ role?: string }>;
      }>;
    };
    for (const e of pep.entries)
      links.push([
        e.contractorEik,
        e.name,
        `/officials/${e.slug}`,
        "official",
        e.role ?? null,
        e.totalEur ?? null,
        JSON.stringify(e.relations ?? []),
      ]);
  }
  await exec("TRUNCATE company_politicians");
  if (links.length)
    await bulkInsert(
      "company_politicians",
      ["eik", "politician", "ref", "kind", "role", "total_eur", "relations"],
      links,
    );

  // Awarder K-Index (politician/NGO-board-linked-supplier share per awarder) —
  // depends on contracts + the company_politicians just loaded. The migration
  // creates the fn + (re)builds the ranking matview. Skipped cleanly if the
  // contracts table isn't present yet (TR-only load before a contract load).
  const KINDEX_SQL = fileURLToPath(
    new URL("./schema/pg/039_awarder_kindex.sql", import.meta.url),
  );
  // Multi-component A–F risk grade (buyer + supplier) — same deps as the K-Index
  // (contracts + company_politicians), so applied in the same guarded block.
  const RISK_GRADE_SQL = fileURLToPath(
    new URL("./schema/pg/041_procurement_risk_grade.sql", import.meta.url),
  );
  const hasContracts = await getPool()
    .query("SELECT to_regclass('public.contracts') AS t")
    .then((r) => r.rows[0]?.t != null)
    .catch(() => false);
  if (hasContracts) {
    await exec(readFileSync(KINDEX_SQL, "utf8"));
    await exec(readFileSync(RISK_GRADE_SQL, "utf8"));
    // 041 rebuilt the ranking matview from fresh company_politicians; repopulate
    // the per-scope serving table so the leaderboard doesn't go stale (F-007).
    await withClient((c) => rebuildRiskGradeScoped(c));
  }

  await exec(
    "CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text)",
  );
  await withClient(async (c) => {
    for (const [k, v] of [
      ["tr_schema_version", "pg/003_tr_search.sql"],
      ["tr_generated_at", new Date().toISOString()],
      ["tr_code_git_sha", gitSha()],
      ["tr_companies", String(companies.length)],
      ["tr_officers", String(officers.length)],
    ])
      await c.query(
        "INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, v],
      );
  });

  return { companies: companies.length, officers: officers.length };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(TR_DB)) {
    console.error(`No TR store at ${TR_DB} — run the TR ingest first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  loadTrPg()
    .then(async ({ companies, officers }) => {
      console.log(
        `loaded ${companies} companies + ${officers} officers → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
