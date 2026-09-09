import { afterEach, describe, expect, it, vi } from "vitest";
import { resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

const FIXTURE = [
  {
    id: 1712,
    date: "2026-04-17T00:00:00",
    link: "https://myara.bg/election-formula-5-1-2-1712/",
    title: { rendered: "Изборите: потенциална формула 5+1+2" },
  },
  {
    id: 1681,
    date: "2026-03-20T00:00:00",
    link: "https://myara.bg/electoral-snapshot-march-2026-1681/",
    title: {
      rendered: "Моментна картина на електоралните нагласи към средата на март",
    },
  },
];

describe("myara lister", () => {
  it("lists using the two fixed electoral-category ids, BG and EN", async () => {
    let capturedUrl = "";
    vi.doMock("../../watch/fingerprint", async (orig) => ({
      ...(await orig<typeof import("../../watch/fingerprint")>()),
      fetchText: async (url: string) => {
        capturedUrl = url;
        return JSON.stringify(FIXTURE);
      },
    }));
    const { listPublications } = await import("./myara");
    const pubs = await listPublications();
    expect(capturedUrl).toContain("categories=98%2C114");
    expect(pubs).toHaveLength(2);
    expect(pubs[0].id).toBe(1712);
  });

  it("classifies every post in the scoped categories as electoral", async () => {
    const { isElectoral } = await import("./myara");
    // The category scoping itself IS the electoral filter — a post about
    // anything else never reaches this lister's own list, so the predicate is
    // unconditional true for whatever it is handed.
    expect(
      isElectoral({
        id: 1,
        url: "x",
        title: "Мнозинството в НС",
        publishedAt: null,
        kind: "html",
        attachments: [],
      }),
    ).toBe(true);
  });

  it("is registered under the MY agency id", async () => {
    const { myara } = await import("./myara");
    expect(myara.agencyId).toBe("MY");
  });
});
