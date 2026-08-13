// The document-index merge, and the corpus invariant it exists to hold.
//
// `mergeDocuments` is keyed on `id`, so a change to how an id is MINTED strands
// the old id in the committed file for ever: nothing mints it again, so nothing
// ever revisits it, and every renamed document survives twice. That is not
// hypothetical — until this prune shipped, 15 of documents.json's 48 records
// were the same 15 execution reports a second time, under the pre-
// `canonicalExecutionAdminId` slug minted from the ministry's definite-article
// label („Министерството на …" → `exec-admin-ministerstvoto-na-…`) beside the
// `exec-admin-ministerstvo-na-…` the builder mints today. Same title, same URL,
// same date; only the id differed, so every consumer counting documents
// over-counted by 45% and `/budget/law` listed FY2024's 11 documents as 19.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildConfigDocuments, mergeDocuments } from "./documents";
import type { BudgetDocument, BudgetDocumentsFile } from "./types";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const doc = (over: Partial<BudgetDocument> & { id: string }): BudgetDocument =>
  ({
    kind: "execution-report",
    fiscalYear: 2024,
    seq: 0,
    title: "Отчет",
    sources: [],
    discovery: "auto-confirmed",
    ...over,
  }) as BudgetDocument;

describe("mergeDocuments", () => {
  it("drops a machine-derived record the build no longer mints", () => {
    const merged = mergeDocuments(
      [doc({ id: "exec-admin-ministerstvoto-na-zemedelieto-2024" })],
      [doc({ id: "exec-admin-ministerstvo-na-zemedelieto-2024" })],
    );
    expect(merged.map((d) => d.id)).toEqual([
      "exec-admin-ministerstvo-na-zemedelieto-2024",
    ]);
  });

  it("never prunes a kind this build produced nothing for", () => {
    // The guard that matters most: an empty config, or a builder that threw
    // before contributing, must not retire a whole family. Same refusal the
    // budget loader's shrink floor makes one layer down.
    const previous = [
      doc({ id: "exec-a-2024" }),
      doc({ id: "amendment-2024-1", kind: "amendment" }),
    ];
    const merged = mergeDocuments(previous, [
      doc({ id: "amendment-2024-1", kind: "amendment" }),
    ]);
    expect(merged.map((d) => d.id).sort()).toEqual([
      "amendment-2024-1",
      "exec-a-2024",
    ]);
  });

  it("keeps a curated record even when the build no longer mints it", () => {
    const merged = mergeDocuments(
      [
        doc({ id: "exec-hand-keyed-2024", discovery: "manual" }),
        doc({ id: "exec-stale-2024" }),
      ],
      [doc({ id: "exec-fresh-2024" })],
    );
    expect(merged.map((d) => d.id).sort()).toEqual([
      "exec-fresh-2024",
      "exec-hand-keyed-2024",
    ]);
  });

  it("leaves the network-derived kinds alone", () => {
    // `law` is enumerated from the fetched КФП resources, `audit-report` from a
    // best-effort scrape that yields [] on any structural surprise, `kfp-feed`
    // only when the feed parsed. Pruning those turns a fetch failure into a
    // silent retraction, so absence there means "not seen", never "retired".
    const previous = [
      doc({ id: "law-2019", kind: "law" }),
      doc({ id: "audit-2019", kind: "audit-report" }),
      doc({ id: "kfp-feed", kind: "kfp-feed", fiscalYear: null }),
    ];
    expect(
      mergeDocuments(previous, [])
        .map((d) => d.id)
        .sort(),
    ).toEqual(["audit-2019", "kfp-feed", "law-2019"]);
  });
});

describe("the committed document corpus", () => {
  const corpus: BudgetDocumentsFile = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "data/budget/documents.json"), "utf8"),
  );

  it("carries each document exactly once", () => {
    // The invariant `/budget/law` used to restore at DISPLAY time. Holding it
    // HERE is what makes it true for every other consumer of the corpus —
    // `budget_document`, the hub ledger's documentCount figures, and the OGP
    // coverage score, none of which dedupe.
    const byIdentity = new Map<string, string[]>();
    for (const d of corpus.documents) {
      const key = [
        d.title,
        d.sources?.[0]?.url ?? "",
        d.promulgationDate ?? d.reportDate ?? "",
      ].join("|");
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), d.id]);
    }
    const dupes = [...byIdentity.entries()].filter(([, ids]) => ids.length > 1);
    expect(dupes).toEqual([]);
  });

  it("mints every execution-report id off the article-stripped ministry slug", () => {
    // The specific divergence that produced the duplicates. `admin-
    // ministerstvoto-na-…` is the law parser's orphan spelling; anything
    // reaching the corpus under it has skipped canonicalExecutionAdminId.
    const wrong = [...corpus.documents, ...buildConfigDocuments()]
      .map((d) => d.id)
      .filter((id) => id.includes("ministerstvoto-na-"));
    expect(wrong).toEqual([]);
  });
});
