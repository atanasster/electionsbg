// One-off backfill: walk every session JSON under data/parliament/votes/
// sessions/ and write `itemSlugs` + `itemTopics` derived from the existing
// `itemTitles`. Pure rewrite — no network calls. Idempotent.
//
// Behind the `--backfill` flag per project policy (one-off historical work
// never runs in the watcher). Run once after the slug/topic pipeline lands:
//
//   tsx scripts/parliament/backfill_topics_slugs.ts --backfill

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { slugify } from "../lib/slug";
import { normalizeTitle } from "./derived/dedupe";
import { classifyItemTitles } from "./derived/topics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../data/parliament/votes");
const SESSIONS_DIR = path.join(VOTES_DIR, "sessions");

interface SessionJson {
  itemTitles?: Record<string, string>;
  itemSlugs?: Record<string, string>;
  itemTopics?: Record<string, string>;
  [key: string]: unknown;
}

const computeSlugs = (
  titles: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [item, title] of Object.entries(titles)) {
    const normalized = normalizeTitle(title);
    if (!normalized) continue;
    out[item] = slugify(normalized, item);
  }
  return out;
};

const main = async (args: { backfill: boolean }): Promise<void> => {
  if (!args.backfill) {
    console.error(
      "refusing to run without --backfill flag (one-off historical rewrite)",
    );
    process.exit(2);
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log("no sessions directory; nothing to do");
    return;
  }

  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let slugHits = 0;
  let topicHits = 0;
  let writes = 0;
  for (const f of files) {
    const full = path.join(SESSIONS_DIR, f);
    const session = JSON.parse(fs.readFileSync(full, "utf8")) as SessionJson;
    const titles = session.itemTitles ?? {};

    const slugs = computeSlugs(titles);
    const topics = classifyItemTitles(titles);

    let changed = false;
    if (Object.keys(slugs).length > 0) {
      if (JSON.stringify(session.itemSlugs ?? {}) !== JSON.stringify(slugs)) {
        session.itemSlugs = slugs;
        changed = true;
      }
      slugHits++;
    } else if (session.itemSlugs) {
      delete session.itemSlugs;
      changed = true;
    }
    if (Object.keys(topics).length > 0) {
      if (JSON.stringify(session.itemTopics ?? {}) !== JSON.stringify(topics)) {
        session.itemTopics = topics;
        changed = true;
      }
      topicHits++;
    } else if (session.itemTopics) {
      delete session.itemTopics;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(full, JSON.stringify(session, null, 2) + "\n");
      writes++;
    }
  }

  console.log(
    `✓ scanned ${files.length} session(s) · rewrote ${writes} · slugs in ${slugHits} · topics in ${topicHits}`,
  );
};

const cli = command({
  name: "backfill-topics-slugs",
  args: {
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description:
        "Required: confirms this is a one-off historical rewrite (never runs in watcher)",
      defaultValue: () => false,
    }),
  },
  handler: (args) => main({ backfill: !!args.backfill }),
});

run(cli, process.argv.slice(2));
