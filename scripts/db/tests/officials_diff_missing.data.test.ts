// `missing_official` must mean the roster is SILENT — not that our join lost the mayor (T4.3).
//
// WHY THIS GATE EXISTS. `mayor.status = "missing_official"` renders as
// „Кметът {{cik}} още не е подал декларация." on the municipality tile and „Чака декларация"
// on /sverka. That is a factual claim about a named individual, and for a long time it was
// false about every municipality anybody checked. Measured 2026-09-04, before the fixes:
// 6/5/6/6/4 across the five cycles — from sidecars that were themselves mixed vintages, four
// frozen at 2026-08-10 and the 2023 one regenerated 2026-09-03, so the five numbers are not
// one measurement. FOUR were investigated, all on the 2023 cycle, and not one of them was the
// register being silent —
//
//   VAR05 Бяла (Варна)  the obshtina join resolved "Бяла/Варна/" to RSE04, so VAR05 had no
//                       roster shard at all while RSE04 carried both municipalities' rosters
//   SZR22 Мъглиж        the register's LISTING label calls the sitting mayor „Заместник кмет";
//   VID25 Макреш        his own filing says „Кмет на Община Мъглиж"
//   BLG37 Разлог        the mayor's newest filing is 2025 and the year filter dropped him
//
// Each of those is our defect, and each published a false statement about a person who had
// filed. The earlier cycles' entries were never enumerated one by one, and the count reached
// zero in the same window as a roster reload — which can heal one upstream by itself, as the
// register did for Разград — so this gate deliberately does NOT assert a cause. The invariant
// is not "the count is small", nor "the causes above explain it", but "every remaining one is
// real".
// Plan: docs/plans/officials-roster-missing-mayor-v1.md.
//
// ⚠️ THE CHECK IS AGAINST THE DECLARATION CORPUS, NOT AGAINST THE SHARD. Asserting that a
// `missing_official` municipality has no mayor in its shard is vacuous — the sidecar is
// DERIVED from that shard, so the two agree by construction and a lost mayor agrees with them
// both. The only independent authority is `declaration`: if the register holds a filing whose
// declarant is the CIK-elected mayor of that municipality, then "has not filed" is false
// however the shard got that way.
//
// Auto-skips with a DISTINCT reason per state — Postgres unreachable, the declaration table
// absent, no permission to read it, a column it lost, the muni declarations unloaded, the
// register's `institution` unfilled, or no sidecars on disk — because "no sidecars on disk"
// must never read as "no false claims", and neither must "the server is down". The two tests
// have SEPARATE gates: they read different tables, written by different loaders.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { canonicalDeclarantName } from "../../officials/shared";

const DATA_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data",
);

const cycles = existsSync(DATA_ROOT)
  ? readdirSync(DATA_ROOT).filter(
      (d) =>
        d.endsWith("_mi") &&
        existsSync(path.join(DATA_ROOT, d, "officials_diff")),
    )
  : [];

/** ⚠ IT RETURNS A REASON, NOT A BOOLEAN, AND THE REASON IS THE POINT. A probe answering `false` both
 *  when the server is down and when the table is empty forces ONE authored sentence onto two
 *  different worlds — and the half it gets wrong is always "Postgres unreachable", which
 *  `mp_arm_sql`'s header records as the string a real SQL bug hid behind for two days: "the one
 *  warning an operator is trained to ignore". The slash in the old message was that conflation
 *  written out rather than fixed. `report_skip_coverage.test.ts` finds the shape structurally.
 *
 *  ⚠ IT PROBES THE COLUMNS THE ASSERTION READS, NOT MERELY THE TABLE. The check folds
 *  `declarant_name` AND scopes on `institution`. The scoping stops a homonym three oblasts
 *  away FABRICATING a false claim against our join — see the in-body ⚠ on the município scope,
 *  which owns that rule and its measurement. The probe guards the OTHER direction: with
 *  `institution` unfilled every register key is `…@""`, no sidecar key can match it (0 of 1,412
 *  sidecars carry a blank `obshtinaName`), so the sweep finds nothing and passes VACUOUSLY —
 *  "no false claims" published by a corpus that was never asked. That is the shape
 *  `official_role_reconcile.data.test.ts` shipped: a probe testing a column that is always
 *  present, clearing a test that depends on one that is not.
 *
 *  ⚠ THE CATCH IS BRANCHED FOR THE SAME REASON. A bare `catch` reports a server that is UP and
 *  missing 089 as "unreachable" — and once a probe is tri-state `conflatedProbes` is blind to
 *  it (its exemption is satisfied by any `string` in the return type), so only review is left. */
const reachable = async (): Promise<string | false> => {
  try {
    const [c] = await allRows<{ n: string; inst: string }>(
      `SELECT count(*) n,
              count(*) FILTER (WHERE institution IS NOT NULL AND btrim(institution) <> '') inst
         FROM declaration WHERE tier = 'muni'`,
    );
    if (Number(c.n) === 0)
      return "no muni declarations loaded — run npm run db:load:declarations:pg";
    if (Number(c.inst) === 0)
      return "declaration.institution is empty for every muni filing — the município scoping this gate depends on cannot run";
    return false;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01")
      return "the declaration table does not exist — apply 089_declarations.sql to this database";
    if (code === "42501")
      return "no permission to read declaration — check the role this DATABASE_URL connects as";
    if (code === "42703")
      return "the declaration table is missing a column this probe reads (tier / institution) — re-apply 089_declarations.sql";
    // ⚠ CARRY THE CODE. 28P01 (auth) and 3D000 (no such database) are servers that answered;
    // describing them as unreachable sends an operator to restart a container that is running.
    return `Postgres unreachable (${code ?? (e as Error).message})`;
  }
};

// `reachable()` returns the REASON, so the database half of the gate is the value itself.
//
// ⚠ EVERY BRANCH RETURNS A NON-EMPTY SENTENCE, AND THAT IS LOAD-BEARING. `""` is falsy, so an
// empty reason would fall straight through this `||` and run the gate against an unusable
// database with nothing printed.
//
// ⚠ COMPOSED INLINE, WITH NO INTERMEDIATE. A `const dbSkip = await reachable()` reads more
// clearly and is a second GATE as far as `report_skip_coverage` is concerned — it holds a skip
// reason that nothing reports, which is the `unreported` violation. One variable, one report.
const skip =
  (await reachable()) ||
  (cycles.length === 0
    ? "no data/<cycle>/officials_diff sidecars on disk (gitignored; run npm run data -- --resolve-local-canonicals)"
    : false);
reportSkip(import.meta.url, skip);

/** The SECOND test's gate, and it is separate on purpose.
 *
 *  ⚠⚠ IT READS A DIFFERENT TABLE, WRITTEN BY A DIFFERENT LOADER. `official_roster` is
 *  TRUNCATEd and reloaded only by `scripts/ngo/load_ngo_board_links_pg.ts`
 *  (`db:load:ngo-board-links`), so "the declarations are loaded" says nothing about it, and the
 *  two are independently loadable — by a standalone `db:load:declarations:pg`, by a cloud
 *  target filled in the documented per-loader order, or transiently during the roster loader's
 *  own TRUNCATE. (`db:refresh` runs the roster at step 29 and declarations at 51, so an
 *  interrupted refresh is not the path.)
 *
 *  Both directions were wrong while the two shared one gate:
 *
 *  — FALSE RUN, and it is the damaging one. With `declaration` loaded and the roster EMPTY the
 *    sweep returns no rows, `unexpected` passes vacuously, and `resolved` then fails with
 *    „1 KNOWN_DOUBLE_MAYORS entr(ies) no longer occur — remove them". That message is an
 *    instruction, and following it deletes PAZ20 — a município where the register genuinely
 *    lists an outgoing and an incoming Кмет — permanently disarming the detector for the one
 *    place it has ever fired. Same shape as the sibling's headline defect, where the remedy in
 *    the failure message would have written a false claim into committed data.
 *  — FALSE SKIP. Every declaration-shaped reason — including the new `institution` one — stood
 *    this test down while the roster was perfectly loaded and the question perfectly answerable.
 */
const rosterReachable = async (): Promise<string | false> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM official_roster WHERE role = 'mayor' AND sitting",
    );
    if (Number(c.n) === 0)
      return "official_roster holds no sitting mayor — run npm run db:load:ngo-board-links";
    return false;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01")
      return "the official_roster table does not exist — run npm run db:load:ngo-board-links against this database";
    if (code === "42501")
      return "no permission to read official_roster — check the role this DATABASE_URL connects as";
    return `Postgres unreachable (${code ?? (e as Error).message})`;
  }
};

// ⚠ NOT `skip || …`. The declaration states have nothing to do with this question, and folding
// them in is exactly the false skip above.
const skipRoster = await rosterReachable();
reportSkip(import.meta.url, skipRoster);
afterAll(async () => {
  await end();
});

// ⚠ `mayor` IS OPTIONAL BECAUSE THIS IS PARSED JSON, not a value the compiler has seen. It is
// present on all 1,412 sidecars today, so the `?.` below never fires — but a required type
// beside an optional access is a disagreement about whether it can, and only one of them can
// be right about a file read off disk.
type Sidecar = {
  obshtinaCode: string;
  obshtinaName: string;
  mayor?: { status: string; cikName: string | null };
};

test.skipIf(skip)(
  "every `missing_official` names a mayor the declaration register really has no filing for",
  async () => {
    // Folded per declarant so that the case, spacing and hyphen drift the register introduces
    // between folders does not hide a filing. It is not a name-identity rule and does not
    // pretend to be: a genuinely different spelling still misses, which fails in the safe
    // direction here (a missed filing means we do NOT accuse the join). `canonicalDeclarantName` is the officials ingest's OWN fold —
    // the one every profile URL is built from — because inventing a second one here would
    // test our two folds against each other rather than testing the corpus.
    // ⚠️ SCOPED TO THE MUNICÍPIO, NOT JUST THE NAME. A fold alone is a homonym away from
    // accusing the wrong join: measured 2026-09-04, 50 folded municipal declarant names are held in more
    // than one institution, and 19 sidecar mayors carry such a name. An unscoped check would
    // report "Ivan Ivanov HAS a municipal filing" because a different Ivan Ivanov filed three
    // oblasts away — an authoritative message about a defect that is not there, on a gate
    // whose whole subject is authoritative messages that are not true.
    //
    // The sidecar's `obshtinaName` is the app's município name and `declaration.institution`
    // is the register's, which agree for the ordinary case and carry the register's own
    // disambiguator („Бяла/Варна/") where they do not — so the institution is folded to its
    // bare name before comparing.
    const bareMuni = (s: string): string =>
      s
        .replace(/\/[^/]*\/$/u, "")
        .toLocaleLowerCase("bg")
        // ⚠ THE РАЙОН FAMILY COULD NEVER JOIN, so a false „не е подал декларация" on any of
        // Sofia's 22 district shards was undetectable however loudly the register contradicted
        // it. The register writes „Район Красно село", and „Район \"Младост\" - Варна" for the
        // Varna/Plovdiv shape; the sidecar writes the bare district name. Measured before this
        // fold: 26 of 287 sidecar names had no counterpart in the `institution` vocabulary, 22
        // of them districts. Latent rather than live — the corpus holds 0 `missing_official`
        // today — and invisible to the floor below, which counts FILES rather than joinable
        // municipalities.
        .replace(/^район\s+/u, "")
        .replace(/^"([^"]+)"\s*-\s*.+$/u, "$1")
        .replace(/["„”]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
    const filed = new Set(
      (
        await allRows<{ declarant_name: string; institution: string | null }>(
          "SELECT DISTINCT declarant_name, institution FROM declaration WHERE tier = 'muni'",
        )
      ).map(
        (r) =>
          `${canonicalDeclarantName(r.declarant_name)}@${bareMuni(r.institution ?? "")}`,
      ),
    );

    const falseClaims: string[] = [];
    let checked = 0;
    // A `missing_official` with no CIK name cannot be looked up at all, so it must not be
    // reported as verified — the failure message is where this gate earns its keep.
    let unnamed = 0;
    for (const cycle of cycles) {
      const dir = path.join(DATA_ROOT, cycle, "officials_diff");
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        const s = JSON.parse(
          readFileSync(path.join(dir, f), "utf8"),
        ) as Sidecar;
        if (s.mayor?.status !== "missing_official") continue;
        checked++;
        if (!s.mayor.cikName) {
          unnamed++;
          continue;
        }
        const key = `${canonicalDeclarantName(s.mayor.cikName)}@${bareMuni(s.obshtinaName)}`;
        if (filed.has(key))
          falseClaims.push(
            `${cycle} ${s.obshtinaCode} (${s.obshtinaName}): "${s.mayor.cikName}" HAS a municipal filing`,
          );
      }
    }

    assert.deepEqual(
      falseClaims,
      [],
      `${falseClaims.length} sidecar(s) publish „Кметът X още не е подал декларация" about a ` +
        "mayor the register does hold a filing for. The roster is not silent — our join lost " +
        "them. Check the obshtina join (municipality_join.test.ts), the published role " +
        "(restamp_roles.ts) and the bench filter (currentBench), in that order.",
    );

    // ⚠️ AN ALL-UNNAMED SWEEP VERIFIED NOTHING, and until now said so only inside a TRUNCATION
    // message that fires for an unrelated reason — so a corpus whose every `missing_official`
    // lacks a `cikName` passed green and printed not a word. A sidecar in that state is itself
    // a reconcile defect (the CIK winner is missing from the file), not a silent register.
    assert.ok(
      checked === 0 || unnamed < checked,
      `all ${checked} missing_official sidecar(s) lack a cikName, so this sweep verified ` +
        "NOTHING — the CIK winner is absent from the sidecar, which is a reconcile defect " +
        "rather than a register that has nothing to say",
    );

    // ⚠️ NOT VACUOUS-BY-DEFAULT. Zero `missing_official` sidecars is the state this work
    // reached, and it is also what an empty or half-written corpus looks like. So assert the
    // sweep actually read them — counting the SAME files it reads (a directory of non-JSON
    // would otherwise satisfy a floor the sweep learned nothing from), and PER CYCLE, because
    // a global floor passes with a whole cycle missing. `cycles` is itself derived from what
    // is on disk, so a vanished directory is not merely uncounted — it leaves the list
    // entirely, which is what the cycle-count assertion is for.
    const perCycle = cycles.map((c) => ({
      cycle: c,
      n: readdirSync(path.join(DATA_ROOT, c, "officials_diff")).filter((f) =>
        f.endsWith(".json"),
      ).length,
    }));
    assert.ok(
      cycles.length >= 5,
      `only ${cycles.length} cycle(s) carry sidecars — expected the five regular _mi cycles`,
    );
    const thin = perCycle.filter((p) => p.n < 200);
    assert.deepEqual(
      thin,
      [],
      `truncated cycle(s): ${thin.map((p) => `${p.cycle}=${p.n}`).join(", ")} — ` +
        `so "${checked} missing_official (${unnamed} unnamed)" says nothing`,
    );
  },
);

/** Municipalities the register itself lists two MAYORS for, with the reason.
 *
 *  ⚠️ SOURCE-SIDE, NOT OURS. The Сметна палата's newest listing names both a departing and an
 *  arriving Кмет, each with `roleRaw: "Кмет"` and the current `descriptorYear`. The corpus has
 *  no basis to choose, and inventing a tie-break would publish "the mayor is X" from a
 *  coin-flip. `/sverka` is unaffected — `reconcile_officials.ts` matches against the CIK
 *  winner, and PAZ20 reports `match` on Желязко Иванов Гагов.
 *
 *  An allowlist, not a ratchet: a NEW município fails, and one that leaves the list fails too,
 *  so a resolved entry cannot sit here for ever. */
const KNOWN_DOUBLE_MAYORS: Record<string, string> = {
  PAZ20: "Панагюрище — the 2026 listing names an outgoing and an incoming Кмет",
};

/** ⚠️ THE COUNCIL CHAIR IS NOT ENUMERATED, AND THAT IS A MEASUREMENT RATHER THAN A SHORTCUT.
 *  14 municipalities carry two sitting `council_chair` rows (2026-09-04) and 53 carry none at
 *  all — so in this register the chair is simply not a reliably single-holder listing, and an
 *  allowlist of 14 would be a transcription of the corpus rather than a set of exceptions.
 *  T3 used the same measurement to refuse carrying a chair forward.
 *
 *  A ceiling instead, so a JUMP fails while the standing population does not have to be
 *  re-typed on every register update. Deliberately not a tight ratchet: the number moves
 *  legitimately as councils change chairs. */
const MAX_DOUBLE_CHAIRS = 25;

test.skipIf(skipRoster)(
  "the roster gate names the relation the double-mayor sweep reads",
  async () => {
    // ⚠ THE STRUCTURAL GATE CANNOT SEE THIS, and that is why the defect it guards survived a
    // review. `report_skip_coverage` proves a probe is multi-state; it has no way to know
    // WHICH relation the probe tests, so it reported this file clean while the double-mayor
    // sweep below ran on an entirely unprobed `official_roster`. A floor here is what stops an
    // empty roster passing `unexpected` vacuously and then failing `resolved` with a remedy
    // that deletes the PAZ20 guard.
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM official_roster WHERE role = 'mayor' AND sitting",
    );
    assert.ok(
      Number(c.n) > 200,
      `${c.n} sitting mayors in official_roster — the sweep below cannot be read as "no ` +
        'município gained a second mayor" on a roster this thin',
    );
  },
);

test.skipIf(skipRoster)(
  "no município gains a second MAYOR, and the double-chair population stays bounded",
  async () => {
    // ⚠️ THE OTHER DIRECTION. The sweep above polices `missing_official` being honest; with the
    // count at zero it passes trivially and would keep passing however the roster is
    // OVER-corrected. A município acquiring a second mayor is invisible to it and to
    // official_roster_obshtina.data.test.ts, whose assertions are all shard-relative — and
    // scripts/officials/role_reconcile.ts is precisely a mechanism for ADDING mayors, so this
    // is the direction its failures would take.
    //
    // `district IS NULL` excludes the sanctioned район fold: Пловдив legitimately carries seven
    // mayors under PDV22, its own plus six районни.
    const rows = await allRows<{
      obshtina: string;
      role: string;
      names: string;
    }>(
      `SELECT obshtina, role, string_agg(DISTINCT name, ' | ') AS names
         FROM official_roster
        WHERE role IN ('mayor','council_chair') AND sitting
          AND district IS NULL AND obshtina IS NOT NULL
        GROUP BY 1, 2
       HAVING count(DISTINCT name) > 1`,
    );

    const mayors = new Map(
      rows.filter((r) => r.role === "mayor").map((r) => [r.obshtina, r.names]),
    );
    const unexpected = [...mayors]
      .filter(([code]) => !(code in KNOWN_DOUBLE_MAYORS))
      .map(([code, names]) => `${code}: ${names}`);
    assert.deepEqual(
      unexpected,
      [],
      `${unexpected.length} município(s) publish two sitting MAYORS and are not in ` +
        "KNOWN_DOUBLE_MAYORS. If the register really lists both, add it there with its " +
        "reason; if a promotion rule created it, that is the over-correction " +
        "scripts/officials/role_reconcile.ts must not make.",
    );
    const resolved = Object.keys(KNOWN_DOUBLE_MAYORS).filter(
      (code) => !mayors.has(code),
    );
    assert.deepEqual(
      resolved,
      [],
      `${resolved.length} KNOWN_DOUBLE_MAYORS entr(ies) no longer occur — remove them, or ` +
        "they will hide the next real one",
    );

    const chairs = rows.filter((r) => r.role === "council_chair").length;
    assert.ok(
      chairs <= MAX_DOUBLE_CHAIRS,
      `${chairs} município(s) carry two sitting council chairs (was 14 on 2026-09-04, ceiling ` +
        `${MAX_DOUBLE_CHAIRS}) — a jump this size is a listing change or a promotion rule that ` +
        "has started firing on the chair bucket, which role_reconcile.ts deliberately excludes",
    );
  },
);
