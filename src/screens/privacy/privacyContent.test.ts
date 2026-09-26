// The /privacy notice must stay TRUE as the code changes. The load-bearing claim is "no consent
// banner is needed because we store nothing non-essential on your device" — which is only true
// while every browser-storage write is one the notice lists and a reader asked for. A new
// `localStorage.setItem` anywhere in the app fails here until someone adds it to STORAGE_ROWS
// (and decides whether it is really exempt) — see docs/plans/gdpr-consent-v1.md §2.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";
import {
  STORAGE_ROWS,
  STORAGE_WRITER_EXCEPTIONS,
  parseInline,
  privacyBodyHtml,
  privacySections,
} from "./privacyContent";

const REPO = path.resolve(__dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".venv", "m0", "dist"]);
const WRITE_RE =
  /(localStorage|sessionStorage)\.setItem\(|document\.cookie\s*=|indexedDB\.open\(|caches\.open\(/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|eval)\./.test(e.name))
      out.push(p);
  }
  return out;
};

const writers = () =>
  ["src", "ai"]
    .flatMap((d) => walk(path.join(REPO, d)))
    .filter((f) => WRITE_RE.test(stripComments(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(REPO, f).split(path.sep).join("/"))
    .sort();

describe("the storage table is complete", () => {
  const found = writers();
  const declared = new Set(STORAGE_ROWS.flatMap((r) => r.files));
  const excepted = new Set(Object.keys(STORAGE_WRITER_EXCEPTIONS));

  it("finds writers at all (anti-vacuity)", () => {
    expect(found.length).toBeGreaterThan(10);
  });

  it("every file that writes browser storage is listed on /privacy", () => {
    expect(
      found.filter((f) => !declared.has(f) && !excepted.has(f)),
      "add the key to STORAGE_ROWS in privacyContent.ts — and check it is really a setting the reader chose, or the no-banner conclusion no longer holds",
    ).toEqual([]);
  });

  it("no listed file is stale", () => {
    expect(
      [...declared, ...excepted].filter((f) => !found.includes(f)),
    ).toEqual([]);
  });

  it("nothing sets a cookie", () => {
    const cookie = /document\.cookie\s*=/;
    expect(
      found.filter((f) =>
        cookie.test(stripComments(fs.readFileSync(path.join(REPO, f), "utf8"))),
      ),
    ).toEqual([]);
  });
});

describe("no third-party tracker comes back", () => {
  it("index.html loads no Google Analytics / Tag Manager and no third-party preconnect", () => {
    const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
    expect(html).not.toMatch(/googletagmanager|google-analytics|gtag\(/);
    const preconnects = [
      ...html.matchAll(/rel="preconnect"\s+href="([^"]+)"/g),
    ].map((m) => new URL(m[1]).hostname);
    // storage.googleapis.com is our own data bucket, not a third party's.
    expect(preconnects.filter((h) => h !== "storage.googleapis.com")).toEqual(
      [],
    );
  });
});

describe("the notice renders", () => {
  it("every section has a heading and text in both languages", () => {
    for (const s of privacySections()) {
      for (const lang of ["bg", "en"] as const) {
        expect(s.heading[lang], `${s.id} heading ${lang}`).toBeTruthy();
        for (const b of s.blocks) {
          const texts =
            b.kind === "p"
              ? [b.text]
              : b.kind === "ul"
                ? b.items
                : b.rows.flat();
          for (const t of texts)
            expect(t[lang], `${s.id} ${lang}`).toBeTruthy();
        }
      }
    }
  });

  it("the anchors the chat links to exist", () => {
    const ids = privacySections().map((s) => s.id);
    expect(ids).toContain("ai");
    expect(ids).toContain("storage");
    expect(ids).toContain("people");
  });

  it("the prerendered body carries every storage key, escaped", () => {
    const html = privacyBodyHtml("en");
    for (const r of STORAGE_ROWS) expect(html).toContain(r.key);
    expect(html).not.toMatch(/<script/);
  });

  it("parses inline links", () => {
    expect(parseInline("a [b](mailto:x@y.z) c")).toEqual([
      { text: "a " },
      { text: "b", href: "mailto:x@y.z" },
      { text: " c" },
    ]);
  });
});
