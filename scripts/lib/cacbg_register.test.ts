// Unit tests for the cacbg register year discovery. No network — the fetcher
// is injected. Runs in the `node` Vitest project (see docs/testing-standards.md).

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  REGISTER_ROOT,
  parseRegisterYears,
  latestRegisterYear,
  __resetRegisterYearCache,
} from "./cacbg_register";

// Trimmed from the real register root — keeps the shapes that matter: plain
// years, the annual-check `y` suffix, the несъответствие `f1` suffix, and the
// split 2021 (which has NO plain-year folder).
const ROOT_HTML = `
<div class='list'>
  <a href="2025/index.html">За 2025 година &raquo;</a>
  <a href="2025y/index.html">За 2025 година - проверка &raquo;</a>
  <a href="2024f1/index.html">За 2024 година - несъответствие&raquo;</a>
  <a href="2024/index.html">За 2024 година &raquo;</a>
  <a href="2023y4/index.html">За 2023 година - несъответствие&raquo;</a>
  <a href="2023/index.html">За 2023 година &raquo;</a>
  <a href="2022/index.html">За 2022 година &raquo;</a>
  <a href="2021_nc/index.html">За 2021 година (Народно Събрание) &raquo;</a>
  <a href="2021_nonc/index.html">За 2021 година &raquo;</a>
  <a href="2021f1/index.html">За 2021 година - несъответствие &raquo;</a>
</div>`;

describe("parseRegisterYears", () => {
  it("keeps only bare <YYYY> folders, newest last", () => {
    expect(parseRegisterYears(ROOT_HTML)).toEqual([2022, 2023, 2024, 2025]);
  });

  it("excludes suffixed folders rather than truncating them to a year", () => {
    const years = parseRegisterYears(ROOT_HTML);
    // 2021 exists only as _nc / _nonc / f1 — it must not be reported.
    expect(years).not.toContain(2021);
  });

  it("dedupes a year listed more than once", () => {
    expect(
      parseRegisterYears(
        '<a href="2025/index.html">a</a><a href="2025/index.html">b</a>',
      ),
    ).toEqual([2025]);
  });

  it("ignores 4-digit hrefs below the plausible-year floor", () => {
    expect(parseRegisterYears('<a href="1999/index.html">x</a>')).toEqual([]);
  });

  it("returns empty for markup with no year folders", () => {
    expect(parseRegisterYears("<html><body>нищо</body></html>")).toEqual([]);
  });
});

describe("latestRegisterYear", () => {
  beforeEach(() => __resetRegisterYearCache());

  it("resolves the newest plain year from the root", async () => {
    const fetchHtml = vi.fn().mockResolvedValue(ROOT_HTML);
    await expect(latestRegisterYear(fetchHtml)).resolves.toBe(2025);
    expect(fetchHtml).toHaveBeenCalledWith(REGISTER_ROOT);
  });

  it("picks up a newly published cycle without a code change", async () => {
    const withNextYear = ROOT_HTML.replace(
      '<a href="2025/index.html">',
      '<a href="2026/index.html">За 2026 година</a><a href="2025/index.html">',
    );
    await expect(
      latestRegisterYear(vi.fn().mockResolvedValue(withNextYear)),
    ).resolves.toBe(2026);
  });

  it("fetches the root once across repeated calls", async () => {
    const fetchHtml = vi.fn().mockResolvedValue(ROOT_HTML);
    await latestRegisterYear(fetchHtml);
    await latestRegisterYear(fetchHtml);
    expect(fetchHtml).toHaveBeenCalledTimes(1);
  });

  it("throws when the root yields no year folders", async () => {
    await expect(
      latestRegisterYear(vi.fn().mockResolvedValue("<html></html>")),
    ).rejects.toThrow(/no plain-year folders/);
  });

  it("throws on an empty root page", async () => {
    await expect(
      latestRegisterYear(vi.fn().mockResolvedValue(null)),
    ).rejects.toThrow(/empty register root/);
  });

  it("does not cache a failure — a later call retries", async () => {
    const fetchHtml = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(ROOT_HTML);
    await expect(latestRegisterYear(fetchHtml)).rejects.toThrow("boom");
    await expect(latestRegisterYear(fetchHtml)).resolves.toBe(2025);
  });
});
