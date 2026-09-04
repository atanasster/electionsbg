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
// Auto-skips when Postgres is down or the sidecars are absent — with DISTINCT reasons, because
// "no sidecars on disk" must never read as "no false claims".
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

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration WHERE tier = 'muni'",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = !haveDb
  ? "Postgres unreachable / no muni declarations — `npm run db:load:declarations:pg`"
  : cycles.length === 0
    ? "no data/<cycle>/officials_diff sidecars on disk (gitignored; `npm run data -- --resolve-local-canonicals`)"
    : false;
reportSkip(import.meta.url, skip);
afterAll(async () => {
  await end();
});

type Sidecar = {
  obshtinaCode: string;
  obshtinaName: string;
  mayor: { status: string; cikName: string | null };
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
    // accusing the wrong join: measured, 30 folded municipal declarant names are held in more
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

test.skipIf(skip)(
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
