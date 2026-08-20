// The regression gate that turns a silent `db:refresh` omission into a build
// failure (docs/plans/db-refresh-loader-gaps-v1.md T6.1/T6.1a). CLAUDE.md
// documents db:refresh as "schema + every loader + resolve + test:data"; this
// held 26/38 for months with nothing red. The contract now: every local
// `db:load:*` / `db:resolve:*` script is either referenced by `db:refresh` or
// carries an explicit entry in REFRESH_EXCLUSIONS — and the exclusion list
// cannot rot (no stale keys, no double-listed loaders).
//
// Deliberately a plain unit test (test:unit, node project), NOT a
// *.data.test.ts: the assertions are pure JSON + git metadata, and an
// auto-skip-when-Postgres-is-down gate would go green on exactly the machines
// where this matters. Precedent: scripts/bucket_sync_paths.test.ts.

import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFRESH_EXCLUSIONS,
  REFRESH_GENERATORS,
  TOLERATED_GITIGNORED_INPUTS,
} from "./refresh_coverage";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pkg = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
};

const localLoaders = Object.keys(pkg.scripts).filter(
  (k) => /^db:(load|resolve):/.test(k) && !k.endsWith(":cloud"),
);
const genScripts = Object.keys(pkg.scripts).filter((k) => /^db:gen-/.test(k));
// The tolerated-input contract applies to anything db:refresh runs, loader or
// generator — so the two maps' key spaces are checked against this union.
const coverable = [...localLoaders, ...Object.keys(REFRESH_GENERATORS)];

const readEntrySource = (script: string): { entry: string; src: string } => {
  const cmd = pkg.scripts[script];
  const entry = /(?:^|\s)tsx (\S+\.ts)/.exec(cmd)?.[1];
  assert.ok(entry, `${script}: cannot resolve a tsx entry file from "${cmd}"`);
  return { entry: entry!, src: readFileSync(path.join(ROOT, entry!), "utf8") };
};

// Tokenize the chain — extract exact `npm run <name>` script names rather than
// substring-matching. `includes()` passes today but is one loader name away
// from a false positive (`db:load:agri:pg` inside `db:load:agri:pg-full`), and
// a gate whose purpose is catching silent omissions must not have one.
const refreshChain = pkg.scripts["db:refresh"];
// `?? ""` keeps the module importable if db:refresh is ever removed, so test 1
// reports its intended diagnostic instead of a collection-time TypeError.
const referenced = new Set(
  [...(refreshChain ?? "").matchAll(/npm run ([a-z0-9:_-]+)/g)].map(
    (m) => m[1],
  ),
);

test("db:refresh exists and still chains npm run steps", () => {
  assert.ok(refreshChain, "package.json has no db:refresh script");
  assert.ok(
    referenced.size >= 20,
    `db:refresh tokenized into only ${referenced.size} scripts — the extraction regex no longer matches its shape`,
  );
});

// ORDER, not just membership. Every test around this one asks "is the loader in
// the chain?" — none asks "is it in the right PLACE?", and that gap shipped a
// real defect: db:load:tr-company-place:pg sat next to db:load:place-dim:pg,
// twenty steps ahead of the db:load:graph:pg that APPLIES and rebuilds
// company_public_money (127), the money basis it denormalizes. So on every
// contracts reload it copied the PREVIOUS vintage — the governance
// "фирми, регистрирани тук" tile ranked and counted a stale corpus at a 200,
// with every row count reconciling. Caught 2026-08-05 only because
// tr_company_place.data.test.ts compares the copy against its source.
//
// Each pair below is "consumer must follow the step that rebuilds its input".
// Add a pair whenever a loader denormalizes or reads something another chain
// step (re)builds; membership alone cannot express that.
const ORDER_PAIRS: { after: string; before: string; why: string }[] = [
  {
    after: "db:load:grant-links:pg",
    before: "db:load:tenders:pg",
    why:
      "the spine extracts ПИИ codes from tenders.subject; with no tenders it " +
      "writes only the contract half and the coverage it prints reads as if the " +
      "procedure side simply had no grants",
  },
  {
    after: "db:load:grant-links:pg",
    before: "db:load:pg",
    why: "the other half of the spine is contracts.title",
  },
  {
    after: "db:load:employer-links:pg",
    before: "db:load:declarations:pg",
    why:
      "the bridge folds declaration.filed_institution, which is written by " +
      "declarations PHASE 1 (the plain db:load:declarations:pg — `--resolve` only " +
      "fills person_id). Run it first and every employer reads NULL, so the table " +
      "comes out empty and every surface says „no employer matched“ for the whole " +
      "corpus: loaded, green, and wrong",
  },
  {
    after: "db:load:employer-links:pg",
    before: "db:load:pg",
    why:
      "the other half of the fold is contracts.awarder_name — with no contracts " +
      "there is nothing to resolve an employer TO, and the loader skips",
  },
  {
    after: "db:load:agri:pg",
    before: "db:load:pg",
    why:
      "162's agri_hub_stats_cache reads `contracts` for its cross-programme arm, and " +
      "CREATE MATERIALIZED VIEW RESOLVES ITS QUERY at creation — so on a database " +
      "where contracts does not exist the migration cannot be applied at all. The " +
      "loader preflights and skips it with a warning rather than aborting, which " +
      "leaves the /subsidies hub rendering with NO figures",
  },
  {
    after: "db:load:agri:pg",
    before: "db:load:funds:pg",
    why:
      "same as the contracts pair above — 162 reads `fund_projects` for the " +
      "cross-programme arm, and the matview's query is resolved at CREATE time",
  },
  // 162's OTHER two inputs run after db:load:agri:pg, so the cache that loader builds
  // is always one vintage behind on them — and on a FIRST run, against a person layer
  // 081 has just created empty, the political arm is not stale but ZERO. That is why
  // db:load:agri-hub-stats:pg exists and sits late in the chain: it rebuilds the same
  // matview in 5.9 s instead of re-running a 5m44s corpus load.
  {
    after: "db:load:agri-hub-stats:pg",
    before: "db:resolve:persons",
    why:
      "162's political arm reads person_role ⨝ person. Built before the resolve it is " +
      "empty on a fresh database, and `politicalEiks: 0` beside a NULL politicalEur is " +
      "a CLAIM (0 companies) rather than an absence — the tile would read „0 фирми" +
      "\u201c where the truth is „not computed yet",
  },
  {
    after: "db:load:agri-hub-stats:pg",
    before: "db:load:budget-muni:pg",
    why:
      "162's crossStream block reads budget_muni_transfer for the „общински трансфери" +
      "\u201c tile. Built first, that tile has no figure at all",
  },
  {
    after: "db:load:council:pg",
    before: "db:resolve:persons",
    why:
      "council_vote.person_id REFERENCES person ON DELETE SET NULL, and " +
      "db:resolve:persons runs DELETE FROM person + re-COPY with person_id as a " +
      "POSITIONAL ordinal — so every re-resolve nulls the column table-wide and this " +
      "loader is what re-attaches it. Running it first leaves every named vote " +
      "unattributed at a 200, the declarations --resolve trap one table over",
  },
  {
    after: "db:load:person-elections:pg",
    before: "db:resolve:persons",
    why:
      "candidate_person and person_election_stats store person_id with NO foreign key, " +
      "and db:resolve:persons hands out person_id as a POSITIONAL ordinal — so a stale " +
      "row does not dangle, it silently resolves to a DIFFERENT person. Measured across " +
      "the 2026-08-20 resolve: 35,211 of 133,723 ids (26.3%) changed identity and 0 " +
      "dangled, all of them above the tier-V boundary at person_id 98,512. Unlike " +
      "declaration and council_vote (ON DELETE SET NULL, which at least blanks loudly) " +
      "nothing here announces the drift and every row count still reconciles",
  },
  {
    after: "db:load:person-search:pg",
    before: "db:load:persons-browse:pg",
    why:
      "its public tier is built FROM person_browse_table, so building it first indexes " +
      "the previous vintage — the route degrades a MISSING table to empty tiers but " +
      "serves a STALE one at a 200",
  },
  {
    after: "db:load:council:pg",
    before: "db:load:ngo-board-links",
    why:
      "official_roster is this loader's ONLY roster bridge — it supplies roster_code and " +
      "every council_vote.person_id — and db:load:ngo-board-links is its only writer (the " +
      "repo's sole TRUNCATE official_roster). Running council first resolves against the " +
      "previous vintage, or against an empty table on a fresh clone, and publishes 0% " +
      "attribution at a 200",
  },
  {
    after: "db:load:municipal-fiscal:pg",
    before: "db:load:place-dim:pg",
    why:
      "two of 149's three serving functions JOIN place_dim, and a LANGUAGE sql body is " +
      "validated at CREATE time — so applying the migration against a database " +
      "without place_dim raises 42P01. exec() sends the file as ONE transaction, " +
      "which means a cold bootstrap gets no municipal_fiscal table AT ALL, not " +
      "merely unlabelled rows",
  },
  {
    after: "db:load:budget-hub:pg",
    before: "db:load:budget-muni:pg",
    why:
      "156's matview is built over 152-155, and db:load:budget-muni:pg is what APPLIES " +
      "those four (db:load:budget:pg, which fills the state half, is in " +
      "REFRESH_EXCLUSIONS and never runs in the chain). Applying 156 first raises 42P01 " +
      "on budget_fiscal_year and rolls the file back",
  },
  {
    after: "db:load:budget-muni:pg",
    before: "db:load:place-dim:pg",
    why:
      "154's obshtina column resolves every municipal label through place_dim, and the " +
      "loader preflights it on COLUMNS rather than a row count — the Interreg deploy " +
      "(2026-08-08) passed a count-based check against a place_dim that had the right " +
      "5,720 rows and the wrong columns, then failed after writing nothing",
  },
  {
    after: "db:load:budget-muni:pg",
    before: "db:load:municipal-fiscal:pg",
    why:
      "not a data dependency — 154 never reads municipal_fiscal, and must not (they are " +
      "what the state SENDS vs what municipalities OWE, adjacent and never combined). " +
      "The order is so the two municipal corpora land together: a db:refresh that " +
      "reloads one and not the other leaves /budget/municipal and " +
      "/governance/municipal-finance describing different vintages of the same 265 places",
  },
  {
    after: "db:resolve:persons",
    before: "db:load:tr-name-fold-people:pg",
    why:
      "tr-attribution-basis-v1 §2.4: both fold-keyed mints in the resolver read " +
      "tr_name_fold_people to decide whether a name belongs to ONE registry person. " +
      "Bridge B now requires positive evidence (people_n = 1), so running the resolver " +
      "first — against an empty or absent table — reads every fold as unmeasured and mints " +
      "NO tr roles at all, silently emptying the company list on ~13k public figures",
  },
  {
    after: "db:load:pg",
    before: "db:pg:bootstrap",
    why:
      "grant-role-guard-sweep-v1: db:pg:bootstrap is the only thing in the repo that " +
      "creates app_readonly, and the migrations this loader applies GRANT to it. NOTE " +
      "the reason changed once Tier 1 guarded those grants, and the pair got MORE " +
      "necessary rather than less: before, a bare GRANT on a roleless cluster raised " +
      "42704 and rolled its whole file back, so the loader died loudly. Now every guard " +
      "simply skips, the load SUCCEEDS, and the objects are left with no ACL — every " +
      "/api/db endpoint then 42501s against a corpus that looks perfectly loaded. Roles " +
      "are CLUSTER-wide, so this is invisible on any machine that ever ran " +
      "roles_readonly.sql by hand",
  },
  {
    after: "db:resolve:persons",
    before: "db:load:declarations:pg",
    why:
      "T2 of person-enrichment-v1: the resolver dates every officials posting from the " +
      "встъпителна / при напускане filings, joining declaration.subject_ref to the " +
      "officials slug — and phase 1 of that loader is what WRITES subject_ref. Running " +
      "first leaves 4,625 roles undated, and because the renderer shows nothing without " +
      "a date_basis the office periods simply vanish from /person with nothing failing",
  },
  {
    after: "db:resolve:persons",
    before: "db:load:magistrates:pg",
    why:
      "the resolver builds its magistrate mentions from `SELECT name, court FROM " +
      "magistrate`, so that table decides which magistrates get a person row and a " +
      "/person slug at all. Running first resolves them from the PREVIOUS roster — and " +
      "since the roster now retains magistrates who have left the bench specifically so " +
      "their URL survives the ИВСС register's yearly turnover, a stale one silently drops " +
      "the people that retention exists to keep (462 of them in 2026). See " +
      "magistrate_roster_retention.data.test.ts",
  },
  {
    after: "db:load:judicial-bodies:pg",
    before: "db:load:magistrates:pg",
    why:
      "load_judicial_bodies_pg.ts's own header declares it, and nothing enforced it: the " +
      "dimension is built from `SELECT DISTINCT court FROM magistrate` ∪ court_load, so a " +
      "stale magistrate table means a stale set of bodies and aliases. It matters more since " +
      "the roster started retaining departed magistrates — that carries 72 court strings the " +
      "dimension had never seen (2 new bodies). db:resolve:persons then reads " +
      "judicial_body_alias for every magistrate's court, so running first publishes ~2,700 " +
      "magistrate roles against the previous vintage",
  },
  {
    after: "db:load:tr-company-place:pg",
    before: "db:resolve:persons",
    why:
      "tr_company_place.person_link_n is DENORMALIZED from person_role(tr,ngo) joined to " +
      "person(active, is_public_figure) — the column place_mp_companies() FILTERS on, so a " +
      "stale one does not skew the page, it empties it at a 200. db:resolve:persons is what " +
      "rebuilds person_role, and this loader already had to follow it for a second reason " +
      "(company_public_money via graph). Running first publishes the previous resolve's link " +
      "set to every /settlement/:id/companies page with every row count reconciling",
  },
  {
    after: "db:load:funds-fit:pg",
    before: "db:load:funds:pg",
    why:
      "fund_fit aggregates fund_projects and reads the procedure NAMES out of " +
      "fund_payloads(kind='procedure'); db:load:funds:pg rebuilds both. Running " +
      "first republishes the previous vintage's answer to „финансирано ли е нещо " +
      "като моето" +
      '" — a project count and a median grant, at a 200, with every ' +
      "row count reconciling",
  },
  {
    after: "db:load:interreg:pg",
    before: "db:load:funds:pg",
    why:
      "it applies 139, whose funds_muni_combined_v SELECTs fund_payloads — and a " +
      "view body is resolved at CREATE time, so on a database without that table " +
      "the whole migration 42P01s, rolls back and aborts the loader before a " +
      "single Interreg row is written. db:load:funds:pg is that table's only applier",
  },
  {
    after: "db:load:interreg:pg",
    before: "db:load:awarder-seats:pg",
    why:
      "Tier L1 of its place cascade reads awarder_seats — 158 of 1,469 placed " +
      "Bulgarian partner rows come from it, and running first places them from " +
      "the previous vintage or not at all",
  },
  {
    after: "db:load:interreg:pg",
    before: "db:load:tr-company-place:pg",
    why: "Tier L2 of its place cascade reads tr_company_place (41 placements)",
  },
  {
    after: "db:load:tr-company-place:pg",
    before: "db:load:graph:pg",
    why: "denormalizes company_public_money (127), which db:load:graph:pg applies and rebuilds",
  },
  {
    after: "db:load:tr-company-place:pg",
    before: "db:load:place-dim:pg",
    why: "resolves company seats against the place dimension",
  },
  {
    after: "db:load:persons-browse:pg",
    before: "db:resolve:persons",
    why: "folds person/person_role, which the resolver builds",
  },
  {
    after: "db:load:graph:pg",
    before: "db:load:persons-browse:pg",
    why: "reads person_browse_table facets for its person nodes",
  },
  {
    // Unlike hub_stats / sector_stats, which are NOT in this table, this generator's
    // position is declared: `people` is person_browse_table's tier='P' count, so run
    // ahead of the loader it commits the PREVIOUS vintage of the one figure on the page
    // that a reader can check by opening the destination and reading its row count.
    after: "db:gen-declarations-hub-stats",
    before: "db:load:persons-browse:pg",
    why: "its `people` figure is person_browse_table's tier='P' floor, which that loader rebuilds",
  },
  {
    after: "db:load:annexes:pg",
    before: "db:load:pg",
    why:
      "re-resolves procurement_annexes.contract_key against the contracts table IN POSTGRES, " +
      "so running it before the corpus lands re-attaches every annex to the vintage " +
      "db:load:pg is about to replace — and every eviction pass (the cross-source reconcile, " +
      "the stale-base-key sweep) orphans annexes that only this loader repairs",
  },
];

test("db:refresh orders each loader after the step that rebuilds its input", () => {
  const steps = (refreshChain ?? "")
    .split("&&")
    .map((s) => s.match(/npm run ([a-z0-9:_-]+)/)?.[1])
    .filter((s): s is string => Boolean(s));
  const at = (name: string) => steps.indexOf(name);

  for (const { after, before, why } of ORDER_PAIRS) {
    const a = at(after);
    const b = at(before);
    // Membership is another test's job; skip rather than double-report it.
    if (a === -1 || b === -1) continue;
    assert.ok(
      a > b,
      `db:refresh runs ${after} at step ${a + 1} but ${before} at step ${b + 1} — ` +
        `${after} ${why}, so it must come AFTER. Running it earlier publishes the ` +
        `previous vintage with nothing failing.`,
    );
  }
});

test("every local db:load/db:resolve script is in db:refresh or REFRESH_EXCLUSIONS", () => {
  const uncovered = localLoaders.filter(
    (k) => !referenced.has(k) && !(k in REFRESH_EXCLUSIONS),
  );
  assert.deepEqual(
    uncovered,
    [],
    `loaders neither run by db:refresh nor documented in scripts/db/refresh_coverage.ts: ${uncovered.join(
      ", ",
    )} — add each to db:refresh (absent-tolerant if its input is gitignored) or to REFRESH_EXCLUSIONS with its axis`,
  );
});

test("REFRESH_EXCLUSIONS carries no stale or contradictory keys", () => {
  const gone = Object.keys(REFRESH_EXCLUSIONS).filter(
    (k) => !localLoaders.includes(k),
  );
  assert.deepEqual(
    gone,
    [],
    `excluded loaders that no longer exist in package.json: ${gone.join(", ")}`,
  );
  const both = Object.keys(REFRESH_EXCLUSIONS).filter((k) => referenced.has(k));
  assert.deepEqual(
    both,
    [],
    `loaders both excluded and run by db:refresh — pick one: ${both.join(", ")}`,
  );
});

// T6.1a — the second invariant, scoped to declared inputs. The §1a mis-sort
// happened because "the inputs are present" was measured on a working copy that
// holds gitignored files a fresh clone does not. The declaration list pins
// which inputs are gitignored-and-tolerated; this test keeps the declaration
// honest against git itself, in both directions.
test("TOLERATED_GITIGNORED_INPUTS names real loaders and genuinely untracked paths", () => {
  // Tie the two exported maps together: a tolerated loader must be either run
  // by db:refresh or an (interim) exclusion — an orphan declaration describes a
  // loader nobody decided about, which is the exact state this module exists
  // to make impossible.
  const orphans = Object.keys(TOLERATED_GITIGNORED_INPUTS).filter(
    (k) => !referenced.has(k) && !(k in REFRESH_EXCLUSIONS),
  );
  assert.deepEqual(
    orphans,
    [],
    `tolerated loaders neither in db:refresh nor REFRESH_EXCLUSIONS: ${orphans.join(", ")}`,
  );
  for (const [loader, inputs] of Object.entries(TOLERATED_GITIGNORED_INPUTS)) {
    assert.ok(
      coverable.includes(loader),
      `${loader} declared in TOLERATED_GITIGNORED_INPUTS but is neither a local loader script nor a registered db:gen-* generator`,
    );
    for (const input of inputs) {
      // A path listed as gitignored-and-tolerated must not be tracked: if it
      // gets committed, the tolerance note is stale and the loader's absent
      // branch is dead code that hides real regressions.
      const tracked = execFileSync("git", ["ls-files", "--", input], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
      assert.equal(
        tracked,
        "",
        `${loader}: ${input} is declared gitignored-and-tolerated but git tracks it — remove it from TOLERATED_GITIGNORED_INPUTS (a tracked input going missing SHOULD throw)`,
      );
    }
  }
});

// The behavioral half of T6.1a: the declaration promises an absent-tolerant
// branch; this keeps that promise checkable at the source level. For each
// tolerated loader, resolve its entry file from the package.json script, find
// the path constant carrying the declared input, and assert the guard on that
// constant is SKIP-shaped: `if (!existsSync(CONST))` whose block reaches a
// `return` without a `throw`. That is exactly the revert-to-throw regression
// that produced the T1b interim exclusions — a file-level `includes()` grep
// false-passed on it (the throwing versions also contain "existsSync" and the
// basename), which is why this is shape-matched rather than substring-matched.
test("every tolerated gitignored input has a skip-shaped existsSync guard in its loader", () => {
  for (const [loader, inputs] of Object.entries(TOLERATED_GITIGNORED_INPUTS)) {
    const { entry, src } = readEntrySource(loader);
    for (const input of inputs) {
      // Directory inputs have uselessly short basenames ("fts") — pin the last
      // two segments instead so the staleness check stays meaningful.
      const needle = /\.[a-z0-9]+$/.test(input)
        ? path.basename(input)
        : input.split("/").slice(-2).join("/");
      assert.ok(
        src.includes(needle),
        `${loader}: ${entry} never references its declared input ${needle} — the TOLERATED_GITIGNORED_INPUTS entry is stale`,
      );
      // The constant the path is bound to, e.g. `const JSON_FILE = …"activities.json"…`.
      const constName = new RegExp(
        `const (\\w+) = [^;]*${needle.replace(/[./]/g, "\\$&")}`,
      ).exec(src)?.[1];
      assert.ok(
        constName,
        `${loader}: no path constant in ${entry} carries ${needle}`,
      );
      // The guard block on that constant, up to its terminating return. For the
      // nzok loaders this is the main() skip branch (`return;`); for the
      // ngo-funding FTS directory it is parseFts's `return [];`.
      // Boundary anchor rather than a full `))`: the guard may be compound
      // (`!existsSync(X) || readdirSync(X).length === 0`), but the identifier
      // must still end there — a longer constant sharing the prefix must not
      // satisfy the assertion.
      const guard = new RegExp(
        `if \\(!existsSync\\(${constName}(?:\\)| ?\\|\\|)[\\s\\S]{0,900}?return`,
      ).exec(src)?.[0];
      assert.ok(
        guard,
        `${loader}: ${entry} has no \`if (!existsSync(${constName})) … return\` guard — the absent-input branch is gone`,
      );
      assert.ok(
        !/throw /.test(guard),
        `${loader}: the absent branch for ${constName} in ${entry} throws — that aborts the &&-chained db:refresh on a fresh clone (gaps plan T1.0)`,
      );
    }
  }
});

// ── db:gen-* coverage (cross-source-dedup-v2 §T5) ───────────────────────────
// The loader tests above cannot see these: hub_stats.json and sector_stats.json
// are committed, bucket-synced artifacts regenerated from Postgres by a
// `db:gen-*` script, and drifted from the corpus for weeks because nothing ran
// them. See REFRESH_GENERATORS for why the axis is "writes a committed artifact"
// rather than the whole `db:gen-*` prefix.

test("every registered db:gen-* generator is run by db:refresh", () => {
  const uncovered = Object.keys(REFRESH_GENERATORS).filter(
    (k) => !referenced.has(k),
  );
  assert.deepEqual(
    uncovered,
    [],
    `generators that write a committed artifact but are not in db:refresh: ${uncovered.join(
      ", ",
    )} — their output silently drifts from the corpus on every reload`,
  );
});

test("REFRESH_GENERATORS names real scripts writing real committed artifacts", () => {
  for (const [gen, spec] of Object.entries(REFRESH_GENERATORS)) {
    assert.ok(
      pkg.scripts[gen],
      `${gen} is registered in REFRESH_GENERATORS but is not a package.json script`,
    );
    // The whole reason these need chain membership is that their output is
    // COMMITTED — an untracked artifact is regenerated per-machine and cannot go
    // stale in the repo, so the entry would be describing something else.
    const tracked = execFileSync("git", ["ls-files", "--", spec.artifact], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    assert.ok(
      tracked,
      `${gen}: declared artifact ${spec.artifact} is not tracked by git — REFRESH_GENERATORS is for committed artifacts only`,
    );
    const { entry, src } = readEntrySource(gen);
    assert.ok(
      src.includes(spec.artifact),
      `${gen}: ${entry} never references its declared artifact ${spec.artifact} — the REFRESH_GENERATORS entry is stale`,
    );
  }
});

// The hole-closer: a NEW generator dropped into gen_procurement/ must land on one
// side or the other, mechanically. `process.argv.includes("--write")` is the exact
// idiom all seven sql-migration-v1 parity verifiers use to stay read-only by
// default; anything without it writes on every run and therefore belongs in the
// chain.
test("every db:gen-* script is either registered or a --write-gated verifier", () => {
  const WRITE_GATE = 'process.argv.includes("--write")';
  const stray: string[] = [];
  for (const gen of genScripts) {
    const { src } = readEntrySource(gen);
    const gated = src.includes(WRITE_GATE);
    if (gen in REFRESH_GENERATORS) {
      // Symmetric check: adding a --write gate to a registered generator would
      // turn its db:refresh step into a silent no-op, which looks exactly like
      // success in an &&-chain.
      assert.ok(
        !gated,
        `${gen} is in REFRESH_GENERATORS but gates its write behind --write — its db:refresh step would write nothing`,
      );
      continue;
    }
    if (!gated) stray.push(gen);
  }
  assert.deepEqual(
    stray,
    [],
    `db:gen-* scripts that write unconditionally but are not in REFRESH_GENERATORS: ${stray.join(
      ", ",
    )} — register them (and add them to db:refresh) or gate their write behind --write like the parity verifiers`,
  );
});

/**
 * The budget DDL reaches a fresh clone through the CHAIN, not through the
 * excluded loader — and in an order 155 depends on.
 *
 * ⚠️ THIS EXISTS BECAUSE THE COMMENT DESCRIBING IT WENT STALE FOR TWO TIERS.
 * `load_budget_pg.ts`'s header and this file's own `REFRESH_EXCLUSIONS` note
 * both said „THIS FILE IS THE ONLY APPLIER of 152/153, so a fresh clone has no
 * budget tables at all" — written while T4 was still ahead, and left standing
 * after T2/T3 shipped `load_budget_muni_pg.ts` into the chain. A reader acting
 * on it would have concluded the opposite of the truth. Prose cannot hold an
 * invariant the code can move; this can.
 *
 * The ORDER is the load-bearing half: 155's bodies are `LANGUAGE sql` and are
 * validated at CREATE time, so applying it before 152/153/154/157 raises 42P01
 * and `exec()` rolls the whole file back. Measured on a virgin database
 * 2026-08-15: 152→153→154→155 fails at 155's line 350 with
 * `relation "budget_admin_procurement" does not exist`.
 */
test("an IN-CHAIN loader applies the budget DDL, 155 last", () => {
  const chainAppliers = localLoaders.filter((s) => refreshChain.includes(s));
  /** The APPLIED list, not the file. Reading the whole source and comparing
   *  `indexOf` positions is comment-dependent: a prose line naming
   *  `155_budget_serving.sql` above the array made this gate report the correct
   *  order as wrong. So the migration names are taken from the string-literal
   *  array the loader actually iterates, with comments stripped. */
  const appliedList = (src: string): string[] => {
    // Comments FIRST. Stripping after the capture lets a `]` inside an array
    // comment truncate it — and the array in question carries a nine-line
    // comment block today.
    const clean = src
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Anchored on the declaration, so an earlier `OTHER_SCHEMA_FILES` cannot
    // claim the match.
    const m = /\bconst\s+SCHEMA_FILES\s*=\s*\[([\s\S]*?)\]/.exec(clean);
    const body = m?.[1] ?? clean;
    // Both idioms: a bare `"157_x.sql"` and the path-prefixed
    // `"schema/pg/157_x.sql"` that five of the eight schema-applying loaders
    // use — including the two other budget ones. Matching only the bare form
    // yields [] for those, which is a SILENT pass, not a red test.
    return [...body.matchAll(/"(?:[\w/.-]*\/)?(\d{3}_[a-z_]+\.sql)"/g)].map(
      (x) => x[1],
    );
  };

  const hits = chainAppliers
    .map((s) => ({ script: s, ...readEntrySource(s) }))
    .map((h) => ({ ...h, applied: appliedList(h.src) }))
    .filter(({ applied }) => applied.includes("155_budget_serving.sql"));

  // ⚠️ THE ARRAY IS NOT THE APPLY LOOP. This gate reads the declared order; a
  // `[...SCHEMA_FILES].reverse()` or a conditional `continue` in the loop would
  // keep it green with the 42P01 live. What makes that acceptable is that the
  // loop is three lines beside the array and the array is the thing people edit
  // — but it is a stated limit, not a covered case.
  assert.ok(
    hits.length > 0,
    "no loader in db:refresh applies 155_budget_serving.sql — a fresh clone " +
      "would have no budget serving layer, and every /api/db/budget-* route " +
      "would 42883 against a corpus that looks fully loaded",
  );

  for (const { script, applied } of hits) {
    const at = (f: string) => applied.indexOf(f);
    for (const dep of [
      "152_budget_kfp.sql",
      "153_budget_admin.sql",
      "154_budget_municipal.sql",
      "157_budget_admin_procurement.sql",
    ]) {
      assert.ok(
        at(dep) !== -1,
        `${script} applies 155 without ${dep} — 155's LANGUAGE sql bodies are ` +
          "validated at CREATE time and 42P01 against it",
      );
      assert.ok(
        at(dep) < at("155_budget_serving.sql"),
        `${script} applies ${dep} AFTER 155 — the same 42P01, just later in the file`,
      );
    }
  }
});
