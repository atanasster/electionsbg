// The „В медиите" tile (news-person-sentiment-v1 §8). What is under test is
// the refusals: no tile without a published summary, no mean or score, and a
// fetch that fails resolving to „no tile" rather than an error.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  fetchPersonMediaTone,
  mentionShardId,
  type PersonMediaTone,
} from "@/data/news/usePersonMediaTone";
import { PersonMediaToneBody } from "./PersonInTheMedia";

const tone: PersonMediaTone = {
  basis: "story",
  n: 20,
  counts: { unfavorable: 4, neutral: 14, favorable: 2 },
  outlet_count: 6,
  outlets: [{ domain: "a.bg", outlet: "А", n: 8 }],
  last_published: "2026-09-26",
  generated_at: "2026-09-27T00:00:00Z",
  news_url: "https://news.electionsbg.com/person/mp-1",
};

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("bg");
});

describe("mentionShardId", () => {
  it("mirrors the pipeline's safe_id", () => {
    expect(mentionShardId("mp-1588")).toBe("mp-1588");
    expect(mentionShardId("a/b:c")).toBe("a_b_c");
    expect(mentionShardId("..x..")).toBe("x");
    expect(mentionShardId("")).toBe("_");
  });
});

describe("fetchPersonMediaTone", () => {
  const stub = (res: Partial<Response> | Error) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        res instanceof Error ? Promise.reject(res) : Promise.resolve(res),
      ),
    );

  it("reads the tone block", async () => {
    stub({ ok: true, json: () => Promise.resolve({ tone }) });
    expect(await fetchPersonMediaTone("mp-1")).toEqual(tone);
  });

  it("a shard without a summary is no tile", async () => {
    stub({ ok: true, json: () => Promise.resolve({ articles: [] }) });
    expect(await fetchPersonMediaTone("mp-1")).toBeNull();
  });

  it("a 404 or a network failure is no tile, not an error", async () => {
    stub({ ok: false, json: () => Promise.resolve({}) });
    expect(await fetchPersonMediaTone("mp-1")).toBeNull();
    stub(new Error("offline"));
    expect(await fetchPersonMediaTone("mp-1")).toBeNull();
  });

  it("refuses a link off https", async () => {
    stub({
      ok: true,
      json: () =>
        Promise.resolve({ tone: { ...tone, news_url: "javascript:alert(1)" } }),
    });
    expect(await fetchPersonMediaTone("mp-1")).toBeNull();
  });
});

describe("PersonMediaToneBody", () => {
  it("shows the whole distribution and the link, and no score", () => {
    const { container } = render(<PersonMediaToneBody tone={tone} />);
    expect(screen.getByTestId("media-tone-bar").children).toHaveLength(3);
    expect(screen.getByRole("link").getAttribute("href")).toBe(tone.news_url);
    expect(container.textContent).toContain("А (8)");
    expect(container.textContent).toContain("по 20 материала");
    expect(container.textContent).toContain("не е оценка, класиране");
    expect(container.textContent).not.toMatch(/средн|average|mean/i);
  });

  it("links the English person page in English", async () => {
    await i18n.changeLanguage("en");
    render(<PersonMediaToneBody tone={tone} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://news.electionsbg.com/en/person/mp-1",
    );
    expect(screen.getByText(/In the media|How news outlets/)).toBeTruthy();
  });
});
