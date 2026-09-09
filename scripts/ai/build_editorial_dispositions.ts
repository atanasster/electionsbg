import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type EditorialQuestion = {
  id: string;
  category: string;
  subcategory: string;
  bg: string;
  status: "editorial-review";
  relatedTools: string[];
};

type Promotion = {
  id: string;
  outcome: "promote_existing";
  capabilityId: string;
  validationEvidence: string;
};
type Ingestion = {
  id: string;
  outcome: "new_official_ingestion";
  ingestionContract: string;
};
type Unavailable = {
  id: string;
  outcome: "unavailable";
  blockingEvidence: string;
  newsContract?: {
    retrievalCorpus: "news/";
    articleDate: true;
    sourceAttribution: true;
    claimVsVerifiedData: true;
    authoritativeSource: true;
    sqlAllowed: false;
  };
};
type Decision = Promotion | Ingestion | Unavailable;

export const buildEditorialDispositions = (
  sourceText: string,
  decisionText: string,
) => {
  const source = JSON.parse(sourceText) as { questions: EditorialQuestion[] };
  const reviewed = JSON.parse(decisionText) as { decisions: Decision[] };
  const sourceIds = source.questions.map((question) => question.id);
  const decisionIds = reviewed.decisions.map((decision) => decision.id);
  if (new Set(decisionIds).size !== decisionIds.length)
    throw new Error("Editorial decision IDs must be unique");
  if (JSON.stringify(decisionIds) !== JSON.stringify(sourceIds))
    throw new Error("Editorial decisions must match all source IDs in order");

  const dispositions = source.questions.map((question, index) => {
    const decision = reviewed.decisions[index];
    if (decision.outcome === "promote_existing")
      return {
        ...decision,
        category: question.category,
        subcategory: question.subcategory,
        questionBg: question.bg,
        chat: "ready" as const,
        sql: "ready" as const,
      };
    if (decision.outcome === "new_official_ingestion")
      return {
        ...decision,
        category: question.category,
        subcategory: question.subcategory,
        questionBg: question.bg,
        chat: "review" as const,
        sql: "review" as const,
      };
    return {
      ...decision,
      category: question.category,
      subcategory: question.subcategory,
      questionBg: question.bg,
      chat: "unavailable" as const,
      sql: "unavailable" as const,
    };
  });
  return {
    generatedAt: "2026-09-09",
    source: "docs/audits/bulgarian-civic-questions.json",
    decisions: "docs/audits/editorial-question-decisions.json",
    sourceSha256: createHash("sha256").update(sourceText).digest("hex"),
    decisionsSha256: createHash("sha256").update(decisionText).digest("hex"),
    policy:
      "Every ID has an independently reviewed decision. Topic-adjacent relatedTools are never accepted as answerability evidence. News claims require dated retrieval and citations outside unrestricted SQL.",
    dispositions,
  };
};

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sourcePath = path.join(
  ROOT,
  "docs/audits/bulgarian-civic-questions.json",
);
const decisionPath = path.join(
  ROOT,
  "docs/audits/editorial-question-decisions.json",
);
const outputPath = path.join(
  ROOT,
  "docs/audits/editorial-question-dispositions.json",
);

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const built = buildEditorialDispositions(
    readFileSync(sourcePath, "utf8"),
    readFileSync(decisionPath, "utf8"),
  );
  writeFileSync(outputPath, `${JSON.stringify(built, null, 2)}\n`);
  console.log(`editorial dispositions: ${built.dispositions.length}`);
}
