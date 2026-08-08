// READ-ONLY measurement of the Interreg corpus.
//
// There is no `--apply` and no write path anywhere in this file. It exists so
// that every number in docs/plans/interreg-funds-ingest-v1.md can be re-derived
// by running one command, against either the committed corpus or a database,
// with THE SAME CODE the ingest and loader act on rather than a
// re-implementation (`readCorpus` here is the very function the loader reads
// through — see corpus.ts for why it lives there and not in the loader). Modelled on scripts/procurement/measure_cross_source.ts,
// whose header records why: the procurement plan's first draft measured a
// LOOKALIKE helper instead of the real one and was wrong, and a committed
// harness importing the real functions cannot drift from what they do.
//
//   npx tsx scripts/funds/interreg/measure.ts                # every section
//   npx tsx scripts/funds/interreg/measure.ts --full         # same (the plan's §Verification name)
//   npx tsx scripts/funds/interreg/measure.ts --ranking-delta  # §6 only
//   npx tsx scripts/funds/interreg/measure.ts --source=corpus  # no database
//   npx tsx scripts/funds/interreg/measure.ts --json         # machine-readable
//
// Against Cloud SQL (production), via the proxy — still read-only:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/funds/interreg/measure.ts
//
// ── WHAT EACH SOURCE CAN AND CANNOT ANSWER, AND WHY THAT IS NOT A GAP ────────
//
// `--source=corpus` reads data/funds/interreg/ — the committed facts, exactly
// what `db:load:interreg:pg` ingests. It answers §1 (programme admission),
// §3.1 (money), §5 (scale) and §7 (language) completely, and it is the only
// source that works on a checkout with no Postgres.
//
// It CANNOT answer §3.2 or §6, because **the committed corpus carries no
// EKATTE**. Place resolution runs inside the LOADER (Tier L1 reads
// `awarder_seats`, L2 reads `tr_company_place` — both Postgres tables), which is
// a deliberate design decision recorded in the plan's §8: an ingest that reached
// into Postgres would make the committed tree unreproducible from a fresh clone.
// So "no placement figures without a database" is the design showing through,
// not a limitation of this file.
//
// §6 additionally needs `fund_payloads` — the ИСУН baseline the ranking moves
// against — so it is Postgres-only twice over.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT RE-DERIVE ──────────────────────────
//
// §1's programme ROSTER — which programmes exist and their eligible NUTS3 — and
// §2's source evaluation are keep.eu facts established by crawling, not
// properties of the corpus; re-deriving them would mean re-running the ~2 h
// index walk on every measurement. What §1 below DOES check is admission: that
// every programme_code in the corpus is curated, and which curated ones came
// back empty. §11's "unestablished" list is unestablished by definition.

import { readCorpus } from "./corpus";
import { INTERREG_PROGRAMMES } from "./programmes";
import {
  isBulgarianPartner,
  isLinkedBasis,
  BUDGET_BASES,
  INTERREG_PERIODS,
  type InterregOperation,
  type InterregPartner,
  type PlaceBasis,
} from "./types";
import { allRows, dbReachable, end } from "../../db/lib/pg";

const argv = process.argv.slice(2);
const KNOWN = new Set([
  "--json",
  "--full",
  "--ranking-delta",
  "--source=pg",
  "--source=corpus",
]);
const unknown = argv.filter((a) => !KNOWN.has(a));
if (unknown.length) {
  // The sibling harness does this too, and the reason is specific: the crawl
  // CLI silently ignores unknown flags (argv.includes), and a measurement that
  // quietly ignored `--sourse=pg` would print the other source's numbers under
  // the requested heading.
  console.error(`measure: unknown flag(s): ${unknown.join(", ")}`);
  console.error(`known: ${[...KNOWN].join(" ")}`);
  process.exit(2);
}
const JSON_OUT = argv.includes("--json");
const CORPUS_ONLY = argv.includes("--source=corpus");
const ONLY_RANKING = argv.includes("--ranking-delta");
if (CORPUS_ONLY && ONLY_RANKING) {
  // §6 is the one section the committed corpus cannot answer — it needs both the
  // loader's placement and `fund_payloads`. Asking for §6 only, from a source
  // that has neither, is a request for nothing; accepting it would exit 0 with
  // an empty report, which reads as "measured, nothing to say".
  console.error(
    "measure: --source=corpus --ranking-delta measures nothing — §6 needs the " +
      "LOADED corpus (placement runs in the loader) and fund_payloads. Pass one flag, not both.",
  );
  process.exit(2);
}

const eur = (n: number | null | undefined): string =>
  n == null ? "—" : `€${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number, d: number): string =>
  d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
const num = (n: number): string => n.toLocaleString("en-US");

/** Every figure, keyed by the plan section it re-derives. `--json` prints this
 *  verbatim so a diff against a previous run is a diff of the measurements. */
const out: Record<string, unknown> = {};
const lines: string[] = [];
const say = (s = ""): void => {
  lines.push(s);
};
const head = (s: string): void => {
  say();
  say(s);
  say("─".repeat(Math.min(s.length, 78)));
};

// ── §3.1 · §5 · §7 — from the committed corpus ──────────────────────────────

const measureCorpus = (
  operations: InterregOperation[],
  partners: InterregPartner[],
): void => {
  const bg = partners.filter(isBulgarianPartner);
  const byKeep = new Map<number, InterregOperation>();
  for (const o of operations) byKeep.set(o.keepId, o);

  // ── §5 Scale ──────────────────────────────────────────────────────────────
  const bgOps = new Set(bg.map((p) => p.keepId));
  const bgMoney = bg.reduce((a, p) => a + (p.budgetEur ?? 0), 0);
  const byPeriod = Object.fromEntries(
    INTERREG_PERIODS.map((period) => {
      const rows = bg.filter((p) => byKeep.get(p.keepId)?.period === period);
      return [
        period,
        {
          partnerRows: rows.length,
          operations: new Set(rows.map((r) => r.keepId)).size,
          budgetEur: rows.reduce((a, r) => a + (r.budgetEur ?? 0), 0),
          withEik: rows.filter((r) => r.eik).length,
        },
      ];
    }),
  );
  out["§5"] = {
    operations: operations.length,
    partnerRows: partners.length,
    bgPartnerRows: bg.length,
    bgOperations: bgOps.size,
    bgBudgetEur: bgMoney,
    byPeriod,
  };
  head("§5 — Scale");
  say(
    `operations ${num(operations.length)} · partner rows ${num(partners.length)}`,
  );
  say(
    `Bulgarian partner rows ${num(bg.length)} (${pct(bg.length, partners.length)}) ` +
      `across ${num(bgOps.size)} operations · ${eur(bgMoney)}`,
  );
  for (const period of INTERREG_PERIODS) {
    const p = byPeriod[period];
    say(
      `  ${period}  rows ${String(p.partnerRows).padStart(5)} · ops ${String(p.operations).padStart(4)} · ` +
        `${eur(p.budgetEur).padStart(14)} · with EIK ${p.withEik} (${pct(p.withEik, p.partnerRows)})`,
    );
  }
  // THE PERIOD ASYMMETRY IS THE PLAN'S CENTRAL CONSTRAINT, so it is stated as a
  // conclusion rather than left to be read off the table: it is what caps
  // /company/:eik and company_public_money at Tier L.
  const older = byPeriod["2014-2020"];
  if (older && older.withEik === 0)
    say(
      `  → Tier L ceiling holds: 0 of ${num(older.partnerRows)} 2014-2020 rows carry a national id.`,
    );
  else if (older)
    say(
      `  → TIER L CEILING MOVED: ${older.withEik} 2014-2020 rows now carry a national id. ` +
        `Every "2021-2027 only" caption on the site is calibrated on that being zero.`,
    );

  // ── §3.1 Partner shares vs total budget ───────────────────────────────────
  const basisCount = Object.fromEntries(
    BUDGET_BASES.map((b) => [b, bg.filter((p) => p.budgetBasis === b).length]),
  );
  // The invariant: an operation's total is NOT the sum of its partners, and no
  // money surface may substitute one for the other. keep.eu does not guarantee
  // the two reconcile, so this REPORTS the overshoot rather than asserting it
  // away — the plan's §12 records that refusing those 68 operations dropped 64
  // Bulgarian rows and €9.47m for no defensible reason.
  const sums = new Map<number, number>();
  for (const p of partners)
    sums.set(p.keepId, (sums.get(p.keepId) ?? 0) + (p.budgetEur ?? 0));
  const overshoot = operations.filter((o) => {
    const s = sums.get(o.keepId) ?? 0;
    return o.totalBudgetEur != null && s > o.totalBudgetEur * 1.01;
  });
  out["§3.1"] = {
    budgetBasis: basisCount,
    operationsWhosePartnersExceedTotal: overshoot.length,
    overshootShare: overshoot.length / Math.max(operations.length, 1),
  };
  head("§3.1 — Partner shares vs the operation total");
  for (const b of BUDGET_BASES)
    say(
      `  ${b.padEnd(15)} ${String(basisCount[b]).padStart(5)} BG rows ` +
        `(${pct(basisCount[b], bg.length)})`,
    );
  say(
    `  Σ partners > operation total (>1%): ${overshoot.length} of ${num(operations.length)} ` +
      `operations (${pct(overshoot.length, operations.length)}) — REPORTED, not refused: ` +
      `keep.eu does not guarantee the two reconcile.`,
  );

  // The four rows the plan opens with. Named explicitly because they are the
  // worked example every reader checks first, and because BSB00963 is where the
  // 4x overstatement would land if a surface ever summed the operation total.
  const mt = bg
    .filter((p) => /малко\s*търново/i.test(p.partnerName ?? ""))
    .concat(
      bg.filter(
        (p) =>
          /malko\s*tarnovo/i.test(p.partnerName ?? "") ||
          /malko\s*tarnovo/i.test(p.partnerNameEn ?? ""),
      ),
    );
  const seen = new Set<string>();
  const mtRows = mt.filter((p) => {
    const k = `${p.keepId}:${p.partnerSeq}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  out["§3.1.malkoTarnovo"] = mtRows.map((p) => ({
    keepId: p.keepId,
    operationId: byKeep.get(p.keepId)?.operationId ?? null,
    partner: p.partnerName,
    eik: p.eik,
    budgetEur: p.budgetEur,
    operationTotalEur: byKeep.get(p.keepId)?.totalBudgetEur ?? null,
  }));
  say();
  say(`  Малко Търново — ${mtRows.length} partner rows:`);
  for (const p of mtRows.sort((a, b) => a.keepId - b.keepId)) {
    const o = byKeep.get(p.keepId);
    say(
      `    ${String(p.keepId).padEnd(6)} ${(o?.operationId ?? "—").padEnd(12)} ` +
        `${eur(p.budgetEur).padStart(12)} of ${eur(o?.totalBudgetEur).padStart(12)} whole project`,
    );
  }

  // ── §7 Language ───────────────────────────────────────────────────────────
  const withBgTitle = operations.filter((o) => o.titleBg).length;
  const titleLangs: Record<string, number> = {};
  for (const o of operations) {
    const l = o.titleLang ?? "(none)";
    titleLangs[l] = (titleLangs[l] ?? 0) + 1;
  }
  out["§7"] = {
    operations: operations.length,
    withBulgarianTitle: withBgTitle,
    titleLangs,
  };
  head("§7 — Language");
  say(
    `  Bulgarian title published: ${num(withBgTitle)} of ${num(operations.length)} ` +
      `(${pct(withBgTitle, operations.length)})`,
  );
  // The plan's §7 says keep.eu is English-only, from a 107-project sample. It is
  // not, and this is the line that corrects it — the fallback is the common case
  // rather than the only one. Recorded here because a sampled claim that turns
  // out wrong at full scale is exactly what this harness exists to catch.
  if (withBgTitle > 0)
    say(
      `  → §7's "no Bulgarian title for any of these" was a 107-project sample. ` +
        `At full scale ${num(withBgTitle)} have one; the rest fall back to English.`,
    );
  // keep.eu's own language detection files two operations under mt/it, which is
  // why the page says which language the title is IN rather than assuming "en".
  for (const [lang, n] of Object.entries(titleLangs).sort(
    (a, b) => b[1] - a[1],
  ))
    say(`     title_lang ${lang.padEnd(8)} ${num(n)}`);

  // ── §1 Programme admission ────────────────────────────────────────────────
  const codes = new Set(operations.map((o) => o.programmeCode));
  const curated = new Set(INTERREG_PROGRAMMES.map((p) => p.code));
  const uncurated = [...codes].filter((c) => !curated.has(c));
  const empty = [...curated].filter((c) => !codes.has(c));
  out["§1"] = {
    curatedProgrammes: curated.size,
    programmesWithOperations: codes.size,
    uncurated,
    curatedButEmpty: empty,
  };
  head("§1 — Programme admission");
  say(
    `  curated ${curated.size} · with operations ${codes.size} · ` +
      `uncurated codes in the corpus ${uncurated.length}`,
  );
  if (uncurated.length)
    say(
      `  UNCURATED (should be impossible — the gate skips them): ${uncurated.join(", ")}`,
    );
  if (empty.length)
    say(
      `  curated with zero operations (a named gap, see §11): ${empty.join(", ")}`,
    );
};

// ── §3.2 · §6 · T4 — Postgres only ──────────────────────────────────────────

const one = async <T>(sql: string): Promise<T> => {
  const rows = await allRows<T>(sql);
  return rows[0];
};

const measurePlacement = async (): Promise<void> => {
  const BG = `(p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')`;
  const rows = await allRows<{
    period: string;
    rows: string;
    placed: string;
    money: string;
    placed_money: string;
    linked: string;
  }>(
    `SELECT o.period,
            count(*) rows,
            count(p.ekatte) placed,
            COALESCE(SUM(p.budget_eur), 0)::text money,
            COALESCE(SUM(p.budget_eur) FILTER (WHERE p.ekatte IS NOT NULL), 0)::text placed_money,
            count(*) FILTER (WHERE p.eik IS NOT NULL) linked
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
      WHERE ${BG} GROUP BY o.period ORDER BY o.period`,
  );
  const basis = await allRows<{ place_basis: string | null; n: string }>(
    `SELECT p.place_basis, count(*) n FROM interreg_partners p
      WHERE ${BG} GROUP BY 1 ORDER BY 2 DESC`,
  );
  out["§3.2"] = {
    byPeriod: rows.map((r) => ({
      period: r.period,
      rows: Number(r.rows),
      placed: Number(r.placed),
      budgetEur: Number(r.money),
      placedBudgetEur: Number(r.placed_money),
      withEik: Number(r.linked),
    })),
    placeBasis: Object.fromEntries(
      basis.map((b) => [b.place_basis ?? "(unplaced)", Number(b.n)]),
    ),
  };
  head("§3.2 — Place attribution (Tier L / Tier P)");
  for (const r of rows)
    say(
      `  ${r.period}  rows ${String(r.rows).padStart(5)} · placed ${String(r.placed).padStart(5)} ` +
        `(${pct(Number(r.placed), Number(r.rows))}) · money placed ` +
        `${pct(Number(r.placed_money), Number(r.money))} · with EIK ${r.linked}`,
    );
  say();
  for (const b of basis)
    say(
      `  ${(b.place_basis ?? "(unplaced)").padEnd(18)} ${String(b.n).padStart(5)}` +
        (isLinkedBasis(b.place_basis as PlaceBasis | null)
          ? "   ← Tier L (identity)"
          : ""),
    );
  // Placement has NO period ceiling, unlike identity — which is the finding that
  // made the plan viable, since the larger and older half of the money is
  // attributable to a place without any identifier at all.
  const total = rows.reduce((a, r) => a + Number(r.rows), 0);
  const placed = rows.reduce((a, r) => a + Number(r.placed), 0);
  // DERIVED, not asserted. The claim "placement has no period ceiling" is the
  // finding that made the plan viable — the older and larger half of the money
  // is attributable to a place with no identifier at all — so it has to be read
  // off the rows rather than printed regardless of them. Compare §5's Tier-L
  // line, which shouts when its ceiling moves.
  const worstPeriod = rows
    .map((r) => ({
      period: r.period,
      share: Number(r.placed) / Number(r.rows),
    }))
    .sort((a, b) => a.share - b.share)[0];
  say();
  say(
    `  → placement ${pct(placed, total)} overall; worst period ` +
      `${worstPeriod.period} at ${(100 * worstPeriod.share).toFixed(1)}%` +
      (worstPeriod.share > 0.9
        ? ` — the ceiling is on IDENTITY (Tier L), not on geography.`
        : ` — BELOW THE 90% FLOOR the loader enforces; geography is no longer ` +
          `the reliable arm and §6's ranking cannot be trusted.`),
  );
};

const measureRanking = async (): Promise<void> => {
  const r = await one<{
    cohort: string;
    moved: string;
    gained: string;
    best: string;
    worst: string;
  }>(
    `SELECT count(*) cohort,
            count(*) FILTER (WHERE rank <> rank_before) moved,
            count(*) FILTER (WHERE interreg_eur > 0) gained,
            max(rank_before - rank) best, min(rank_before - rank) worst
       FROM funds_muni_combined_v`,
  );
  const movers = await allRows<{
    obshtina: string;
    pop: string;
    ir: string;
    before: number;
    after: number;
    pc_before: string;
    pc_after: string;
  }>(
    `SELECT obshtina, population::text pop, interreg_eur::text ir,
            rank_before before, rank after,
            per_capita_eur_isun::text pc_before, per_capita_eur::text pc_after
       FROM funds_muni_combined_v
      WHERE rank_before - rank > 0
      ORDER BY rank_before - rank DESC, obshtina LIMIT 12`,
  );
  // READ THE FUNCTION, do not re-derive it. The first draft copied 139's
  // classification subquery character for character — the exact lookalike-drift
  // failure this file's header cites from measure_cross_source.ts, applied to
  // the figure §6 itself calls "part of the answer, not a footnote".
  const bucket = await one<{
    r: { excluded: Record<string, { rows: number; eur: number }> };
  }>(`SELECT funds_muni_combined_rank(1) AS r`);
  const excluded = Object.entries(bucket.r.excluded ?? {}).map(
    ([reason, v]) => ({ reason, rows: String(v.rows), eur: String(v.eur) }),
  );
  excluded.sort((x, y) => Number(y.eur) - Number(x.eur));
  out["§6"] = {
    cohort: Number(r.cohort),
    moved: Number(r.moved),
    gainedMoney: Number(r.gained),
    bestGain: Number(r.best),
    worstLoss: Number(r.worst),
    topMovers: movers.map((m) => ({
      obshtina: m.obshtina,
      population: Number(m.pop),
      interregEur: Number(m.ir),
      rankBefore: m.before,
      rank: m.after,
      perCapitaBefore: Number(m.pc_before),
      perCapita: Number(m.pc_after),
    })),
    excluded: Object.fromEntries(
      excluded.map((e) => [
        e.reason,
        { rows: Number(e.rows), eur: Number(e.eur) },
      ]),
    ),
  };
  head("§6 — Which municipalities move");
  // `worst` is min(rank_before - rank), so it is a LOSS only when negative — a
  // corpus where every municipality gained would print "largest loss +3".
  const worst = Number(r.worst);
  say(
    `  ${num(Number(r.moved))} of ${num(Number(r.cohort))} ranked общини change rank ` +
      `(${pct(Number(r.moved), Number(r.cohort))}); ${num(Number(r.gained))} gain money. ` +
      `Best gain +${r.best}; ` +
      (worst < 0
        ? `largest loss ${worst} (what happens to everyone the movers pass).`
        : `no municipality lost a place.`),
  );
  say();
  say(
    `  ${"obshtina".padEnd(9)} ${"pop".padStart(8)} ${"Interreg".padStart(12)}  rank      €/жител`,
  );
  for (const m of movers)
    say(
      `  ${m.obshtina.padEnd(9)} ${num(Number(m.pop)).padStart(8)} ` +
        `${eur(Number(m.ir)).padStart(12)}  ${String(m.before).padStart(3)}→${String(m.after).padEnd(4)} ` +
        `+${String(m.before - m.after).padEnd(3)} ` +
        `${Math.round(Number(m.pc_before))}→${Math.round(Number(m.pc_after))}`,
    );
  say();
  // The exclusions are part of the answer, not a footnote — most of what falls
  // outside is Столична община, which has no per-capita figure on EITHER arm
  // because ГРАО publishes no city EKATTE. The share is COMPUTED rather than
  // quoted: an earlier draft of this comment carried 23.8% against a measured
  // 23.2%, which is precisely the kind of stale prose a harness exists to end.
  const exTotal = excluded.reduce((a, e) => a + Number(e.eur), 0);
  const exOutside = excluded
    .filter((e) => e.reason !== "ranked")
    .reduce((a, e) => a + Number(e.eur), 0);
  say(
    `  ${pct(exOutside, exTotal)} of the Bulgarian corpus sits outside the ranked cohort:`,
  );
  for (const e of excluded)
    say(
      `  ${e.reason.padEnd(14)} ${String(e.rows).padStart(5)} rows · ${eur(Number(e.eur))}`,
    );
};

const measurePublicMoney = async (): Promise<void> => {
  const r = await one<{ companies: string; eur: string; src: string }>(
    `SELECT count(*) FILTER (WHERE interreg_eur > 0)::text companies,
            COALESCE(SUM(interreg_eur), 0)::text eur,
            (SELECT COALESCE(SUM(budget_eur), 0)::text FROM interreg_partners
              WHERE eik IS NOT NULL
                AND (country = 'Bulgaria' OR country_department = 'Bulgaria')) src
       FROM company_public_money`,
  );
  out["T4"] = {
    companies: Number(r.companies),
    interregEur: Number(r.eur),
    sourceEur: Number(r.src),
    reconciles: Math.abs(Number(r.eur) - Number(r.src)) < 0.02,
  };
  head("T4 — company_public_money's Interreg arm");
  say(
    `  ${num(Number(r.companies))} companies · ${eur(Number(r.eur))} ` +
      `(source ${eur(Number(r.src))}${
        Math.abs(Number(r.eur) - Number(r.src)) < 0.02
          ? ", reconciles"
          : " — DRIFT: the graph loader has not re-run since the corpus moved"
      })`,
  );
};

const main = async (): Promise<void> => {
  if (!ONLY_RANKING) {
    const { operations, partners } = readCorpus();
    measureCorpus(operations, partners);
  }

  if (!CORPUS_ONLY) {
    if (!(await dbReachable())) {
      // A clear statement rather than a crash: §3.1/§5/§7 above are already
      // printed and complete, and the reader needs to know which sections are
      // missing and why — not to see a connection error where a table was.
      // Recorded in `out` as well as in the human report: --json is the
      // run-to-run diff this file advertises, and without a marker a skipped
      // run is byte-identical to `--source=corpus` — a machine consumer cannot
      // tell "measured against a database" from "did not look".
      out["skipped"] = {
        sections: ["§3.2", "§6", "T4"],
        reason: "postgres unreachable",
      };
      head("§3.2 · §6 · T4 — SKIPPED");
      say("  Postgres is unreachable. Placement, the ranking delta and the");
      say(
        "  public-money arm need the LOADED corpus: the committed tree carries",
      );
      say(
        "  no EKATTE, because place resolution runs in the loader (plan §8).",
      );
      say("  Start it with `npm run db:pg:up`, or pass --source=corpus.");
    } else {
      // Ordered by dependency: the ranking is downstream of placement, and
      // T4's arm is downstream of both.
      if (!ONLY_RANKING) await measurePlacement();
      await measureRanking();
      if (!ONLY_RANKING) await measurePublicMoney();
      await end();
    }
  }

  flush();
};

/** Print whatever has been measured so far. Called on the way out of BOTH the
 *  success and the failure path.
 *
 *  Output is buffered so the sections come out in one block, and the first draft
 *  flushed only at the end — so a throw in any Postgres section discarded §1,
 *  §3.1, §5 and §7, which were already computed and correct, and printed a raw
 *  pg error instead. That is exactly the state a first Cloud SQL run is in: the
 *  header invites pointing this at production, where `db:load:interreg:pg:cloud`
 *  is a manual step and the relations may simply not be there yet. */
const flush = (): void => {
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else console.log(lines.join("\n"));
};

main().catch((e) => {
  // The measured sections first, then the error — in that order, because the
  // report is the point and the stack is the footnote.
  flush();
  console.error();
  console.error(e);
  process.exit(1);
});
