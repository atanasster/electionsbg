// Every data fetch in src/ must go through `dataUrl()` when hosting cannot serve
// the path itself. This is the one bug class that is invisible everywhere except
// production:
//
//   * `VITE_DATA_BASE_URL` is EMPTY in dev and in the test env, so `dataUrl()` is
//     the identity — a hook that skips it behaves identically in both.
//   * `public/procurement` is a symlink to `data/procurement`, so the file is
//     right there on the dev server and the page renders correctly.
//   * In production firebase.json's hosting `ignore` drops `procurement/**/*.json`
//     from the deploy, so the request falls through the `**` → /index.html
//     catch-all and comes back as the SPA shell with a **200**. `r.ok` is true,
//     `r.json()` throws on the HTML, React Query swallows it into `data:
//     undefined`, and the tile renders with no number and no error.
//
// That is exactly how /governance/sectors and /procurement shipped with blank
// stat tiles while the (correct, current) files sat on the bucket the whole time.
//
// The rule enforced here: a bare literal fetch path must be servable by hosting.
// Anything hosting ignores is bucket-served and must be wrapped in `dataUrl()`.
//
// A plain source+config test — no DB, no network. Runs in the node vitest project.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

type Hosting = { target?: string; public?: string; ignore?: string[] };

const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, "firebase.json"), "utf-8"),
) as { hosting: Hosting[] };

const main =
  config.hosting.find((h) => h.target === "main") ?? config.hosting[0];
const IGNORE = main.ignore ?? [];

/** firebase `ignore` glob → RegExp. Handles the subset actually in use:
 *  `**` (any depth), `*` (one segment), and literal text. Scanned left to right
 *  so a `**` expansion is never re-read by the single-`*` rule. */
const globToRegExp = (glob: string): RegExp => {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?"; // any depth of directories, including none
      i += 3;
    } else if (glob.startsWith("**", i)) {
      out += ".*";
      i += 2;
    } else if (glob[i] === "*") {
      out += "[^/]*"; // exactly one segment
      i += 1;
    } else {
      out += glob[i].replace(/[.+^${}()|[\]\\]/, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
};

const IGNORE_RES = IGNORE.map(globToRegExp);

/** Is this deploy-root-relative path dropped from the hosting upload? */
const isIgnored = (rel: string): boolean =>
  IGNORE_RES.some((re) => re.test(rel));

/** First path segment of every ignore glob anchored to one (i.e. not a leading
 *  `**`). Used for interpolated fetch paths, where only the static head of the
 *  template is knowable at scan time. */
const IGNORED_ROOTS = new Set(
  IGNORE.map((g) => g.split("/")[0]).filter((s) => s && !s.includes("*")),
);

const SRC = path.join(ROOT, "src");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
      out.push(p);
  }
  return out;
};

/** `fetch("/…")` / `fetch(`/…`)` with a LITERAL leading-slash path — i.e. one
 *  that did NOT go through dataUrl(). Group 2 is the static head (a template
 *  stops at its first `${`); group 3 marks that an interpolation followed.
 *  A `fetch(dataUrl(…))` never matches: the token after `fetch(` is then an
 *  identifier rather than a quote. */
const BARE_FETCH = /\bfetch\(\s*(["'`])(\/(?:(?!\1)[^\n$])*)(\$\{)?/g;

interface Hit {
  file: string;
  line: number;
  pathPrefix: string;
  interpolated: boolean;
}

const collect = (): Hit[] => {
  const hits: Hit[] = [];
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, "utf-8");
    for (const m of text.matchAll(BARE_FETCH)) {
      hits.push({
        file: path.relative(ROOT, file),
        line: text.slice(0, m.index).split("\n").length,
        pathPrefix: m[2],
        interpolated: Boolean(m[3]),
      });
    }
  }
  return hits;
};

// Runtime endpoints answered by a rewrite (functions) rather than by a deployed
// file — correctly fetched bare, and no part of the bucket seam.
const RUNTIME_PREFIXES = ["/api/"];

describe("data-fetch seam: bare fetches must be servable by hosting", () => {
  it("has a hosting ignore list to check against", () => {
    expect(IGNORE.length).toBeGreaterThan(0);
  });

  // Guards the guard: if globToRegExp ever breaks, every assertion below passes
  // vacuously. These are the exact two paths that shipped blank.
  it("still discriminates — the known bucket-served paths read as ignored", () => {
    expect(isIgnored("procurement/derived/sector_stats.json")).toBe(true);
    expect(isIgnored("procurement/derived/hub_stats.json")).toBe(true);
    // …and genuinely deployed static assets do not.
    expect(isIgnored("articles/index.json")).toBe(false);
    expect(isIgnored("locales/bg/translation.json")).toBe(false);
    expect(isIgnored("index.html")).toBe(false);
  });

  it("finds the fetch call sites it is meant to police", () => {
    // Cheap canary: a regex that silently stopped matching would leave this
    // suite green while enforcing nothing.
    expect(collect().length).toBeGreaterThan(0);
  });

  it("no bare fetch names a path the deploy drops", () => {
    const offenders = collect()
      .filter((h) => !RUNTIME_PREFIXES.some((p) => h.pathPrefix.startsWith(p)))
      .filter((h) => {
        const rel = h.pathPrefix.replace(/^\//, "");
        // Fully static → match the ignore globs exactly. Interpolated → only the
        // static head is knowable, so fall back to its top-level directory.
        return h.interpolated
          ? IGNORED_ROOTS.has(rel.split("/")[0])
          : isIgnored(rel);
      })
      .map(
        (h) =>
          `${h.file}:${h.line} — fetch("${h.pathPrefix}${h.interpolated ? "${…}" : ""}") is dropped by firebase.json ignore; wrap it in dataUrl()`,
      );

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
