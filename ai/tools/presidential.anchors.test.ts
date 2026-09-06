// The tool run against the REAL committed corpus, on the three facts a fixture cannot see.
//
// ⚠ THE DEFECT THIS EXISTS FOR SURVIVED A FULL FIXTURE SUITE. Every other assertion about this
// tool runs on synthetic rounds, and the runoff-verdict bug (art. 93 (3) read on round 2, so
// the answer denied a win the same payload named) only shows against real turnout figures:
// 2021 34.63%, 2011 48.24%, 2006 41.69% — three of five cycles, all under half, all of which
// elected a president. `scripts/parsers_presidential/anchors.test.ts` established the pattern
// one layer down.
//
// ⚠ IT SKIPS WITH A DISTINCT REASON ON A CHECKOUT WITHOUT THE CORPUS. `data/*_pvr` is
// gitignored, so a fresh clone has none of it — and „the corpus is absent" must never read as
// „the rule is enforced".

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { presidentialResults } from "./presidential";
import { setFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const DATA_ROOT = path.join(process.cwd(), "data");
const CYCLES: [string, string][] = [
  ["2021", "Румен Георгиев Радев"],
  ["2016", "Румен Георгиев Радев"],
  ["2011", "Росен Асенов Плевнелиев"],
  // ⚠ THE NAMES ARE THE CORPUS'S OWN. 2001 records „Георги Седефчов Първанов" and 2006 records
  // „Георги Първанов" for the same man — the register spells him differently across eras, which
  // is exactly why the anchor is read from the file rather than typed from memory.
  ["2006", "Георги Първанов"],
  ["2001", "Георги Седефчов Първанов"],
];

const present = CYCLES.filter(([y]) =>
  fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .some(
      (d) => d.isDirectory() && d.name.startsWith(y) && d.name.endsWith("_pvr"),
    ),
);
const hasCorpus = present.length === CYCLES.length;

/** Serve the committed tree straight off disk, the way the bucket would. */
const local = async (p: string): Promise<unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(DATA_ROOT, p.replace(/^\//, "")), "utf8"),
  );

const ctx = { lang: "bg" } as ToolContext;

afterEach(() => clearDataCache());

describe.runIf(hasCorpus)("presidentialResults against the real corpus", () => {
  it.each(present)(
    "%s: the default answer names the elected president and does not deny the win",
    async (cycle, president) => {
      setFetcher(local);
      const env = await presidentialResults({ cycle }, ctx);
      const facts = JSON.stringify(env.facts);
      expect(facts).toContain(president);
      // ⚠ THE ASSERTION THE FIXTURE SUITE COULD NOT MAKE. Every one of these five cycles was
      // decided in a runoff, and three of them had a runoff turnout under half.
      expect(facts).not.toMatch(/няма избран/);
      expect(env.kind).toBe("table");
    },
  );

  it("2006 round 1: a majority of the valid vote, and still nobody elected", async () => {
    // 64.05% and 43.88% turnout — the case the whole file is named for, and the one a leader's
    // share alone renders as a win.
    setFetcher(local);
    const facts = JSON.stringify(
      (await presidentialResults({ cycle: "2006", round: 1 }, ctx)).facts,
    );
    expect(facts).toMatch(/няма избран в първи тур/);
    expect(facts).toMatch(/мнозинството е налице/);
    expect(facts).toMatch(/активността е недостатъчна/);
  });

  it("answers for София with the three МИР summed, not „no data“", async () => {
    setFetcher(local);
    const env = await presidentialResults(
      { cycle: "2021", place: "София" },
      ctx,
    );
    expect(env.kind).toBe("table");
    expect(JSON.stringify(env.facts)).not.toMatch(/няма данни/);
    // The capital is the largest município in the country; a six-figure leading total is the
    // cheapest proof the three shards were actually summed rather than one picked.
    expect(Number(env.rows?.[0]?.votes)).toBeGreaterThan(100_000);
  });

  it("answers an oblast question with the oblast, not its capital município", async () => {
    // Measured: Пловдив município is roughly half of oblast Пловдив (PDV + PDV-00).
    setFetcher(local);
    const oblast = await presidentialResults(
      { cycle: "2021", oblast: "Пловдив" },
      ctx,
    );
    const muni = await presidentialResults(
      { cycle: "2021", place: "Пловдив" },
      ctx,
    );
    expect(oblast.title).toMatch(/област/);
    expect(muni.title).toMatch(/община/);
    expect(Number(oblast.rows?.[0]?.votes)).toBeGreaterThan(
      Number(muni.rows?.[0]?.votes),
    );
  });
});

describe.runIf(!hasCorpus)(
  "presidentialResults against the real corpus",
  () => {
    it("skips: data/*_pvr is gitignored and this checkout has no presidential tree", () => {
      expect(present.length).toBeLessThan(CYCLES.length);
    });
  },
);
