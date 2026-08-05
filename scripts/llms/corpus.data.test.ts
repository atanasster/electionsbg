// The committed /llms-full.txt corpora, checked as PUBLISHED CLAIMS.
//
// These files are what an answer engine reads instead of crawling 310 pages, so
// a wrong cell is quoted verbatim and a missing section is simply an entity the
// model has never heard of. Two failure modes have already happened once each
// and are pinned here:
//
//   * a dash meaning "not published" read as a zero, and an intro sentence
//     asserting a rule ("the ВСС publishes workload for courts only") that is
//     false for six courts including both Supreme Courts;
//   * a build without Postgres rewriting the committed file ~290 lines shorter,
//     exit 0, one buried warning.
//
// buildFull.ts is a top-level-await script with side effects, so it cannot be
// imported — these read the artifact, which is what actually ships.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../db/lib/pg";
import { readSeoCourts } from "../db/lib/seo_courts";
import { readSeoPensionFunds } from "../prerender/kfnFunds";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PUBLIC = path.join(PROJECT_ROOT, "public");
const CORPORA = ["llms-full.txt", "llms-full.en.txt"] as const;

const read = (f: string): string =>
  fs.readFileSync(path.join(PUBLIC, f), "utf-8");

const haveDb = await dbReachable();

afterAll(async () => {
  if (haveDb) await end();
});

/** Every markdown table row under a `## <heading>` block, as cell arrays. */
const tableUnder = (corpus: string, heading: string): string[][] => {
  const start = corpus.indexOf(`## ${heading}`);
  if (start < 0) return [];
  const end = corpus.indexOf("\n## ", start + 1);
  const block = corpus.slice(start, end < 0 ? undefined : end);
  return block
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
};

const HEADINGS = {
  "llms-full.txt": {
    judiciary: "Съдебна власт — органи, натовареност и магистрати",
    pensions: "Частни пенсионни фондове (КФН) — нетни активи и осигурени лица",
  },
  "llms-full.en.txt": {
    judiciary: "The judiciary — bodies, caseload and magistrates",
    pensions: "Private pension funds (FSC) — net assets and insured persons",
  },
} as const;

for (const f of CORPORA) {
  test(`${f}: both new sections are present and populated`, () => {
    const corpus = read(f);
    for (const heading of Object.values(HEADINGS[f])) {
      const rows = tableUnder(corpus, heading);
      // header + separator + at least one body row
      assert.ok(
        rows.length > 2,
        `"${heading}" is missing or empty — a corpus built without its source must SKIP the write, not publish a shorter file`,
      );
    }
  });

  test(`${f}: every table row has the same column count as its header`, () => {
    const corpus = read(f);
    for (const heading of Object.values(HEADINGS[f])) {
      const rows = tableUnder(corpus, heading);
      if (!rows.length) continue;
      const width = rows[0].length;
      for (const [i, r] of rows.entries()) {
        assert.equal(
          r.length,
          width,
          `"${heading}" row ${i} has ${r.length} cells, header has ${width}`,
        );
      }
    }
  });

  test(`${f}: no workload cell is a zero standing in for "not published"`, () => {
    const corpus = read(f);
    const rows = tableUnder(corpus, HEADINGS[f].judiciary).slice(2);
    for (const r of rows) {
      // The last four numeric columns before the year: judges, magistrates,
      // filed, resolved. A body with no published workload must carry "—" in
      // the rate columns, never "0" / "0,00".
      const [filed, resolved, year] = r.slice(-4, -1);
      const noYear = year === "—";
      if (noYear) {
        assert.equal(filed, "—", `${r[0]}: filed is "${filed}" with no year`);
        assert.equal(
          resolved,
          "—",
          `${r[0]}: resolved is "${resolved}" with no year`,
        );
      }
    }
  });

  test(`${f}: the intro does not claim the ВСС publishes workload for all courts`, () => {
    // Six courts (ВКС, ВАС, СОС, РС София, АС София-град, АС София-област)
    // carry no court_load row, so "only the courts have it" is false — and the
    // per-page prose was already fixed for exactly this. The corpus summarises
    // those pages and must not re-assert the rule one level up.
    const corpus = read(f);
    assert.ok(
      !/статистиката обхваща съдилищата|publishes that statistic for the courts only/.test(
        corpus,
      ),
      "the judiciary intro states a rule that is false for six courts",
    );
  });

  test(`${f}: the share column is labelled by fund TYPE, not by pillar`, () => {
    // The value is a share within УПФ / ППФ / ДПФ / ДПФПС. Pillar 2 is УПФ+ППФ
    // and pillar 3 is ДПФ+ДПФПС, so the sole ДПФПС reads 100% of its type
    // against 1.2% of its pillar — the number is right, "стълб" was not.
    const corpus = read(f);
    const rows = tableUnder(corpus, HEADINGS[f].pensions);
    if (!rows.length) return;
    assert.ok(
      !rows[0].some((h) => /Дял в стълба|Share of pillar/.test(h)),
      "the share column still claims to be a share of the pillar",
    );
  });
}

test("the judiciary intro's claim about load-less courts matches the table", async (t) => {
  if (!haveDb) return t.skip();
  // The intro is HAND-WRITTEN above a GENERATED table, so the two drift
  // independently — and did: after the duplicate-fold fix took the load-less
  // courts from six to two, both corpora still told an answer engine that some
  // courts' series sit under "a second, duplicate entry for the same court".
  const [row] = await allRows<{ n: string }>(`
    SELECT count(*) AS n FROM judicial_body b
     WHERE b.kind = 'court'
       AND NOT EXISTS (SELECT 1 FROM judicial_body_source_name s
                         JOIN court_load c ON c.name = s.source_name
                        WHERE s.body_code = b.body_code)`);
  const loadless = Number(row?.n ?? 0);
  assert.equal(
    loadless,
    2,
    "the number of load-less courts moved — the hand-written judiciary intro in buildFull.ts names ВКС and ВАС explicitly and must be re-checked",
  );
  for (const f of CORPORA) {
    const corpus = read(f);
    assert.ok(
      !/дублиращо се вписване|duplicate entry for the same court/.test(corpus),
      `${f}: the intro still describes the dimension as double-counted`,
    );
  }
});

test("the corpus lists exactly the enumerable courts and funds", async (t) => {
  if (!haveDb) return t.skip();
  const courts = await readSeoCourts();
  if (!courts.length) return t.skip();
  const corpus = read("llms-full.txt");
  const rows = tableUnder(corpus, HEADINGS["llms-full.txt"].judiciary).slice(2);
  assert.equal(rows.length, courts.length, "corpus and reader disagree");

  const funds = readSeoPensionFunds(PROJECT_ROOT);
  const fundRows = tableUnder(corpus, HEADINGS["llms-full.txt"].pensions).slice(
    2,
  );
  assert.equal(fundRows.length, funds.length);
});

test("a build without Postgres refuses to rewrite the corpus shorter", () => {
  // The whole point of the guard: these are COMMITTED files whose sources
  // degrade to [] rather than throwing, so without this a Docker-less machine
  // publishes a corpus missing every judicial body, with a green exit.
  const before = CORPORA.map((f) => read(f));
  execFileSync("npx", ["tsx", "scripts/llms/buildFull.ts"], {
    cwd: PROJECT_ROOT,
    // Port 1 is reserved and never listening — the same "no database" shape as
    // Docker being down.
    env: {
      ...process.env,
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/electionsbg",
    },
    stdio: "pipe",
  });
  for (const [i, f] of CORPORA.entries()) {
    assert.equal(
      read(f),
      before[i],
      `${f} was rewritten by a Postgres-less run — the regression guard did not fire`,
    );
  }
});
