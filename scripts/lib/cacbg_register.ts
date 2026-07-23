// Year discovery for the Сметна палата declarations register
// (register.cacbg.bg). The register publishes one folder per declaration
// year — `/<YYYY>/list.xml` — and the root page is the only place that says
// which years actually exist.
//
// Callers used to pin the year as a constant, which meant a new cycle went
// unnoticed until someone remembered to bump it by hand. Discovering the
// newest year from the root removes that manual step.
//
// The root also lists derived folders alongside the plain-year ones:
//
//   2025/index.html        ← a real declaration year
//   2025y/index.html       ← annual чл. 58 check
//   2024f1/index.html      ← check that closed with a несъответствие
//   2021_nc, 2021_nonc     ← the split 2021 (Народно събрание / rest)
//
// Only bare `<YYYY>` folders carry a `list.xml` in the shape the ingest
// parses, so those are the only ones considered. Note that the plain-year
// series has gaps (there is no `/2021/` — that cycle ships as `2021_nc` +
// `2021_nonc`), so "newest" is a max over what exists, not a range walk.
//
// The fetcher is injected: the watcher and the ingest each carry their own
// fetch wrapper (both need a permissive TLS dispatcher — register.cacbg.bg
// serves an incomplete cert chain), and this module stays free of that.

import { load } from "cheerio";

export const REGISTER_ROOT = "https://register.cacbg.bg/";

// Oldest year worth believing. Guards against a stray 4-digit href being read
// as a declaration year if the root page is ever restructured.
const MIN_PLAUSIBLE_YEAR = 2005;

// Pure parser — exported for unit tests.
export const parseRegisterYears = (html: string): number[] => {
  const years = new Set<number>();
  // Anchored on `/index.html` immediately after the digits so suffixed
  // folders (2025y, 2024f1, 2021_nc) are excluded rather than truncated.
  for (const m of html.matchAll(/href="(\d{4})\/index\.html"/g)) {
    const year = Number(m[1]);
    if (year >= MIN_PLAUSIBLE_YEAR) years.add(year);
  }
  return Array.from(years).sort((a, b) => a - b);
};

// Memoised across the process: the watcher probes two cacbg sources in one
// run and the register root is the same page for both. Cleared by
// __resetRegisterYearCache() so tests stay independent.
let cached: Promise<number> | null = null;

export const latestRegisterYear = async (
  fetchHtml: (url: string) => Promise<string | null>,
): Promise<number> => {
  if (!cached) {
    cached = (async () => {
      const html = await fetchHtml(REGISTER_ROOT);
      if (!html) throw new Error("empty register root page");
      const years = parseRegisterYears(html);
      if (years.length === 0) {
        throw new Error(
          "register root listed no plain-year folders — upstream layout may have changed",
        );
      }
      return years[years.length - 1];
    })().catch((e) => {
      // Don't cache a failure — the next caller should retry rather than
      // inherit a rejected promise for the rest of the run.
      cached = null;
      throw e;
    });
  }
  return cached;
};

export const __resetRegisterYearCache = (): void => {
  cached = null;
};

// Collect the <xmlFile> of every declaration under a category the caller
// accepts, applying the same skip rules as the ingest (Sent must be True, and
// the person and file must both be named).
//
// This MUST be a structure-aware walk, not a regex over
// `<Category Name="…">…</Category>`. list.xml carries ~41 self-closing
// navigation entries — `<Category Name="Областни управители" />` — against only
// ~54 real closing tags. A regex treats the self-closing tag as an opening one
// and then runs to the NEXT `</Category>`, so it attributes a sibling
// category's declarations to the empty one and skips the real categories in
// between. That silently under-counted cacbg_officials (489 of 548 tracked, two
// of the three ingest buckets never watched at all) and over-counted
// cacbg_local by 150 foreign declarations.
//
// Kept in lockstep with fetchYearListing / fetchMunicipalListing in
// scripts/officials/{index,municipal}.ts — the watcher must fingerprint exactly
// the set the ingest would process.
export const extractDeclarationXmlFiles = (
  xml: string,
  categoryMatches: (name: string) => boolean,
): string[] => {
  const $ = load(xml, { xmlMode: true });
  const out: string[] = [];
  $("Category").each((_, cat) => {
    if (!categoryMatches($(cat).attr("Name") || "")) return;
    $(cat)
      .find("Institution")
      .each((__, inst) => {
        $(inst)
          .find("Person")
          .each((___, person) => {
            const name = $(person).find("> Name").first().text().trim();
            $(person)
              .find("Position > Declaration")
              .each((____, decl) => {
                const xmlFile = $(decl).find("xmlFile").first().text().trim();
                const sent = $(decl).find("Sent").first().text().trim();
                if (sent !== "True" || !name || !xmlFile) return;
                out.push(xmlFile);
              });
          });
      });
  });
  return out;
};
