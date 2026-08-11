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
