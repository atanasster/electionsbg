// Staleness gate for the published risk-flag spec.
//
// The handbook and public/risk-flags.json are GENERATED from
// src/lib/riskFlagCatalog.ts. Generated-and-committed is the right shape here —
// a reader following a link needs the document to exist in the repo, and the
// build must not rewrite tracked files — but it has one failure mode: somebody
// changes the catalogue, does not re-run the generator, and the published spec
// quietly starts describing a flag set that is no longer the one being computed.
// That is worse than the drift the catalogue was created to end, because the
// document is the copy people quote.
//
// So: `npm run gen:risk -- --check` exits non-zero when either artifact is stale,
// and this runs it. Same shape as gen_sql/shlyo_query_fold.test.ts.
//
// The content assertions below are NOT a second copy of the generator. They pin
// the handful of statements that must survive any rewrite of it — the ones whose
// absence would make the spec misleading rather than merely different.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import OCP_FIXTURE_RAW from "./__fixtures__/ocp_2024_flags.json";

/** The fixture, widened for lookup by an arbitrary id string. The JSON import
 *  types `flags` as an exact 73-key object, so indexing it with a variable is a
 *  type error — and the whole point here is to look up ids that might NOT be in
 *  it. */
const OCP_FIXTURE = OCP_FIXTURE_RAW as unknown as {
  flags: Record<string, string | undefined>;
};
import {
  ALIGNMENT_SOURCES,
  AWARDER_EXPOSURE_LIST,
  CATALOG_VERSION,
  CONCENTRATION_MIN_AWARDER_TOTAL_EUR,
  CONTRACT_FLAG_LIST,
  FIRED_COUNT_DISTRIBUTION,
  RISK_MASK_BITS,
  TENDER_FLAG_LIST,
  contractThreshold,
  tenderThreshold,
} from "../../src/lib/riskFlagCatalog";

const ROOT = path.resolve(__dirname, "../..");
const HANDBOOK = path.join(ROOT, "docs/methodology/procurement-risk-flags.md");
const JSON_OUT = path.join(ROOT, "public/risk-flags.json");

const handbook = fs.readFileSync(HANDBOOK, "utf8");

/** Parse the committed catalogue, turning the one confusing failure mode into an
 *  instruction.
 *
 *  The staleness tests below MUTATE the committed artifacts and restore them in a
 *  `finally`. That covers an assertion failure, but not the process being killed
 *  mid-test — a Ctrl-C or a timeout leaves a trailing "MUTATED" line on disk, and
 *  the next run then dies with a bare `SyntaxError … at position 24199` that says
 *  nothing about why. */
const readCatalogue = (): unknown => {
  const raw = fs.readFileSync(JSON_OUT, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${JSON_OUT} is not valid JSON. A previous run of this file's staleness ` +
        "test was almost certainly interrupted while the artifact was mutated. " +
        "Run `npm run gen:risk` to restore it.\n" +
        String(e),
    );
  }
};

const catalogue = readCatalogue() as {
  version: string;
  bitOrder: string[];
  contractFlags: {
    id: string;
    legacyWeight: number;
    baseRate: string | null;
    ocp: { id: string | null; note: string };
    imonitor: { id: string | null; note: string };
  }[];
  tenderFlags: {
    id: string;
    ocp: { id: string | null; note: string };
    imonitor: { id: string | null; note: string };
  }[];
  contractIndex: { weighted: boolean };
  exposureGrades: {
    awarder: { key: string }[];
    supplier: { key: string }[];
    supplierOpenQuestion: string;
  };
};

describe("the published spec is current", () => {
  test("`gen:risk --check` passes", () => {
    // Fails the moment the catalogue moves without the generator being re-run.
    expect(() =>
      execFileSync("npx", ["tsx", "scripts/risk/gen_risk.ts", "--check"], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  }, 60_000);

  // BOTH artifacts, separately.
  //
  // Mutating only the JSON leaves a gate that would still pass if the handbook
  // were dropped from the generator's OUTPUTS entirely — the failure that matters
  // most, since the handbook is the document people quote.
  test.each([
    ["risk-flags.json", JSON_OUT],
    ["the handbook", HANDBOOK],
  ])(
    "the gate detects staleness in %s",
    (_label, file) => {
      const original = fs.readFileSync(file, "utf8");
      try {
        fs.writeFileSync(file, `${original}\nMUTATED\n`);
        expect(() =>
          execFileSync("npx", ["tsx", "scripts/risk/gen_risk.ts", "--check"], {
            cwd: ROOT,
            stdio: "pipe",
          }),
        ).toThrow();
      } finally {
        fs.writeFileSync(file, original);
      }
    },
    60_000,
  );
});

describe("risk-flags.json is a faithful catalogue", () => {
  test("version and flag sets match the source", () => {
    expect(catalogue.version).toBe(CATALOG_VERSION);
    expect(catalogue.bitOrder).toEqual([...RISK_MASK_BITS]);
    expect(catalogue.contractFlags.map((f) => f.id)).toEqual(
      CONTRACT_FLAG_LIST.map((f) => f.id),
    );
    expect(catalogue.tenderFlags.map((f) => f.id)).toEqual(
      TENDER_FLAG_LIST.map((f) => f.id),
    );
  });

  test("the index declares itself UNWEIGHTED", () => {
    // The one field most likely to be misread by a machine consumer: the flags
    // carry weights, and the index does not use them.
    expect(catalogue.contractIndex.weighted).toBe(false);
  });

  test("the two exposure weight sets are published separately", () => {
    expect(catalogue.exposureGrades.awarder.map((c) => c.key)).toContain(
      "upheldAppeal",
    );
    expect(catalogue.exposureGrades.supplier.map((c) => c.key)).not.toContain(
      "upheldAppeal",
    );
    expect(catalogue.exposureGrades.supplierOpenQuestion).toMatch(/undecided/i);
  });
});

describe("the OCP / iMonitor alignment", () => {
  // The plan made verification the deliverable of this tier for a reason: an
  // alignment table is the first artifact an OCP or TI reader checks, and a
  // plausible-looking wrong id discredits every mapping beside it. The plan's own
  // first draft guessed two ids and both were wrong.

  test("every flag declares a decision for BOTH schemes", () => {
    // An absent mapping is not the same as `unmapped`. The required field forces
    // this at compile time; asserting it here catches a mapping hollowed out to
    // an empty note.
    for (const f of [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST])
      for (const scheme of ["ocp", "imonitor"] as const) {
        expect(f[scheme], `${f.id}.${scheme}`).toBeTruthy();
        expect(
          f[scheme].note.trim().length,
          `${f.id}.${scheme} has no note — a mapping with no stated difference ` +
            "reads as a claim of equivalence, and none of these are equivalent",
        ).toBeGreaterThan(20);
      }
  });

  test("every OCP id EXISTS in the published flag list, with the title we cite", () => {
    // The fixture is the 73 flags verbatim from the source PDF, committed so this
    // is a test run rather than a manual re-read. That distinction is not
    // academic: three false claims about what these flags SAY survived a green
    // suite precisely because nothing here could check them.
    expect(Object.keys(OCP_FIXTURE.flags).length).toBe(
      ALIGNMENT_SOURCES.ocp.flagCount,
    );
    for (const f of [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST]) {
      const id = f.ocp.id;
      if (id === null) continue;
      const title = OCP_FIXTURE.flags[id];
      expect(
        title,
        `${f.id} cites ${id}, which is not a published flag`,
      ).toBeTruthy();
      // The name we publish beside the id must be the source's own wording — a
      // paraphrase drifts into a claim about a flag that says something else.
      if (f.ocp.name) expect(f.ocp.name, `${f.id} → ${id}`).toBe(title);
    }
  });

  test("any OCP flag NAMED in a note is a real flag", () => {
    // The notes reference neighbouring flags to explain a difference (R011, R014,
    // R019, R031, R045, R048, R049, R050, R059, R062 …). A wrong id there is as
    // misleading as a wrong mapping, and is exactly where the false claims sat.
    const cited = new Set<string>();
    for (const f of [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST])
      for (const m of f.ocp.note.matchAll(/\bR\d{3}\b/g)) cited.add(m[0]);
    expect(
      cited.size,
      "no cross-references at all — the notes got thinner",
    ).toBeGreaterThan(5);
    for (const id of cited)
      expect(
        OCP_FIXTURE.flags[id],
        `a note cites ${id}, which is not one of the ${ALIGNMENT_SOURCES.ocp.flagCount} published flags`,
      ).toBeTruthy();
  });

  test("ids look like OCP ids and sit inside the published range", () => {
    for (const f of [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST]) {
      const id = f.ocp.id;
      if (id === null) continue;
      expect(id, `${f.id}: '${id}' is not an R-id`).toMatch(/^R\d{3}$/);
      expect(
        Number(id.slice(1)),
        `${f.id}: R-id outside the ${ALIGNMENT_SOURCES.ocp.flagCount} published flags`,
      ).toBeLessThanOrEqual(ALIGNMENT_SOURCES.ocp.flagCount);
    }
  });

  test("the CORRECTED mappings are the ones published", () => {
    // Pinned deliberately: these two are the errors verification found, and a
    // silent regression to the guess would be invisible in a table this size.
    const byId = Object.fromEntries(
      [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST].map((f) => [f.id, f]),
    );
    // splitPurchase is R055 (MULTIPLE direct awards around the threshold), not
    // R049 (a SINGLE direct award below it, which is nearer our directAward).
    expect(byId.splitPurchase.ocp.id).toBe("R055");
    // awardOverEstimate compares against the procedure's OWN estimate (R031),
    // not against the category average (R016).
    expect(byId.awardOverEstimate.ocp.id).toBe("R031");
  });

  test("the sources record how they were verified", () => {
    for (const src of [ALIGNMENT_SOURCES.ocp, ALIGNMENT_SOURCES.imonitor]) {
      expect(src.url).toMatch(/^https:\/\//);
      expect(src.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(src.method.length).toBeGreaterThan(30);
    }
  });

  test("the handbook publishes both tables, the sources and the unmapped rule", () => {
    expect(handbook).toContain("## Alignment with OCP and iMonitor");
    expect(handbook).toContain(ALIGNMENT_SOURCES.ocp.url);
    expect(handbook).toContain(ALIGNMENT_SOURCES.imonitor.url);
    expect(handbook).toContain("**unmapped**");
    expect(handbook).toMatch(
      /somebody read the source and found no equivalent/,
    );
  });

  test("the JSON carries the alignment for a machine consumer", () => {
    const flags = [...catalogue.contractFlags, ...catalogue.tenderFlags];
    expect(flags.length).toBe(
      CONTRACT_FLAG_LIST.length + TENDER_FLAG_LIST.length,
    );
    for (const f of flags) {
      expect(f.ocp, `${f.id}.ocp`).toBeTruthy();
      expect(f.imonitor, `${f.id}.imonitor`).toBeTruthy();
    }
  });
});

describe("the handbook keeps the statements that make it honest", () => {
  test("it carries the a/b/c framing, and does NOT claim it is an order of likelihood", () => {
    expect(handbook).toMatch(/not at all illicit or suboptimal/);
    expect(handbook).toMatch(/presentation order/i);
    expect(handbook).not.toMatch(/order of likelihood/i);
  });

  test("it says the flags are not findings of wrongdoing", () => {
    expect(handbook).toMatch(/not (a )?findings? of wrongdoing/i);
  });

  test("it states the availability rule for the CRI denominator", () => {
    expect(handbook).toMatch(/never scored 0|never scored zero/i);
  });

  test("it publishes the version-stamp caveat", () => {
    // Without this a reader cites the number at the top of the document, which
    // is the code's version and not the served masks'.
    expect(handbook).toMatch(/not stamped/);
    expect(handbook).toMatch(/risk-catalog-version/);
  });

  test("it publishes the known limits, including the negative validation result", () => {
    expect(handbook).toMatch(/Decarolis/);
    expect(handbook).toMatch(/Goodhart/);
  });

  test("it distinguishes the two rushed-window thresholds, at the CURRENT values", () => {
    // Derived, not pinned. A literal here would keep passing after a threshold
    // changed — cementing a stale number in the one document people quote, which
    // is worse than not asserting it at all.
    const contractDays = contractThreshold("shortTenderPeriod");
    const tenderDays = tenderThreshold("rushedDeadline");
    expect(contractDays, "the two must not be the same number").not.toBe(
      tenderDays,
    );
    expect(handbook).toContain(`${contractDays}-day cut`);
    expect(handbook).toContain(
      `${tenderDays} days, because on low-value tiers`,
    );
  });

  test("the numbers it states are the catalogue's, not frozen literals", () => {
    const total = AWARDER_EXPOSURE_LIST.reduce((t, c) => t + c.weight, 0);
    expect(handbook).toContain(total.toFixed(2));
    expect(handbook).toContain(FIRED_COUNT_DISTRIBUTION[0].share);
    expect(handbook).toContain(
      `€${CONCENTRATION_MIN_AWARDER_TOTAL_EUR.toLocaleString("en-US")}`,
    );
    for (const c of AWARDER_EXPOSURE_LIST)
      expect(handbook, `buyer weight ${c.key}`).toContain(
        `| \`${c.key}\` | ${c.weight} |`,
      );
  });

  test("every declared caveat is published", () => {
    // The caveats are the half a sales document would omit: a check that is
    // currently inert, a threshold the project's own methodology calls
    // uncalibrated, a flag whose direction is unsettled.
    const withCaveats = [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST].filter(
      (f) => f.caveat,
    );
    expect(withCaveats.length, "no caveats declared at all").toBeGreaterThan(0);
    for (const f of withCaveats)
      expect(handbook, `${f.id}'s caveat is missing`).toContain(f.caveat!);
  });

  test("it discloses that shortTenderPeriod is currently inert", () => {
    // Measured 0 of 20,000 sampled contracts. Publishing it as one of thirteen
    // live checks without saying so overstates what the index evaluates.
    expect(handbook).toMatch(/CURRENTLY INERT/);
  });

  test("it names the supplier arm's open question rather than inventing a rationale", () => {
    expect(handbook).toMatch(/Open question/i);
    expect(handbook).toMatch(/has not been\s+decided|under review/i);
  });

  test("every flag id appears", () => {
    for (const f of [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST])
      expect(handbook, `${f.id} missing from the handbook`).toContain(
        `\`${f.id}\``,
      );
  });

  test("no flag's weight is presented in the per-flag table", () => {
    // Weights are in the JSON, labelled legacy. Putting them in the reference
    // table invites a reader to reproduce a weighted index we do not publish.
    // The TABLE ROWS only — the prose beneath it deliberately explains why the
    // weights are absent, so slicing to the next heading would match its own
    // explanation and make this assertion unfailable.
    const rows = handbook
      .slice(
        handbook.indexOf("| flag | bit |"),
        handbook.indexOf("#### Threshold provenance"),
      )
      .split("\n")
      .filter((l) => l.startsWith("|"));
    expect(rows.length, "per-flag table rows").toBeGreaterThan(
      CONTRACT_FLAG_LIST.length,
    );
    expect(rows.join("\n")).not.toMatch(/weight/i);
  });
});
