// The presidential watcher's slug discovery — the one rule that decides whether an election
// is noticed at all.
//
// ⚠ ЦИК HAS NEVER REPEATED A SLUG, so a hard-coded guess is a watcher that reports „no
// change" through an entire election night. The pattern has to admit five spellings that
// share only the letters `pvr`, and refuse every other family's archive — a match on
// `mi2023` or `ns2024` would route a LOCAL or PARLIAMENTARY publish to the presidential
// ingest, which reads a tree that does not exist.

import { describe, expect, it } from "vitest";
import { cikPresidential, discoverSlugs, roundUrl } from "./cik_presidential";
import { PRESIDENTIAL_SOURCES } from "../../parsers_presidential/sources";

const href = (slug: string) =>
  `<a href="https://results.cik.bg/${slug}/index.html">x</a>`;

describe("discoverSlugs", () => {
  it("finds every slug this repo has already ingested", () => {
    // ⚠ THE REAL FIVE, FROM THE INGEST'S OWN TABLE RATHER THAN RETYPED — and that is what
    // caught the defect this pattern shipped with. A hand-written list would have said
    // „pvr2001", repeating the very assumption that dropped `prezident2001`: ЦИК archived
    // 2001 before it settled on the abbreviation, so the slugs share TWO stems, not one. The
    // letters around them say what else was on the ballot (`nr` a referendum, `ns` a snap
    // parliamentary vote, `mi` the local elections it ran with).
    const slugs = Object.values(PRESIDENTIAL_SOURCES).map((s) => s.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(5);
    const found = discoverSlugs(slugs.map(href).join("\n")).map((s) => s.slug);
    for (const slug of slugs) expect(found, slug).toContain(slug);
  });

  it("refuses every other family's archive", () => {
    // ⚠ THE CONSEQUENCE OF A FALSE POSITIVE IS NOT A NOISY REPORT. `process-watch-report`
    // routes this source to the presidential ingest alone, so a local or parliamentary slug
    // matching here sends that publish to a reader that cannot parse it.
    const other = [
      "mi2023",
      "mi2019",
      "ns2024",
      "ns2021",
      "chmi2024-2026",
      "ep2024",
      "referendum2016",
    ];
    expect(discoverSlugs(other.map(href).join("\n"))).toEqual([]);
  });

  it("captures the year alongside the slug, for the NEW CYCLE headline", () => {
    // ⚠ THE YEAR DOES NOT DECIDE NOVELTY — `known` does, against the ingest's own table. It
    // is here so the report can say „pvr2026: NEW CYCLE 2026" rather than a bare slug.
    expect(discoverSlugs(href("pvr2026"))).toEqual([
      { slug: "pvr2026", year: "2026" },
    ]);
  });

  it("finds a presidential slug in a MIXED index — the realistic input", () => {
    // Every foil above appears on the SAME page as the real thing; testing them apart proves
    // less than testing them together, because the failure mode is a pattern that matches
    // across a boundary between two hrefs.
    const html = [
      "mi2023",
      "pvrns2021",
      "ns2024",
      "chmi2024-2026/2025-10-12_nov",
      "ep2024",
    ]
      .map(href)
      .join("\n");
    expect(discoverSlugs(html).map((s) => s.slug)).toEqual(["pvrns2021"]);
  });

  it("admits the underscore forms ЦИК demonstrably uses in paths", () => {
    // ⚠ `\b` TREATS `_` AS A WORD CHARACTER, so an anchored pattern silently misses
    // `pvr2026_tur1` and `el_pvr2026` — and ЦИК uses underscores in exactly this position
    // (`before_2003/`, `2001_prezident.zip`, `2024-10-20_chastichen`). A missed 2026 slug is
    // a watcher that reports „no change" through an entire election.
    expect(discoverSlugs(href("pvr2026_tur1")).map((s) => s.slug)).toEqual([
      "pvr2026",
    ]);
    expect(discoverSlugs(href("pvr_2026")).map((s) => s.slug)).toEqual([
      "pvr_2026",
    ]);
    // ⚠ A PREFIX SEPARATED BY `_` IS DELIBERATELY REFUSED — „el_pvr2026" is an invented
    // shape, and admitting it means matching the STEM inside a longer token, which would
    // report the slug as „pvr2026" when ЦИК's own path says otherwise. Every measured slug
    // joins its prefix directly (`mipvr2011`), so the pattern requires that too; a genuinely
    // new separator is a one-line change made against a real URL rather than a guess.
    expect(discoverSlugs(href("el_pvr2026"))).toEqual([]);
  });

  it("de-duplicates a slug the index lists many times", () => {
    // The root index links each archive from several places; a repeated slug must not
    // become a repeated HEAD, nor a repeated fingerprint line.
    const html = [href("pvrns2021"), href("pvrns2021"), href("pvrns2021")].join(
      "",
    );
    expect(discoverSlugs(html)).toHaveLength(1);
  });

  it("returns nothing for an index it could not read", () => {
    // ⚠ AN OUTAGE MUST NOT READ AS „every cycle disappeared". The fingerprint's own detail
    // line says so; this is the input that produces it.
    expect(discoverSlugs("")).toEqual([]);
  });
});

describe("roundUrl", () => {
  it("takes every ingested cycle's URL from the catalogue, never from the template", () => {
    // ⚠⚠ SEVEN OF TEN (cycle, round) PAIRS ARE NOT `tur{n}/export.zip`. ЦИК has used a
    // different archive name in every cycle — `el2011_t1.zip`, `export_t1.zip`,
    // `2001_prezident.zip` — and 2006 is on a DIFFERENT HOST. The first cut hard-coded the
    // template, so 2011, 2006 and 2001 recorded 404 on both rounds for ever and re-upload
    // detection was dead on three of five cycles, with the report reading healthy.
    for (const src of Object.values(PRESIDENTIAL_SOURCES))
      for (const round of [1, 2] as const) {
        const declared = src.archives[src.rounds[round].archive]?.url;
        if (!declared) continue;
        const got = roundUrl(src.slug, round);
        expect(got.url, `${src.slug} tur${round}`).toBe(declared);
        expect(got.guessedUrl, `${src.slug} tur${round}`).toBe(false);
      }
  });

  it("falls back to the template for a slug nobody has ingested, and SAYS it guessed", () => {
    // For an unknown slug there is no entry yet, so the template is all there is — and a 404
    // then means „not published yet OR published under a name we did not guess", which the
    // report must not present as a definite negative.
    const got = roundUrl("pvr2026", 1);
    expect(got.url).toBe("https://results.cik.bg/pvr2026/tur1/export.zip");
    expect(got.guessedUrl).toBe(true);
  });

  it("gives both rounds ONE url where the cycle ships one archive", () => {
    // 2016 and 2001 publish a single file covering both rounds. The fingerprint loop
    // de-duplicates on this, so a second HEAD is not issued and the report does not claim
    // two bundles where ЦИК published one.
    for (const slug of ["pvrnr2016", "prezident2001"])
      expect(roundUrl(slug, 1).url, slug).toBe(roundUrl(slug, 2).url);
    // …and the control: 2021 genuinely ships two.
    expect(roundUrl("pvrns2021", 1).url).not.toBe(roundUrl("pvrns2021", 2).url);
  });
});

describe("describe()", () => {
  const meta = (cycles: unknown) => ({
    value: "v",
    detail: "d",
    meta: { cycles },
  });
  const cycle = (over: Record<string, unknown> = {}) => ({
    slug: "pvrns2021",
    year: "2021",
    known: true,
    rounds: [
      {
        round: 1,
        url: "u1",
        guessedUrl: false,
        status: 200,
        lastModified: "A",
        contentLength: "1",
      },
      {
        round: 2,
        url: "u2",
        guessedUrl: false,
        status: 404,
        lastModified: null,
        contentLength: null,
      },
    ],
    ...over,
  });
  const run = (prev: unknown, curr: unknown) =>
    cikPresidential.describe!(prev as never, curr as never);

  it("reports a round-2 bundle appearing", () => {
    const before = meta([cycle()]);
    const after = meta([
      cycle({
        rounds: [
          cycle().rounds[0],
          { ...cycle().rounds[1], status: 200, lastModified: "B" },
        ],
      }),
    ]);
    expect(run({ meta: before.meta }, after)).toContain(
      "tur2: bundle published",
    );
  });

  it("reports a re-upload, which ЦИК does for corrected bundles", () => {
    const after = meta([
      cycle({
        rounds: [
          { ...cycle().rounds[0], lastModified: "Z" },
          cycle().rounds[1],
        ],
      }),
    ]);
    expect(run({ meta: meta([cycle()]).meta }, after)).toContain(
      "tur1: bundle re-uploaded",
    );
  });

  it("says nothing about a round whose HEAD merely failed", () => {
    // ⚠ `cikHead` returns `status: 0` on a request failure. Reading that as „withdrawn", or
    // its recovery as „published", reports an upstream event that never happened.
    const down = meta([
      cycle({
        rounds: [{ ...cycle().rounds[0], status: 0 }, cycle().rounds[1]],
      }),
    ]);
    expect(run({ meta: meta([cycle()]).meta }, down)).not.toContain("tur1");
    expect(run({ meta: down.meta }, meta([cycle()]))).not.toContain("tur1");
  });

  it("survives a persisted meta from an older shape", () => {
    // ⚠⚠ IT RUNS INSIDE THE RUNNER'S TRY AND THE CATCH SKIPS THE STATE WRITE, so one
    // unguarded read of a shape that has since changed makes this source error on EVERY run
    // and never heal. `prev` is a file a previous build wrote; both fixes in this step change
    // that shape.
    for (const bad of [
      undefined,
      {},
      { cycles: null },
      { cycles: [{ slug: "pvrns2021" }] },
      { cycles: [{ slug: "pvrns2021", rounds: "nope" }] },
    ])
      expect(() => run({ meta: bad }, meta([cycle()]))).not.toThrow();
  });

  it("names a NEW CYCLE with its year, and an already-ingested one differently", () => {
    const fresh = meta([
      cycle({ slug: "pvr2026", year: "2026", known: false }),
    ]);
    expect(run({ meta: { cycles: [] } }, fresh)).toContain(
      "pvr2026: NEW CYCLE 2026 — not ingested",
    );
    const listed = meta([cycle()]);
    expect(run({ meta: { cycles: [] } }, listed)).toContain("newly listed");
  });
});

describe("the source's declaration", () => {
  it("is its own id, not a kind on cik_results", () => {
    // ⚠ `process-watch-report` couples every `cik_results` flip to `update-persons` and
    // `db:load:person-elections:pg`, and that loader reads the PARLIAMENTARY candidate files.
    // A presidential flip routed through it stalls or skips silently (plan T7.2).
    expect(cikPresidential.id).toBe("cik_presidential");
  });

  it("probes daily, because what it watches is the PUBLISH and not the election", () => {
    // Round 1's bundle appears within days of the vote and round 2's about a week later —
    // the 2021 bundle was dated four days after election day. A five-yearly cadence would
    // sleep through the entire publication window.
    expect(cikPresidential.cadence).toBe("daily");
  });
});
