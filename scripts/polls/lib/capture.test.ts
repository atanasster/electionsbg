import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../watch/state", () => ({ readState: vi.fn() }));
vi.mock("../agencies/trend", () => ({
  trend: { agencyId: "TR", listPublications: vi.fn(), isElectoral: vi.fn() },
}));
vi.mock("../agencies/gallup", () => ({
  gallup: { agencyId: "GIB", listPublications: vi.fn(), isElectoral: vi.fn() },
}));

import { readState } from "../../watch/state";
import { trend } from "../agencies/trend";
import { gallup } from "../agencies/gallup";
import {
  AGENCY_DIR_SLUG,
  backlogTargets,
  captureDir,
  combinedSha256,
  dirSlugFor,
  discoverPdfLinks,
  discoverSovaHarrisBulletinImages,
  latestVersionSuffix,
  nextVersionSuffix,
  parseWaybackOriginalUrl,
  pendingPressNotices,
  pendingSiteTargets,
  targetFromArchive,
  targetFromUrl,
} from "./capture";

const mockedReadState = vi.mocked(readState);
const mockedTrendList = vi.mocked(trend.listPublications);
const mockedTrendElectoral = vi.mocked(trend.isElectoral);
const mockedGallupList = vi.mocked(gallup.listPublications);
const mockedGallupElectoral = vi.mocked(gallup.isElectoral);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dirSlugFor / captureDir", () => {
  it("uses the lister module's own filename slug for site agencies", () => {
    expect(dirSlugFor("SH")).toBe("sova_harris");
    expect(dirSlugFor("AR")).toBe("alpha_research");
    expect(dirSlugFor("GIB")).toBe("gallup");
  });

  it("falls back to the lowercased registry id for press-only agencies", () => {
    expect(dirSlugFor("MD")).toBe("md");
    expect(dirSlugFor("BB")).toBe("bb");
  });

  it("falls back to lowercasing an id with no registry entry at all", () => {
    expect(dirSlugFor("ZZ")).toBe("zz");
  });

  it("builds the decision-13 directory shape", () => {
    expect(captureDir("TR", "1052")).toBe("raw_data/polls/trend/1052");
    expect(captureDir("SH", "883")).toBe("raw_data/polls/sova_harris/883");
  });

  it("every AGENCY_DIR_SLUG value is a distinct slug", () => {
    const slugs = Object.values(AGENCY_DIR_SLUG);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("pendingSiteTargets", () => {
  it("reads a site agency's own watcher state items", () => {
    mockedReadState.mockReturnValue({
      fingerprint: "12",
      detail: "d",
      meta: {
        newestId: 12,
        items: [
          {
            id: 12,
            url: "https://rctrend.bg/p/12",
            title: "T",
            publishedAt: "2026-07-01",
          },
        ],
      },
      lastChecked: "2026-09-01T00:00:00.000Z",
    });
    const targets = pendingSiteTargets("TR")!;
    expect(mockedReadState).toHaveBeenCalledWith("polls_trend");
    expect(targets).toEqual([
      {
        agencyId: "TR",
        pubId: "12",
        fetchUrl: "https://rctrend.bg/p/12",
        originalUrl: "https://rctrend.bg/p/12",
        archiveUrl: null,
        title: "T",
        publishedAt: "2026-07-01",
      },
    ]);
  });

  it("reads Gallup's SITE sub-arm specifically, not its press arm", () => {
    mockedReadState.mockReturnValue({
      fingerprint: "x",
      detail: "d",
      meta: {
        site: {
          newestId: 5,
          items: [
            {
              id: 5,
              url: "https://gallup-international.bg/p/5",
              title: "G",
              publishedAt: null,
            },
          ],
        },
        press: {
          latestMs: 1000,
          latestGuid: "g1",
          items: [
            {
              title: "press item",
              link: "https://news.google.com/x",
              guid: "g1",
              pubDate: "d",
              sourceUrl: null,
              sourceName: null,
            },
          ],
        },
      },
      lastChecked: "2026-09-01T00:00:00.000Z",
    });
    const targets = pendingSiteTargets("GIB")!;
    expect(mockedReadState).toHaveBeenCalledWith("polls_gallup");
    expect(targets).toHaveLength(1);
    expect(targets[0].pubId).toBe("5");
  });

  it("returns an empty array (not null) when the state file has no items yet", () => {
    mockedReadState.mockReturnValue(null);
    expect(pendingSiteTargets("TR")).toEqual([]);
  });

  it("returns null for a press-only agency — no fetchable watcher at all", () => {
    expect(pendingSiteTargets("MD")).toBeNull();
  });

  it("returns null for an unregistered agency id", () => {
    expect(pendingSiteTargets("ZZ")).toBeNull();
  });
});

describe("pendingPressNotices", () => {
  it("combines Gallup's press arm and every polls_press agency's items", () => {
    mockedReadState.mockImplementation((id: string) => {
      if (id === "polls_gallup")
        return {
          fingerprint: "x",
          detail: "d",
          meta: {
            site: null,
            press: {
              latestMs: 1,
              latestGuid: "g1",
              items: [
                {
                  title: "Gallup press",
                  link: "l",
                  guid: "g1",
                  pubDate: "p1",
                  sourceUrl: null,
                  sourceName: "BTV",
                },
              ],
            },
          },
          lastChecked: "2026-09-01T00:00:00.000Z",
        };
      if (id === "polls_press")
        return {
          fingerprint: "y",
          detail: "d",
          meta: {
            agencies: {
              MD: {
                latestMs: 2,
                latestGuid: "g2",
                items: [
                  {
                    title: "Mediana press",
                    link: "l2",
                    guid: "g2",
                    pubDate: "p2",
                    sourceUrl: null,
                    sourceName: null,
                  },
                ],
              },
            },
          },
          lastChecked: "2026-09-01T00:00:00.000Z",
        };
      return null;
    });
    const notices = pendingPressNotices();
    expect(notices).toEqual([
      {
        agencyId: "GIB",
        title: "Gallup press",
        sourceName: "BTV",
        guid: "g1",
        pubDate: "p1",
      },
      {
        agencyId: "MD",
        title: "Mediana press",
        sourceName: null,
        guid: "g2",
        pubDate: "p2",
      },
    ]);
  });

  it("returns an empty array when neither state file has anything", () => {
    mockedReadState.mockReturnValue(null);
    expect(pendingPressNotices()).toEqual([]);
  });
});

describe("parseWaybackOriginalUrl", () => {
  it("extracts the original URL from a Wayback snapshot address", () => {
    expect(
      parseWaybackOriginalUrl(
        "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html",
      ),
    ).toBe("https://alpharesearch.bg/post/1-x.html");
  });

  it("returns null for a non-Wayback URL", () => {
    expect(
      parseWaybackOriginalUrl("https://alpharesearch.bg/post/1-x.html"),
    ).toBeNull();
  });
});

describe("targetFromUrl / targetFromArchive", () => {
  it("derives a stable content-hash pubId for a press URL", () => {
    const t = targetFromUrl("MD", "https://btvnovinite.bg/x");
    expect(t.pubId).toMatch(/^[0-9a-f]{16}$/);
    expect(t.fetchUrl).toBe("https://btvnovinite.bg/x");
    expect(t.originalUrl).toBe("https://btvnovinite.bg/x");
    expect(t.archiveUrl).toBeNull();
    // Deterministic — the same URL always yields the same pubId, so a
    // re-run naturally lands on the same directory (the skip/version logic
    // depends on this).
    expect(targetFromUrl("MD", "https://btvnovinite.bg/x").pubId).toBe(t.pubId);
  });

  it("recovers the original URL from the Wayback URL when --url is not given", () => {
    const t = targetFromArchive(
      "AR",
      "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html",
    );
    expect(t.fetchUrl).toBe(
      "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html",
    );
    expect(t.originalUrl).toBe("https://alpharesearch.bg/post/1-x.html");
    expect(t.archiveUrl).toBe(t.fetchUrl);
  });

  it("prefers an explicit --url over the recovered one", () => {
    const t = targetFromArchive(
      "AR",
      "https://web.archive.org/web/20160101000000/https://alpharesearch.bg/post/1-x.html",
      "https://alpharesearch.bg/post/1-canonical.html",
    );
    expect(t.originalUrl).toBe(
      "https://alpharesearch.bg/post/1-canonical.html",
    );
  });

  it("takes an explicit --pub over the hash-derived one", () => {
    const t = targetFromArchive(
      "AR",
      "https://web.archive.org/web/x/https://y",
      undefined,
      "42",
    );
    expect(t.pubId).toBe("42");
  });
});

describe("discoverPdfLinks", () => {
  it("finds every distinct .pdf link, resolved absolute against the page URL", () => {
    const html = `<html><body>
      <a href="/files/report.pdf">Report</a>
      <a href="https://www.marketlinks.bg/files/report.pdf">Same one again</a>
      <a href="/files/other.pdf?v=2">Other</a>
      <a href="/files/not-a-pdf.html">Not a PDF</a>
    </body></html>`;
    const links = discoverPdfLinks(
      html,
      "https://www.marketlinks.bg/bg/news/x-1.html",
    );
    expect(links.sort()).toEqual(
      [
        "https://www.marketlinks.bg/files/report.pdf",
        "https://www.marketlinks.bg/files/other.pdf?v=2",
      ].sort(),
    );
  });

  it("returns an empty array when the page has no PDF links", () => {
    expect(
      discoverPdfLinks("<html><body>no links here</body></html>", "https://x/"),
    ).toEqual([]);
  });

  it("skips a malformed href rather than throwing", () => {
    const html = `<a href="not a url at all :::">bad</a><a href="/ok.pdf">ok</a>`;
    expect(discoverPdfLinks(html, "https://x.example/")).toEqual([
      "https://x.example/ok.pdf",
    ]);
  });
});

describe("discoverSovaHarrisBulletinImages", () => {
  it("extracts every Buletin_*_page-NNNN.jpg URL, deduplicated", () => {
    const html = `<img src="https://sovaharris.com/wp-content/Buletin_2026-07_page-0001.jpg">
      <img src="https://sovaharris.com/wp-content/Buletin_2026-07_page-0002.jpeg">
      <img src="https://sovaharris.com/wp-content/Buletin_2026-07_page-0001.jpg">
      <img src="https://sovaharris.com/wp-content/unrelated.jpg">`;
    const images = discoverSovaHarrisBulletinImages(html);
    expect(images).toEqual([
      "https://sovaharris.com/wp-content/Buletin_2026-07_page-0001.jpg",
      "https://sovaharris.com/wp-content/Buletin_2026-07_page-0002.jpeg",
    ]);
  });

  it("returns an empty array when no bulletin images are present", () => {
    expect(
      discoverSovaHarrisBulletinImages("<html>no bulletin here</html>"),
    ).toEqual([]);
  });
});

describe("combinedSha256", () => {
  it("changes when the page HTML changes", () => {
    const h1 = combinedSha256("<html>a</html>", []);
    const h2 = combinedSha256("<html>b</html>", []);
    expect(h1).not.toBe(h2);
  });

  it("changes when an attachment's bytes change, even if the page is identical", () => {
    const page = "<html>same</html>";
    const h1 = combinedSha256(page, [new Uint8Array([1, 2, 3])]);
    const h2 = combinedSha256(page, [new Uint8Array([1, 2, 4])]);
    expect(h1).not.toBe(h2);
  });

  it("is deterministic for the same inputs", () => {
    const a = combinedSha256("<html>x</html>", [new Uint8Array([9])]);
    const b = combinedSha256("<html>x</html>", [new Uint8Array([9])]);
    expect(a).toBe(b);
  });
});

describe("latestVersionSuffix / nextVersionSuffix", () => {
  it("reports no prior capture when nothing exists", () => {
    const exists = () => false;
    expect(latestVersionSuffix(exists)).toBeNull();
    expect(nextVersionSuffix(exists)).toBe("");
  });

  it("reports the base capture when only it exists", () => {
    const exists = (s: string) => s === "";
    expect(latestVersionSuffix(exists)).toBe("");
    expect(nextVersionSuffix(exists)).toBe(".v2");
  });

  it("reports the latest of several existing versions", () => {
    const present = new Set(["", ".v2", ".v3"]);
    const exists = (s: string) => present.has(s);
    expect(latestVersionSuffix(exists)).toBe(".v3");
    expect(nextVersionSuffix(exists)).toBe(".v4");
  });
});

describe("backlogTargets", () => {
  const pub = (id: number, title: string) => ({
    id,
    url: `https://x/${id}`,
    title,
    publishedAt: "2026-07-01",
    kind: "html" as const,
    attachments: [],
  });

  it("walks a site agency's OWN lister with the after filter, electoral only", async () => {
    mockedTrendList.mockResolvedValue([pub(1, "a"), pub(2, "electoral b")]);
    mockedTrendElectoral.mockImplementation((p) =>
      p.title.includes("electoral"),
    );
    const targets = await backlogTargets("TR", "2026-01-01");
    expect(mockedTrendList).toHaveBeenCalledWith({ after: "2026-01-01" });
    expect(targets).toEqual([
      {
        agencyId: "TR",
        pubId: "2",
        fetchUrl: "https://x/2",
        originalUrl: "https://x/2",
        archiveUrl: null,
        title: "electoral b",
        publishedAt: "2026-07-01",
      },
    ]);
  });

  it("walks Gallup's SITE lister (not a press query) for GIB", async () => {
    mockedGallupList.mockResolvedValue([pub(9, "electoral")]);
    mockedGallupElectoral.mockReturnValue(true);
    const targets = await backlogTargets("GIB", "2026-01-01");
    expect(mockedGallupList).toHaveBeenCalledWith({ after: "2026-01-01" });
    expect(targets).toHaveLength(1);
    expect(targets![0].agencyId).toBe("GIB");
  });

  it("returns null for a press-only agency — no lister to walk", async () => {
    expect(await backlogTargets("MD", "2026-01-01")).toBeNull();
  });
});
