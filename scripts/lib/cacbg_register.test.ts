// Unit tests for the cacbg register year discovery. No network — the fetcher
// is injected. Runs in the `node` Vitest project (see docs/testing-standards.md).

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  REGISTER_ROOT,
  parseRegisterYears,
  latestRegisterYear,
  extractDeclarationXmlFiles,
  __resetRegisterYearCache,
  registerFolderYear,
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

// Regression cover for the self-closing-<Category/> defect. The upstream
// list.xml interleaves ~41 empty nav categories with the real ones; a regex
// scan mis-attributed and skipped whole categories. Shapes below are lifted
// from the real 2025 file.
describe("extractDeclarationXmlFiles", () => {
  const decl = (file: string, sent = "True") =>
    `<Declaration><Sent>${sent}</Sent><xmlFile>${file}</xmlFile></Declaration>`;
  const person = (name: string, decls: string) =>
    `<Person><Name>${name}</Name><Position><Name>роля</Name>${decls}</Position></Person>`;
  const cat = (name: string, people: string) =>
    `<Category Name="${name}"><Institution Name="и">${people}</Institution></Category>`;

  const wanted = (n: string) => n === "ЦЕЛЕВА";

  it("does not let a self-closing category swallow the next category", () => {
    // The empty in-scope nav entry is immediately followed by an out-of-scope
    // category — the old regex attributed b.xml/c.xml to the empty one.
    const xml =
      `<Category Name="ЦЕЛЕВА" />` +
      cat("ДРУГА", person("Друг", decl("b.xml") + decl("c.xml")));
    expect(extractDeclarationXmlFiles(xml, wanted)).toEqual([]);
  });

  it("still finds a real in-scope category that follows an empty one", () => {
    // The old regex consumed through to the next </Category> and skipped this.
    const xml =
      `<Category Name="ЦЕЛЕВА" />` +
      cat("ДРУГА", person("Друг", decl("b.xml"))) +
      cat("ЦЕЛЕВА", person("Иван", decl("a.xml")));
    expect(extractDeclarationXmlFiles(xml, wanted)).toEqual(["a.xml"]);
  });

  it("keeps every declaration a person filed", () => {
    const xml = cat("ЦЕЛЕВА", person("Иван", decl("a.xml") + decl("b.xml")));
    expect(extractDeclarationXmlFiles(xml, wanted)).toEqual(["a.xml", "b.xml"]);
  });

  it("skips unsent declarations, matching the ingest", () => {
    const xml = cat(
      "ЦЕЛЕВА",
      person("Иван", decl("a.xml") + decl("b.xml", "False")),
    );
    expect(extractDeclarationXmlFiles(xml, wanted)).toEqual(["a.xml"]);
  });

  it("skips a declaration whose person has no name", () => {
    const xml = cat("ЦЕЛЕВА", person("", decl("a.xml")));
    expect(extractDeclarationXmlFiles(xml, wanted)).toEqual([]);
  });

  it("returns nothing when no category matches", () => {
    const xml = cat("ДРУГА", person("Друг", decl("b.xml")));
    expect(extractDeclarationXmlFiles(xml, wanted)).toEqual([]);
  });
});

// The `at(...)` helper builds a per-declaration source URL — the shape
// registerFolderYear recovers a year from.
const at = (folder: string) =>
  `https://register.cacbg.bg/${folder}/F7431F58-230F-48F4-8F7A-AB8FCA424301155913.xml`;

describe("registerFolderYear", () => {
  it("reads a bare year folder in both modes", () => {
    expect(registerFolderYear(at("2025"))).toBe(2025);
    expect(registerFolderYear(at("2025"), { allowSuffixed: true })).toBe(2025);
  });

  // The merge drops the rows a run owns before re-adding them. If `2021_nc`
  // answered to a `--year 2021` run, those rows would be dropped and never
  // re-fetched — there is no plain /2021/ listing to fetch them from.
  it("does not attribute a suffixed folder to a bare-year run by default", () => {
    expect(registerFolderYear(at("2021_nc"))).toBeNull();
    expect(registerFolderYear(at("2021_nonc"))).toBeNull();
    expect(registerFolderYear(at("2024f1"))).toBeNull();
  });

  it("reads suffixed folders when asked to date a filing", () => {
    expect(registerFolderYear(at("2021_nc"), { allowSuffixed: true })).toBe(
      2021,
    );
    expect(registerFolderYear(at("2024f1"), { allowSuffixed: true })).toBe(
      2024,
    );
  });

  it("rejects a foreign host", () => {
    expect(
      registerFolderYear("https://example.invalid/2025/x.xml", {
        allowSuffixed: true,
      }),
    ).toBeNull();
  });

  it("rejects an implausible year", () => {
    expect(registerFolderYear(at("1999"), { allowSuffixed: true })).toBeNull();
  });
});
