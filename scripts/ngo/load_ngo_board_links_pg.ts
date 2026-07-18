// Build ngo_board_links (migration 080) — the politicians / officials / magistrates
// who sit on an NGO's governing body. This is the Phase-2 CONNECTION source the
// audit flagged as missing: company_politicians is gated to procurement winners,
// so an MP/official/magistrate who only sits on an NGO board never appears there.
//
// We instead match the person's name against the NGO's OWN board officers
// (tr_officers roles ngo_board/representative/trustee/verifier, already in PG),
// namesake-guarded via officer_name_counts. Two rosters:
//   - officials → loaded here into `official_roster` from data/officials/derived/
//     company_links.json (names + person refs only; the served artifact is
//     ngo_board_links, so this stays a build-time lookup, DB-only, no JSON serving);
//   - magistrates → already in PG (the `magistrate` table, migration 070);
//   - MPs → companies-index.json when the connections graph has been rebuilt
//     (added if present; otherwise the MP leg stays empty until update-connections).
//
//   npm run db:load:ngo-board-links   (needs local Postgres up + TR loaded)
//
// See docs/plans/ngo-risk-signals-v1.md (Phase 2 / A2).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, withClient, getPool, end } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";

const SCHEMA_SQL = fileURLToPath(
  new URL("../db/schema/pg/080_ngo_signals.sql", import.meta.url),
);
const OFFICIALS = fileURLToPath(
  new URL("../../data/officials/derived/company_links.json", import.meta.url),
);

type OfficialLinksFile = {
  byOfficial: Record<
    string,
    { name: string; slug: string; role?: string; tier?: string }
  >;
};

export const loadNgoBoardLinksPg = async (): Promise<{
  roster: number;
  links: number;
}> => {
  // Idempotent DDL (tables + rebuild fn + the signals matview/view). Safe to
  // re-run: the tables use IF NOT EXISTS, the matview is rebuilt below.
  await exec(readFileSync(SCHEMA_SQL, "utf8"));

  // Officials roster → official_roster (one row per official; dedup on slug).
  let roster = 0;
  if (existsSync(OFFICIALS)) {
    const j = JSON.parse(readFileSync(OFFICIALS, "utf8")) as OfficialLinksFile;
    const seen = new Map<
      string,
      [string, string, string | null, string | null]
    >();
    for (const o of Object.values(j.byOfficial))
      if (o?.slug && o?.name && !seen.has(o.slug))
        seen.set(o.slug, [o.name, o.slug, o.role ?? null, o.tier ?? null]);
    await withClient(async (c) => {
      await c.query("TRUNCATE official_roster");
      roster = await copyRows(
        c,
        "official_roster",
        ["name", "slug", "role", "tier"],
        seen.values(),
      );
    });
  } else {
    console.warn(
      "[ngo-board-links] officials company_links.json missing — official leg empty",
    );
  }

  // MP leg (companies-index.json) is deferred: absent until update-connections
  // rebuilds the MP-companies graph. When present, add MPs to the roster with a
  // /candidate/mp-<id> ref (TODO once the graph is regenerated on this checkout).

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
    return { roster, links: 0 };
  }
  const links = await getPool()
    .query("SELECT rebuild_ngo_board_links() AS n")
    .then((r) => Number(r.rows[0].n));

  // The signals matview reads ngo_board_links for the connection signals.
  const hasSignals = await getPool()
    .query("SELECT to_regclass('public.ngo_signals') AS t")
    .then((r) => r.rows[0]?.t != null)
    .catch(() => false);
  if (hasSignals) await exec("REFRESH MATERIALIZED VIEW ngo_signals");

  return { roster, links };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const t0 = Date.now();
  loadNgoBoardLinksPg()
    .then(async ({ roster, links }) => {
      console.log(
        `ngo_board_links: ${roster} officials in roster, ${links} board links (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
