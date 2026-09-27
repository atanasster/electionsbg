// Every person shard the news pipeline publishes under data/news/mentions/person/
// must name a person the main site serves (news-person-sentiment-v1 §8).
//
// The shard is fetched by `/person/:slug` for its „В медиите" tile, keyed on the
// CURRENT slug — so a shard under a slug the person layer no longer holds is a
// tile that can never render. A RETIRED slug is no better: `/person/<old>` 301s
// to the new slug and the tile then asks for the new slug's shard. The gazetteer
// the news pipeline resolves against is a snapshot of `person`; this is what
// notices it drifting. (It checks existence only — whether a slug now names a
// different human is the identity join's business, not this file's.)
//
// Skips with a distinct reason when the tree is absent (it is gitignored and
// written only by `news/scripts/build_mention_index.py`) or Postgres is down.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const DIR = join(process.cwd(), "data", "news", "mentions", "person");

const shardIds = (): string[] =>
  existsSync(DIR)
    ? readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map(
          (f) =>
            (JSON.parse(readFileSync(join(DIR, f), "utf-8")) as { id: string })
              .id,
        )
    : [];

// The reason to skip, or false to run — a down server and an empty person
// layer are different worlds and each gets its own sentence.
const personLayerGap = async (): Promise<string | false> => {
  let people: number;
  try {
    const [c] = await allRows<{ n: string }>("SELECT count(*) n FROM person");
    people = Number(c.n);
  } catch {
    return "Postgres unreachable";
  }
  return people > 0 ? false : "person layer empty (run db:resolve:persons)";
};

const ids = shardIds();
const skip =
  ids.length === 0
    ? "no data/news/mentions/person shards on this machine"
    : await personLayerGap();
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("every person shard names a live slug", async () => {
  const rows = await allRows<{
    slug: string;
    live: boolean;
    retired: boolean;
  }>(
    `SELECT s.slug,
            EXISTS (SELECT 1 FROM person p WHERE p.slug = s.slug) AS live,
            EXISTS (SELECT 1 FROM person_slug_retired r WHERE r.slug = s.slug) AS retired
       FROM unnest($1::text[]) AS s(slug)`,
    [ids],
  );
  const unknown = rows
    .filter((r) => !r.live)
    .map((r) => (r.retired ? `${r.slug} (retired)` : r.slug));
  assert.deepEqual(
    unknown,
    [],
    `${unknown.length} of ${ids.length} news shards name a slug no person holds now — ` +
      "rebuild the gazetteer (news/scripts/build_gazetteer.py) and the index",
  );
});
