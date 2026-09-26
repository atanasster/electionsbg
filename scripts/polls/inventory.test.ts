import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inventoryAgency } from "./inventory";
import { readPublicationLedger } from "./lib/publication_ledger";
import type { AgencyLister, Publication } from "./agencies/types";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "poll-inventory-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const publication: Publication = {
  id: 1,
  url: "https://example.org/survey",
  title: "Президентски избори",
  publishedAt: "2021-11-10",
  kind: "html",
  attachments: [],
};
const window = { after: "2021-01-01", before: "2021-12-31" };
const lister: AgencyLister = {
  agencyId: "TR",
  listPublications: async () => [publication],
  isElectoral: () => true,
};

describe("publication inventory", () => {
  it("retains discoveries when capture fails, and keeps a prior inventory on a listing outage", async () => {
    const first = await inventoryAgency(
      root,
      lister,
      window,
      undefined,
      async () => {
        throw new Error("download failed");
      },
    );
    expect(first.publications[0]).toMatchObject({
      status: "incomplete",
      error: "download failed",
    });
    expect(readPublicationLedger(root, "TR")[0].pubId).toBe("1");
    const retry = await inventoryAgency(
      root,
      {
        ...lister,
        listPublications: async () => {
          throw new Error("site unavailable");
        },
      },
      window,
      first,
    );
    expect(retry.listingComplete).toBe(false);
    expect(retry.publications).toEqual(first.publications);
    expect(retry.lastSuccessfulListing).toBe(first.lastSuccessfulListing);
  });

  it("reconciles existing raw evidence and retains failed attachments", async () => {
    const dir = path.join(root, "raw_data/polls/trend/1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({
        url: publication.url,
        sha256: "abc",
        fetchedAt: "2021-11-10T12:00:00Z",
        attachmentFailures: ["https://example.org/figure.pdf"],
      }),
    );
    const result = await inventoryAgency(root, lister, window);
    expect(result.publications[0].status).toBe("incomplete");
    expect(readPublicationLedger(root, "TR")[0].versions[0].capturePath).toBe(
      "raw_data/polls/trend/1",
    );
  });
});
