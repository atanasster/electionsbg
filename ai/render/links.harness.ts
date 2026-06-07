// "Виж в сайта" deep-link harness for siteLinks().
// Run: npx tsx ai/render/links.harness.ts   (part of `npm run ai:test:all`)
//
// siteLinks() is a pure function: Envelope -> the real electionsbg.com pages
// that back the answer. The end-to-end golden coverage (real prompt -> real
// data -> real href) lives in ai/tests/regression.ts via each case's `links`.
// THIS harness exhaustively pins the pure logic + the edge cases a real prompt
// can't easily reach: the Sofia-city guards, language-independence of the link
// id, the no-geo / missing-id fallbacks, cycle-from-provenance for local, and
// that aggregates keep the generic section page. Synthetic envelopes, no data.

import { muniLocator, oblastLocator, settlementLocator } from "../tools/geo";
import { latestLocalCycle } from "../tools/localDataset";
import { siteLinks } from "./links";
import type { Domain, Envelope } from "../tools/types";

const SITE = "https://electionsbg.com";
const CYCLE = latestLocalCycle(); // the cycle the generic local landing points at

let failures = 0;
const pathsOf = (env: Envelope): string[] =>
  siteLinks(env).map((l) => l.href.replace(SITE, ""));

// each expected entry is the path portion; comparison is order-independent and
// also rejects duplicate links (siteLinks de-dupes by href).
const expect = (label: string, env: Envelope, want: string[]): void => {
  const got = pathsOf(env);
  if (new Set(got).size !== got.length) {
    failures += 1;
    console.log(`  ✗ ${label}: duplicate links ${JSON.stringify(got)}`);
    return;
  }
  const a = [...got].sort();
  const b = [...want].sort();
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    failures += 1;
    console.log(
      `  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`,
    );
  } else {
    console.log(`  ✓ ${label} -> ${JSON.stringify(got)}`);
  }
};

// minimal envelope; override what each case needs.
const mk = (
  over: Partial<Envelope> & { tool: string; domain: Domain },
): Envelope => ({
  kind: "table",
  title: "x",
  viz: "bar",
  facts: {},
  ...over,
});

console.log("siteLinks() deep-link cases:");

// ---- candidate (non-geo; canonical slug from facts.candidate_id) ------------
expect(
  "candidateResult",
  mk({
    tool: "candidateResult",
    domain: "elections",
    kind: "table",
    facts: { name: "Божидар Божанов", candidate_id: "c-7-bozhidar-bozhanov" },
  }),
  ["/candidate/c-7-bozhidar-bozhanov"],
);
// language-independence: EN answer transliterates facts.name, but the URL must
// use the canonical slug (candidate_id), NEVER the transliterated display name
expect(
  "candidateResult (EN — slug not the transliterated name)",
  mk({
    tool: "candidateResult",
    domain: "elections",
    kind: "scalar",
    facts: { name: "Bozhidar Bozhanov", candidate_id: "c-7-bozhidar-bozhanov" },
  }),
  ["/candidate/c-7-bozhidar-bozhanov"],
);

// ---- MPs (non-geo; numeric mp_id) ------------------------------------------
expect(
  "mpVotingProfile",
  mk({
    tool: "mpVotingProfile",
    domain: "people",
    kind: "scalar",
    facts: { name: "Бойко Борисов", mp_id: 5186 },
  }),
  ["/candidate/mp-5186"],
);
expect(
  "mpSimilarity",
  mk({
    tool: "mpSimilarity",
    domain: "people",
    facts: { mp: "Асен Василев", mp_id: 3606 },
  }),
  ["/parliament/similarity/3606"],
);

// ---- polling agency (deep link + the polls overview, like its siblings) -----
for (const tool of ["agencyProfile", "agencyPolls", "agencyAccuracyHistory"]) {
  expect(tool, mk({ tool, domain: "elections", facts: { agency_id: "AR" } }), [
    "/polls/AR",
    "/polls",
  ]);
}

// ---- region (geo-derived; Sofia-city keeps the overview) -------------------
for (const tool of ["regionResults", "regionResultsTrend"]) {
  expect(
    `${tool} (Varna)`,
    mk({ tool, domain: "elections", geo: oblastLocator("VAR", "Варна") }),
    ["/municipality/VAR"],
  );
  expect(
    `${tool} (Sofia-city -> /regions)`,
    mk({ tool, domain: "elections", geo: muniLocator("SOF", "S23", "София") }),
    ["/regions"],
  );
}

// ---- municipality (geo-derived; Sofia-city keeps the overview) -------------
for (const tool of ["municipalityResults", "municipalityHistory"]) {
  expect(
    `${tool} (Plovdiv)`,
    mk({
      tool,
      domain: "elections",
      geo: muniLocator("PDV22", "PDV", "Пловдив"),
    }),
    ["/settlement/PDV22"],
  );
  expect(
    `${tool} (Sofia-city -> /regions)`,
    mk({ tool, domain: "elections", geo: muniLocator("SOF", "S23", "София") }),
    ["/regions"],
  );
}

// ---- settlement & section (geo / facts deep links) -------------------------
for (const tool of ["settlementResults", "settlementHistory"]) {
  expect(
    tool,
    mk({
      tool,
      domain: "elections",
      geo: settlementLocator("32754", "VID09", "Иново"),
    }),
    ["/sections/32754"],
  );
}
for (const tool of ["sectionResults", "sectionHistory"]) {
  expect(
    tool,
    mk({ tool, domain: "elections", facts: { section: "050900092" } }),
    ["/section/050900092"],
  );
}

// ---- local single-município (cycle parsed from provenance, not the latest) --
expect(
  "localMunicipality",
  mk({
    tool: "localMunicipality",
    domain: "local",
    geo: muniLocator("PDV22", "PDV", "Пловдив"),
    provenance: [`${CYCLE}/municipalities/PDV22.json`],
  }),
  [`/local/${CYCLE}/PDV22`],
);
expect(
  "localMayorRace (older cycle -> links to ITS cycle)",
  mk({
    tool: "localMayorRace",
    domain: "local",
    geo: muniLocator("VAR06", "VAR", "Варна"),
    provenance: ["2019_10_27_mi/municipalities/VAR06.json"],
  }),
  ["/local/2019_10_27_mi/VAR06/mayor"],
);
expect(
  "localCouncil",
  mk({
    tool: "localCouncil",
    domain: "local",
    geo: muniLocator("BGS04", "BGS", "Бургас"),
    provenance: [`${CYCLE}/municipalities/BGS04.json`],
  }),
  [`/local/${CYCLE}/BGS04/council`],
);

// ---- party deep links (pre-existing; guard against regressions) ------------
expect(
  "partyResult",
  mk({
    tool: "partyResult",
    domain: "elections",
    kind: "scalar",
    facts: { party: "ГЕРБ-СДС" },
  }),
  ["/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1"],
);
expect(
  "regionBreakdown",
  mk({
    tool: "regionBreakdown",
    domain: "elections",
    facts: { party: "ГЕРБ-СДС" },
  }),
  ["/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1/regions"],
);

console.log("\naggregates keep the generic section page (no deep link):");
expect(
  "settlementWinners",
  mk({ tool: "settlementWinners", domain: "elections" }),
  ["/regions"],
);
expect(
  "municipalityWinners",
  mk({ tool: "municipalityWinners", domain: "elections" }),
  ["/regions"],
);
expect("regionWinners", mk({ tool: "regionWinners", domain: "elections" }), [
  "/regions",
]);
expect(
  "nationalResults",
  mk({ tool: "nationalResults", domain: "elections" }),
  ["/parties"],
);
expect(
  "localMayorsWon (national aggregate)",
  mk({ tool: "localMayorsWon", domain: "local" }),
  [`/local/${CYCLE}`],
);

console.log("\nfallbacks when the deep-link id is unavailable:");
// candidate "not found" -> no candidate_id -> elections domain landing
expect(
  "candidateResult (not found -> home)",
  mk({
    tool: "candidateResult",
    domain: "elections",
    kind: "scalar",
    facts: { query: "x" },
  }),
  ["/"],
);
// MP "not found" -> no mp_id -> people domain landing
expect(
  "mpVotingProfile (not found -> governments)",
  mk({
    tool: "mpVotingProfile",
    domain: "people",
    kind: "scalar",
    facts: { query: "x" },
  }),
  ["/governments"],
);
// settlement "no data" -> no geo -> elections domain landing
expect(
  "settlementResults (no data -> home)",
  mk({
    tool: "settlementResults",
    domain: "elections",
    kind: "scalar",
    facts: {},
  }),
  ["/"],
);
// local Sofia (oblast-level locator, no muni code) -> cycle landing, no deep link
expect(
  "localMunicipality (Sofia -> cycle landing)",
  mk({
    tool: "localMunicipality",
    domain: "local",
    geo: muniLocator("SOF", "S23", "София"),
    provenance: [`${CYCLE}/municipalities/SOF.json`],
  }),
  [`/local/${CYCLE}`],
);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — siteLinks deep-link coverage`,
);
process.exit(failures === 0 ? 0 : 1);
