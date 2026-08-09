// The worksheet — the contract between the deterministic halves and the agent that reads.
//
// Everything here is a way the INSTRUCTIONS could drift from the GATE. That drift is silent and
// expensive: the model follows a rule the gate does not enforce (wasted care) or breaks one it
// does (every field rejected, looking like a model failure rather than a documentation one).

import { describe, expect, it } from "vitest";
import {
  buildWorksheet,
  CANDIDATES_SQL,
  proposalPath,
  scratchSlug,
  WORKSHEET_RULES,
  worksheetPath,
} from "./enrich_extract";
import { MIN_QUOTE_CHARS } from "./enrich_gate";
import { AUDIENCES } from "./types";

const KEY = "005e2518-07ea-410b-8995-cae8ae47f351";

describe("CANDIDATES_SQL — the queue definition", () => {
  it("is exactly the rows nothing has been written to yet", () => {
    // The queue IS `enrichment = 'none'`. That is why `--apply` must not write 'auto' on an
    // empty extraction: doing so retires a row from this set with no path back.
    expect(CANDIDATES_SQL).toContain("enrichment = 'none'");
    expect(CANDIDATES_SQL).toContain("source = 'isun'");
  });

  it("skips procedures with no documents — there is nothing to read", () => {
    expect(CANDIDATES_SQL).toContain("jsonb_array_length(docs) > 0");
  });

  it("orders by deadline, so the most urgent is enriched first", () => {
    expect(CANDIDATES_SQL).toMatch(/ORDER BY COALESCE\(closes_at/);
  });
});

describe("scratch paths", () => {
  it("the worksheet and the proposal share one sanitiser", () => {
    // Two copies of the slug meant the instructions could name a file the reader never writes
    // to — and then the gate skips the procedure for „no worksheet", blaming the wrong step.
    expect(worksheetPath(KEY)).toBe(
      proposalPath(KEY).replace(/\.json$/, ".md"),
    );
    expect(scratchSlug(KEY)).not.toContain("-");
  });

  it("the worksheet TELLS the reader the proposal path it will actually be read from", () => {
    const ws = buildWorksheet(
      { source_key: KEY, title: "T", source_url: "u", docs: [] },
      { label: "Обява", filename: "o.pdf", url: "d" },
      "текст на документа",
    );
    expect(ws).toContain(`${scratchSlug(KEY)}.json`);
  });
});

describe("the rules cannot drift from the gate", () => {
  it("states the same quote floor the gate enforces", () => {
    expect(WORKSHEET_RULES).toContain(String(MIN_QUOTE_CHARS));
  });

  it("lists exactly the audience values the schema allows", () => {
    // Four copies of this list existed. The CHECK constraint in 142 is the fourth and must be
    // SQL; this one is derived, so an added facet reaches the instructions automatically.
    for (const a of AUDIENCES) expect(WORKSHEET_RULES, a).toContain(a);
  });

  it("tells the reader the value must be stated, not just the sentence quoted", () => {
    // The gate checks both halves. A reader told only about the quote produces exactly the
    // failure the value binding was added to catch.
    expect(WORKSHEET_RULES).toMatch(/STATE the value/);
  });

  it("forbids converting a lev figure rather than omitting it", () => {
    expect(WORKSHEET_RULES).toMatch(/Do NOT convert/);
  });
});
