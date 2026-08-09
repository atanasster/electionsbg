// The review queue's two pure halves: recovering the document text the model was shown, and
// building the provenance blob that is the ONLY place an unreviewed figure may live.
//
// The property under test throughout is invariant 8: at `enrichment='auto'` a money value exists
// in `enrichment_meta` and NOWHERE ELSE. Everything about Stage 7's safety rests on that split,
// and both halves of it are here — what goes into the meta, and what the writer is allowed to
// put in a column (`MONEY_FIELDS`, which the writer never writes at `auto`).

import { describe, expect, it } from "vitest";
import {
  AUTO_WRITE_SQL,
  buildMeta,
  docTextFromWorksheet,
  MONEY_FIELDS,
  promoteSql,
  type Proposal,
} from "./enrich_apply";
import { buildWorksheet } from "./enrich_extract";
import { runGate } from "./enrich_gate";

const DOC = `Общият размер на помощта по процедурата е 127 000 000 евро.
Максималният интензитет на помощта е 60 % от общата стойност на проекта.
Допустими са търговци по смисъла на Търговския закон.`;

const candidate = {
  source_key: "abc-123-de45-6789",
  title: "Процедура за иновации",
  source_url:
    "https://eumis2020.government.bg/bg/s/Procedure/Info/abc-123-de45-6789",
  docs: [
    {
      label: "Обява",
      url: "https://eumis2020.government.bg/InfoDownload?fileKey=k",
    },
  ],
};

const doc = {
  label: "Обява",
  filename: "obyava.pdf",
  url: "https://x/InfoDownload?fileKey=k",
};

describe("docTextFromWorksheet", () => {
  it("round-trips the exact document text the worksheet showed", () => {
    // THE central property. The gate checks quotes against whatever this returns, so if it
    // trims, re-wraps or drops a trailing line, a perfectly good quote fails and the failure is
    // invisible — it looks like the model made the quote up.
    const ws = buildWorksheet(candidate, doc, DOC);
    expect(docTextFromWorksheet(ws)).toContain(DOC);
  });

  it("a quote that passed against the worksheet still passes after the round trip", () => {
    const ws = buildWorksheet(candidate, doc, DOC);
    const recovered = docTextFromWorksheet(ws);
    const g = runGate(
      {
        aid_rate_pct: {
          value: 60,
          quote: "Максималният интензитет на помощта е 60 %",
        },
      },
      recovered,
    );
    expect(g.rejected).toEqual([]);
    expect(g.accepted.aid_rate_pct?.value).toBe(60);
  });

  it("does NOT return the instruction block above the document", () => {
    // If the rules leaked into the checked text, a model could „quote" the instructions —
    // including the example JSON — and the gate would confirm it.
    const ws = buildWorksheet(candidate, doc, DOC);
    const recovered = docTextFromWorksheet(ws);
    expect(recovered).not.toContain("Rules — read before extracting");
    expect(recovered).not.toContain("grant_min_eur");
  });

  it("returns empty when the marker is missing rather than the whole file", () => {
    // A truncated or hand-edited worksheet must ground nothing. Returning the whole file would
    // let the instruction block serve as evidence.
    expect(
      docTextFromWorksheet("# just a heading\n\nno document section"),
    ).toBe("");
  });
});

describe("buildMeta", () => {
  const proposal: Proposal = {
    source_key: "abc-123-de45-6789",
    doc_url: doc.url,
    budget_eur: {
      value: 127_000_000,
      quote: "Общият размер на помощта по процедурата е 127 000 000 евро",
    },
    aid_rate_pct: {
      value: 60,
      quote: "Максималният интензитет на помощта е 60 %",
    },
    grant_max_eur: { value: 999, quote: "не съществува в този документ" },
  };

  it("carries the model, the timestamp and the document link", () => {
    const meta = buildMeta(
      { ...proposal, model: "m" },
      runGate(proposal, DOC),
      "2026-08-09T00:00:00Z",
    );
    expect(meta.model).toBe("m");
    expect(meta.gated_at).toBe("2026-08-09T00:00:00Z");
    expect(meta.doc_url).toBe(doc.url);
  });

  it("stores ONLY gated fields — a rejected one never reaches `values`", () => {
    // The provenance blob is what a human reads when promoting. A rejected value sitting in it
    // would be promoted along with the good ones.
    const meta = buildMeta(proposal, runGate(proposal, DOC), "t") as {
      values: Record<string, unknown>;
      quotes: Record<string, string>;
    };
    expect(meta.values.budget_eur).toBe(127_000_000);
    expect(meta.values.aid_rate_pct).toBe(60);
    expect(meta.values.grant_max_eur).toBeUndefined();
    expect(meta.quotes.grant_max_eur).toBeUndefined();
  });

  it("keeps the rejections, with their reasons", () => {
    // Discarding them leaves the next run to rediscover the same problem, and hides a document
    // (or a model) that is systematically failing.
    const meta = buildMeta(proposal, runGate(proposal, DOC), "t") as {
      rejected: { field: string; reason: string }[];
    };
    expect(meta.rejected.map((r) => r.field)).toEqual(["grant_max_eur"]);
    expect(meta.rejected[0].reason).toMatch(/not found/);
  });

  it("every quote in the meta is the verbatim span, not the value", () => {
    const meta = buildMeta(proposal, runGate(proposal, DOC), "t") as {
      quotes: Record<string, string>;
    };
    for (const [field, q] of Object.entries(meta.quotes)) {
      expect(q.length, field).toBeGreaterThan(11);
      expect(DOC).toContain(q);
    }
  });

  it("an all-rejected proposal yields empty values, not a partial write", () => {
    const bad: Proposal = {
      source_key: "x-key-0001",
      doc_url: "u",
      budget_eur: { value: 1, quote: "нищо от това не е в документа" },
    };
    const meta = buildMeta(bad, runGate(bad, DOC), "t") as {
      values: Record<string, unknown>;
      rejected: unknown[];
    };
    expect(meta.values).toEqual({});
    expect(meta.rejected).toHaveLength(1);
  });
});

describe("provenance is recorded, never invented", () => {
  const p: Proposal = {
    source_key: "abc-123-de45-6789",
    doc_url: "u",
    beneficiaries: {
      value: "търговци по смисъла на Търговския закон",
      quote: "Допустими са търговци по смисъла на Търговския закон",
    },
  };

  it("model and extracted_at are NULL when the proposal did not record them", () => {
    // Not a plausible-looking literal. This blob's whole job is to say where a number came
    // from; a guessed model name is provenance that was invented looking like provenance that
    // was observed. Only the agent that read the document knows either value.
    delete process.env.ENRICH_MODEL;
    const meta = buildMeta(p, runGate(p, DOC), "2026-08-09T00:00:00Z");
    expect(meta.model).toBeNull();
    expect(meta.extracted_at).toBeNull();
  });

  it("gated_at is always stamped — it IS observed here", () => {
    const meta = buildMeta(p, runGate(p, DOC), "2026-08-09T00:00:00Z");
    expect(meta.gated_at).toBe("2026-08-09T00:00:00Z");
  });

  it("a proposal that DID record them keeps its own values", () => {
    const meta = buildMeta(
      { ...p, model: "claude-opus-5", extracted_at: "2026-08-01T10:00:00Z" },
      runGate(p, DOC),
      "2026-08-09T00:00:00Z",
    );
    expect(meta.model).toBe("claude-opus-5");
    expect(meta.extracted_at).toBe("2026-08-01T10:00:00Z");
  });
});

describe("the two write statements", () => {
  it("the `auto` write is scoped to the FULL unique key, not source_key alone", () => {
    // `(source, source_key)` is the unique constraint. Keyed on source_key alone, a ДФЗ row
    // sharing a key shape would be silently overwritten by an ИСУН extraction.
    expect(AUTO_WRITE_SQL).toContain("source = 'isun'");
    expect(AUTO_WRITE_SQL).toContain("source_key = $1");
  });

  it("the `auto` write refuses to overwrite an existing provenance", () => {
    expect(AUTO_WRITE_SQL).toContain("enrichment = 'none'");
  });

  it("the `auto` write touches NO money column — invariant 8, in the SQL", () => {
    // The CHECK would reject it, but a rejection aborts the run; not emitting it is better.
    const setClause = AUTO_WRITE_SQL.slice(
      AUTO_WRITE_SQL.indexOf("SET"),
      AUTO_WRITE_SQL.indexOf("WHERE"),
    );
    for (const f of MONEY_FIELDS) expect(setClause, f).not.toContain(f);
  });

  it("both writes RETURN, so the caller counts writes that happened", () => {
    // Without this, „stored 6" was reachable with zero rows updated.
    expect(AUTO_WRITE_SQL).toContain("RETURNING source_key");
    expect(promoteSql(["budget_eur"])).toContain("RETURNING source_key");
  });

  it("promotion is guarded on 'auto', so it is idempotent and cannot clobber 'source'", () => {
    const sql = promoteSql(["budget_eur", "aid_rate_pct"]);
    expect(sql).toContain("enrichment = 'auto'");
    expect(sql).toContain("source = 'isun'");
    expect(sql).toContain(
      "SET enrichment = 'reviewed', budget_eur = $2, aid_rate_pct = $3",
    );
  });

  it("promotion with nothing to release still writes only the flag", () => {
    // No trailing comma, no empty assignment — this is the beneficiaries-only outcome.
    expect(promoteSql([])).toContain("SET enrichment = 'reviewed'\n");
  });
});

describe("invariant 8 — the columns `auto` may not touch", () => {
  it("names exactly the four the migration's CHECK constraint guards", () => {
    // If a fifth money column is ever added to 142, this list must grow with it or the writer
    // will happily fill it at `auto` — the constraint would catch a direct write, but the
    // promotion path reads THIS list to decide what to copy.
    expect([...MONEY_FIELDS]).toEqual([
      "budget_eur",
      "aid_rate_pct",
      "grant_min_eur",
      "grant_max_eur",
    ]);
  });

  it("beneficiaries is deliberately NOT among them — it is the one thing `auto` publishes", () => {
    // Verbatim, gate-checked, not sortable. Per the plan: „auto may render its verbatim quote
    // plus the document link".
    expect(MONEY_FIELDS as readonly string[]).not.toContain("beneficiaries");
    expect(MONEY_FIELDS as readonly string[]).not.toContain("audience");
  });
});
