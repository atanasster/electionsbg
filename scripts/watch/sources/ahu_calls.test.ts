// The АХУ watcher: it fingerprints the funding competitions on the news page and nothing else,
// and refuses a page that parsed to almost nothing rather than reporting an empty register.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchText = vi.hoisted(() => vi.fn());
vi.mock("../fingerprint", async (orig) => ({
  ...(await orig<typeof import("../fingerprint")>()),
  fetchText,
}));

const { ahuCalls } = await import("./ahu_calls");

const NEWS = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../opencalls/__fixtures__/ahu_news.html",
  ),
  "utf8",
);

afterEach(() => fetchText.mockReset());

describe("ahu_calls", () => {
  it("counts the seven funding competitions, not the ~120 other news items", async () => {
    fetchText.mockResolvedValue(NEWS);
    const fp = await ahuCalls.fingerprint();
    expect((fp.meta as { keys: string[] }).keys.length).toBe(7);
  });

  it("does not move when only a non-call news item changes", async () => {
    fetchText.mockResolvedValue(NEWS);
    const a = (await ahuCalls.fingerprint()).value;
    fetchText.mockResolvedValue(
      NEWS.replace(
        '<div class="portal-news-date">',
        '<div class="portal-news-date">01.10.2026</div><a>Публикуван протокол</a></div><div class="portal-news-date">',
      ),
    );
    expect((await ahuCalls.fingerprint()).value).toBe(a);
  });

  it("throws on a page that parsed to almost nothing — a probe failure, not an empty register", async () => {
    fetchText.mockResolvedValue("<html><body>Моля изчакайте</body></html>");
    await expect(ahuCalls.fingerprint()).rejects.toThrow(/markup change/);
  });

  it("reports a new competition as new", async () => {
    fetchText.mockResolvedValue(NEWS);
    const prev = await ahuCalls.fingerprint();
    const withNew = NEWS.replace(
      '<div class="portal-news-date">',
      '<div class="portal-news-date">01.10.2026</div><a>АХУ обявява конкурс за финансиране на нов проект</a></div><div class="portal-news-date">',
    );
    fetchText.mockResolvedValue(withNew);
    const curr = await ahuCalls.fingerprint();
    expect(
      ahuCalls.describe?.(
        {
          fingerprint: prev.value,
          detail: prev.detail,
          meta: prev.meta,
          lastChecked: "x",
          lastChanged: "x",
        },
        curr,
      ),
    ).toContain("1 нови");
  });
});
