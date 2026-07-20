// Build ngo_board_links (migration 080) — the politicians / officials / magistrates
// who sit on an NGO's governing body. This is the Phase-2 CONNECTION source the
// audit flagged as missing: company_politicians is gated to procurement winners,
// so an MP/official/magistrate who only sits on an NGO board never appears there.
//
// We instead match the person's name against the NGO's OWN board officers
// (tr_officers roles ngo_board/representative/trustee/verifier, already in PG),
// namesake-guarded via officer_name_counts. Two rosters:
//   - officials → loaded here into `official_roster` from the full officials
//     universe: data/officials/index.json (executive) + municipal/index.json
//     (mayors, councillors, …), with derived/company_links.json as a fallback.
//     Names + person refs only; the served artifact is ngo_board_links, so this
//     stays a build-time lookup, DB-only, no JSON serving;
//   - magistrates → already in PG (the `magistrate` table, migration 070);
//   - MPs → loaded here into `mp_roster` from the all-time MP list
//     (data/parliament/index.json); names are matched against NGO board officers
//     the same way the official/magistrate legs are.
//
//   npm run db:load:ngo-board-links   (needs local Postgres up + TR loaded)
//
// See docs/plans/ngo-risk-signals-v1.md (Phase 2 / A2).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { exec, withClient, getPool, end } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { recordIngestBatch } from "../db/lib/ingest_changelog";

const SCHEMA_SQL = fileURLToPath(
  new URL("../db/schema/pg/080_ngo_signals.sql", import.meta.url),
);
// The full officials universe (executive + municipal), NOT just the officials
// that already had a company link. Every company_links.json official is a strict
// subset of these two indexes, so the board-link roster covers e.g. a councillor
// who sits on a читалище board but owns no company.
const OFFICIALS_EXEC = fileURLToPath(
  new URL("../../data/officials/index.json", import.meta.url),
);
const OFFICIALS_MUNI = fileURLToPath(
  new URL("../../data/officials/municipal/index.json", import.meta.url),
);
// Kept as a robustness fallback: any company-linked official not present in the
// two indexes above is still added (0 such today, but avoids a silent regression
// if the officials pipeline ever diverges).
const OFFICIALS_LINKS = fileURLToPath(
  new URL("../../data/officials/derived/company_links.json", import.meta.url),
);
const MP_INDEX = fileURLToPath(
  new URL("../../data/parliament/index.json", import.meta.url),
);
// Human-in-the-loop overrides: an editor promotes a verified medium-confidence
// link to 'high' (public) or suppresses a false positive. See ngo:review-board-links.
const OVERRIDES = fileURLToPath(
  new URL("../../data/ngo/board_link_overrides.json", import.meta.url),
);

// index.json exec entries carry `category`; municipal entries carry `role`.
// Either is used as the roster `role` label (resolve_persons reads it into
// person_role), so a broadened official keeps a meaningful role, not a generic one.
type OfficialEntry = {
  name: string;
  slug: string;
  role?: string;
  category?: string;
};
type OfficialsIndexFile = { entries?: OfficialEntry[] };
type OfficialLinksFile = {
  byOfficial: Record<
    string,
    { name: string; slug: string; role?: string; tier?: string }
  >;
};

type MpIndexFile = {
  mps: { id: number; name: string }[];
};

type OverrideEntry = { eik: string; ref: string; note?: string };
export type Overrides = { promote: OverrideEntry[]; suppress: OverrideEntry[] };

// Read the editor's promote/suppress overrides. Tolerant: a missing file is an
// empty set, and a malformed (hand-edited) file warns and no-ops rather than
// aborting the whole board-links load — this runs in the automated pipeline, not
// only when the editor is present.
export const readOverrides = (): Overrides => {
  const empty: Overrides = { promote: [], suppress: [] };
  if (!existsSync(OVERRIDES)) return empty;
  try {
    const j = JSON.parse(readFileSync(OVERRIDES, "utf8")) as {
      promote?: OverrideEntry[];
      suppress?: OverrideEntry[];
    };
    const clean = (a?: OverrideEntry[]): OverrideEntry[] =>
      (a ?? []).filter((o) => o?.eik && o?.ref);
    return { promote: clean(j.promote), suppress: clean(j.suppress) };
  } catch (e) {
    console.warn(
      `[ngo-board-links] board_link_overrides.json is malformed — skipping overrides (${String(e)})`,
    );
    return empty;
  }
};

// Apply overrides to the freshly-rebuilt table, inside the rebuild txn so the
// changelog reflects the final public state. Suppress wins over promote (a
// suppressed row is deleted regardless of a promote on the same ref, because the
// promote loop runs first and the suppress DELETE is unconditional).
export const applyOverrides = async (
  c: PoolClient,
  ov: Overrides,
): Promise<{ promoted: number; suppressed: number }> => {
  let promoted = 0;
  for (const o of ov.promote) {
    const r = await c.query(
      "UPDATE ngo_board_links SET confidence = 'high' WHERE eik = $1 AND ref = $2 AND confidence <> 'high'",
      [o.eik, o.ref],
    );
    if (!r.rowCount)
      console.warn(
        `[ngo-board-links] promote override matched no promotable row: ${o.eik} ${o.ref}`,
      );
    promoted += r.rowCount ?? 0;
  }
  let suppressed = 0;
  for (const o of ov.suppress) {
    const r = await c.query(
      "DELETE FROM ngo_board_links WHERE eik = $1 AND ref = $2",
      [o.eik, o.ref],
    );
    if (!r.rowCount)
      console.warn(
        `[ngo-board-links] suppress override matched no row: ${o.eik} ${o.ref}`,
      );
    suppressed += r.rowCount ?? 0;
  }
  return { promoted, suppressed };
};

export const loadNgoBoardLinksPg = async (): Promise<{
  roster: number;
  mps: number;
  links: number;
}> => {
  // Idempotent DDL (tables + rebuild fn + the signals matview/view). Safe to
  // re-run: the tables use IF NOT EXISTS, the matview is rebuilt below.
  await exec(readFileSync(SCHEMA_SQL, "utf8"));

  // Officials roster → official_roster (one row per official; dedup on slug).
  // Union the executive index, the municipal index, and (fallback) company_links.
  let roster = 0;
  {
    const seen = new Map<
      string,
      [string, string, string | null, string | null]
    >();
    const add = (
      name: string | undefined,
      slug: string | undefined,
      role: string | null,
      tier: string | null,
    ) => {
      if (slug && name && !seen.has(slug))
        seen.set(slug, [name, slug, role, tier]);
    };
    if (existsSync(OFFICIALS_EXEC)) {
      const j = JSON.parse(
        readFileSync(OFFICIALS_EXEC, "utf8"),
      ) as OfficialsIndexFile;
      for (const e of j.entries ?? [])
        add(e.name, e.slug, e.category ?? e.role ?? null, "executive");
    }
    if (existsSync(OFFICIALS_MUNI)) {
      const j = JSON.parse(
        readFileSync(OFFICIALS_MUNI, "utf8"),
      ) as OfficialsIndexFile;
      for (const e of j.entries ?? [])
        add(e.name, e.slug, e.role ?? e.category ?? null, "municipal");
    }
    if (existsSync(OFFICIALS_LINKS)) {
      const j = JSON.parse(
        readFileSync(OFFICIALS_LINKS, "utf8"),
      ) as OfficialLinksFile;
      for (const o of Object.values(j.byOfficial))
        add(o.name, o.slug, o.role ?? null, o.tier ?? null);
    }
    if (seen.size === 0)
      console.warn(
        "[ngo-board-links] officials indexes missing or empty — official leg empty",
      );
    await withClient(async (c) => {
      await c.query("TRUNCATE official_roster");
      roster = await copyRows(
        c,
        "official_roster",
        ["name", "slug", "role", "tier"],
        seen.values(),
      );
    });
  }

  // MP leg → mp_roster (the full all-time MP list from parliament/index.json).
  // Names are matched against NGO board officers in rebuild_ngo_board_links the
  // same way officials/magistrates are, so we only need (name, id) here. Dedup on
  // name — the ref (/candidate/mp-<id>) must be single-valued per name to avoid an
  // ambiguous double-attribution of one board seat.
  let mps = 0;
  if (existsSync(MP_INDEX)) {
    const j = JSON.parse(readFileSync(MP_INDEX, "utf8")) as MpIndexFile;
    const seen = new Map<string, [string, number]>();
    for (const m of j.mps ?? []) {
      if (!m?.name || !Number.isInteger(m.id)) continue;
      const prev = seen.get(m.name);
      if (prev) {
        if (prev[1] !== m.id)
          console.warn(
            `[ngo-board-links] duplicate MP name "${m.name}" (ids ${prev[1]}, ${m.id}) — keeping ${prev[1]}; board seats attribute to the first id`,
          );
        continue;
      }
      seen.set(m.name, [m.name, m.id]);
    }
    await withClient(async (c) => {
      await c.query("TRUNCATE mp_roster");
      mps = await copyRows(c, "mp_roster", ["name", "mp_id"], seen.values());
    });
  } else {
    // Empty the leg so a vanished index.json genuinely clears it (not stale rows).
    await withClient((c) => c.query("TRUNCATE mp_roster"));
    console.warn(
      "[ngo-board-links] parliament/index.json missing — MP leg empty",
    );
  }

  // The rebuild joins `magistrate` (070) + `officer_name_counts` (008). On a DB
  // where those haven't been applied/refreshed the function would raise — guard
  // like load_tr_pg.ts does rather than abort the whole load.
  const ready = await getPool()
    .query(
      "SELECT to_regclass('public.magistrate') AS m, to_regclass('public.officer_name_counts') AS n",
    )
    .then((r) => r.rows[0]?.m != null && r.rows[0]?.n != null)
    .catch(() => false);
  if (!ready) {
    console.warn(
      "[ngo-board-links] magistrate / officer_name_counts not present — run db:load:tr:pg first; skipping rebuild",
    );
    return { roster, mps, links: 0 };
  }
  // Rebuild + the "what changed" changelog atomically, so a newly-appeared board
  // link surfaces in recent_updates (the PG-changelog rule). ingest_first_seen
  // survives the rebuild's TRUNCATE, so only genuinely-new links are itemised.
  let links = 0;
  await withClient(async (c) => {
    await c.query("BEGIN");
    links = Number(
      (await c.query("SELECT rebuild_ngo_board_links() AS n")).rows[0].n,
    );
    const ov = await applyOverrides(c, readOverrides());
    if (ov.promoted || ov.suppressed) {
      links = Number(
        (await c.query("SELECT count(*)::int AS n FROM ngo_board_links"))
          .rows[0].n,
      );
      console.log(
        `[ngo-board-links] overrides: +${ov.promoted} promoted, -${ov.suppressed} suppressed`,
      );
    }
    await recordIngestBatch(c, {
      source: "ngo_board_links",
      table: "ngo_board_links",
      keyExpr:
        "md5(concat_ws('|', t.eik, t.person, t.ref, t.kind, t.confidence))",
      nameExpr: "t.person",
      detailExpr: "concat_ws(' · ', t.kind, t.role, t.confidence)",
      rowsTotal: links,
    });
    await c.query("COMMIT");
  });

  // The signals matview reads ngo_board_links for the connection signals.
  const hasSignals = await getPool()
    .query("SELECT to_regclass('public.ngo_signals') AS t")
    .then((r) => r.rows[0]?.t != null)
    .catch(() => false);
  if (hasSignals) await exec("REFRESH MATERIALIZED VIEW ngo_signals");

  return { roster, mps, links };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const t0 = Date.now();
  loadNgoBoardLinksPg()
    .then(async ({ roster, mps, links }) => {
      console.log(
        `ngo_board_links: ${roster} officials + ${mps} MPs in roster, ${links} board links (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
