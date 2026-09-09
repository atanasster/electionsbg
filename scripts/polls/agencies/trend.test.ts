import { afterEach, describe, expect, it } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

// The 25-newest project listing measured 2026-09-05 (titles only, trimmed).
const FIXTURE = [
  {
    id: 212891,
    date: "2026-06-30T10:54:45",
    link: "https://rctrend.bg/project/upotreba-na-narkotichni-veshtestva-yuni-2026/",
    title: { rendered: "Употреба на наркотични вещества (юни 2026)" },
  },
  {
    id: 212680,
    date: "2026-03-18T00:00:00",
    link: "https://rctrend.bg/project/212680/",
    title: {
      rendered:
        "Нагласи към системата на здравеопазването в България (февруари 2026)",
    },
  },
  {
    id: 212809,
    date: "2026-05-27T12:04:02",
    link: "https://rctrend.bg/project/obshtestveni-naglasi-spryamo-osnovnite-5/",
    title: {
      rendered:
        "Обществени нагласи спрямо основните институции, партии и актуални теми (май 2026)",
    },
  },
  {
    id: 212656,
    date: "2026-04-16T00:00:00",
    link: "https://rctrend.bg/project/elektoralni-naglasi-spryamo-predstoya-3/",
    title: {
      rendered:
        "Електорални нагласи спрямо предстоящите парламентарни избори (Април 2026)",
    },
  },
];

describe("trend lister", () => {
  it("lists publications from the custom project post type", async () => {
    mockFetchText({ "wp-json/wp/v2/project": JSON.stringify(FIXTURE) });
    const { listPublications } = await import("./trend");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(4);
    expect(pubs[0].id).toBe(212891);
    expect(pubs[3].title).toBe(
      "Електорални нагласи спрямо предстоящите парламентарни избори (Април 2026)",
    );
  });

  it("classifies electoral titles correctly, including the party-support monthly", async () => {
    const { isElectoral } = await import("./trend");
    const [drugs, health, monthly, electoral] = FIXTURE.map((p) => ({
      ...p,
      title: p.title.rendered,
      url: p.link,
      publishedAt: p.date,
      kind: "html" as const,
      attachments: [],
    }));
    expect(isElectoral(drugs)).toBe(false);
    expect(isElectoral(health)).toBe(false);
    // The monthly institutions/economy tracker matches on "партии" — it also
    // carries party support figures, deliberately included per the module
    // header.
    expect(isElectoral(monthly)).toBe(true);
    expect(isElectoral(electoral)).toBe(true);
  });

  it("is registered under the TR agency id", async () => {
    const { trend } = await import("./trend");
    expect(trend.agencyId).toBe("TR");
  });
});
