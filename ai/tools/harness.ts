// Node correctness harness for the deterministic tools layer (Brain 1).
// Run: npx tsx ai/tools/harness.ts
//
// Swaps in a node fetcher that reads the local `data/` tree (instead of the
// browser's bucket fetch), exercises every tool, prints results, and asserts a
// couple of known-good values so a regression fails loudly.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "../orchestrator/router";
import { setFetcher } from "./dataClient";
import { runTool } from "./registry";
import type { Envelope, ToolContext } from "./types";

setFetcher(async (path: string) => {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  const abs = join(process.cwd(), "data", rel);
  return JSON.parse(await readFile(abs, "utf8"));
});

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ASSERT FAILED: ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
};

const printEnvelope = (e: Envelope) => {
  console.log(`\n=== [${e.tool}] ${e.title} ===`);
  if (e.subtitle) console.log(`    ${e.subtitle}`);
  console.log(`  viz: ${e.viz} · provenance: ${e.provenance.join(", ")}`);
  if (e.kind === "table" && e.rows) {
    console.table(e.rows.slice(0, 8));
  }
  if (e.kind === "series" && e.series) {
    for (const s of e.series) {
      const pts = s.points.map((p) => `${p.x}:${p.y ?? "—"}`).join("  ");
      console.log(`  ${s.label}: ${pts}`);
    }
  }
  console.log("  facts:", JSON.stringify(e.facts, null, 0));
};

const run = async () => {
  const ctxEn: ToolContext = { lang: "en", election: "2026_04_19" };
  const ctxBg: ToolContext = { lang: "bg", election: "2026_04_19" };

  // 1. machine-vote series (the showcase) — pure, no fetch
  const ms = (await runTool("machineVoteSeries", { n: 7 }, ctxEn)) as Envelope;
  printEnvelope(ms);
  const msLatest = ms.series![0].points.at(-1);
  assert(
    msLatest != null && Math.abs((msLatest.y ?? 0) - 47.61) < 0.5,
    `machine share for latest ≈ 47.61% (got ${msLatest?.y})`,
  );
  assert(ms.series![0].points.length === 7, "series has 7 points");

  // 2. turnout series — pure
  const ts = (await runTool("turnoutSeries", { n: 7 }, ctxEn)) as Envelope;
  printEnvelope(ts);
  const tsLatest = ts.series![0].points.at(-1);
  assert(
    tsLatest != null && Math.abs((tsLatest.y ?? 0) - 50.7) < 0.5,
    `turnout for latest ≈ 50.7% (got ${tsLatest?.y})`,
  );

  // 3. national results — fetches national_summary
  const nr = (await runTool("nationalResults", {}, ctxEn)) as Envelope;
  printEnvelope(nr);
  assert((nr.rows?.length ?? 0) > 0, "national results returned rows");
  assert(
    (nr.rows ?? []).every((r) => typeof r.votes === "number"),
    "every row has a numeric vote count",
  );

  // 4. party result — fuzzy match
  const pr = (await runTool(
    "partyResult",
    { party: "ГЕРБ" },
    ctxBg,
  )) as Envelope;
  printEnvelope(pr);
  assert(pr.kind === "scalar", "partyResult is scalar");

  // 5. party timeline — canonical lineage + bundled votes
  const pt = (await runTool(
    "partyTimeline",
    { party: "ГЕРБ" },
    ctxEn,
  )) as Envelope;
  printEnvelope(pt);
  assert(
    (pt.series?.[0].points.length ?? 0) > 1,
    "party timeline spans multiple elections",
  );

  // 6. new metric tools
  const mvs = (await runTool(
    "machineVoteShare",
    { election: "2023_04_02" },
    ctxEn,
  )) as Envelope;
  printEnvelope(mvs);
  assert(mvs.kind === "scalar", "machineVoteShare is scalar");

  const cmp = (await runTool(
    "compareElections",
    { a: "2022_10_02", b: "2024_10_27" },
    ctxEn,
  )) as Envelope;
  printEnvelope(cmp);
  assert((cmp.rows?.length ?? 0) === 4, "compareElections has 4 metric rows");

  // 7. router: questions -> tools (the no-model fallback)
  console.log("\n=== [router] question -> tool ===");
  const ctx: ToolContext = { lang: "bg", election: "2026_04_19" };
  const cases: [string, string | null][] = [
    [
      "Какъв е процентът машинно гласуване в последните 7 избора?",
      "machineVoteSeries",
    ],
    ["machine voting in the last 7 elections", "machineVoteSeries"],
    ["Как се представя ГЕРБ през годините?", "partyTimeline"],
    ["Колко гласа взе ДПС?", "partyResult"],
    ["Сравни изборите от 2022 и 2024", "compareElections"],
    ["Каква беше активността през 2023?", "turnout"],
    ["Какви са резултатите от последните избори?", "nationalResults"],
    ["времето е хубаво днес", null],
  ];
  for (const [q, expected] of cases) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 8. new cross-domain tools
  console.log("\n=== [new domains] tool runs ===");
  const local = (await runTool("localCouncilVoteShare", {}, ctxEn)) as Envelope;
  printEnvelope(local);
  assert((local.rows?.length ?? 0) > 0, "localCouncilVoteShare returns rows");

  const muni = (await runTool(
    "localMunicipality",
    { place: "Пловдив" },
    ctxBg,
  )) as Envelope;
  printEnvelope(muni);
  assert(muni.kind === "scalar", "localMunicipality is scalar");

  const budget = (await runTool("budgetOverview", {}, ctxEn)) as Envelope;
  printEnvelope(budget);
  assert((budget.rows?.length ?? 0) === 4, "budgetOverview has 4 metric rows");

  const cofog = (await runTool("budgetByFunction", {}, ctxEn)) as Envelope;
  printEnvelope(cofog);
  assert((cofog.rows?.length ?? 0) > 0, "budgetByFunction returns rows");

  const proc = (await runTool("procurementTotals", {}, ctxEn)) as Envelope;
  printEnvelope(proc);
  assert(!!proc.facts.contracts, "procurementTotals has contract count");

  const funds = (await runTool("fundsOverview", {}, ctxEn)) as Envelope;
  printEnvelope(funds);
  assert((funds.rows?.length ?? 0) > 0, "fundsOverview returns rows");

  const govs = (await runTool("governments", {}, ctxEn)) as Envelope;
  printEnvelope(govs);
  assert((govs.rows?.length ?? 0) > 0, "governments returns rows");

  const macro = (await runTool(
    "macroIndicator",
    { indicator: "инфлация" },
    ctxEn,
  )) as Envelope;
  printEnvelope(macro);
  assert(
    (macro.series?.[0].points.length ?? 0) > 0,
    "macroIndicator returns a series",
  );

  // 9. router: new-domain questions
  console.log("\n=== [router] new-domain questions ===");
  const cases2: [string, string | null][] = [
    ["Кой е кметът на Пловдив?", "localMunicipality"],
    ["Колко кмета спечели ГЕРБ на местните избори?", "localMayorsWon"],
    ["Кой спечели общинските съвети?", "localCouncilVoteShare"],
    ["Какъв е държавният бюджет?", "budgetOverview"],
    ["За какво се харчи бюджетът?", "budgetByFunction"],
    ["Колко са обществените поръчки?", "procurementTotals"],
    ["Кой получава европейски средства?", "fundsOverview"],
    ["Кои са правителствата от 2005?", "governments"],
    ["Каква е инфлацията?", "macroIndicator"],
    ["Как е икономиката?", "macroOverview"],
  ];
  for (const [q, expected] of cases2) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 10. Phase B — place-based tools
  console.log("\n=== [phase B] place-based tools ===");
  const mayorRace = (await runTool(
    "localMayorRace",
    { place: "Варна" },
    ctxBg,
  )) as Envelope;
  printEnvelope(mayorRace);
  assert(
    (mayorRace.rows?.length ?? 0) > 0,
    "localMayorRace returns candidates",
  );

  const council = (await runTool(
    "localCouncil",
    { place: "Бургас" },
    ctxBg,
  )) as Envelope;
  printEnvelope(council);
  assert((council.rows?.length ?? 0) > 0, "localCouncil returns parties");

  const chmi = (await runTool("chmiEvents", {}, ctxEn)) as Envelope;
  printEnvelope(chmi);
  assert((chmi.rows?.length ?? 0) > 0, "chmiEvents returns events");

  const subnat = (await runTool(
    "subnationalIndicator",
    { place: "Сливен", indicator: "безработица" },
    ctxEn,
  )) as Envelope;
  printEnvelope(subnat);
  assert(
    (subnat.series?.[0].points.length ?? 0) > 0,
    "subnationalIndicator returns a series",
  );

  const region = (await runTool(
    "regionIndicator",
    { oblast: "Варна", indicator: "бвп" },
    ctxEn,
  )) as Envelope;
  printEnvelope(region);
  assert(
    (region.series?.[0].points.length ?? 0) > 0,
    "regionIndicator returns a series",
  );

  const lisi = (await runTool(
    "transparencyScore",
    { place: "Русе" },
    ctxBg,
  )) as Envelope;
  printEnvelope(lisi);
  assert(lisi.facts.composite != null, "transparencyScore has a composite");

  const taxes = (await runTool(
    "localTaxes",
    { place: "Пловдив" },
    ctxBg,
  )) as Envelope;
  printEnvelope(taxes);
  assert((taxes.rows?.length ?? 0) > 0, "localTaxes returns rows");

  // 11. router: Phase B questions
  console.log("\n=== [router] phase B questions ===");
  const cases3: [string, string | null][] = [
    ["Кои бяха кандидатите за кмет на Варна?", "localMayorRace"],
    ["Какъв е общинският съвет на Бургас?", "localCouncil"],
    ["Има ли частични местни избори?", "chmiEvents"],
    ["Каква е безработицата в Сливен?", "subnationalIndicator"],
    ["Колко прозрачна е община Русе?", "transparencyScore"],
    ["Какви са данъците в Пловдив?", "localTaxes"],
  ];
  for (const [q, expected] of cases3) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 12. Phase C — place profile / census / settlement procurement
  console.log("\n=== [phase C] place tools ===");
  const cen = (await runTool("census", { place: "Видин" }, ctxBg)) as Envelope;
  printEnvelope(cen);
  assert(!!cen.facts.population, "census has population");

  const procS = (await runTool(
    "procurementBySettlement",
    { place: "Русе" },
    ctxEn,
  )) as Envelope;
  printEnvelope(procS);
  assert(
    !!procS.facts.total || procS.kind === "scalar",
    "procurementBySettlement runs",
  );

  const profile = (await runTool(
    "governanceProfile",
    { place: "Габрово" },
    ctxBg,
  )) as Envelope;
  printEnvelope(profile);
  assert(
    !!profile.facts.place && Object.keys(profile.facts).length >= 3,
    "governanceProfile assembled multiple facts",
  );

  console.log("\n=== [router] phase C questions ===");
  const cases4: [string, string | null][] = [
    ["Разкажи ми за Габрово", "governanceProfile"],
    ["Колко жители има Видин?", "census"],
    ["Колко поръчки има в Русе?", "procurementBySettlement"],
  ];
  for (const [q, expected] of cases4) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 13. D1 — people/oversight + fiscal depth + macro expansion
  console.log("\n=== [D1] coverage tools ===");
  const mpA = (await runTool("mpAssetsTop", {}, ctxBg)) as Envelope;
  printEnvelope(mpA);
  assert((mpA.rows?.length ?? 0) > 0, "mpAssetsTop returns rows");

  const mpC = (await runTool("mpConnectionsTop", {}, ctxEn)) as Envelope;
  printEnvelope(mpC);
  assert((mpC.rows?.length ?? 0) > 0, "mpConnectionsTop returns rows");

  const offA = (await runTool(
    "officialsAssetsTop",
    { category: "cabinet" },
    ctxBg,
  )) as Envelope;
  printEnvelope(offA);
  assert((offA.rows?.length ?? 0) > 0, "officialsAssetsTop returns rows");

  const fin = (await runTool("financingOverview", {}, ctxEn)) as Envelope;
  printEnvelope(fin);
  assert(!!fin.facts.distinct_parties, "financingOverview has party count");

  const poll = (await runTool("pollAccuracy", {}, ctxBg)) as Envelope;
  printEnvelope(poll);
  assert((poll.rows?.length ?? 0) > 0, "pollAccuracy returns rows");

  const debt = (await runTool("govDebt", {}, ctxEn)) as Envelope;
  printEnvelope(debt);
  assert((debt.rows?.length ?? 0) > 0, "govDebt returns issuances");

  const noi = (await runTool("noiFunds", {}, ctxEn)) as Envelope;
  printEnvelope(noi);
  assert(!!noi.facts.year, "noiFunds has a year");

  const macroCat = (await runTool(
    "macroByCategory",
    { category: "управление" },
    ctxBg,
  )) as Envelope;
  printEnvelope(macroCat);
  assert((macroCat.rows?.length ?? 0) > 0, "macroByCategory returns rows");

  // newly-aliased macro indicators are now reachable
  const gini = (await runTool(
    "macroIndicator",
    { indicator: "неравенство" },
    ctxEn,
  )) as Envelope;
  assert(
    /gini|inequ|Джини|неравен/i.test(gini.title) ||
      (gini.series?.[0].points.length ?? 0) > 0,
    "macroIndicator resolves 'неравенство' -> gini",
  );

  console.log("\n=== [router] D1 questions ===");
  const cases5: [string, string | null][] = [
    ["Кои депутати са най-богати?", "mpAssetsTop"],
    ["Кои депутати имат най-много фирмени връзки?", "mpConnectionsTop"],
    ["Кои министри са най-богати?", "officialsAssetsTop"],
    ["Коя социологическа агенция е най-точна?", "pollAccuracy"],
    ["Покажи показателите за управление", "macroByCategory"],
    ["Колко харчи НОИ за пенсии?", "noiFunds"],
    ["Какви са последните емисии на дълг?", "govDebt"],
  ];
  for (const [q, expected] of cases5) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 14. D3 — per-place environment / population / council
  console.log("\n=== [D3] place-enrichment tools ===");
  const air = (await runTool(
    "airQuality",
    { place: "Перник" },
    ctxBg,
  )) as Envelope;
  printEnvelope(air);
  assert(
    (air.rows?.length ?? 0) > 0 || air.kind === "scalar",
    "airQuality runs",
  );

  const lu = (await runTool("landUse", { oblast: "Варна" }, ctxEn)) as Envelope;
  printEnvelope(lu);
  assert((lu.rows?.length ?? 0) > 0, "landUse returns categories");

  const grao = (await runTool(
    "graoPopulation",
    { place: "Габрово" },
    ctxBg,
  )) as Envelope;
  printEnvelope(grao);
  assert(!!grao.facts.permanent, "graoPopulation has permanent count");

  const cr = (await runTool(
    "councilResolutions",
    { place: "Русе" },
    ctxEn,
  )) as Envelope;
  printEnvelope(cr);
  assert(
    (cr.rows?.length ?? 0) > 0,
    "councilResolutions returns rows for Ruse",
  );

  // governanceProfile should now carry the new enrichment facts
  const prof2 = (await runTool(
    "governanceProfile",
    { place: "Габрово" },
    ctxBg,
  )) as Envelope;
  assert(
    !!prof2.facts.registered_population,
    "governanceProfile now includes GRAO population",
  );

  console.log("\n=== [router] D3 questions ===");
  const cases6: [string, string | null][] = [
    ["Какъв е въздухът в Перник?", "airQuality"],
    ["Колко гора има в България?", "landUse"],
    ["Колко е регистрираното население на Габрово?", "graoPopulation"],
    ["Какво реши общинският съвет на Русе?", "councilResolutions"],
    ["Какъв е общинският съвет на Бургас?", "localCouncil"],
  ];
  for (const [q, expected] of cases6) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 15. D2 — budget execution depth
  console.log("\n=== [D2] budget-depth tools ===");
  const exec = (await runTool(
    "budgetExecution",
    { series: "приходи" },
    ctxBg,
  )) as Envelope;
  printEnvelope(exec);
  assert(
    (exec.series?.[0].points.length ?? 0) > 0,
    "budgetExecution returns a series",
  );

  const minB = (await runTool(
    "ministryBudget",
    { ministry: "транспорт" },
    ctxBg,
  )) as Envelope;
  printEnvelope(minB);
  assert(!!minB.facts.ministry, "ministryBudget resolved a ministry");

  const inv = (await runTool(
    "investmentProjects",
    { oblast: "Варна" },
    ctxEn,
  )) as Envelope;
  printEnvelope(inv);
  assert((inv.rows?.length ?? 0) > 0, "investmentProjects returns rows");

  console.log("\n=== [router] D2 questions ===");
  const cases7: [string, string | null][] = [
    ["Покажи изпълнението на бюджета по месеци", "budgetExecution"],
    ["Какъв е бюджетът на Министерството на транспорта?", "ministryBudget"],
    ["Кои са най-големите инвестиционни проекти?", "investmentProjects"],
    ["Какъв е държавният бюджет?", "budgetOverview"],
    ["Колко чужди инвестиции има?", "macroIndicator"],
  ];
  for (const [q, expected] of cases7) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${failures === 0 ? "tools layer verified" : "see above"}`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
