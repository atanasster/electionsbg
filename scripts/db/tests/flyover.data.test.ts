// `data/home/flyover.json` must be the corpus it claims to be — plan §11.1.
//
// The artifact is COMMITTED and bucket-served, so every number in it is a claim published at a
// 200 long after the corpus underneath it has moved. Nothing at request time can notice: there
// is no live query to disagree with. So this gate re-counts every layer, every cell of the flow
// matrix and every coverage bucket directly against Postgres.
//
// Three things it deliberately does NOT do:
//
//   - it never sums the three money layers. They are three TAPS over overlapping corpora (an
//     ИСУН-funded contract is in `fund_projects` AND `contracts`), so their sum is a quantity
//     with no name, and a gate that computed one would license a caption to publish it;
//   - it does not require the elections layer. `data/<date>/region_votes.json` is gitignored,
//     so a fresh clone legitimately has none — `available.elections` is the assertion;
//   - it does not „reconcile" the three procurement bases. €94.12bn (corpus), €93.91bn (the
//     hub-stats tile) and €93.18bn (buyer-placed) are three different questions, and the gate
//     pins the DISTANCE between them rather than their equality.
//
// Auto-skips when Postgres is down or the contracts corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import {
  MAX_BYTES,
  buildArtifact,
  type FlyoverArtifactV1,
} from "../gen_home/flyover";
import { OBLAST_CODES, oblastFromName } from "../gen_home/oblastCodes";
import type { FlyoverWorld } from "../../../src/lib/flyover/types";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const REL = "data/home/flyover.json";
const FILE = path.join(ROOT, REL);

const haveFile = fs.existsSync(FILE);
const haveDb = await dbReachable();
const contractsLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM contracts WHERE tag = 'contract'",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveFile
  ? `${REL} has not been generated`
  : !haveDb
    ? "Postgres unreachable"
    : !contractsLoaded
      ? "contracts corpus is empty"
      : false;
reportSkip(import.meta.url, skip);

const artifact: FlyoverArtifactV1 | null = haveFile
  ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as FlyoverArtifactV1)
  : null;

/**
 * ⚠️ THE ENGINE DECLARES THE ARTIFACT'S SHAPE A SECOND TIME, AND THIS IS WHAT KEEPS THE TWO
 * IN STEP. `src/lib/flyover/` may not import from `scripts/` — the generator pulls in
 * `node:fs`, and the engine has to bundle for the browser, for Node canvas and for Remotion —
 * so `FlyoverWorld` is a parallel declaration rather than a shared one. This assignability
 * check fails at BUILD time (`tsc -b`), not at runtime, the moment the generator's output
 * stops satisfying what the engine expects to draw.
 */
type ArtifactSatisfiesEngine = FlyoverArtifactV1 extends FlyoverWorld
  ? true
  : never;
const _engineShape: ArtifactSatisfiesEngine = true;
void _engineShape;

/**
 * Negative control: the one way the check above can go quiet is either side resolving to
 * `any`, since `any extends X ? true : never` accepts `true` and compiles in silence. This
 * line compiles only while a wrong shape is genuinely REJECTED.
 */
type EngineCheckRejectsWrongShape = { v: number } extends FlyoverWorld
  ? never
  : true;
const _engineShapeDiscriminates: EngineCheckRejectsWrongShape = true;
void _engineShapeDiscriminates;

afterAll(async () => {
  await end();
});

/** M€, the artifact's money grain — the same rounding the generator applies. */
const meur = (eur: number): number => Math.round(eur / 1e6);

test.skipIf(skip)(
  "the artifact is committed, parses, and is inside its budget",
  () => {
    const tracked = execFileSync("git", ["ls-files", REL], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    assert.ok(
      tracked,
      `${REL} is not tracked by git — it is a committed artifact`,
    );
    assert.equal(artifact!.v, 1);
    const bytes = fs.statSync(FILE).size;
    assert.ok(
      bytes <= MAX_BYTES,
      `${REL} is ${bytes} bytes, over the ${MAX_BYTES}-byte budget`,
    );
  },
);

test.skipIf(skip)(
  "the geometry is the committed МИР set, closed and in frame",
  () => {
    const fc = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/regions_map.json"), "utf8"),
    ) as { features: { properties: { nuts3: string } }[] };
    const keys = fc.features.map((f) => f.properties.nuts3).sort();
    assert.deepEqual(Object.keys(artifact!.geo.regions).sort(), keys);
    assert.deepEqual(artifact!.frame, { w: 1000, h: 625 });
    const oblasts = new Set<string>();
    for (const [key, region] of Object.entries(artifact!.geo.regions)) {
      oblasts.add(region.oblast);
      for (const ring of region.rings) {
        assert.ok(
          ring.length >= 4,
          `${key}: a ring with ${ring.length} points`,
        );
        assert.deepEqual(
          ring[0],
          ring[ring.length - 1],
          `${key}: an unclosed ring`,
        );
        for (const [x, y] of ring) {
          assert.ok(
            Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0,
            `${key}: ${x},${y} is not an integer tenth inside the frame`,
          );
          assert.ok(
            x <= 10_000 && y <= 6_250,
            `${key}: ${x},${y} is outside the frame`,
          );
        }
      }
    }
    assert.deepEqual([...oblasts].sort(), [...OBLAST_CODES]);
    assert.deepEqual(Object.keys(artifact!.geo.cities).sort(), [
      ...OBLAST_CODES,
    ]);
  },
);

test.skipIf(skip)(
  "two consecutive runs are byte-identical, and the commit is one of them",
  async () => {
    // ⚠️ The artifact is COMMITTED. Nondeterminism here fails nothing at runtime — it churns
    // the diff of the one file a reviewer reads to see what a corpus reload actually moved.
    const a = await buildArtifact();
    const b = await buildArtifact();
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(
      fs.readFileSync(FILE, "utf8"),
      JSON.stringify(a) + "\n",
      "the committed artifact is not what this corpus builds — run npm run db:gen-home-flyover",
    );
  },
);

test.skipIf(skip)("the funds layer declares its place coverage", async () => {
  if (!artifact!.available.funds) return;
  const [{ total, placed }] = (await allRows(
    `SELECT sum(grant_eur::numeric) AS total,
            sum(grant_eur::numeric) FILTER (
              WHERE oblast IS NOT NULL AND btrim(oblast) <> '') AS placed
       FROM fund_projects`,
  )) as { total: string; placed: string }[];
  assert.ok(Math.abs(Number(total) - artifact!.figures.fundsTotalEur) <= 1);
  assert.ok(Math.abs(Number(placed) - artifact!.figures.fundsPlacedEur) <= 1);
  // The GAP is the finding, not an error — assert that it is STATED, never that it is small.
  // 4.6% of rows are unplaced and they hold 52% of the money, so a consumer given only the
  // numerator publishes a figure about half the corpus.
  assert.ok(
    artifact!.figures.fundsTotalEur > artifact!.figures.fundsPlacedEur,
    "fundsTotalEur must be the denominator fundsPlacedEur is a share of",
  );
});

test.skipIf(skip)("no money layer has quietly emptied", () => {
  // The per-layer recount below defaults an absent oblast to 0 on BOTH sides, so a layer that
  // lost its rows compares equal. This is the non-vacuity arm: the generator's own refusal is
  // the real guard, and this notices if that refusal is ever weakened.
  for (const [name, layer] of Object.entries(artifact!.layers.all)) {
    const values = Object.values(layer!);
    const zeros = values.filter((v) => v === 0).length;
    assert.ok(
      zeros <= 2,
      `layers.all.${name} has ${zeros} zero oblasts of ${values.length} — a hole draws as a claim`,
    );
  }
});

test.skipIf(skip)("every money layer equals its own SQL recount", async () => {
  const recount = async (
    sql: string,
    key: "name" | "code",
  ): Promise<Record<string, number>> => {
    const rows = (await allRows(sql)) as {
      k: string | null;
      eur: string | null;
    }[];
    const acc = new Map<string, number>();
    for (const r of rows) {
      const code =
        key === "name"
          ? oblastFromName(r.k)
          : r.k && OBLAST_CODES.includes(r.k)
            ? r.k
            : foldCode(r.k);
      if (!code) continue;
      acc.set(code, (acc.get(code) ?? 0) + Number(r.eur ?? 0));
    }
    return Object.fromEntries(
      OBLAST_CODES.map((c) => [c, meur(acc.get(c) ?? 0)]),
    );
  };
  // The funds corpus is CODE-keyed with four spellings for the capital; the fold is the
  // generator's own, restated here only so this recount is independent of it in the arms that
  // matter (the money, and which oblast it lands in).
  const foldCode = (c: string | null): string | null =>
    c === "S22" || c === "S23" || c === "S24" || c === "S25"
      ? "SOF"
      : c === "PDV-00"
        ? "PDV"
        : null;

  const proc = await recount(
    `SELECT s.oblast AS k, sum(c.amount_eur::numeric) AS eur
       FROM contracts c JOIN awarder_seats s ON s.eik = c.awarder_eik
      WHERE c.tag = 'contract' GROUP BY 1`,
    "name",
  );
  assert.deepEqual(artifact!.layers.all.proc, proc);

  if (artifact!.available.funds) {
    const funds = await recount(
      `SELECT oblast AS k, sum(grant_eur::numeric) AS eur FROM fund_projects GROUP BY 1`,
      "code",
    );
    assert.deepEqual(artifact!.layers.all.funds, funds);
  }
  if (artifact!.available.agri) {
    const agri = await recount(
      `SELECT oblast AS k, sum(total_eur::numeric) AS eur FROM agri_subsidies GROUP BY 1`,
      "name",
    );
    assert.deepEqual(artifact!.layers.all.agri, agri);
  }
});

test.skipIf(skip)(
  "only `proc` is scoped, and the sitting parliament is a real window",
  async () => {
    // `fund_projects` has NO date column and `agri_subsidies` is annual, so a parliament window
    // over either would be invented. `available.scopedLayers` is the claim; this is the check.
    assert.deepEqual(artifact!.available.scopedLayers, ["proc"]);
    const scoped = Object.keys(artifact!.layers).filter((k) => k !== "all");
    assert.equal(
      scoped.length,
      1,
      "v1 carries `all` plus exactly one parliament window",
    );
    for (const key of scoped) {
      assert.deepEqual(Object.keys(artifact!.layers[key]), ["proc"]);
    }
    const [{ scope_key }] = (await allRows(
      `SELECT scope_key FROM procurement_scopes WHERE scope_key LIKE 'ns:%'
      ORDER BY sort_ord ASC LIMIT 1`,
    )) as { scope_key: string }[];
    assert.equal(
      scoped[0],
      scope_key,
      "the scoped window is the SITTING parliament",
    );
    // It must be a strict subset of the corpus, or the window is not being applied at all.
    const all = Object.values(artifact!.layers.all.proc!).reduce(
      (a, b) => a + b,
      0,
    );
    const ns = Object.values(artifact!.layers[scope_key].proc!).reduce(
      (a, b) => a + b,
      0,
    );
    assert.ok(
      ns > 0 && ns < all,
      `the ${scope_key} window sums ${ns} against ${all} for all time`,
    );
  },
);

test.skipIf(skip)(
  "the flow matrix equals its SQL recount, cell by cell",
  async () => {
    const rows = (await allRows(
      `SELECT s.oblast AS buyer, p.oblast AS con, sum(c.amount_eur::numeric) AS eur
       FROM contracts c
       JOIN awarder_seats s ON s.eik = c.awarder_eik
       JOIN tr_company_place p ON p.uic = c.contractor_eik
      WHERE c.tag = 'contract' GROUP BY 1, 2`,
    )) as { buyer: string; con: string; eur: string }[];
    const idx = new Map(OBLAST_CODES.map((c, i) => [c, i]));
    const m = OBLAST_CODES.map(() => OBLAST_CODES.map(() => 0));
    for (const r of rows) {
      const b = oblastFromName(r.buyer);
      const k = oblastFromName(r.con);
      if (!b || !k) continue;
      m[idx.get(b)!][idx.get(k)!] += Number(r.eur);
    }
    assert.deepEqual(artifact!.flows.keys, [...OBLAST_CODES]);
    assert.deepEqual(
      artifact!.flows.m,
      m.map((row) => row.map(meur)),
    );
  },
);

test.skipIf(skip)(
  "the coverage buckets are an exact partition of the corpus",
  () => {
    const cov = artifact!.flows.coverage;
    const parts =
      cov.bothPlacedEur +
      Object.values(cov.unplaced).reduce((a, b) => a + b, 0);
    assert.ok(
      Math.abs(parts - cov.totalEur) <= 1,
      `the buckets sum to ${parts} against a corpus of ${cov.totalEur} — ` +
        `\`unplaced\` is a decomposition, not a list of related figures`,
    );
    // The matrix's own total is the both-placed sum, to within the M€ rounding of 784 cells.
    const matrixM = artifact!.flows.m.reduce(
      (a, row) => a + row.reduce((x, y) => x + y, 0),
      0,
    );
    assert.ok(
      Math.abs(matrixM - meur(cov.bothPlacedEur)) <=
        OBLAST_CODES.length ** 2 / 2,
      `the matrix sums to ${matrixM} M€ against a declared ${meur(cov.bothPlacedEur)} M€`,
    );
  },
);

test.skipIf(skip)(
  "the arcs' coverage floor still holds, and the join still discriminates",
  async () => {
    // The §7 ratchet. RAISE this by hand after each contractor-placement step lands; a floor
    // left where it was is a gate that has stopped discriminating.
    const FLOOR = 0.2;
    const cov = artifact!.flows.coverage;
    const placed = cov.bothPlacedEur / cov.totalEur;
    assert.ok(
      placed >= FLOOR,
      `both ends are placed for ${(placed * 100).toFixed(1)}% of the money, under the ${FLOOR * 100}% floor`,
    );
    // Mutation check: the same recount WITHOUT the contractor join must be strictly larger, or
    // an implementation whose join silently stopped filtering would satisfy the assertion above.
    const [{ eur }] = (await allRows(
      `SELECT sum(c.amount_eur::numeric) AS eur
       FROM contracts c JOIN awarder_seats s ON s.eik = c.awarder_eik
      WHERE c.tag = 'contract'`,
    )) as { eur: string }[];
    assert.ok(
      Number(eur) > cov.bothPlacedEur * 1.5,
      "dropping the contractor join did not widen the sum — the join is not filtering",
    );
  },
);

test.skipIf(skip)(
  "the three procurement bases stay distinct and stay close",
  async () => {
    const cov = artifact!.flows.coverage;
    const [{ total }] = (await allRows(
      `SELECT sum(amount_eur::numeric) AS total FROM contracts WHERE tag = 'contract'`,
    )) as { total: string }[];
    assert.ok(
      Math.abs(Number(total) - cov.totalEur) <= 1,
      "coverage.totalEur is not the corpus at tag='contract'",
    );
    const hub = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/home/hub_stats.json"), "utf8"),
    ) as { tiles?: { procurement?: { value?: number } } };
    assert.equal(
      artifact!.figures.procTotalEur,
      Math.round(hub.tiles!.procurement!.value!),
      "the caption headline must be the tile's own figure — two numbers on one screen",
    );
    const gap =
      Math.abs(artifact!.figures.procTotalEur - cov.totalEur) / cov.totalEur;
    assert.ok(
      gap < 0.005,
      `the tile and the corpus differ by ${(gap * 100).toFixed(2)}%`,
    );
    assert.ok(
      cov.buyerPlacedEur / cov.totalEur >= 0.98,
      `only ${((cov.buyerPlacedEur / cov.totalEur) * 100).toFixed(1)}% of the money has a placed buyer`,
    );
  },
);

test.skipIf(skip)(
  "computedAt is the max source date, never today",
  async () => {
    const [{ max_date }] = (await allRows(
      `SELECT max(date) AS max_date FROM contracts WHERE tag = 'contract'`,
    )) as { max_date: string }[];
    assert.equal(artifact!.computedAt, max_date);
    assert.notEqual(
      artifact!.computedAt,
      new Date().toISOString().slice(0, 10),
      "a `now` stamp lets a stalled pipeline look fresh and makes two rebuilds differ",
    );
  },
);

test.skipIf(skip)("the overlays are declared rather than assumed", () => {
  const a = artifact!;
  assert.equal(a.available.elections, Boolean(a.elections));
  assert.equal(a.available.prices, Boolean(a.prices));
  assert.equal(a.available.proc, Boolean(a.layers.all.proc));
  assert.equal(a.available.funds, Boolean(a.layers.all.funds));
  assert.equal(a.available.agri, Boolean(a.layers.all.agri));
  if (a.prices) {
    // МИР keys, not oblast codes — the price panel's grain and the polygons'.
    for (const key of Object.keys(a.prices.byMir)) {
      assert.ok(
        key in a.geo.regions,
        `prices carry ${key}, which has no polygon`,
      );
    }
    assert.ok(a.prices.national > 0);
  }
  if (a.elections) {
    // ⚠️ WHICH elections, not just that they are well-formed. A slice taken from the wrong end
    // of a registry that carries no date field shows 2005 and 2009 while every other assertion
    // here passes.
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src/data/json/elections.json"), "utf8"),
    ) as { name: string }[];
    const newest = registry
      .map((e) => e.name)
      .sort()
      .slice(-2)
      .reverse();
    assert.deepEqual(
      Object.keys(a.elections),
      newest.filter((d) =>
        fs.existsSync(path.join(ROOT, `data/${d}/region_votes.json`)),
      ),
      "the overlay must carry the MOST RECENT elections",
    );
    for (const [date, regions] of Object.entries(a.elections)) {
      for (const [key, r] of Object.entries(regions)) {
        assert.ok(key in a.geo.regions, `${date}: ${key} has no polygon`);
        assert.ok(
          r.nick.length > 0 && r.color.length > 0,
          `${date}/${key}: no winner`,
        );
        assert.ok(
          r.share > 0 && r.share <= 100,
          `${date}/${key}: share ${r.share}`,
        );
      }
    }
  }
});

test.skipIf(skip)("every population is the census's own", () => {
  const census = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/census_2021.json"), "utf8"),
  ) as { oblasts: { code: string; population: number }[] };
  assert.deepEqual(
    artifact!.pop,
    Object.fromEntries(
      census.oblasts
        .map((o) => [o.code, o.population] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  );
});
