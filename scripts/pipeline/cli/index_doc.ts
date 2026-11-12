// pnpm run pipeline:index — regenerate docs/pipeline-handlers.md and the
// pipeline-pointer block in every runbook a handler names, from the registry.
// `--check` writes nothing and exits 1 when anything is stale.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HANDLERS, UNROUTED } from "../registry";
import {
  applySkillPointer,
  INDEX_PATH,
  POINTER_START,
  removeSkillPointer,
  renderHandlerIndex,
  renderSkillPointer,
} from "../registry/handler_index";
import { POST_STEPS } from "../registry/post_steps";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const check = process.argv.includes("--check");
const read = (f: string): string => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

const targets: { file: string; want: string }[] = [
  {
    file: INDEX_PATH,
    want: renderHandlerIndex(HANDLERS, UNROUTED, POST_STEPS),
  },
];
const named = new Set(HANDLERS.flatMap((h) => h.skill ?? []));
// A runbook whose handler was renamed or retired keeps a block that points at
// nothing: strip it.
const skillsDir = path.join(REPO, ".claude/skills");
for (const skill of fs.readdirSync(skillsDir)) {
  if (named.has(skill)) continue;
  const file = `.claude/skills/${skill}/SKILL.md`;
  const have = read(path.join(REPO, file));
  if (have.includes(POINTER_START))
    targets.push({ file, want: removeSkillPointer(have) });
}
for (const skill of named) {
  const file = `.claude/skills/${skill}/SKILL.md`;
  const have = read(path.join(REPO, file));
  if (!have) {
    console.error(`${file} does not exist (named by a handler)`);
    process.exit(1);
  }
  targets.push({
    file,
    want: applySkillPointer(have, renderSkillPointer(HANDLERS, skill)!),
  });
}

const stale = targets.filter((t) => read(path.join(REPO, t.file)) !== t.want);
if (check) {
  for (const t of stale) console.error(`stale: ${t.file}`);
  if (stale.length) {
    console.error("run: pnpm run pipeline:index");
    process.exit(1);
  }
  console.log(`${targets.length} files current`);
} else {
  for (const t of stale) fs.writeFileSync(path.join(REPO, t.file), t.want);
  console.log(
    stale.length
      ? `wrote ${stale.map((t) => t.file).join(", ")}`
      : "all current",
  );
}
