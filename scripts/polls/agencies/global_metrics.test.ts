import { afterEach, describe, expect, it } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

// The rare-posting pattern measured 2026-09-05 — mostly HR/health topics,
// with the July 2026 presidential poll as the one electoral post.
const FIXTURE = [
  {
    id: 658,
    date: "2026-07-28T15:05:54",
    link: "https://globalmetrics.eu/obshtestveni-naglasi-prezidentski-izbori-yuli-2026/",
    title: {
      rendered:
        "Обществени нагласи юли 2026: вотът за президентските избори е все още неясен",
    },
  },
  {
    id: 601,
    date: "2024-11-29T00:00:00",
    link: "https://globalmetrics.eu/hr-updates-2024-new-generation-new-rules/",
    title: { rendered: "HR UPDATES 2024: NEW GENERATION, NEW RULES" },
  },
];

describe("globalMetrics lister", () => {
  it("lists all posts (no category filter — the site posts rarely on varied topics)", async () => {
    mockFetchText({ "wp-json/wp/v2/posts": JSON.stringify(FIXTURE) });
    const { listPublications } = await import("./global_metrics");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(2);
  });

  it("classifies the presidential poll as electoral and the HR post as not", async () => {
    const { isElectoral } = await import("./global_metrics");
    const [pres, hr] = FIXTURE.map((p) => ({
      id: p.id,
      url: p.link,
      title: p.title.rendered,
      publishedAt: p.date,
      kind: "html" as const,
      attachments: [],
    }));
    expect(isElectoral(pres)).toBe(true);
    expect(isElectoral(hr)).toBe(false);
  });

  it("is registered under the GM agency id", async () => {
    const { globalMetrics } = await import("./global_metrics");
    expect(globalMetrics.agencyId).toBe("GM");
  });
});
