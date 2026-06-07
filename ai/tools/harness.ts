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

  // 16. D4 — election analytical drill-down
  console.log("\n=== [D4] election-depth tools ===");
  const rb = (await runTool(
    "regionBreakdown",
    { party: "ГЕРБ" },
    ctxBg,
  )) as Envelope;
  printEnvelope(rb);
  assert((rb.rows?.length ?? 0) > 0, "regionBreakdown returns oblasts");

  // geo-overlay integrity (the area-codes-join-the-geojson check) lives in its
  // own pass: ai/tools/geo.harness.ts. Here we only exercise the new drill-down
  // tools run + route correctly; the maps they attach are validated there.
  const mb = (await runTool(
    "municipalityBreakdown",
    { party: "ГЕРБ", oblast: "Варна" },
    ctxBg,
  )) as Envelope;
  printEnvelope(mb);
  assert(
    (mb.rows?.length ?? 0) > 0,
    "municipalityBreakdown returns municipalities",
  );
  const sb = (await runTool(
    "settlementBreakdown",
    { party: "ГЕРБ", place: "Варна" },
    ctxBg,
  )) as Envelope;
  printEnvelope(sb);
  assert((sb.rows?.length ?? 0) > 0, "settlementBreakdown returns settlements");

  const anom = (await runTool("electionAnomalies", {}, ctxEn)) as Envelope;
  printEnvelope(anom);
  assert(
    anom.facts.problem_sections != null,
    "electionAnomalies has problem-section count",
  );

  const rh = (await runTool(
    "regionHistory",
    { oblast: "Хасково" },
    ctxBg,
  )) as Envelope;
  printEnvelope(rh);
  assert(
    (rh.series?.[0].points.length ?? 0) > 1,
    "regionHistory spans multiple elections",
  );

  const vt = (await runTool("voteTransitions", {}, ctxEn)) as Envelope;
  printEnvelope(vt);
  assert(
    (vt.rows?.length ?? 0) > 0 || vt.kind === "scalar",
    "voteTransitions runs",
  );

  console.log("\n=== [router] D4 questions ===");
  const cases8: [string, string | null][] = [
    ["Къде е силна ГЕРБ?", "regionBreakdown"],
    ["ГЕРБ по общини във Варна", "municipalityBreakdown"],
    ["ГЕРБ по населени места в община Варна", "settlementBreakdown"],
    ["Имаше ли нередности на последните избори?", "electionAnomalies"],
    ["кои партии загубиха най-много от флаш памет", "flashMemoryByParty"],
    ["Как се променя активността в Хасково?", "regionHistory"],
    ["Къде отидоха гласовете на последните избори?", "voteTransitions"],
    ["Как се представя ГЕРБ през годините?", "partyTimeline"],
  ];
  for (const [q, expected] of cases8) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 17. D1.5 — detailed polling
  console.log("\n=== [polls] detailed polling tools ===");
  const pa = (await runTool("pollAccuracy", {}, ctxBg)) as Envelope;
  printEnvelope(pa);
  assert(
    !!pa.facts.best_grade &&
      (pa.rows?.[0] as Record<string, unknown>)?.grade != null,
    "pollAccuracy now shows grade",
  );

  const agp = (await runTool(
    "agencyProfile",
    { agency: "Алфа Рисърч" },
    ctxBg,
  )) as Envelope;
  printEnvelope(agp);
  assert(
    agp.facts.grade != null && agp.kind === "scalar",
    "agencyProfile resolved + has grade",
  );

  const lp = (await runTool("latestPolls", {}, ctxEn)) as Envelope;
  printEnvelope(lp);
  assert(
    (lp.rows?.length ?? 0) > 0 && !!lp.facts.agency,
    "latestPolls returns per-party support",
  );

  console.log("\n=== [router] polls questions ===");
  const cases9: [string, string | null][] = [
    ["Коя социологическа агенция е най-точна?", "pollAccuracy"],
    ["Колко е точна Алфа Рисърч?", "agencyProfile"],
    ["Какво показват последните проучвания?", "latestPolls"],
    ["Какво би станало ако изборите бяха сега?", "latestPolls"],
  ];
  for (const [q, expected] of cases9) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 18. integrity / demographics / parliament / schools (the new tool surface)
  console.log(
    "\n=== [new] integrity / demographics / parliament / schools ===",
  );
  const probSec = (await runTool("problemSections", {}, ctxBg)) as Envelope;
  printEnvelope(probSec);
  assert(
    (probSec.rows?.length ?? 0) > 0 && probSec.facts.neighborhoods != null,
    "problemSections returns neighbourhoods",
  );

  const romaTrend = (await runTool(
    "romaVoteTrend",
    { years: 5 },
    ctxBg,
  )) as Envelope;
  printEnvelope(romaTrend);
  assert(
    romaTrend.kind === "series" &&
      (romaTrend.series?.length ?? 0) > 1 &&
      romaTrend.facts.elections_count === 7,
    "romaVoteTrend: 5-year window -> 7-election multi-line series",
  );

  const risk = (await runTool("riskScore", {}, ctxEn)) as Envelope;
  printEnvelope(risk);
  assert((risk.rows?.length ?? 0) === 4, "riskScore has 4 bands");

  const clusters = (await runTool("riskClusters", {}, ctxBg)) as Envelope;
  printEnvelope(clusters);
  assert((clusters.rows?.length ?? 0) > 0, "riskClusters returns clusters");

  const persist = (await runTool("clusterPersistence", {}, ctxEn)) as Envelope;
  printEnvelope(persist);
  assert((persist.rows?.length ?? 0) > 0, "clusterPersistence returns loci");

  const benford = (await runTool("benfordAnomalies", {}, ctxBg)) as Envelope;
  printEnvelope(benford);
  assert(
    !!benford.facts.parties_tested,
    "benfordAnomalies has a tested-party count",
  );

  const wasted = (await runTool("wastedVotes", {}, ctxEn)) as Envelope;
  printEnvelope(wasted);
  assert(!!wasted.facts.national_share, "wastedVotes has a national share");

  const suspect = (await runTool(
    "suspiciousSettlements",
    {},
    ctxBg,
  )) as Envelope;
  printEnvelope(suspect);
  assert((suspect.rows?.length ?? 0) === 3, "suspiciousSettlements has 3 rows");

  const diaspora = (await runTool("diasporaVote", {}, ctxEn)) as Envelope;
  printEnvelope(diaspora);
  assert(
    (diaspora.rows?.length ?? 0) > 0 && !!diaspora.facts.leader,
    "diasporaVote returns parties + a leader",
  );

  const vp = (await runTool("voterPersistence", {}, ctxBg)) as Envelope;
  printEnvelope(vp);
  assert(
    (vp.rows?.length ?? 0) > 0 || vp.kind === "scalar",
    "voterPersistence runs",
  );

  const pd = (await runTool(
    "partyDemographics",
    { party: "Възраждане" },
    ctxBg,
  )) as Envelope;
  printEnvelope(pd);
  assert(
    (pd.rows?.length ?? 0) > 0 && !!pd.facts.party,
    "partyDemographics returns correlations",
  );

  const cleav = (await runTool("demographicCleavages", {}, ctxEn)) as Envelope;
  printEnvelope(cleav);
  assert((cleav.rows?.length ?? 0) > 0, "demographicCleavages returns rows");

  const loyalty = (await runTool("mpLoyalty", {}, ctxBg)) as Envelope;
  printEnvelope(loyalty);
  assert(
    (loyalty.rows?.length ?? 0) > 0 && !!loyalty.facts.ns,
    "mpLoyalty returns a ranking for the current NS",
  );

  const att = (await runTool("mpAttendance", {}, ctxEn)) as Envelope;
  printEnvelope(att);
  assert((att.rows?.length ?? 0) > 0, "mpAttendance returns rows");

  const cohesion = (await runTool("factionCohesion", {}, ctxBg)) as Envelope;
  printEnvelope(cohesion);
  assert((cohesion.rows?.length ?? 0) > 0, "factionCohesion returns groups");

  const mpProf = (await runTool(
    "mpVotingProfile",
    { name: "Бойко Борисов" },
    ctxBg,
  )) as Envelope;
  printEnvelope(mpProf);
  assert(
    mpProf.kind === "scalar" && !!mpProf.facts.name,
    "mpVotingProfile resolved an MP",
  );

  // transliteration: an English-spelled name resolves against the Cyrillic roster
  const mpProfEn = (await runTool(
    "mpVotingProfile",
    { name: "Asen Vasilev" },
    ctxEn,
  )) as Envelope;
  assert(
    mpProfEn.kind === "scalar" && /Василев/.test(String(mpProfEn.facts.name)),
    "mpVotingProfile resolves an EN-spelled name via transliteration",
  );

  const sim = (await runTool(
    "mpSimilarity",
    { name: "Асен Василев" },
    ctxEn,
  )) as Envelope;
  printEnvelope(sim);
  assert(
    (sim.rows?.length ?? 0) > 0 || sim.kind === "scalar",
    "mpSimilarity runs",
  );

  const vs = (await runTool(
    "voteSearch",
    { query: "бюджет" },
    ctxBg,
  )) as Envelope;
  printEnvelope(vs);
  assert(!!vs.facts.matches || vs.kind === "scalar", "voteSearch runs");

  const sch = (await runTool(
    "schoolScores",
    { place: "Пловдив" },
    ctxBg,
  )) as Envelope;
  printEnvelope(sch);
  assert(
    (sch.rows?.length ?? 0) > 0 && !!sch.facts.place,
    "schoolScores returns schools",
  );

  // graceful failure: an unknown place declines cleanly (scalar, no crash)
  const schMiss = (await runTool(
    "schoolScores",
    { place: "Несъществуевоград" },
    ctxBg,
  )) as Envelope;
  assert(
    schMiss.kind === "scalar",
    "schoolScores declines gracefully on an unknown place",
  );

  // every new envelope carries its registry domain (runTool stamps it)
  assert(risk.domain === "elections", "riskScore envelope is stamped domain");
  assert(loyalty.domain === "people", "mpLoyalty envelope is stamped domain");

  // 19. remaining-coverage sweep — every tool not yet exercised above runs once
  // against real data (so the harness covers the full registry surface, not just
  // a sample). Routing for these is asserted in tests/regression.ts.
  console.log("\n=== [coverage] every remaining tool runs ===");
  const cand = (await runTool(
    "candidateResult",
    { name: "Божидар Божанов" },
    ctxBg,
  )) as Envelope;
  printEnvelope(cand);
  assert(!!cand.facts.name, "candidateResult resolved a candidate");

  // ---- typo tolerance across the resolvers (fuzzy fallback) -----------------
  console.log("\n=== [fuzzy] typo-tolerant lookups ===");
  // candidate: one dropped letter still resolves to the right person
  const candTypo = (await runTool(
    "candidateResult",
    { name: "Божидар Божанв" },
    ctxBg,
  )) as Envelope;
  assert(
    /Божанов/.test(String(candTypo.facts.name ?? "")),
    `candidate typo "Божидар Божанв" -> Божанов (got "${candTypo.facts.name}")`,
  );
  // candidate: reversed word order + a typo
  const candRev = (await runTool(
    "candidateResult",
    { name: "Божанов Божидар" },
    ctxBg,
  )) as Envelope;
  assert(
    /Божанов/.test(String(candRev.facts.name ?? "")),
    `candidate reversed "Божанов Божидар" -> Божанов`,
  );
  // candidate: a genuine non-name must still decline cleanly (no over-reach)
  const candMiss = (await runTool(
    "candidateResult",
    { name: "Пешо Несъществуващ" },
    ctxBg,
  )) as Envelope;
  assert(
    candMiss.kind === "scalar" && candMiss.facts.търсене != null,
    "candidate nonsense still declines (notFound), no fuzzy over-reach",
  );
  // party: a misspelt longer party name resolves via matchParty's fuzzy tier
  const partyTypo = (await runTool(
    "partyResult",
    { party: "Възраждене" },
    ctxBg,
  )) as Envelope;
  assert(
    partyTypo.facts?.party != null,
    `party typo "Възраждене" -> resolved (got "${partyTypo.facts?.party}")`,
  );
  // MP: a dropped letter in the surname still resolves
  const mpTypo = (await runTool(
    "mpVotingProfile",
    { name: "Бойко Борисв" },
    ctxBg,
  )) as Envelope;
  assert(
    /Борисов/.test(String(mpTypo.facts.name ?? "")),
    `MP typo "Бойко Борисв" -> Борисов (got "${mpTypo.facts.name}")`,
  );
  // agency: a misspelt pollster name still resolves to a profile
  const agTypo = (await runTool(
    "agencyProfile",
    { agency: "Алфа Рисрч" },
    ctxBg,
  )) as Envelope;
  assert(
    agTypo.kind === "scalar" && agTypo.facts.grade != null,
    `agency typo "Алфа Рисрч" -> resolved a profile (got "${agTypo.title}")`,
  );
  // ministry: a misspelt ministry name still resolves
  const minTypo = (await runTool(
    "ministryBudget",
    { ministry: "транспрта" },
    ctxBg,
  )) as Envelope;
  assert(
    !!minTypo.facts.ministry &&
      /транспорт/i.test(String(minTypo.facts.ministry)),
    `ministry typo "транспрта" -> transport ministry (got "${minTypo.facts.ministry}")`,
  );
  // agency: a genuine non-agency must still decline cleanly (no over-reach)
  const agMiss = (await runTool(
    "agencyProfile",
    { agency: "Несъществуваща Агенция" },
    ctxBg,
  )) as Envelope;
  assert(
    agMiss.kind === "scalar" && agMiss.facts.grade == null,
    "agency nonsense still declines (no fuzzy over-reach)",
  );
  // settlement resolver: a town that is NOT a município (Калофер) resolves to
  // its OWN ekatte for a settlement-keyed tool (GRAO), not a município.
  const graoVillage = (await runTool(
    "graoPopulation",
    { place: "Калофер" },
    ctxBg,
  )) as Envelope;
  assert(
    !!graoVillage.facts.permanent &&
      /Калофер/.test(String(graoVillage.facts.place ?? "")),
    `graoPopulation "Калофер" -> village GRAO (got "${graoVillage.facts.place}")`,
  );
  // and its typo
  const graoTypo = (await runTool(
    "graoPopulation",
    { place: "Калофре" },
    ctxBg,
  )) as Envelope;
  assert(
    /Калофер/.test(String(graoTypo.facts.place ?? "")),
    `graoPopulation typo "Калофре" -> Калофер`,
  );
  // a name shared by several settlements ("Баня" = a town + villages, never the
  // município "Долна баня") now returns an ask-the-user chooser instead of
  // silently picking one; picking an option (an "ekatte:" pin in the place arg)
  // re-runs to exactly one place — no second chooser.
  const graoBanya = (await runTool(
    "graoPopulation",
    { place: "Баня" },
    ctxBg,
  )) as Envelope;
  assert(
    (graoBanya.clarify?.options.length ?? 0) >= 4,
    `graoPopulation "Баня" -> disambiguation chooser (got ${graoBanya.clarify?.options.length ?? 0} options)`,
  );
  const banyaPick = graoBanya.clarify?.options[0];
  const graoBanyaPicked = banyaPick
    ? ((await runTool(banyaPick.tool, banyaPick.args, ctxBg)) as Envelope)
    : null;
  assert(
    !!graoBanyaPicked && !graoBanyaPicked.clarify,
    `graoPopulation "Баня" pick -> resolves to one place (no second chooser)`,
  );

  const turn = (await runTool(
    "turnout",
    { election: "2023_04_02" },
    ctxEn,
  )) as Envelope;
  printEnvelope(turn);
  assert(turn.kind === "scalar" && !!turn.facts.turnout, "turnout is scalar");

  const flash = (await runTool("flashMemoryByParty", {}, ctxBg)) as Envelope;
  printEnvelope(flash);
  assert(
    (flash.rows?.length ?? 0) > 0 || flash.kind === "scalar",
    "flashMemoryByParty runs",
  );

  const mayorsWon = (await runTool("localMayorsWon", {}, ctxEn)) as Envelope;
  printEnvelope(mayorsWon);
  assert(!!mayorsWon.facts.leader, "localMayorsWon has a leader");

  const oblMayors = (await runTool(
    "localOblastMayors",
    { place: "Пловдив" },
    ctxBg,
  )) as Envelope;
  printEnvelope(oblMayors);
  assert((oblMayors.rows?.length ?? 0) > 0, "localOblastMayors returns rows");

  const mayorHist = (await runTool(
    "localMayorHistory",
    { place: "София" },
    ctxBg,
  )) as Envelope;
  printEnvelope(mayorHist);
  assert((mayorHist.rows?.length ?? 0) > 0, "localMayorHistory returns terms");

  const subMayors = (await runTool(
    "localSubMayors",
    { place: "София" },
    ctxBg,
  )) as Envelope;
  printEnvelope(subMayors);
  assert(
    (subMayors.rows?.length ?? 0) > 0 || subMayors.kind === "scalar",
    "localSubMayors runs",
  );

  const budgetFn = (await runTool(
    "budgetFunction",
    { category: "здравеопазване" },
    ctxBg,
  )) as Envelope;
  printEnvelope(budgetFn);
  assert(!!budgetFn.facts.function, "budgetFunction resolved a function");

  const macroOv = (await runTool("macroOverview", {}, ctxEn)) as Envelope;
  printEnvelope(macroOv);
  assert((macroOv.rows?.length ?? 0) > 0, "macroOverview returns rows");

  const rank = (await runTool(
    "rankPlaces",
    { indicator: "кои общини са с най-висока безработица" },
    ctxBg,
  )) as Envelope;
  printEnvelope(rank);
  assert((rank.rows?.length ?? 0) > 0, "rankPlaces returns a ranking");

  const cmpPlaces = (await runTool(
    "comparePlaces",
    { a: "Варна", b: "Бургас" },
    ctxBg,
  )) as Envelope;
  printEnvelope(cmpPlaces);
  assert((cmpPlaces.rows?.length ?? 0) > 0, "comparePlaces returns rows");

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${failures === 0 ? "tools layer verified" : "see above"}`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
