import { afterEach, describe, expect, it } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

// A trimmed reproduction of the real listing structure measured 2026-09-05:
// each item is THREE anchors to the SAME href — a bare-date one, the
// title-bearing one, and a "Повече" read-more link.
const item = (href: string, date: string, title: string) => `
  <div class="item">
    <a href="${href}">${date}</a>
    <a href="${href}">${title}</a>
    <a href="${href}">Повече</a>
  </div>`;

const LISTING = `<html><body>
  <a href="/bg/news/category4.html">Нови изследвания и анализи</a>
  ${item(
    "/bg/news/obshtestvenopoliticheski-naglasi-yuli-2026-118.html",
    "23.07.2026",
    "Обществено–политически нагласи - Юли 2026",
  )}
  ${item(
    "/bg/news/pozitsiya-na-market-links-otnosno-priziva-115.html",
    "19.04.2026",
    "Позиция на „Маркет Линкс“ относно призива на Обществения съвет към ЦИК",
  )}
  ${item(
    "/bg/news/analiz-ot-natsionalno-prouchvane-111.html",
    "16.02.2026",
    "Анализ от национално проучване на социално-политическите нагласи на българите",
  )}
</body></html>`;

describe("marketLinks lister", () => {
  it("groups the three per-item anchors and picks the title by elimination", async () => {
    mockFetchText({ "news.html": LISTING });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications();
    expect(pubs).toHaveLength(3);
    const july = pubs.find((p) => p.id === 118)!;
    expect(july).toEqual({
      id: 118,
      url: "https://www.marketlinks.bg/bg/news/obshtestvenopoliticheski-naglasi-yuli-2026-118.html",
      title: "Обществено–политически нагласи - Юли 2026",
      publishedAt: "2026-07-23",
      kind: "pdf",
      attachments: [],
    });
  });

  it("excludes the category listing links (no trailing -<id> before .html)", async () => {
    mockFetchText({ "news.html": LISTING });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications();
    expect(pubs.some((p) => p.url.includes("category4"))).toBe(false);
  });

  it("sorts newest id first", async () => {
    mockFetchText({ "news.html": LISTING });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications();
    expect(pubs.map((p) => p.id)).toEqual([118, 115, 111]);
  });

  it("classifies the two real forms of the electoral title rule", async () => {
    const { isElectoral } = await import("./market_links");
    const t = (title: string) =>
      isElectoral({
        id: 1,
        url: "x",
        title,
        publishedAt: null,
        kind: "pdf" as const,
        attachments: [],
      });
    expect(t("Обществено–политически нагласи - Юли 2026")).toBe(true);
    expect(
      t(
        "Анализ от национално проучване на социално-политическите нагласи на българите",
      ),
    ).toBe(true);
    expect(
      t(
        "Позиция на „Маркет Линкс“ относно призива на Обществения съвет към ЦИК",
      ),
    ).toBe(false);
  });

  it("is registered under the ML agency id", async () => {
    const { marketLinks } = await import("./market_links");
    expect(marketLinks.agencyId).toBe("ML");
  });

  it("skips a group whose only texts are the date and the read-more link", async () => {
    const noTitleListing = `<html><body>
      <div class="item">
        <a href="/bg/news/date-only-120.html">23.07.2026</a>
        <a href="/bg/news/date-only-120.html">Повече</a>
      </div>
      ${item(
        "/bg/news/analiz-ot-natsionalno-prouchvane-111.html",
        "16.02.2026",
        "Анализ от национално проучване на социално-политическите нагласи на българите",
      )}
    </body></html>`;
    mockFetchText({ "news.html": noTitleListing });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications();
    expect(pubs.map((p) => p.id)).toEqual([111]);
  });

  it("honors opts.limit by slicing the newest-first list", async () => {
    mockFetchText({ "news.html": LISTING });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications({ limit: 2 });
    expect(pubs.map((p) => p.id)).toEqual([118, 115]);
  });

  it("parses a single-digit day and month", async () => {
    const singleDigitListing = `<html><body>
      ${item(
        "/bg/news/obshtestvenopoliticheski-naglasi-yuli-2026-118.html",
        "5.7.2026",
        "Обществено–политически нагласи - Юли 2026",
      )}
    </body></html>`;
    mockFetchText({ "news.html": singleDigitListing });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications();
    expect(pubs[0].publishedAt).toBe("2026-07-05");
  });

  it("honors opts.after / opts.before, excluding items with no known date", async () => {
    const withUndated = `<html><body>
      ${item(
        "/bg/news/obshtestvenopoliticheski-naglasi-yuli-2026-118.html",
        "23.07.2026",
        "Обществено–политически нагласи - Юли 2026",
      )}
      ${item(
        "/bg/news/analiz-ot-natsionalno-prouchvane-111.html",
        "16.02.2026",
        "Анализ от национално проучване на социално-политическите нагласи на българите",
      )}
      <div class="item">
        <a href="/bg/news/undated-105.html">Повече</a>
        <a href="/bg/news/undated-105.html">Заглавие без дата</a>
      </div>
    </body></html>`;
    mockFetchText({ "news.html": withUndated });
    const { listPublications } = await import("./market_links");
    const pubs = await listPublications({ after: "2026-03-01" });
    expect(pubs.map((p) => p.id)).toEqual([118]);
  });
});
