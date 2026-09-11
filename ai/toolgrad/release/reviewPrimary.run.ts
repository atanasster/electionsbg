// Fixed local assessment of the retained primary responses; no model calls.
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "../corpus";
const dir = "data/ai/toolgrad/release";
const report = JSON.parse(readFileSync(`${dir}/primary/report.json`, "utf8"));
if (
  hash(report) !==
  "77cd01d8df9d3737f0e17d314f3b0db64e1f1dbf0bce6f54e3fd26b1ba79fe9b"
)
  throw new Error("Unreviewed primary report");
const findings: Record<string, string[]> = {
  "province-ballot:bg": [
    "Bulgarian province alias does not resolve; narration withheld by the fixture boundary.",
  ],
  "province-participation:bg": [
    "Bulgarian province prefix does not resolve; narration withheld by the fixture boundary.",
  ],
  "national-resident:bg": [
    "Explicit all-Bulgaria request was changed to Plovdiv city despite a correct national model selection.",
  ],
  "national-resident:en": [
    "Explicit all-Bulgaria request was changed to Plovdiv city despite a correct national model selection.",
  ],
  "province-ballot:en": [
    "'turnout reached 40% out of a total of 1,200 votes' conflates the party-vote total with turnout's registered-voter denominator (4,000).",
  ],
  "varna-ballot:en": [
    "'turnout reached 42% out of 200 total votes' misstates the turnout denominator (500 registered).",
  ],
  "follow-explicit-province:en": [
    "'turnout reached 40% out of a total of 1,200 votes' misstates the turnout denominator.",
  ],
  "follow-bare-city:en": [
    "'300 total votes cast' overstates party-vote counts as all cast ballots; the source separately supplies 320 actual voters.",
  ],
  "varna-ballot:bg": [
    "Mixed-script place spelling 'Варna' is not fluent Bulgarian or the supplied name.",
  ],
  "tax-plovdiv:en": [
    "Guard correctly rejected an invented year 2022; final fallback has '1 rates' and a Cyrillic place name in English prose. The table retains the correct rates.",
  ],
};
for (const id of [
  "transfer-recipient:bg",
  "transfer-recipient:en",
  "transfer-ranking:bg",
  "transfer-ranking:en",
  "follow-transfer-recipient:bg",
  "follow-transfer-recipient:en",
]) {
  findings[id] = [
    "Exposes internal provenance identifier budget_muni_list in prose.",
  ];
}
for (const id of ["transfer-ranking:en", "follow-transfer-recipient:en"])
  findings[id].push("Mislabels two municipality records as two transfers.");
if (
  !report.complete ||
  report.rows.length !== 48 ||
  new Set(report.rows.map((r: { id: string }) => r.id)).size !== 48
)
  throw new Error("Incomplete primary suite");
for (const id of Object.keys(findings))
  if (!report.rows.some((r: { id: string }) => r.id === id))
    throw new Error("Assessment ID missing");
const rows = report.rows.map(
  (r: {
    id: string;
    routePass: boolean;
    response: { env: unknown };
    expectedEnv: unknown;
    blockedNarration: boolean;
  }) => ({
    id: r.id,
    routePass: r.routePass,
    toolDataPass:
      !r.blockedNarration && hash(r.response.env) === hash(r.expectedEnv),
    completeAnswerPass: !(r.id in findings),
    findings: findings[r.id] ?? [],
  }),
);
writeFileSync(
  `${dir}/primary-review.json`,
  JSON.stringify(
    {
      version: 1,
      reportHash: hash(report),
      method:
        "Local coding-agent assessment against frozen rubric, not blinded human judgment. All failed/withheld answers retained. Complete-answer quality includes factual binding and language, not only number membership.",
      rows,
      summary: {
        questions: 48,
        routePass: rows.filter((r: { routePass: boolean }) => r.routePass)
          .length,
        toolDataPass: rows.filter(
          (r: { toolDataPass: boolean }) => r.toolDataPass,
        ).length,
        completeAnswerPass: rows.filter(
          (r: { completeAnswerPass: boolean }) => r.completeAnswerPass,
        ).length,
        guardProbes: 20,
        guardCorrect: report.guardProbes.filter(
          (r: { actual: boolean; accept: boolean }) => r.actual === r.accept,
        ).length,
      },
      guardFailures: report.guardProbes.filter(
        (r: { actual: boolean; accept: boolean }) => r.actual !== r.accept,
      ),
    },
    null,
    2,
  ) + "\n",
);
