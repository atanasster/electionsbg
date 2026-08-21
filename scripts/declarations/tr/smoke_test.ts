/**
 * Smoke test for the TR parser + state replay + dataset-index parser. Run:
 *
 *   npx tsx scripts/declarations/tr/smoke_test.ts
 *
 * Fixtures:
 *   __fixtures__/2026-04-29.json    — 13 representative deeds extracted from a
 *                                     full daily snapshot.
 *   __fixtures__/dataset-page1.html — saved data.egov.bg listing page 1, used
 *                                     to verify the dataset-index parser.
 *
 * If the schema, the parser, or the listing HTML changes shape, this fails loudly.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import { parseTrDailyFiling } from "./parse_daily_filing";
import { replayEvents, currentPersons } from "./state_replay";
import { parseListingPage, findLastPage } from "./fetch_dataset_index";
import { reconstructState } from "./reconstruct_state";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, "__fixtures__", "2026-04-29.json");

const assert = (cond: unknown, msg: string): void => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
};

const main = async (): Promise<void> => {
  console.log(`\nTR parser smoke test — fixture: ${path.basename(fixture)}`);

  const json = JSON.parse(fs.readFileSync(fixture, "utf-8"));
  const events = parseTrDailyFiling(json);

  // Basic shape
  assert(events.length > 0, "extracted at least one event");
  assert(
    events.some((e) => e.kind === "person_added"),
    "extracted person_added events",
  );
  assert(
    events.some((e) => e.kind === "company_meta"),
    "extracted company_meta events",
  );
  assert(
    events.some((e) => e.kind === "person_section_erased"),
    "extracted person_section_erased events (the fixture includes a Partners erase)",
  );

  // Roles seen — each event has a stable role string from a known enum
  const roles = new Set<string>();
  for (const e of events) if (e.kind === "person_added") roles.add(e.role);
  assert(roles.has("partner"), "saw role: partner");
  assert(roles.has("manager"), "saw role: manager");
  assert(roles.has("director"), "saw role: director");

  // Replay produces a per-company map
  events.sort((a, b) => (a.filingDate || "").localeCompare(b.filingDate || ""));
  const state = replayEvents(events);
  assert(state.size > 0, "replay produced at least one company state");

  // Specific company sanity: БулВижън Консулт (UIC 208793530) — managers + partners
  const bvk = state.get("208793530");
  assert(!!bvk, "БулВижън Консулт (208793530) is in state");
  if (bvk) {
    const managers = currentPersons(bvk).filter((p) => p.role === "manager");
    assert(
      managers.length >= 1,
      `БулВижън Консулт has 1+ current managers (got ${managers.length})`,
    );
  }

  // Specific company sanity: СПОРТНИ НОВИНИ (UIC 208793555) — board of directors with ≥3 members
  const sportniNovini = state.get("208793555");
  if (sportniNovini) {
    const directors = currentPersons(sportniNovini).filter(
      (p) => p.role === "director",
    );
    assert(
      directors.length >= 3,
      `СПОРТНИ НОВИНИ has 3+ current directors (got ${directors.length})`,
    );
  }

  // Privacy guard: no event or state record should carry an EGN-derived
  // identifier. The TR dump's `Indent` element is a hash+salt of the EGN —
  // we treat it the same as the EGN itself and never extract it. Asserting
  // absence here catches accidental re-introduction of the field.
  const eventsWithLeak = events.filter(
    (e) =>
      e.kind === "person_added" &&
      "personHash" in (e as object) &&
      (e as { personHash?: unknown }).personHash != null,
  );
  assert(
    eventsWithLeak.length === 0,
    "no person_added event carries EGN-derived data (personHash always absent)",
  );
  let stateWithLeak = 0;
  for (const c of state.values()) {
    for (const p of c.persons.values()) {
      if ("personHash" in (p as object)) stateWithLeak++;
    }
  }
  assert(
    stateWithLeak === 0,
    "no person record in replayed state carries EGN-derived data",
  );

  // Names are normalized in state
  for (const c of state.values()) {
    for (const p of c.persons.values()) {
      assert(
        p.nameNormalized === p.name.toUpperCase().replace(/\s+/g, " ").trim(),
        `name is normalized in state: ${p.name}`,
      );
      break; // one is enough
    }
    break;
  }

  // Dataset-index parser
  console.log(
    `\nTR dataset-index parser smoke test — fixture: dataset-page1.html`,
  );
  const listingPath = path.join(
    __dirname,
    "__fixtures__",
    "dataset-page1.html",
  );
  const html = fs.readFileSync(listingPath, "utf-8");
  const entries = parseListingPage(html);
  assert(
    entries.length === 10,
    `page 1 yields 10 entries (got ${entries.length})`,
  );
  assert(
    entries.every((e) => /^[0-9a-f-]{36}$/.test(e.uuid)),
    "every entry has a valid UUID",
  );
  assert(
    entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.isoDate)),
    "every entry has an ISO date",
  );
  assert(
    entries[0].uuid === "9cf12b00-dae2-4e79-89ba-486c121b7173",
    `first entry UUID matches the 29.04.2026 resource`,
  );
  assert(
    entries[0].isoDate === "2026-04-29",
    `first entry isoDate parsed as 2026-04-29 (got ${entries[0].isoDate})`,
  );
  const lastPage = findLastPage(html);
  assert(
    lastPage >= 100,
    `pager declares ≥100 pages (got ${lastPage}) — sanity check that the regex caught the 168 page link`,
  );

  // Phase 4: reconstruct → SQLite, then verify forward + reverse lookups.
  // Skipped automatically if no daily file is on disk yet (e.g. fresh clone
  // before --bulk has been run).
  const dailyFolder = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "raw_data",
    "tr",
    "daily",
  );
  if (fs.existsSync(dailyFolder) && fs.readdirSync(dailyFolder).length > 0) {
    console.log(`\nTR Phase 4 reconstruction smoke test`);

    const tmpRaw = fs.mkdtempSync(path.join(os.tmpdir(), "tr-smoke-"));
    // Mirror the daily folder into the temp raw root so reconstruct_state can
    // find it (it expects <rawFolder>/tr/daily). Symlink for zero-copy.
    fs.mkdirSync(path.join(tmpRaw, "tr"), { recursive: true });
    fs.symlinkSync(dailyFolder, path.join(tmpRaw, "tr", "daily"), "dir");

    const result = await reconstructState({
      rawFolder: tmpRaw,
      progressEvery: 1,
    });
    assert(
      result.companies > 0,
      `reconstruction produced ≥1 company (got ${result.companies})`,
    );
    assert(
      result.persons > 0,
      `reconstruction produced ≥1 person row (got ${result.persons})`,
    );
    assert(
      result.source === "folder",
      `expected folder mode (got ${result.source})`,
    );

    const db = new DatabaseSync(result.outPath);

    // Forward lookup: by UIC → at least one current person.
    const forward = db
      .prepare(
        `SELECT COUNT(*) AS n FROM company_persons WHERE uic = ? AND erased_at IS NULL`,
      )
      .all("208793530") as Array<{ n: number }>;
    assert(
      forward[0].n >= 1,
      `SQLite forward lookup: company 208793530 has ≥1 active person (got ${forward[0].n})`,
    );

    // Reverse lookup: pick any person from the SQLite table, then verify
    // querying by name_norm finds at least their own row.
    const sample = db
      .prepare(`SELECT name_norm FROM company_persons LIMIT 1`)
      .all() as Array<{ name_norm: string }>;
    assert(sample.length === 1, "SQLite has ≥1 company_persons row");
    const reverse = db
      .prepare(`SELECT COUNT(*) AS n FROM company_persons WHERE name_norm = ?`)
      .all(sample[0].name_norm) as Array<{ n: number }>;
    assert(
      reverse[0].n >= 1,
      `SQLite reverse lookup by name_norm finds ≥1 row (got ${reverse[0].n})`,
    );

    // Indexes exist (catches accidental schema regressions).
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='company_persons'`,
      )
      .all() as Array<{ name: string }>;
    const idxNames = new Set(idx.map((r) => r.name));
    assert(
      idxNames.has("idx_persons_name_norm"),
      "idx_persons_name_norm exists on company_persons",
    );
    assert(
      idxNames.has("idx_persons_uic"),
      "idx_persons_uic exists on company_persons",
    );

    // Privacy guard at the storage layer: the company_persons table must
    // not have a person_hash (or any EGN-derived) column. Re-introducing
    // such a column is the failure we most want to catch.
    const cols = db
      .prepare(`PRAGMA table_info(company_persons)`)
      .all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    assert(
      !colNames.has("person_hash") &&
        !colNames.has("egn") &&
        !colNames.has("personHash"),
      "company_persons has no EGN-derived column",
    );

    db.close();

    // Phase 5 is GONE (2026-08-20). It drove integrateTr against a temp copy of
    // companies-index.json — the only output that module had left — and both are retired
    // with the name-keyed company page. /company/:eik serves the registry identity and
    // declaration_stake_company (096) serves the declared stakes, each with its own gate and
    // its own data test. See docs/plans/company-page-consolidation-v1.md (Tier 5).
    //
    // What this phase actually covered — that a fresh one-day reconstruction produces a
    // SQLite the downstream readers can consume — is still covered above: every assertion
    // from `db.prepare(...)` down runs against the store this smoke test just built.

    // Tidy up temp dir + db.
    fs.rmSync(tmpRaw, { recursive: true, force: true });
  } else {
    console.log(
      `\n[skip] Phase 4 reconstruction — no daily files at ${dailyFolder}. ` +
        `Run \`npx tsx scripts/declarations/tr/cli.ts --bulk\` to enable this section.`,
    );
  }

  console.log("\nAll smoke assertions passed.\n");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
