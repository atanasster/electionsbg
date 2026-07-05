// КЗК-appeals invariants: the register parser + the tender transparency score's
// null-safe funding indicator. Run: npx tsx scripts/procurement/kzk.harness.ts
//
// parseComplaintsText is regex-heavy (split-on-"Жалба №", label extraction,
// bgDate, ВМ negation) and is exactly where a reg.cpc.bg markup change breaks
// silently — the fixture below is a real two-record page dump. The transparency
// checks lock the `isEuFunded != null` fix (a JSON null must read as NOT
// published, unlike the old `!== undefined` which counted every tender).

import {
  parseComplaintsText,
  mergeAppealInto,
  applyEnrichment,
  KZK_UPSERT_SQL,
  type KzkAppeal,
} from "./kzk_appeals";
import { computeTenderTransparency } from "@/lib/tenderTransparency";
import type { Tender } from "@/lib/tenderTypes";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
};

// --- TEST-001: parseComplaintsText ----------------------------------------
{
  // Real two-record page dump — note the leading row ordinal ("1 ", "2 ") the
  // register renders before each "Жалба №" header (markup as of 2026-07-05).
  const FIXTURE = `Начало Жалби
Намерени са общо 668 жалби по ЗОП за 2026 година.
1     Жалба № ВХР-2048-03.07.2026
Наименование на жалбоподателя: ОБЕДИНЕНИЕ "УФФ - НЮ БИЛДИНГ" ДЗЗД
Ответник(ници): ОБЩИНА НИКОЛАЕВО
Обжалван акт № D56375531
УНП: 00674-2026-0007
Дата на жалбата: 03.07.2026 г.
Статус: иницииран процес
Искани временни мерки: Няма искане за ВМ
Предмет: Жалба - Обединение с/у Решение на община Николаево
2     Жалба № ВХР-2047-03.07.2026
Наименование на жалбоподателя: ДЗЗД "ЛИДЕР КОНСУЛТ 2026"
Ответник(ници): ОБЩИНА ПЕРНИК
Обжалван акт № D56374957
УНП: 00589-2026-0026
Дата на жалбата: 03.07.2026 г.
Статус: иницииран процес
Искани временни мерки: Допусната ВМ
Предмет: Жалба - ДЗЗД`;
  const recs = parseComplaintsText(
    FIXTURE,
    { "ВХР-2048-03.07.2026": "300688242" },
    "2026-07-04",
  );
  check(
    "parser: extracts both records",
    recs.length === 2,
    `got ${recs.length}`,
  );
  check(
    "parser: fields + УНП + bgDate on record 1",
    recs[0]?.unp === "00674-2026-0007" &&
      recs[0]?.complaintDate === "2026-07-03" &&
      recs[0]?.respondent === "ОБЩИНА НИКОЛАЕВО" &&
      recs[0]?.complaintId === "300688242",
    JSON.stringify(recs[0]),
  );
  check(
    "parser: 'Няма искане за ВМ' → vmRequested false",
    recs[0]?.vmRequested === false,
  );
  check(
    "parser: 'Допусната ВМ' → vmRequested true",
    recs[1]?.vmRequested === true,
  );
  check(
    "parser: [] on empty input, never throws",
    parseComplaintsText("", {}, "2026-07-04").length === 0,
  );
}

// --- TEST-001b: singular "Ответник:" label (no "(ници)") ------------------
{
  const FIXTURE = `Жалба № ВХР-1-01.01.2026
Наименование на жалбоподателя: ФИРМА ЕООД
Ответник: ОБЩИНА СИНГУЛАР
УНП: 00001-2026-0001
Статус: иницииран процес`;
  const recs = parseComplaintsText(FIXTURE, {}, "2026-01-01");
  check(
    "parser: singular 'Ответник:' → respondent extracted",
    recs[0]?.respondent === "ОБЩИНА СИНГУЛАР",
    JSON.stringify(recs[0]),
  );
}

// --- TEST-001c: mergeAppealInto null-clobber + enrichment survival ----------
{
  // prev = a stored row carrying PG write-back enrichment the scrape never has.
  const prev = {
    complaintNo: "X-1",
    complaintId: null,
    complaintDate: "2026-01-01",
    complainant: "Old complainant",
    respondent: "Old respondent",
    appealedAct: null,
    unp: "00001-2026-0001",
    vmRequested: null,
    status: "иницииран процес",
    subject: "Old subject",
    sourceUrl: null,
    fetchedAt: "2026-01-01",
    // enrichment (not part of a bare scrape):
    buyerEik: "999999999",
    match: "exact",
    outcome: "уважена",
  } as KzkAppeal & Record<string, unknown>;
  // incoming = a re-scrape that MISSED the УНП (markup drift → null) but has
  // fresh values for other fields.
  const incoming: KzkAppeal = {
    complaintNo: "X-1",
    complaintId: null,
    complaintDate: "2026-01-02",
    complainant: "New complainant",
    respondent: "New respondent",
    appealedAct: null,
    unp: null,
    vmRequested: null,
    status: "открито производство",
    subject: "New subject",
    sourceUrl: null,
    fetchedAt: "2026-01-02",
  };
  const merged = mergeAppealInto(prev, incoming);
  check(
    "merge: a null scrape field does NOT clobber a good stored value",
    merged.unp === "00001-2026-0001",
    `unp=${merged.unp}`,
  );
  check(
    "merge: enrichment-only keys survive the merge",
    merged.outcome === "уважена" && merged.buyerEik === "999999999",
  );
  check(
    "merge: a DEFINED scrape field overwrites the stored value",
    merged.complainant === "New complainant" &&
      merged.subject === "New subject",
  );
  check(
    "merge: no prev → incoming passes through unchanged",
    mergeAppealInto(undefined, incoming).complaintNo === "X-1",
  );
}

// --- TEST-001d: applyEnrichment write-back null-clobber (FINDING-001) --------
{
  // JSON row carries the unregenerable outcome; PG lacks it (fresh/reset DB).
  const a: Record<string, unknown> = {
    complaintNo: "X",
    respondent: "R",
    outcome: "уважена",
    decisionDate: "2025-01-01",
  };
  applyEnrichment(a, {
    buyer_eik: "123",
    match: "exact",
    outcome: null,
    decision_date: null,
    suspension: null,
    buyer_name: null,
  });
  check(
    "write-back: PG-null outcome does NOT clobber JSON",
    a.outcome === "уважена",
  );
  check(
    "write-back: PG-null decisionDate does NOT clobber JSON",
    a.decisionDate === "2025-01-01",
  );
  check(
    "write-back: PG value wins when present",
    (() => {
      const b: Record<string, unknown> = { outcome: "уважена" };
      applyEnrichment(b, { outcome: "отхвърлена" });
      return b.outcome === "отхвърлена";
    })(),
  );
}

// --- TEST-002: transparency funding null-safety ----------------------------
{
  const base: Tender = {
    unp: "00000-2025-0001",
    publicationDate: "2025-01-01",
    buyerEik: "000000000",
    buyerName: "Test",
    subject: "Test",
    isCancelled: false,
    lots: [],
    sourceDay: "2025-01-01",
    sourceUrl: "x",
  };
  // The API deserializes an undisclosed EU-funding flag to JSON `null` (not
  // undefined) — the exact value the `!== undefined` bug counted as published.
  // Cast because the FE type is `boolean | undefined`; the runtime value is null.
  const nullFunding = computeTenderTransparency({
    ...base,
    isEuFunded: null as unknown as undefined,
  });
  const disclosedNo = computeTenderTransparency({ ...base, isEuFunded: false });
  const nf = nullFunding.indicators.find((i) => i.key === "fundingInfo");
  const df = disclosedNo.indicators.find((i) => i.key === "fundingInfo");
  check(
    "transparency: undisclosed (null) funding → NOT present",
    nf?.present === false,
  );
  check(
    "transparency: disclosed 'no EU funding' → present",
    df?.present === true,
  );

  // Variable denominator (FINDING-004): a MULTI-lot procedure is scored on
  // lotBreakdown (total 10); a zero/single-lot one drops it (total 9).
  const multiLot = computeTenderTransparency({
    ...base,
    lots: [
      { lotId: "1", name: "A" },
      { lotId: "2", name: "B" },
    ],
  });
  const zeroLot = computeTenderTransparency({ ...base, lots: [] });
  const singleLot = computeTenderTransparency({
    ...base,
    lots: [{ lotId: "1", name: "only" }],
  });
  const hasLot = (r: typeof multiLot) =>
    r.indicators.some((i) => i.key === "lotBreakdown");
  check(
    "transparency: multi-lot includes lotBreakdown (denominator 10)",
    multiLot.total === 10 && hasLot(multiLot),
    `total=${multiLot.total}`,
  );
  check(
    "transparency: zero-lot drops lotBreakdown (denominator 9)",
    zeroLot.total === 9 && !hasLot(zeroLot),
    `total=${zeroLot.total}`,
  );
  check(
    "transparency: single-lot drops lotBreakdown (denominator 9)",
    singleLot.total === 9 && !hasLot(singleLot),
    `total=${singleLot.total}`,
  );
}

// --- TEST-003: awarder_risk_grade() vs. awarder_risk_grade_ranking parity -----
// The A–F weights are hand-copied between the per-entity function and the
// leaderboard matview (041, "MUST STAY IDENTICAL"). This asserts a couple of
// fixed EIKs score/grade the same on both paths, so a future weight tweak that
// lands in only one copy fails loudly. DB-backed — skipped cleanly without PG.
let parityChecked = false;
await (async () => {
  try {
    const { getPool, end } = await import("../db/lib/pg");
    const pool = getPool();
    const EIKS = ["000695089", "000696327"]; // АПИ, Столична община
    for (const eik of EIKS) {
      const [fn, mv] = await Promise.all([
        pool.query(
          `SELECT (awarder_risk_grade($1)->>'score')::int AS s,
                  awarder_risk_grade($1)->>'grade' AS g`,
          [eik],
        ),
        pool.query(
          "SELECT score AS s, grade AS g FROM awarder_risk_grade_ranking WHERE eik = $1",
          [eik],
        ),
      ]);
      if (mv.rows.length === 0) {
        console.log(`  · parity ${eik}: not in ranking (below floor) — skip`);
        continue;
      }
      parityChecked = true;
      check(
        `grade parity fn == matview for ${eik}`,
        fn.rows[0].s === mv.rows[0].s && fn.rows[0].g === mv.rows[0].g,
        `fn ${fn.rows[0].s}/${fn.rows[0].g} vs matview ${mv.rows[0].s}/${mv.rows[0].g}`,
      );
    }
    await end();
  } catch (e) {
    console.log(
      `  ⚠ skip TEST-003 grade parity (no PG): ${(e as Error).message.slice(0, 80)}`,
    );
  }
})();

// --- TEST-004: upsert null-protection (KZK_UPSERT_SQL) ----------------------
// A tier-2 row (suspension=true, complaint_id set) must SURVIVE a later intake
// re-scrape (suspension=false via non-спрян status, complaint_id=null). Runs the
// EXACT applyPg upsert SQL. DB-backed — skipped cleanly without PG.
// Runs inside a transaction that ALWAYS rolls back — the __HARNESS__ row never
// commits, so a crash can't leak it into the user-facing table / recent_updates.
await (async () => {
  try {
    const { withClient, end } = await import("../db/lib/pg");
    const NO = "__HARNESS__-kzk-upsert";
    const P = (o: Partial<Record<string, unknown>>) => [
      NO,
      o.complaint_id ?? null,
      o.complaint_date ?? null,
      o.complainant ?? null,
      o.respondent ?? null,
      o.appealed_act ?? null,
      o.unp ?? null,
      o.vm_requested ?? null,
      o.status ?? null,
      o.subject ?? null,
      o.suspension ?? null,
      o.source_url ?? "https://reg.cpc.bg/AllComplaints.aspx?dt=2",
      o.fetched_at ?? "2026-01-01",
    ];
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // tier-2 baseline
        await c.query(
          KZK_UPSERT_SQL,
          P({
            complaint_id: "TID-1",
            unp: "00000-0000-0000",
            status: "приключено производство",
            suspension: true,
            source_url: "http://known",
          }),
        );
        // intake re-scrape that MISSED the id + carries suspension=false
        await c.query(
          KZK_UPSERT_SQL,
          P({
            complaint_id: null,
            unp: null,
            status: "открито производство",
            suspension: false,
          }),
        );
        const { rows } = await c.query(
          "SELECT suspension, complaint_id, unp, status, source_url FROM kzk_appeals WHERE complaint_no=$1",
          [NO],
        );
        const r = rows[0] ?? {};
        check(
          "upsert: tier-2 suspension=true survives intake false",
          r.suspension === true,
          JSON.stringify(r),
        );
        check(
          "upsert: complaint_id survives a null re-scrape",
          r.complaint_id === "TID-1",
        );
        check(
          "upsert: unp survives a null re-scrape",
          r.unp === "00000-0000-0000",
        );
        check(
          "upsert: source_url kept when re-scrape has no id",
          r.source_url === "http://known",
        );
        check(
          "upsert: status takes the fresh captured value",
          r.status === "открито производство",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await end();
  } catch (e) {
    console.log(
      `  ⚠ skip TEST-004 upsert (no PG): ${(e as Error).message.slice(0, 80)}`,
    );
  }
})();

// --- TEST-005: effective suspended transitions via status (F-001) -----------
// Intake writes suspension=NULL; the effective state derives from the fresh
// status. Re-scraping a row from a live status to "спряно производство" must
// flip the derived suspended flag true (the old stored-bool design froze it).
// Transaction-wrapped + rolled back — the __HARNESS__ row never commits.
await (async () => {
  try {
    const { withClient, end } = await import("../db/lib/pg");
    const NO = "__HARNESS__-kzk-suspension";
    const row = (status: string) => [
      NO,
      null,
      "2026-01-01",
      "C",
      "R",
      null,
      "00000-0000-0000",
      null,
      status,
      "s",
      null,
      "http://x",
      "2026-01-01",
    ];
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const eff = async () =>
          (
            await c.query(
              "SELECT COALESCE(suspension, status ~* 'спрян') AS x FROM kzk_appeals WHERE complaint_no=$1",
              [NO],
            )
          ).rows[0]?.x;
        await c.query(KZK_UPSERT_SQL, row("иницииран процес"));
        check(
          "effective suspended: live status → false",
          (await eff()) === false,
        );
        await c.query(KZK_UPSERT_SQL, row("спряно производство"));
        check(
          "effective suspended: спряно status → true (F-001, no frozen bool)",
          (await eff()) === true,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await end();
  } catch (e) {
    console.log(
      `  ⚠ skip TEST-005 suspension (no PG): ${(e as Error).message.slice(0, 80)}`,
    );
  }
})();

// Make a green run that DIDN'T check parity distinguishable at a glance (a
// no-PG run still exits 0, but the summary says so — FINDING-006).
const parityNote = parityChecked ? "" : " (grade parity SKIPPED — no PG)";
console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}${parityNote} — КЗК parser + transparency invariants`,
);
process.exit(failures === 0 ? 0 : 1);
