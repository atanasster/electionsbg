// Load the parsed asset declarations into Postgres (migration 089).
//
// Reads the SAME per-person JSON trees the app already ships — it does NOT
// re-parse or re-fetch — and COPY-loads them into declaration + its four child
// tables, so declared wealth becomes queryable against contracts / funds / agri /
// company / tr_person_roles / magistrate / elections on person_id. This is a
// SERVING loader: PG is the query engine, the JSON tree stays the ingest artifact
// (reference_funds_pg_only / feedback_no_json_from_pg) — nothing writes JSON back.
//
// LOAD ORDER (audit G13). declaration.person_id references person, but the resolver
// reads official_roster which the declaration ingest feeds, so person need not exist
// when declarations first load. So this runs in two phases:
//   phase 1 (default)   — TRUNCATE + COPY every filing with person_id LEFT NULL,
//                         keyed on (tier, subject_ref);
//   phase 2 (--resolve) — UPDATE declaration.person_id by joining person_role on
//                         subject_ref = ref (NOT tier = source — see below).
// db:refresh runs: load_declarations_pg (phase 1) → db:resolve:persons →
// load_declarations_pg --resolve → (090) REFRESH person_wealth_year. A first cold
// bootstrap has no person table for phase 2 to join, which is exactly why phase 1
// does not need one.
//
// The phase-2 join keys on subject_ref = person_role.ref, because `tier` is a coarse
// four-value label that is NOT a person_role.source: an exec declaration is
// tier='exec' but source 'official_exec' — and some exec categories fan out to
// president / mep / diplomat / regulator (src/lib/officialSources.ts). ref is unique
// across the corpus, so scoping by the tier→source SET and matching ref is exact.
//
// Run:
//   npm run db:load:declarations:pg            # phase 1 (load)
//   npm run db:load:declarations:pg -- --resolve   # phase 2 (fill person_id)
//   …:cloud variants point DATABASE_URL at the Cloud SQL proxy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  registerFolderYear,
  REGISTER_BASE as REGISTER_BASE_URL,
} from "../lib/cacbg_register";
import type { MpDeclaration } from "../../src/data/dataTypes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/089_declarations.sql");
// The wealth matview + serving fns (T2.3). Applied in phase 2 so its CREATE runs
// after person_id is filled, then REFRESHed — G13 step 4.
const WEALTH_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/090_person_wealth.sql",
);
// The accountability gate (T3.0) — the senior cohort the accumulation-gap metric
// may be computed for. A person_role join, so it also belongs after the resolve.
const GATE_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/091_accountability_gate.sql",
);
// The accumulation-gap serving fn (T3.2). Reads person_wealth_year + the 091 gate, so it
// is applied after both.
const GAP_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/092_accumulation_gap.sql",
);
// The disposals / third-party-expenses feed (T3.4). Reads declaration_event + person.
const EVENTS_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/093_declaration_events.sql",
);
// Filed-vs-required (T3.5) — the obligation roster, independent of person resolution, so
// it loads in phase 1 alongside the filings.
const OBLIGATIONS_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/094_declaration_obligations.sql",
);
const OBLIGATIONS_FILE = path.join(ROOT, "data/officials/obligations.json");
// recent_updates changelog (feedback_pg_changelog_required) — every PG-migrated
// dataset wires in. Applied here so a fresh bootstrap has the tables.
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);

type Tier = "mp" | "exec" | "muni" | "magistrate";

// Where each tier's per-person shards live, and how to read the subject_ref (the
// value the resolver stores as person_role.ref) out of a shard's filename / rows.
const TIERS: {
  tier: Tier;
  dir: string;
  // The candidate person_role.source values this tier resolves to. Phase 2 joins
  // person_role.ref = subject_ref AND source = ANY(these). exec fans out.
  sources: string[];
  // subject_ref for a filing in this tier.
  subjectRef: (
    d: MpDeclaration & Record<string, unknown>,
    file: string,
  ) => string;
}[] = [
  {
    tier: "mp",
    dir: "data/parliament/declarations",
    sources: ["mp"],
    subjectRef: (d) => String(d.mpId),
  },
  {
    tier: "exec",
    dir: "data/officials/declarations",
    sources: ["official_exec", "president", "mep", "diplomat", "regulator"],
    subjectRef: (d) => String(d.slug ?? ""),
  },
  {
    tier: "muni",
    dir: "data/officials/municipal/declarations",
    sources: ["official_muni"],
    subjectRef: (d) => String(d.slug ?? ""),
  },
  // The magistrate tier's declarations are not in a per-person JSON tree of this
  // shape (they live in the ИВСС register / magistrate_holdings). They are loaded
  // by the magistrate pipeline, not here; the tier value exists in the schema so a
  // future magistrate leg can COPY into the same tables. Skipped when its dir is
  // absent, which it is today.
  {
    tier: "magistrate",
    dir: "data/judiciary/declarations",
    sources: ["magistrate"],
    subjectRef: (d) => String(d.declarantName ?? ""),
  },
];

// Money / numeric fields arrive as number | null from the JSON. copyRows renders
// null → \N and numbers verbatim, so pass them straight through.
type Row = unknown[];

// filedAt is parsed upstream from a hand-keyed "dd.MM.yyyy" without range checking,
// so a day/month transposition slips through as e.g. "2025-16-04" (month 16), which
// Postgres rejects and which would abort the whole COPY. A bad filing date is not
// worth losing the filing over — null it. Returns a valid YYYY-MM-DD or null.
const safeDate = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [, y, mo, da] = m;
  // Round-trip through a UTC date to reject impossible calendar days (June 31,
  // a month-16 transposition): a valid date's parts survive the round-trip.
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da)));
  if (
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() !== Number(mo) - 1 ||
    dt.getUTCDate() !== Number(da)
  ) {
    return null;
  }
  return raw;
};

const readShards = (
  dir: string,
): { file: string; decls: MpDeclaration[] }[] => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: { file: string; decls: MpDeclaration[] }[] = [];
  // .sort() because readdirSync order is filesystem-dependent, and the caller's
  // dedup keeps the FIRST copy of a source_url — which decides that filing's
  // subject_ref/tier and therefore its person_id join. Unsorted, the winner
  // differs between a Mac and the load container for no reason.
  for (const f of fs.readdirSync(abs).sort()) {
    if (!f.endsWith(".json")) continue;
    let decls: MpDeclaration[];
    try {
      decls = JSON.parse(fs.readFileSync(path.join(abs, f), "utf-8"));
    } catch {
      // A truncated shard would otherwise vanish a subject's whole history with
      // no trace — say so rather than let the corpus silently shrink.
      console.warn(`[declarations] skipped unparseable shard ${dir}/${f}`);
      continue;
    }
    if (Array.isArray(decls) && decls.length) out.push({ file: f, decls });
  }
  return out;
};

const DECL_COLS = [
  "declaration_id",
  "person_id",
  "tier",
  "subject_ref",
  "declarant_name",
  "institution",
  "position_title",
  "category",
  "declaration_type",
  "declaration_year",
  "fiscal_year",
  "register_year",
  "filed_at",
  "entry_number",
  "control_hash",
  "source_url",
];
const ASSET_COLS = [
  "declaration_id",
  "seq",
  "category",
  "description",
  "detail",
  "location",
  "municipality",
  "ekatte",
  "area_sqm",
  "built_area_sqm",
  "acquired_year",
  "share",
  "currency",
  "amount",
  "value_eur",
  "holder_name",
  "is_spouse",
  "legal_basis",
  "funds_origin",
];
const INCOME_COLS = [
  "declaration_id",
  "seq",
  "parent",
  "category",
  "eur_declarant",
  "eur_spouse",
];
const STAKE_COLS = [
  "declaration_id",
  "seq",
  "table_num",
  "company_name",
  "uic",
  "holder_name",
  "transferee_name",
  "share_size",
  "value_eur",
  "registered_office",
  "company_slug",
];
const EVENT_COLS = [
  "declaration_id",
  "seq",
  "kind",
  "description",
  "detail",
  "location",
  "municipality",
  "area_sqm",
  "built_area_sqm",
  "currency",
  "value_eur",
  "legal_basis",
];

const OBLIGATION_COLS = [
  "folder",
  "register_year",
  "declarant_name",
  "institution",
  "position_title",
  "category_raw",
  "sent_flag",
  "xml_file",
];

/** The obligation roster (T3.5) — who OWED a declaration, filed or not. Written by
 *  scripts/officials/obligations.ts from the register's list.xml; absent on a checkout
 *  that has not run it, in which case the table is simply left empty. */
const loadObligations = async (): Promise<number> => {
  await exec(fs.readFileSync(OBLIGATIONS_SCHEMA, "utf-8"));
  if (!fs.existsSync(OBLIGATIONS_FILE)) {
    console.warn(
      "[declarations] no data/officials/obligations.json — filed-vs-required is empty; run scripts/officials/obligations.ts",
    );
    return 0;
  }
  const rows = JSON.parse(fs.readFileSync(OBLIGATIONS_FILE, "utf-8")) as {
    folder: string;
    declarantName: string;
    institution: string | null;
    positionTitle: string | null;
    categoryRaw: string | null;
    sentFlag: boolean;
    xmlFile: string | null;
  }[];
  await withTx(async (c) => {
    await c.query("TRUNCATE declaration_obligation RESTART IDENTITY");
    await copyRows(
      c,
      "declaration_obligation",
      OBLIGATION_COLS,
      rows.map((r) => [
        r.folder,
        // "2021_nc" → 2021, via the shared guarded parser rather than a bare regex whose
        // miss would silently bucket a whole folder under year 0.
        registerFolderYear(`${REGISTER_BASE_URL}/${r.folder}/x.xml`, {
          allowSuffixed: true,
        }),
        r.declarantName,
        r.institution,
        r.positionTitle,
        r.categoryRaw,
        r.sentFlag,
        r.xmlFile,
      ]),
    );
  });
  return rows.length;
};

const load = async () => {
  await exec(fs.readFileSync(SCHEMA, "utf-8"));
  await exec(fs.readFileSync(INGEST_TRACKING, "utf-8"));

  const declRows: Row[] = [];
  const assetRows: Row[] = [];
  const incomeRows: Row[] = [];
  const stakeRows: Row[] = [];
  const eventRows: Row[] = [];

  let declId = 0;
  const seenUrls = new Set<string>();
  let dupUrls = 0;

  for (const spec of TIERS) {
    for (const { file, decls } of readShards(spec.dir)) {
      for (const d of decls as (MpDeclaration & Record<string, unknown>)[]) {
        // source_url is UNIQUE. One filing is written under two slugs for an
        // official who holds two posts, so the same URL reaches this loader
        // twice — keep the first, drop the rest, exactly as the coverage report
        // counts distinct URLs. "First" is deterministic: TIERS order
        // (mp → exec → muni → magistrate), then sorted filename within a tier.
        if (seenUrls.has(d.sourceUrl)) {
          dupUrls++;
          continue;
        }
        seenUrls.add(d.sourceUrl);

        const id = ++declId;
        // register_year is NOT NULL, and a single unparseable sourceUrl returning
        // null would abort the whole COPY. Fall back to declarationYear (always
        // present) rather than lose the batch — same "don't drop the filing over a
        // bad field" call safeDate makes for filed_at.
        const registerYear =
          registerFolderYear(d.sourceUrl, { allowSuffixed: true }) ??
          d.declarationYear;
        declRows.push([
          id,
          null, // person_id — phase 2 fills it
          spec.tier,
          spec.subjectRef(d, file),
          d.declarantName,
          d.institution ?? null,
          (d as { positionTitle?: string }).positionTitle ?? null,
          (d as { category?: string }).category ?? null,
          d.declarationType ?? null,
          d.declarationYear,
          d.fiscalYear ?? null,
          registerYear,
          safeDate(d.filedAt),
          d.entryNumber ?? null,
          d.controlHash ?? null,
          d.sourceUrl,
        ]);

        (d.assets ?? []).forEach((a, seq) => {
          assetRows.push([
            id,
            seq,
            a.category,
            a.description ?? null,
            a.detail ?? null,
            a.location ?? null,
            a.municipality ?? null,
            (a as { ekatte?: string }).ekatte ?? null,
            a.areaSqm ?? null,
            a.builtAreaSqm ?? null,
            a.acquiredYear ?? null,
            a.share ?? null,
            a.currency ?? null,
            a.amount ?? null,
            a.valueEur ?? null,
            a.holderName ?? null,
            a.isSpouse ?? false,
            a.legalBasis ?? null,
            a.fundsOrigin ?? null,
          ]);
        });

        (d.income ?? []).forEach((r, seq) => {
          incomeRows.push([
            id,
            seq,
            r.parent ?? null,
            r.category ?? null,
            r.amountEurDeclarant ?? null,
            r.amountEurSpouse ?? null,
          ]);
        });

        (d.ownershipStakes ?? []).forEach((s, seq) => {
          stakeRows.push([
            id,
            seq,
            s.table,
            s.companyName ?? null,
            (s as { uic?: string }).uic ?? null,
            s.holderName ?? null,
            (s as { transfereeName?: string }).transfereeName ?? null,
            s.shareSize ?? null,
            s.valueEur ?? null,
            s.registeredOffice ?? null,
            (s as { companySlug?: string }).companySlug ?? null,
          ]);
        });

        (d.events ?? []).forEach((e, seq) => {
          eventRows.push([
            id,
            seq,
            e.kind,
            e.description ?? null,
            e.detail ?? null,
            e.location ?? null,
            e.municipality ?? null,
            e.areaSqm ?? null,
            e.builtAreaSqm ?? null,
            e.currency ?? null,
            e.valueEur ?? null,
            e.legalBasis ?? null,
          ]);
        });
      }
    }
  }

  // One transaction: the TRUNCATE, the five COPYs and the changelog batch commit
  // together or not at all — a mid-load failure must not leave the corpus half
  // replaced or the changelog claiming a batch that never landed.
  await withTx(async (c) => {
    // Child tables cascade off declaration, so truncating it clears them; name
    // them all so the RESTART IDENTITY resets every serial.
    await c.query(
      `TRUNCATE declaration, declaration_asset, declaration_income,
                declaration_stake, declaration_event RESTART IDENTITY CASCADE`,
    );
    await copyRows(c, "declaration", DECL_COLS, declRows);
    await copyRows(c, "declaration_asset", ASSET_COLS, assetRows);
    await copyRows(c, "declaration_income", INCOME_COLS, incomeRows);
    await copyRows(c, "declaration_stake", STAKE_COLS, stakeRows);
    await copyRows(c, "declaration_event", EVENT_COLS, eventRows);
    // declaration_id was supplied explicitly; move the serial past it so a later
    // manual insert does not collide.
    await c.query(
      `SELECT setval(pg_get_serial_sequence('declaration','declaration_id'),
                     (SELECT COALESCE(max(declaration_id),1) FROM declaration))`,
    );

    // recent_updates changelog. source_url is the stable per-filing key (survives
    // the TRUNCATE+reload), so a re-run only records genuinely-new filings.
    await recordIngestBatch(c, {
      source: "cacbg_declarations",
      table: "declaration",
      keyExpr: "t.source_url",
      nameExpr: "t.declarant_name",
      detailExpr: "t.tier || ' ' || t.declaration_year",
      amountExpr: "NULL::double precision",
      rowsTotal: declRows.length,
    });
  });

  const obligations = await loadObligations();

  console.log(
    `declarations: ${declRows.length} filings ` +
      `(${dupUrls} duplicate URLs skipped), ${assetRows.length} assets, ` +
      `${incomeRows.length} income, ${stakeRows.length} stakes, ` +
      `${eventRows.length} events, ${obligations} register listings — person_id NULL, ` +
      `run --resolve after db:resolve:persons`,
  );
};

const resolve = async () => {
  // Fill person_id from person_role. One statement per tier so each can scope to
  // its own candidate source set; ref = subject_ref is the join.
  let filled = 0;
  await withClient(async (c) => {
    for (const spec of TIERS) {
      const res = await c.query(
        `UPDATE declaration d
            SET person_id = pr.person_id
           FROM person_role pr
          WHERE d.tier = $1
            AND d.person_id IS NULL
            AND pr.ref = d.subject_ref
            AND pr.source = ANY($2::text[])`,
        [spec.tier, spec.sources],
      );
      filled += res.rowCount ?? 0;
    }

    // MP fallback: a person who filed as an MP but is not in the current
    // parliament gold-set has no source='mp' role — only a candidate role, whose
    // ref is "<election>:mp-<id>". Match those by the mp-<id> slug suffix so a
    // former MP's declarations still attach. Anchored on ":mp-<id>" so id 4854
    // cannot swallow 14854.
    const res = await c.query(
      `UPDATE declaration d
          SET person_id = pr.person_id
         FROM person_role pr
        WHERE d.tier = 'mp'
          AND d.person_id IS NULL
          AND pr.source = 'candidate'
          AND pr.ref LIKE '%:mp-' || d.subject_ref`,
    );
    filled += res.rowCount ?? 0;
  });
  const [{ n: total }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration",
  );
  const [{ n: unresolved }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration WHERE person_id IS NULL",
  );

  // G13 step 4: person_id is now filled, so the wealth matview + serving fns can
  // be created and refreshed. Applying 090 here (not in phase 1) keeps the CREATE
  // after the data it aggregates, and REFRESH populates it from the resolved rows.
  await exec(fs.readFileSync(WEALTH_SCHEMA, "utf-8"));
  await exec(fs.readFileSync(GATE_SCHEMA, "utf-8"));
  await exec(fs.readFileSync(GAP_SCHEMA, "utf-8"));
  await exec(fs.readFileSync(EVENTS_SCHEMA, "utf-8"));
  await exec("REFRESH MATERIALIZED VIEW person_wealth_year");
  const [{ n: wealthRows }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM person_wealth_year",
  );

  console.log(
    `declarations --resolve: filled ${filled} person_id(s); ` +
      `${unresolved}/${total} still NULL (subjects the resolver did not place); ` +
      `person_wealth_year refreshed to ${wealthRows} person-year rows`,
  );
};

const main = async () => {
  const doResolve = process.argv.includes("--resolve");
  if (doResolve) await resolve();
  else await load();
  await end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
