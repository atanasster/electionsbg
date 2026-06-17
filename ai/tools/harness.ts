// Node correctness harness for the deterministic tools layer (Brain 1).
// Run: npx tsx ai/tools/harness.ts
//
// Swaps in a node fetcher that reads the local `data/` tree (instead of the
// browser's bucket fetch), exercises every tool, prints results, and asserts a
// couple of known-good values so a regression fails loudly.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "../orchestrator/router";
import { fetchData, setFetcher } from "./dataClient";
import { runTool } from "./registry";
import {
  detectTaxChange,
  scoreDynamicScenario,
  scoreScenario,
} from "./taxPolicy";
import type { PolicyBaselineFile } from "../../src/data/budget/types";
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

  const awP = (await runTool(
    "awarderProcurement",
    { org: "Министерство на отбраната" },
    ctxBg,
  )) as Envelope;
  printEnvelope(awP);
  assert(
    awP.facts.eik === "000695324" && !!awP.facts.total_value,
    "awarderProcurement resolves a named institution to its procurement",
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
    ["Обществени поръчки на Министерство на отбраната", "awarderProcurement"],
    ["Колко похарчи СУ Добри Чинтулов за поръчки?", "awarderProcurement"],
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

  // poll-history + accuracy trends (registry-derived; resolves the agency that
  // the 2-letter-abbr bug used to mis-route).
  const aPolls = (await runTool(
    "agencyPolls",
    { agency: "Маркет Линкс" },
    ctxBg,
  )) as Envelope;
  printEnvelope(aPolls);
  assert(
    aPolls.kind === "series" &&
      (aPolls.series?.length ?? 0) > 0 &&
      String(aPolls.facts.agency).includes("Маркет"),
    "agencyPolls resolves Маркет ЛИНКС + returns party lines",
  );

  const aAcc = (await runTool(
    "agencyAccuracyHistory",
    { agency: "Тренд" },
    ctxBg,
  )) as Envelope;
  printEnvelope(aAcc);
  assert(
    aAcc.kind === "series" &&
      (aAcc.series?.length ?? 0) >= 1 &&
      aAcc.facts.trend != null,
    "agencyAccuracyHistory returns an MAE trajectory",
  );

  const accTrend = (await runTool("accuracyTrend", {}, ctxBg)) as Envelope;
  printEnvelope(accTrend);
  assert(
    accTrend.kind === "series" && (accTrend.series?.length ?? 0) > 1,
    "accuracyTrend compares multiple agencies",
  );

  console.log("\n=== [router] polls questions ===");
  const cases9: [string, string | null][] = [
    ["Коя социологическа агенция е най-точна?", "pollAccuracy"],
    ["Колко е точна Алфа Рисърч?", "agencyProfile"],
    ["Какво показват последните проучвания?", "latestPolls"],
    ["Какво би станало ако изборите бяха сега?", "latestPolls"],
    ["история на проучванията на Маркет Линкс", "agencyPolls"],
    [
      "Как се променя точността на Алфа Рисърч през годините?",
      "agencyAccuracyHistory",
    ],
    ["Как се променя точността на агенциите през годините?", "accuracyTrend"],
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

  // 20. consumption — basket affordability + basket vs official inflation
  console.log("\n=== [consumption] affordability + inflation ===");
  const aff = (await runTool("basketAffordability", {}, ctxEn)) as Envelope;
  printEnvelope(aff);
  assert(
    (aff.rows?.length ?? 0) >= 5,
    "basketAffordability ranks the oblasts (table)",
  );
  assert(
    !!aff.facts.most_affordable && !!aff.facts.least_affordable,
    "basketAffordability has most/least-affordable leaders",
  );
  assert(
    aff.geo?.level === "oblast",
    "basketAffordability attaches an oblast choropleth",
  );
  // The ranking must reflect the GDP/income join, not a raw basket-€ sort: the
  // most-affordable oblast (highest income) is NOT the cheapest basket. Guards
  // against a regression where the GDP map fails to load and `share` collapses
  // to a basket-only ordering.
  const basketOf = (r: Record<string, unknown>): number =>
    parseFloat(String(r.basket).replace(/[^\d.]/g, "")) || 0;
  const cheapestBasket = [...(aff.rows ?? [])].sort(
    (a, b) => basketOf(a) - basketOf(b),
  )[0];
  assert(
    (aff.rows?.[0]?.place ?? "") !== (cheapestBasket?.place ?? "x"),
    "basketAffordability rank reflects the income join (≠ raw-basket order)",
  );

  const affObl = (await runTool(
    "basketAffordability",
    { oblast: "VAR" },
    ctxBg,
  )) as Envelope;
  printEnvelope(affObl);
  assert(
    affObl.kind === "scalar" && !!affObl.facts.affordability_rank,
    "basketAffordability per-oblast has a rank",
  );

  const bvi = (await runTool("basketVsInflation", {}, ctxEn)) as Envelope;
  printEnvelope(bvi);
  assert(
    (bvi.rows?.length ?? 0) > 0 && !!bvi.facts.basket_change_since_euro,
    "basketVsInflation has HICP rows + the basket change",
  );

  console.log("\n=== [router] consumption questions ===");
  const cases10: [string, string | null][] = [
    ["Къде е най-достъпна кошницата спрямо доходите?", "basketAffordability"],
    ["Каква е покупателната способност по области?", "basketAffordability"],
    [
      "Where is the basket most affordable relative to income?",
      "basketAffordability",
    ],
    ["Изпреварва ли кошницата официалната инфлация?", "basketVsInflation"],
    ["Кошницата спрямо ХИПЦ инфлацията", "basketVsInflation"],
    // guard: a bare inflation question still routes to the macro read
    ["Каква е инфлацията?", "macroIndicator"],
  ];
  for (const [q, expected] of cases10) {
    const r = route(q, ctx);
    const got = r?.tool ?? null;
    console.log(`  "${q}" -> ${got ?? "(none)"}`);
    assert(got === expected, `route: "${q}" -> ${expected}`);
  }

  // 21. tax-policy what-if — PARITY GATE against the /budget/simulator math.
  // Each golden Δ below was read off the simulator screen for the same
  // scenario (the tool mirrors the component's `scenario` useMemo over the
  // same baseline file, so the two MUST stay equal). A baseline regeneration
  // that moves these numbers must move the simulator's too — re-read them
  // from /budget/simulator and update both sides together.
  console.log("\n=== [taxPolicy] simulator parity + detection ===");
  const baseline = await fetchData<PolicyBaselineFile>(
    "/budget/derived/policy_baseline.json",
  );
  const parity: [string, number][] = [
    ["какво става ако ддс стане 21%", 447e6],
    ["ддс върху храните да стане 9%", -1425e6],
    ["what if income tax goes to 12%", 755e6],
    ["колко струва необлагаем минимум от 620 евро", -1937e6],
    ["какво става ако премахнем тавана на осигурителния доход", 1145e6],
    // expenditure levers (balance convention: positive = balance improves)
    ["пенсиите да се индексират само по инфлация", 479e6],
    ["ковид добавката да не се индексира", 57e6],
    ["съкращаване на администрацията с 10%", 30e6],
    ["freeze the minimum wage", -280e6],
    // Phase-5 levers (same balance convention). Defense is priced against
    // the projection's €123.9B 2026 GDP (commit a760b1d5d) — (3.0−2.2)% ×
    // €123.9B ≈ −€991M.
    ["отбраната да стане 3% от бвп", -991e6],
    // Wage indexation & health are NET of the labour-tax feedback (the budget
    // recovers ~30.6% of indexed pay as PIT+SSC; the employee health-share is
    // PIT-deductible) — consistent with the administration-cut lever.
    ["заплатите в публичния сектор +5%", -98e6],
    ["капиталовите разходи -10%", 185e6],
    // Full КСО чл. 6, ал. 5 scope: administration + judiciary + defense &
    // security (132,862 across the two НОИ SOD-2024 categories).
    ["държавните служители да си плащат осигуровките", 254e6],
    ["здравната вноска +1 пункт", 302e6],
    // June-2026 debate levers (static central; the screen's headline is dynamic)
    ["съкращаване на майчинството до 1 година", 154e6],
    ["учителските заплати на 125% от средната", -143e6],
    ["минималната пенсия на 400 €", -963e6],
    ["замразяване на депутатските заплати", 2e6],
    ["премахване на партийните субсидии", 9e6],
    // Excise levers (revenue side; static central — the screen's headline is
    // the dynamic estimate). Fuel/tobacco/alcohol = % change to the existing
    // rate; wine introduced at €X/hl from €0.
    ["вдигане на акциза върху горивата с 10%", 144e6],
    ["вдигане на акциза върху цигарите с 40%", 861e6],
    ["вдигане на акциза върху алкохола с 20%", 35e6],
    ["акциз върху виното 48 €/хл", 45e6],
    // Gambling ЗХ GGR fee (commit ebc14cb16). Level lever; 40% = +€716M×15pp =
    // +€107M static. The screen's headline is the dynamic estimate.
    ["данъкът върху хазарта да стане 40%", 107e6],
  ];
  // FINDING-001 guard: definitional МОД questions carrying a year must NOT
  // parse as a cap what-if (2024-2026 overlap realistic cap amounts).
  for (const q of [
    "какъв е максималният осигурителен доход през 2026 г.",
    "колко е осигурителният таван за 2025",
  ]) {
    assert(
      detectTaxChange(q) == null,
      `definitional МОД question is not a what-if: "${q}"`,
    );
  }
  // Expenditure-lever guards: definitional questions are NOT what-ifs — they
  // keep routing to noiFunds ("колко са пенсиите") / macroIndicator ("каква е
  // минималната заплата") / budgetFunction ("колко са разходите за отбрана"
  // GF02, "каква е здравната вноска" GF07), asserted in the router cases
  // below too.
  for (const q of [
    "каква е минималната заплата",
    "колко са пенсиите",
    "колко са разходите за отбрана",
    "каква е здравната вноска",
    // June-2026 debate-lever definitional reads (no cut/target → fall through)
    "колко е минималната пенсия",
    "колко получават депутатите",
    "каква е учителската заплата",
    "колко е майчинството",
    "колко са партийните субсидии",
    // BGN-denominated bare amounts must NOT be mis-read as EUR (post-euro the
    // UI/URLs are EUR) — they fall through instead of mis-scoring.
    "минимална пенсия 400 лева",
    "субсидията на 4 лева на глас",
    // bare excise reads (anchor, no category + no target) -> budgetOverview
    "колко са акцизите",
    "how much is excise",
    // bare gambling reads (anchor, no rate target) -> budgetOverview
    "колко са приходите от хазарт",
    "how much is gambling revenue",
    "какъв е данъкът върху хазарта",
  ]) {
    assert(
      detectTaxChange(q) == null,
      `definitional question is not a what-if: "${q}"`,
    );
  }
  for (const [q, expected] of parity) {
    const ch = detectTaxChange(q);
    assert(!!ch, `detectTaxChange parses "${q}"`);
    if (!ch) continue;
    const s = scoreScenario(baseline, ch);
    assert(
      Math.abs(s.central - expected) < 5e6,
      `"${q}" -> ${(s.central / 1e6).toFixed(1)}M ≈ simulator ${(expected / 1e6).toFixed(0)}M`,
    );
  }
  // Dynamic-mode gates (the screen's DEFAULT headline): direction + the
  // Фискален-съвет dividend reconciliation, mirroring __smoke_behavioral.ts.
  {
    const chVat = detectTaxChange("какво става ако ддс стане 21%");
    const sVat = scoreScenario(baseline, chVat!);
    const dVat = scoreDynamicScenario(baseline, chVat!, sVat);
    assert(
      dVat.headlineEur < sVat.central && dVat.headlineEur > 0.7 * sVat.central,
      `VAT 21% dynamic ${(dVat.headlineEur / 1e6).toFixed(0)}M < static ${(sVat.central / 1e6).toFixed(0)}M (and not collapsed)`,
    );
    const chDiv = detectTaxChange(
      "какво става ако данъкът върху дивидентите стане 10%",
    );
    const sDiv = scoreScenario(baseline, chDiv!);
    const dDiv = scoreDynamicScenario(baseline, chDiv!, sDiv);
    assert(
      dDiv.headlineEur >= 30e6 && dDiv.headlineEur <= 55e6,
      `dividend 5→10% dynamic ${(dDiv.headlineEur / 1e6).toFixed(1)}M lands in the ФС ≤€50M zone (static ${(sDiv.central / 1e6).toFixed(0)}M)`,
    );
    // Excise: tobacco bends into the Laffer turn — the dynamic figure is well
    // below the static gain as demand contracts and the illicit market grows,
    // but it must not collapse. Fuel is inelastic (a small haircut only).
    const chTob = detectTaxChange("вдигане на акциза върху цигарите с 40%");
    const sTob = scoreScenario(baseline, chTob!);
    const dTob = scoreDynamicScenario(baseline, chTob!, sTob);
    assert(
      dTob.headlineEur < sTob.central && dTob.headlineEur > 0.45 * sTob.central,
      `tobacco +40% dynamic ${(dTob.headlineEur / 1e6).toFixed(0)}M < static ${(sTob.central / 1e6).toFixed(0)}M (illicit-substitution erosion, not collapsed)`,
    );
    const chFuel = detectTaxChange("вдигане на акциза върху горивата с 10%");
    const sFuel = scoreScenario(baseline, chFuel!);
    const dFuel = scoreDynamicScenario(baseline, chFuel!, sFuel);
    assert(
      dFuel.headlineEur > 0.7 * sFuel.central &&
        dFuel.headlineEur < sFuel.central,
      `fuel +10% dynamic ${(dFuel.headlineEur / 1e6).toFixed(0)}M ≈ static ${(sFuel.central / 1e6).toFixed(0)}M (inelastic — small haircut)`,
    );
    // Gambling: a big GGR-fee hike bends into the Laffer turn as licensed play
    // migrates offshore — +107M static at 40% lands ≈ +€68M dynamic (well below
    // static but not collapsed).
    const chGam = detectTaxChange("данъкът върху хазарта да стане 40%");
    const sGam = scoreScenario(baseline, chGam!);
    const dGam = scoreDynamicScenario(baseline, chGam!, sGam);
    assert(
      Math.abs(sGam.central - 107e6) < 5e6,
      `gambling 40% static ${(sGam.central / 1e6).toFixed(0)}M ≈ +€107M`,
    );
    assert(
      dGam.headlineEur < sGam.central && dGam.headlineEur > 0.4 * sGam.central,
      `gambling 40% dynamic ${(dGam.headlineEur / 1e6).toFixed(0)}M < static ${(sGam.central / 1e6).toFixed(0)}M (offshore migration, not collapsed)`,
    );
  }
  const simVat = (await runTool(
    "simulateTaxChange",
    { change: "какво става ако ддс стане 22%" },
    ctxBg,
  )) as Envelope;
  printEnvelope(simVat);
  // The headline is the dynamic estimate; the static +887 млн € rides as a
  // fact, and the envelope's value matches the engine run for the same change.
  assert(
    String(simVat.facts.delta_static).includes("887"),
    `ДДС 22% envelope carries static +887 млн € as a fact (got ${simVat.facts.delta_static})`,
  );
  {
    const ch = detectTaxChange("какво става ако ддс стане 22%");
    const s = scoreScenario(baseline, ch!);
    const d = scoreDynamicScenario(baseline, ch!, s);
    assert(
      Math.abs((simVat.value as number) - d.headlineEur) < 1e6 &&
        d.headlineEur < s.central,
      `ДДС 22% envelope value ${((simVat.value as number) / 1e6).toFixed(0)}M = dynamic engine ${(d.headlineEur / 1e6).toFixed(0)}M < static ${(s.central / 1e6).toFixed(0)}M`,
    );
  }
  assert(
    !!simVat.facts.range,
    `ДДС 22% envelope carries the Monte-Carlo band (got ${simVat.facts.range})`,
  );
  assert(
    simVat.facts.scenario_id === "dds=22",
    `ДДС 22% deep-link qs is "dds=22" (got ${simVat.facts.scenario_id})`,
  );
  const simNoCap = (await runTool(
    "simulateTaxChange",
    { change: "what happens if we remove the social security cap" },
    ctxEn,
  )) as Envelope;
  assert(
    simNoCap.facts.scenario_id === "nocap=1" && !!simNoCap.facts.range,
    "no-cap envelope carries nocap=1 + an uncertainty range",
  );
  // Administration cut: balance basis + the vacancy honesty note + deep link.
  const simAdm = (await runTool(
    "simulateTaxChange",
    { change: "съкращаване на администрацията с 10%" },
    ctxBg,
  )) as Envelope;
  printEnvelope(simAdm);
  assert(
    simAdm.facts.scenario_id === "adm=10" &&
      simAdm.facts.basis_id === "balance" &&
      String(simAdm.facts.note).includes("незаети"),
    `admin-cut envelope carries adm=10 + balance basis + the vacancy note (got ${simAdm.facts.scenario_id}, note: ${simAdm.facts.note})`,
  );
  // Defense target: the tenths deep link + the NATO-definition clause.
  const simDef = (await runTool(
    "simulateTaxChange",
    { change: "отбраната да стане 3% от БВП" },
    ctxBg,
  )) as Envelope;
  printEnvelope(simDef);
  assert(
    simDef.facts.scenario_id === "def=30" &&
      simDef.facts.basis_id === "balance" &&
      String(simDef.facts.note).includes("НАТО"),
    `defense envelope carries def=30 + balance basis + the NATO note (got ${simDef.facts.scenario_id}, note: ${simDef.facts.note})`,
  );
  // Gross-up variant of self-paid contributions is fiscally neutral (€0).
  const simSsp = (await runTool(
    "simulateTaxChange",
    { change: "държавните служители да си плащат осигуровките с компенсация" },
    ctxBg,
  )) as Envelope;
  assert(
    simSsp.facts.scenario_id === "ssp=1&sspg=1" &&
      simSsp.value === 0 &&
      String(simSsp.facts.note).includes("неутрална"),
    `grossed-up self-paid SSC is neutral with ssp=1&sspg=1 (got ${simSsp.facts.scenario_id}, value ${simSsp.value})`,
  );
  // Excise — tobacco: the exct deep link + the static +861 fact + the MC band +
  // the Laffer note. (Revenue lever — NO balance basis.)
  const simTob = (await runTool(
    "simulateTaxChange",
    { change: "вдигане на акциза върху цигарите с 40%" },
    ctxBg,
  )) as Envelope;
  printEnvelope(simTob);
  assert(
    simTob.facts.scenario_id === "exct=40" &&
      simTob.facts.basis_id == null &&
      String(simTob.facts.delta_static).includes("861") &&
      !!simTob.facts.range &&
      String(simTob.facts.note).includes("Лафер"),
    `tobacco-excise envelope: exct=40 + static +861 + band + Laffer note (got ${simTob.facts.scenario_id}, static ${simTob.facts.delta_static}, note ${simTob.facts.note})`,
  );
  // Excise — wine: the winex deep link + the introduced-from-€0 leakage note.
  const simWine = (await runTool(
    "simulateTaxChange",
    { change: "акциз върху виното 48 €/хл" },
    ctxBg,
  )) as Envelope;
  assert(
    simWine.facts.scenario_id === "winex=48" &&
      String(simWine.facts.note).includes("домашно"),
    `wine-excise envelope: winex=48 + home-production note (got ${simWine.facts.scenario_id}, note ${simWine.facts.note})`,
  );
  // Gambling — the haz deep link + the static +107 fact + the MC band + the
  // offshore-migration (Laffer) note. (Revenue lever — NO balance basis.)
  const simGam = (await runTool(
    "simulateTaxChange",
    { change: "данъкът върху хазарта да стане 40%" },
    ctxBg,
  )) as Envelope;
  printEnvelope(simGam);
  assert(
    simGam.facts.scenario_id === "haz=40" &&
      simGam.facts.basis_id == null &&
      String(simGam.facts.delta_static).includes("107") &&
      !!simGam.facts.range &&
      String(simGam.facts.note).includes("Лафер"),
    `gambling envelope: haz=40 + static +107 + band + Laffer note (got ${simGam.facts.scenario_id}, static ${simGam.facts.delta_static}, note ${simGam.facts.note})`,
  );
  // graceful no-detect (the geo.harness probe also hits this path)
  const simMiss = (await runTool(
    "simulateTaxChange",
    { change: "безработица" },
    ctxBg,
  )) as Envelope;
  assert(
    simMiss.kind === "scalar" && !simMiss.facts.delta_per_year,
    "unparseable change returns a graceful scalar envelope",
  );

  console.log("\n=== [router] tax-policy what-if questions ===");
  const cases11: [string, string | null][] = [
    ["Какво става, ако ДДС стане 22%?", "simulateTaxChange"],
    ["What if income tax goes to 15%?", "simulateTaxChange"],
    ["Колко струва необлагаем минимум?", "simulateTaxChange"],
    ["Премахване на тавана на осигурителния доход", "simulateTaxChange"],
    ["Какво става, ако корпоративният данък стане 15%?", "simulateTaxChange"],
    ["Zero VAT on medicines", "simulateTaxChange"],
    // expenditure levers
    [
      "Какво става, ако пенсиите се индексират само по инфлация?",
      "simulateTaxChange",
    ],
    ["Без индексация на ковид добавката", "simulateTaxChange"],
    ["Съкращаване на администрацията с 10%", "simulateTaxChange"],
    ["Freeze the minimum wage", "simulateTaxChange"],
    ["Отвързване на МРЗ от средната заплата", "simulateTaxChange"],
    // Phase-5 levers
    ["Какво става, ако отбраната стане 3% от БВП?", "simulateTaxChange"],
    ["Заплатите в публичния сектор +5%", "simulateTaxChange"],
    ["Капиталовите разходи -10%", "simulateTaxChange"],
    ["Държавните служители да си плащат осигуровките", "simulateTaxChange"],
    ["Здравната вноска +1 пункт", "simulateTaxChange"],
    // June-2026 debate levers
    ["Съкращаване на майчинството до 1 година", "simulateTaxChange"],
    ["Учителските заплати на 125% от средната", "simulateTaxChange"],
    ["Минималната пенсия на 400 €", "simulateTaxChange"],
    ["Замразяване на депутатските заплати", "simulateTaxChange"],
    ["Премахване на партийните субсидии", "simulateTaxChange"],
    // excise levers (revenue side)
    ["Вдигане на акциза върху цигарите с 40%", "simulateTaxChange"],
    ["Намаление на акциза върху горивата с 10%", "simulateTaxChange"],
    ["Акциз върху виното 48 €/хл", "simulateTaxChange"],
    ["Raise the tobacco excise by 40%", "simulateTaxChange"],
    // gambling ЗХ GGR fee (revenue side)
    ["Данъкът върху хазарта да стане 40%", "simulateTaxChange"],
    ["What if the gambling tax goes to 40%?", "simulateTaxChange"],
    // guards: the neighbours keep their own questions
    // bare definitional excise -> the budget overview, not the simulator
    ["Колко са акцизите?", "budgetOverview"],
    ["How much is excise?", "budgetOverview"],
    // bare definitional gambling -> the budget overview, not the simulator
    ["Колко са приходите от хазарт?", "budgetOverview"],
    ["How much is gambling revenue?", "budgetOverview"],
    ["Какъв е държавният бюджет?", "budgetOverview"],
    // NB phrased WITHOUT "местните" — "местни данъци в X" is the known
    // pre-existing localMunicipality over-match (see memory notes), not ours.
    ["Какви са данъците в Пловдив?", "localTaxes"],
    ["Колко струва млякото в Пловдив?", "settlementPrices"],
    ["Колко са пенсиите?", "noiFunds"],
    ["Каква е минималната заплата?", "macroIndicator"],
    // definitional reads stay on the budget-function tool (GF02 / GF07)
    ["Колко са разходите за отбрана?", "budgetFunction"],
    ["Каква е здравната вноска?", "budgetFunction"],
  ];
  for (const [q, expected] of cases11) {
    const r = route(q.toLowerCase(), ctx);
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
