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
import {
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
const catalogue = JSON.parse(fs.readFileSync(JSON_OUT, "utf8")) as {
  version: string;
  bitOrder: string[];
  contractFlags: {
    id: string;
    legacyWeight: number;
    baseRate: string | null;
  }[];
  tenderFlags: { id: string }[];
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
