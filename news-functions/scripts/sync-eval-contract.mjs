import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT = resolve(ROOT, "news/eval_contract");
const destination = process.argv.includes("--runtime")
  ? resolve(ROOT, "news-functions/lib/eval-contract")
  : resolve(ROOT, "news-functions/src/eval-contract");
const files = [
  "canonical.ts",
  "validate.ts",
  "contract.json",
  "article_evaluation.schema.json",
  "article_feedback_request.schema.json",
  "event.schema.json",
  "submission_request.schema.json",
];

mkdirSync(destination, { recursive: true });
for (const name of files) {
  if (process.argv.includes("--runtime") && name.endsWith(".ts")) continue;
  copyFileSync(resolve(CONTRACT, name), resolve(destination, name));
}
