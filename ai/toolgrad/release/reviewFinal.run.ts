// Local fixed review of final responses, bound to their content (not timings).
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "../corpus";
import { digitRuns } from "../../llm/grounding";
import type { evaluateQuestion } from "./harness";
type Row = Awaited<ReturnType<typeof evaluateQuestion>>;
const dir = "data/ai/toolgrad/release";
const read = (name: string) =>
  JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
const manifest = read("manifest");
const assessed: Record<string, string> = {
  replay: "43ea83a913343bf807e00d35ec231035ccdee3399791021d3c58757237021faa",
  "confirmation/report":
    "729b63ea025e365bee3af3bacec618443b3d5d688fa6e967cff32ec551192957",
  "confirmation-replay":
    "2bdbb81d9f970737957b11e60b0cc69b7c827fb7d66f37c9c83141d0729b7f56",
  "followup/report":
    "8d9ba8853f9a621b3e013211f04591de8631c40f317cca7dcf5e4e7e8a3634e8",
};
const reports = Object.entries(assessed).map(([path, expected]) => {
  const report = read(path);
  const rows = report.rows as Row[];
  const content = rows.map((r) => ({
    id: r.id,
    text: r.response.text,
    tool: r.response.tool,
    args: r.response.args,
    env: r.response.env,
  }));
  if (hash(content) !== expected)
    throw new Error(`Unreviewed final response content: ${path}`);
  const grades = rows.map((r) => {
    const goldId = r.id
      .replace("followup-city-2024", "varna-ballot")
      .replace("followup-province-2024", "province-ballot");
    const gold = manifest.captures.find(
      (x: { id: string }) => x.id === goldId,
    )?.env;
    const env = r.response.env;
    const dataPass = gold
      ? !!env &&
        hash(env.rows ?? null) === hash(gold.rows ?? null) &&
        hash(env.geo ?? null) === hash(gold.geo ?? null) &&
        Object.entries(gold.facts).every(
          ([k, v]) =>
            !digitRuns(String(v)).length ||
            hash(digitRuns(String(v))) ===
              hash(digitRuns(String(env.facts[k]))),
        )
      : env === null;
    const issue =
      path === "confirmation/report" && r.id === "confirm-follow-city:en"
        ? "Explicit Varna city inherited province scope; payload withheld. Fixed only after this run; original failure retained."
        : null;
    return {
      id: r.id,
      routePass: r.routePass,
      dataPass,
      completeAnswerPass: r.routePass && dataPass && !issue,
      issue,
      narratedBy: r.response.meta?.narratedBy,
    };
  });
  return {
    path,
    reportHash: hash(report),
    assessedContentHash: expected,
    questions: grades.length,
    routePass: grades.filter((r) => r.routePass).length,
    dataPass: grades.filter((r) => r.dataPass).length,
    completeAnswerPass: grades.filter((r) => r.completeAnswerPass).length,
    templateDataAnswers: rows.filter(
      (r) => r.response.env && r.response.meta?.narratedBy === "rules",
    ).length,
    rows: grades,
  };
});
const primary = read("primary/report"),
  confirmation = read("confirmation/report"),
  followup = read("followup/report");
writeFileSync(
  `${dir}/final-review.json`,
  JSON.stringify(
    {
      version: 1,
      method:
        "Coding-agent local review of all final response content against frozen inputs and rubric, not blinded human review. Content signatures bind text/tool/args/envelope; timing changes cannot attach judgments to different answers. Data checks compare rows, geographic scope and original numeric facts against pre-call captures; new fact fields remain covered by unit tests and review.",
      reports,
      guardRegression: {
        correct: read("replay").guardProbes.filter(
          (r: { actual: boolean; accept: boolean }) => r.actual === r.accept,
        ).length,
        total: 20,
      },
      network: {
        calls: primary.calls + confirmation.calls + followup.calls,
        reservationCeilingUSD:
          Math.round(
            (primary.reservationCeilingUSD +
              confirmation.reservationCeilingUSD +
              followup.reservationCeilingUSD) *
              1000,
          ) / 1000,
        billedUSD: null,
      },
      decision: {
        localRepairsAccepted: true,
        publicDeploymentRecommended: false,
        nextStage:
          "Staging smoke validation of public auth/proxy, browser rendering and live-data correctness",
        reason:
          "Original holdout had a scope failure; repair now passes regressions and four targeted fresh questions, but this is a narrow synthetic operator evaluation. Lexical guards still do not prove general entailment.",
      },
    },
    null,
    2,
  ) + "\n",
);
