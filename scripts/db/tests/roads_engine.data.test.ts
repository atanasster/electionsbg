// The roads engine (src/lib/roadAttributes.ts) run over the REAL АПИ corpus.
//
// Every /sector/roads tile is computed client-side by buildRoadsModel over the
// `awarder-contracts` rows, so the engine's parsing rules ARE the page. The unit
// tests pin each rule on a fixture; this gate pins what the rules do to the
// corpus, because each defect below was invisible on a fixture and only showed
// as a number on the page (docs/plans/roads-hub-v1.md §2, measured 2026-10-12):
//
//   R10  €0 consortium-member rows counted a joint award once per member firm
//        (499 of 2,826 rows; winter maintenance 90.0% single-bid vs a true 76.9%)
//   R12  a lot naming several ОПУ went to one oblast (€800.6M; Шумен €0.6M)
//   R14  the 0–165 Струма cap rejected every construction lot (13 contracts on
//        the strip against a €943.9M corridor)
//   R1/O the model total must stay the hub headline's basis
//   €/km archaeology (НАИМ-БАН, CPV 71351914) and supervision lots titled after
//        the works section carried a €/km: Русе – В. Търново published a median
//        of 0.16 M€/km (n=6) against two build lots at ~10–11 M€/km
//
// Bands and inequalities, never exact figures — the corpus reloads fortnightly.
// Auto-skips only when Postgres is down or the corpus is not loaded.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  API_EIK,
  buildChainageStrips,
  buildRoadsModel,
  lengthOf,
  MULTI_REGION,
  RUSE_VT_CORRIDOR,
} from "@/lib/roadAttributes";
import { reportSkip } from "../../lib/report_skip";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isRoadsInhouse, ROADS_SECTOR_EIKS } from "@/lib/roadsReferenceData";
import { ROAD_ROWS_SQL } from "../lib/roadsRows";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*) n FROM contracts WHERE awarder_eik = $1",
      [API_EIK],
    )
  : [];
const skip = !haveDb
  ? "Postgres unreachable"
  : Number(n) === 0
    ? "АПИ has no contracts loaded — run db:load:pg"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// The roll-up's rows through the ONE shared row query (scripts/db/lib/roadsRows.ts)
// — the same SQL the hub generator runs — fetched once for the whole file.
let rowsCache: Promise<ProcurementContract[]> | null = null;
const rowsOf = () =>
  (rowsCache ??= allRows<ProcurementContract>(ROAD_ROWS_SQL, [
    [...ROADS_SECTOR_EIKS],
  ]));

test.skipIf(skip)(
  "the model total is the headline basis and counts no consortium member (R1, R10)",
  async () => {
    const rows = await rowsOf();
    const m = buildRoadsModel(rows);
    const [sql] = await allRows<{ eur: string; n: string; members: string }>(
      `SELECT sum(amount_eur) eur,
              count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
              count(*) FILTER (WHERE consortium_role = 'member') members
         FROM contracts WHERE awarder_eik = ANY($1) AND tag = 'contract'`,
      [[...ROADS_SECTOR_EIKS]],
    );
    assert.ok(
      Math.abs(m.totalEur - Number(sql.eur)) < 1,
      `model €${m.totalEur} vs SQL €${sql.eur}`,
    );
    assert.equal(m.rows.length, Number(sql.n));
    // Non-vacuity: the guard only means something while members exist.
    assert.ok(Number(sql.members) > 100, "no member rows — retire this arm");
  },
);

test.skipIf(skip)(
  "every single-bid share is on non-member rows — re-derived per component (R10)",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    for (const c of m.components) {
      const own = m.rows.filter(
        (r) => r.component === c.component && r.c.numberOfTenderers != null,
      );
      const single = own.filter((r) => r.c.numberOfTenderers === 1).length;
      if (!own.length) continue;
      assert.ok(
        Math.abs((c.singleBidShare ?? 0) - single / own.length) < 1e-9,
        c.component,
      );
    }
    assert.ok(
      m.rows.every((r) => r.c.consortiumRole !== "member"),
      "a member row reached the model",
    );
  },
);

test.skipIf(skip)(
  "multi-ОПУ lots are their own bucket, not the longest oblast (R12)",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    const multi = m.regions.find((r) => r.region === MULTI_REGION);
    assert.ok(multi, "no multi-ОПУ bucket");
    assert.ok(multi.totalEur > 300e6, `multi-ОПУ only €${multi.totalEur}`);
    // АМ „Тракия" OP3 (€193M across 7 ОПУ) is what used to make Стара Загора
    // the largest single oblast.
    const sz = m.regions.find((r) => r.region === "Стара Загора");
    assert.ok(
      (sz?.totalEur ?? 0) < 300e6,
      "Стара Загора re-absorbed a multi lot",
    );
  },
);

test.skipIf(skip)(
  "Struma construction lots sit on the I-1 axis (R14)",
  async () => {
    const strips = buildChainageStrips(buildRoadsModel(await rowsOf()).rows);
    const i1 = strips.find((s) => s.axis.axisKey === "Струма I-1");
    assert.ok(i1, "no Струма I-1 strip");
    assert.ok(i1.contracts >= 10, `Струма I-1 holds ${i1.contracts}`);
    assert.ok(i1.totalEur > 200e6, `Струма I-1 €${i1.totalEur}`);
  },
);

test.skipIf(skip)(
  "national_competition carries a member-free pair that differs from the raw one",
  async () => {
    const [{ r }] = await allRows<{
      r: {
        singleBid: number;
        bidKnown: number;
        singleBidExMembers?: number;
        bidKnownExMembers?: number;
      };
    }>("SELECT national_competition(NULL, NULL) AS r");
    assert.ok(
      r.bidKnownExMembers != null,
      "167 lacks the ex-member keys — apply 167_national_competition.sql",
    );
    assert.ok(r.bidKnownExMembers! < r.bidKnown, "the two pairs are equal");
  },
);

// ── T9: the audit-sectors Phase 4 pins (plan §4 T9). Bands, shares and basis
// agreement — never a contractor's rank or absolute €, which move every reload.
// Each reference below is INDEPENDENT of the code under test: the committed
// sector_stats.json (written by a different generator), or the corpus itself.

const sectorStats = () =>
  JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "data/procurement/derived/sector_stats.json"),
      "utf8",
    ),
  ) as Record<string, Record<string, { value: number; basis: string }>>;

test.skipIf(skip)("the headline bands each catch the failure they name", () => {
  const s = sectorStats();
  assert.equal(s.all.roads.basis, "procurement");
  // АПИ alone is €8.92bn; with НКСИП (D5) €9.14bn. The floor sits between, so a
  // roll-up that loses НКСИП fails; the ceiling catches a leaked EIK (НКЖИ €3.5bn).
  assert.ok(
    s.all.roads.value > 9.05e9 && s.all.roads.value < 11e9,
    `all: €${s.all.roads.value}`,
  );
  // НКСИП's money is 2013–2019, so only an old window can see it go missing:
  // ns:2014_10_05 is €384M with it and €171M without.
  const ns14 = s["ns:2014_10_05"]?.roads?.value ?? 0;
  assert.ok(ns14 > 3e8 && ns14 < 4.5e8, `ns:2014_10_05: €${ns14}`);
});

test.skipIf(skip)(
  "the engine's contractor leaderboard sums to sector_stats per year (failure O)",
  async () => {
    // The page's leaderboard and the hub tile are built by DIFFERENT code from the
    // same corpus; a tag, member or window rule drifting in either shows here.
    const rows = await rowsOf();
    const s = sectorStats();
    const years = Object.keys(s)
      .filter((k) => /^y:\d{4}$/.test(k) && s[k].roads)
      .map((k) => Number(k.slice(2)));
    assert.ok(years.length >= 5, "too few y: scopes to compare");
    for (const y of years) {
      const m = buildRoadsModel(
        rows.filter((r) => (r.date ?? "").startsWith(String(y))),
      );
      const board = m.contractors.reduce((a, c) => a + c.totalEur, 0);
      assert.ok(
        Math.abs(board - s[`y:${y}`].roads.value) < 2,
        `y:${y} leaderboard €${board} vs sector_stats €${s[`y:${y}`].roads.value}`,
      );
    }
    const all = buildRoadsModel(rows).contractors.reduce(
      (a, c) => a + c.totalEur,
      0,
    );
    assert.ok(Math.abs(all - s.all.roads.value) < 2, `all: €${all}`);
  },
);

test.skipIf(skip)(
  "no single recipient dominates the all-time leaderboard",
  async () => {
    // The in-house company holds ~11%. A rollup change crediting a consortium's
    // full value to each member would push one firm past this as a SHARE.
    const m = buildRoadsModel(await rowsOf());
    const top = m.contractors[0];
    assert.ok(
      top.totalEur / m.totalEur < 0.2,
      `${top.name} holds ${((top.totalEur / m.totalEur) * 100).toFixed(1)}%`,
    );
  },
);

test.skipIf(skip)(
  "the in-house company is a contractor in the corpus, not a buyer",
  async () => {
    // Evidence from the corpus, not from the register's own lookup: it RECEIVES
    // roads money at scale and SPENDS next to none. If it ever starts buying at
    // scale, its place outside the roll-up (D1) needs a fresh decision.
    const [r] = await allRows<{ received: string; spent: string }>(
      `SELECT
         (SELECT sum(amount_eur) FROM contracts
           WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = $2) received,
         (SELECT coalesce(sum(amount_eur), 0) FROM contracts
           WHERE tag = 'contract' AND awarder_eik = $2) spent`,
      [[...ROADS_SECTOR_EIKS], "831646048"],
    );
    assert.ok(isRoadsInhouse("831646048"));
    assert.ok(Number(r.received) > 5e8, `received €${r.received}`);
    assert.ok(
      Number(r.spent) < 2e7,
      `spent €${r.spent} as a buyer — revisit D1`,
    );
  },
);

// ── €/km is physical works only, and a corridor median is one work class.
// The service predicates here are written INDEPENDENTLY of workTypeOf (title
// stem / CPV / contractor name straight off the row), so a classifier that
// regressed cannot also redefine what this gate looks for.

const DESIGN_BUILD_RE = /инженеринг|проектиране\s+и\s+строителств/i;
const isArchaeologyRow = (r: ProcurementContract) =>
  /археолог/i.test(r.title ?? "") &&
  !DESIGN_BUILD_RE.test(r.title ?? "") &&
  !((r.cpv ?? "").startsWith("45") && !(r.cpv ?? "").startsWith("451124"));
const isServiceRow = (r: ProcurementContract) =>
  ((r.cpv ?? "").startsWith("71") && !DESIGN_BUILD_RE.test(r.title ?? "")) ||
  /надзор|консултант|супервизи/i.test(r.title ?? "") ||
  (!r.cpv && /консулт/i.test(r.contractorName ?? ""));

test.skipIf(skip)(
  "no archaeology or supervision/design row carries a €/km",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    const arch = m.rows.filter((r) => isArchaeologyRow(r.c));
    const svc = m.rows.filter((r) => isServiceRow(r.c));
    // Non-vacuity: these rows exist and carry a parseable length — exactly the
    // population that used to be unit-costed.
    assert.ok(
      arch.filter((r) => lengthOf(r.c.title)).length >= 10,
      `only ${arch.length} archaeology rows with a length — retire this arm`,
    );
    assert.ok(
      svc.filter((r) => lengthOf(r.c.title) && r.amountEur > 1e6).length >= 5,
      "too few €1M+ service rows with a length to mean anything",
    );
    const leaked = [...arch, ...svc].filter((r) => r.perKm);
    assert.equal(
      leaked.length,
      0,
      `service rows unit-costed:\n${leaked
        .slice(0, 5)
        .map((r) => `  ${r.workType} ${r.c.cpv} ${r.c.title.slice(0, 90)}`)
        .join("\n")}`,
    );
    for (const r of arch) assert.equal(r.workType, "archaeology", r.c.title);
  },
);

test.skipIf(skip)(
  "Русе – В. Търново: only the build lots carry a €/km, in a plausible band",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    const c = m.corridors.find((x) => x.corridor === RUSE_VT_CORRIDOR);
    assert.ok(c, "no Русе – В. Търново corridor");
    const perKm = m.rows
      .filter((r) => r.ref?.corridor === RUSE_VT_CORRIDOR && r.perKm)
      .map((r) => r.perKm!.eurPerKm);
    // The two lots: 876.5M лв / 40.2 km and 660.4M лв / 35.4 km (≈ 11.1 and
    // 9.5 M€/km). Anything under 5 M€/km is a service row leaking back in.
    assert.ok(perKm.length >= 2, `only ${perKm.length} €/km rows`);
    assert.ok(
      perKm.every((v) => v > 5e6 && v < 25e6),
      `€/km rows ${perKm.map((v) => (v / 1e6).toFixed(2)).join(", ")} M€`,
    );
    // Below EUR_PER_KM_MIN_N it publishes nothing; if a third lot ever lands,
    // its median must stay in the same band rather than fall to 0.16.
    if (c.eurPerKmMedian != null)
      assert.ok(
        c.eurPerKmMedian > 5e6,
        `median ${(c.eurPerKmMedian / 1e6).toFixed(2)} M€/km`,
      );
  },
);

test.skipIf(skip)(
  "every published corridor median is over ONE work class",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    const published = m.corridors.filter((c) => c.eurPerKmMedian != null);
    assert.ok(published.length >= 5, "too few corridors publish a median");
    for (const c of published) {
      assert.ok(c.eurPerKmClass, `${c.corridor} has a median and no class`);
      const own = m.rows.filter(
        (r) => r.ref?.corridor === c.corridor && r.perKm,
      );
      const inClass = own.filter((r) => r.group === c.eurPerKmClass);
      assert.equal(c.eurPerKmN, inClass.length, c.corridor);
    }
    // Non-vacuity of the split: some corridor HAS rows of both classes, so the
    // restriction is excluding something real.
    assert.ok(
      published.some((c) => {
        const groups = new Set(
          m.rows
            .filter((r) => r.ref?.corridor === c.corridor && r.perKm)
            .map((r) => r.group),
        );
        return groups.size > 1;
      }),
      "no corridor mixes classes — the per-class arm is vacuous",
    );
  },
);

test.skipIf(skip)(
  "noise-barrier lots carry no €/km, sibling lots included",
  async () => {
    const rows = await rowsOf();
    // Independent of the engine: every lot of a procedure that ANY lot names as
    // шумозащитни, minus the design/supervision lots (CPV 71).
    const unps = new Set(
      rows
        .filter((r) => r.unp && /шумозащит/i.test(r.title ?? ""))
        .map((r) => r.unp!),
    );
    assert.ok(unps.size >= 1, "no noise-barrier procedure — retire this arm");
    const m = buildRoadsModel(rows);
    const lots = m.rows.filter(
      (r) => r.c.unp && unps.has(r.c.unp) && !(r.c.cpv ?? "").startsWith("71"),
    );
    // Non-vacuity: the procedure has place-and-chainage lots that name no work.
    assert.ok(
      lots.filter((r) => !/шумозащит/i.test(r.c.title) && lengthOf(r.c.title))
        .length >= 2,
      "no untitled sibling lots — the procedure-level rule is untested",
    );
    for (const r of lots) {
      assert.equal(r.workType, "noise_barrier", r.c.title.slice(0, 90));
      assert.equal(r.perKm, undefined, r.c.title.slice(0, 90));
    }
  },
);
