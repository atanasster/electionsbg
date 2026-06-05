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

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${failures === 0 ? "tools layer verified" : "see above"}`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
