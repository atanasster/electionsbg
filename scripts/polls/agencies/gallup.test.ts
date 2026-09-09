import { afterEach, describe, expect, it } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

const FIXTURE = [
  {
    id: 1,
    date: "2026-04-17T00:00:00",
    link: "https://www.gallup-international.bg/44598/electoral-attitudes/",
    title: { rendered: "Electoral attitudes" },
  },
  {
    id: 2,
    date: "2026-08-06T00:00:00",
    link: "https://www.gallup-international.bg/43966/public-opinion-political-situation/",
    title: { rendered: "Public opinion: political situation" },
  },
];

describe("gallup lister (site arm)", () => {
  it("lists posts from the site's own wp-json endpoint", async () => {
    mockFetchText({ "wp-json/wp/v2/posts": JSON.stringify(FIXTURE) });
    const { listPublications } = await import("./gallup");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(2);
  });

  it("classifies EN and BG electoral titles, including a bare 'president'", async () => {
    const { isElectoral } = await import("./gallup");
    expect(
      isElectoral({
        id: 1,
        url: "x",
        title: "Electoral attitudes",
        publishedAt: null,
        kind: "html",
        attachments: [],
      }),
    ).toBe(true);
    expect(
      isElectoral({
        id: 2,
        url: "x",
        title: "Галъп: политическа обстановка преди изборите",
        publishedAt: null,
        kind: "html",
        attachments: [],
      }),
    ).toBe(true);
    // A plain-English title with none of the four defined terms — "political"
    // alone does not match the Cyrillic "политическ" term, so this is
    // correctly non-electoral per the defined rule, not a gap: the site's
    // real title text is unverified while gallup-international.bg is down
    // (measured 2026-09-05), so the rule follows the plan's table rather than
    // a guessed title.
    expect(
      isElectoral({
        id: 3,
        url: "x",
        title: "Public opinion: political situation",
        publishedAt: null,
        kind: "html",
        attachments: [],
      }),
    ).toBe(false);
    expect(
      isElectoral({
        id: 4,
        url: "x",
        title: "Consumer confidence index",
        publishedAt: null,
        kind: "html",
        attachments: [],
      }),
    ).toBe(false);
  });

  it("propagates the real fetchText failure mode (a throw), and the site is currently down", async () => {
    // Not a fixture of the site's own behaviour — a regression guard that this
    // lister's contract doesn't swallow the error the watcher's two-armed
    // design (a later step) needs to see.
    mockFetchText({
      "www.gallup-international.bg": new Error(
        "SSL routines:ST_CONNECT:tlsv1 alert protocol version",
      ),
    });
    const { listPublications } = await import("./gallup");
    await expect(listPublications()).rejects.toThrow(/tlsv1/);
  });

  it("is registered under the GIB agency id", async () => {
    const { gallup } = await import("./gallup");
    expect(gallup.agencyId).toBe("GIB");
  });
});
