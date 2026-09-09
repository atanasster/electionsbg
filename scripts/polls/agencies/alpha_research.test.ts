import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

// A trimmed reproduction of the real page structure measured 2026-09-05: each
// card is an anchor wrapping an <img> with NO text, followed by a heading
// that carries the title — plus the injected spam this site is known to
// carry, absolute links to an unrelated foreign domain.
const PAGE_1 = `<html><body><div id="content">
  <div class="card">
    <a href="/post/1052-obshtestveni-naglasi-v-navecherieto.html"><img src="x.jpg"></a>
    <h3>Обществени нагласи в навечерието на 100-те дни на кабинета „Радев“</h3>
  </div>
  <div class="card">
    <a href="/post/1044-elektoralni-naglasi-na-starta.html"><img src="x.jpg"></a>
    <h3>Електорални нагласи на старта на предизборната кампания</h3>
  </div>
  <div class="card">
    <a href="/post/1047-obshtestveni-naglasi-na-finala.html"><img src="x.jpg"></a>
    <h4>Oбществени нагласи на финала на предизборната кампания</h4>
  </div>
  <div class="card">
    <a href="https://dukcapil.sumbawabaratkab.go.id/-/akun-pro-thailand/">spam</a>
    <a href="https://bkad.majenekab.go.id/-/anti-rungkad">spam2</a>
  </div>
</div></body></html>`;

const EMPTY_PAGE = `<html><body><div id="content"></div></body></html>`;

describe("alphaResearch lister", () => {
  it("extracts id, title (from the sibling heading) and null publishedAt", async () => {
    mockFetchText({ "page=1": PAGE_1, "page=2": EMPTY_PAGE });
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(3);
    expect(pubs[0]).toEqual({
      id: 1052,
      url: "https://alpharesearch.bg/post/1052-obshtestveni-naglasi-v-navecherieto.html",
      title:
        "Обществени нагласи в навечерието на 100-те дни на кабинета „Радев“",
      publishedAt: null,
      kind: "html",
      attachments: [],
    });
  });

  it("NEVER includes an injected spam link — the spam gate", async () => {
    mockFetchText({ "page=1": PAGE_1, "page=2": EMPTY_PAGE });
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications();
    for (const p of pubs) {
      expect(p.url).toContain("alpharesearch.bg");
      expect(p.url).not.toContain(".go.id");
    }
  });

  it("stops paginating once a page returns nothing, and requests no page after that", async () => {
    // Captures every URL actually fetched, so this exercises the STOP
    // condition rather than a fixture that happens to be present.
    const fetchedUrls: string[] = [];
    vi.doMock("../../watch/fingerprint", async (orig) => ({
      ...(await orig<typeof import("../../watch/fingerprint")>()),
      fetchText: async (url: string) => {
        fetchedUrls.push(url);
        if (url.includes("page=1")) return PAGE_1;
        return EMPTY_PAGE; // every page after 1 is empty in this fixture
      },
    }));
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications({ limit: 100 });
    expect(pubs).toHaveLength(3); // only page 1's three real posts
    expect(fetchedUrls).toEqual([
      "https://alpharesearch.bg/blog/?page=1",
      "https://alpharesearch.bg/blog/?page=2",
    ]);
  });

  it("classifies electoral titles per the plan's rule: 'нагласи' AND an electoral term", async () => {
    const { isElectoral } = await import("./alpha_research");
    const t = (title: string) =>
      isElectoral({
        id: 1,
        url: "x",
        title,
        publishedAt: null,
        kind: "html" as const,
        attachments: [],
      });
    // "нагласи" with no electoral term — a cabinet-approval post, not a poll.
    expect(
      t("Обществени нагласи в навечерието на 100-те дни на кабинета"),
    ).toBe(false);
    // "електорал" present.
    expect(t("Електорални нагласи на старта на предизборната кампания")).toBe(
      true,
    );
    // "избор" reached via the substring inside "предизборната".
    expect(t("Обществени нагласи на финала на предизборната кампания")).toBe(
      true,
    );
    // An electoral term with no "нагласи" at all — not a poll (e.g. a bare
    // election-day results post).
    expect(t("19 Април 2026: Избори за Народно събрание")).toBe(false);
    // Neither term present.
    expect(t("ВНИМАНИЕ! ФАЛШИВИ НОВИНИ!")).toBe(false);
  });

  it("is registered under the AR agency id", async () => {
    const { alphaResearch } = await import("./alpha_research");
    expect(alphaResearch.agencyId).toBe("AR");
  });

  it("rejects a spam link whose OWN path contains /post/ on a foreign host", async () => {
    // Unlike PAGE_1's spam cards (no /post/ in their href at all, so
    // cheerio's `a[href*='/post/']` selector never even reaches them), this
    // fixture is the harder case the spam gate exists for: an absolute link
    // to a foreign domain that happens to carry "/post/" in its own path.
    const page = `<html><body><div id="content">
      <div class="card">
        <a href="/post/2001-real-post.html"><img src="x.jpg"></a>
        <h3>Реален пост</h3>
      </div>
      <div class="card">
        <a href="https://spam.example.com/post/9999-fake.html">spam</a>
        <h3>Fake spam heading</h3>
      </div>
    </div></body></html>`;
    mockFetchText({ "page=1": page, "page=2": EMPTY_PAGE });
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(1);
    expect(pubs[0].id).toBe(2001);
    expect(pubs.some((p) => p.url.includes("spam.example.com"))).toBe(false);
  });

  it("skips a card whose heading is missing or empty", async () => {
    const page = `<html><body><div id="content">
      <div class="card">
        <a href="/post/3001-no-heading.html"><img src="x.jpg"></a>
      </div>
      <div class="card">
        <a href="/post/3002-empty-heading.html"><img src="x.jpg"></a>
        <h3>   </h3>
      </div>
      <div class="card">
        <a href="/post/3003-has-heading.html"><img src="x.jpg"></a>
        <h3>Реален пост с título</h3>
      </div>
    </div></body></html>`;
    mockFetchText({ "page=1": page, "page=2": EMPTY_PAGE });
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications();
    expect(pubs.map((p) => p.id)).toEqual([3003]);
  });

  it("dedups a repeated id appearing twice on the same page", async () => {
    const page = `<html><body><div id="content">
      <div class="card">
        <a href="/post/4001-first-link.html"><img src="x.jpg"></a>
        <h3>Първо заглавие</h3>
      </div>
      <div class="card">
        <a href="/post/4001-second-link.html"><img src="x.jpg"></a>
        <h3>Второ заглавие за същия id</h3>
      </div>
    </div></body></html>`;
    mockFetchText({ "page=1": page, "page=2": EMPTY_PAGE });
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(1);
    expect(pubs[0].id).toBe(4001);
  });

  it("never fetches past MAX_PAGES_PER_CALL even when every page keeps contributing new ids", async () => {
    const fetchedUrls: string[] = [];
    const pageHtml = (page: number) => `<html><body><div id="content">
      <div class="card">
        <a href="/post/${page * 1000}-post.html"><img src="x.jpg"></a>
        <h3>Заглавие за страница ${page}</h3>
      </div>
    </div></body></html>`;
    vi.doMock("../../watch/fingerprint", async (orig) => ({
      ...(await orig<typeof import("../../watch/fingerprint")>()),
      fetchText: async (url: string) => {
        fetchedUrls.push(url);
        const m = /page=(\d+)/.exec(url)!;
        return pageHtml(Number(m[1]));
      },
    }));
    const { listPublications } = await import("./alpha_research");
    const pubs = await listPublications({ limit: 1000 });
    expect(fetchedUrls).toHaveLength(6); // MAX_PAGES_PER_CALL, never a 7th request
    expect(pubs).toHaveLength(6);
  });
});
