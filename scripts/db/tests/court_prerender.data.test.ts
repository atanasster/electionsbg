// The 284 static /court pages, checked as PUBLISHED CLAIMS rather than as code.
//
// A prerendered page is not a render that can be fixed on the next request — a
// crawler reads it once and caches it, and an answer engine may quote its FAQ
// verbatim. So the assertions here are about what the sentences SAY:
//
//   * a court must never be told the workload statistic covers courts (it fired
//     on ВКС and ВАС, whose own load rows are absent);
//   * no count may disagree with its noun ("1 магистрати" reached 30 bodies,
//     including the FAQPage JSON-LD);
//   * meta text must be pre-escape, since the emitter escapes it again.
//
// Auto-skips when Postgres is down or the dimension is absent.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { readSeoCourts } from "../lib/seo_courts";
import { buildCourtRoutes } from "../../prerender/dynamicRoutes";

const haveDb = await dbReachable();
const bodies = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          "SELECT count(*) n FROM judicial_body",
        ).catch(() => [{ n: "0" }])
      )[0]?.n ?? 0,
    )
  : 0;

const routes = bodies ? await buildCourtRoutes() : [];
const kindOf = new Map(
  bodies
    ? (await readSeoCourts()).map((b) => [`court/${b.bodyCode}`, b.kind])
    : [],
);

afterAll(async () => {
  if (haveDb) await end();
});

/** Every string a reader or a crawler can see, per route. */
const surfaces = (r: (typeof routes)[number]): string[] => [
  r.title,
  r.description,
  r.bodyHtml ?? "",
  JSON.stringify(r.jsonLd ?? []),
  r.english?.title ?? "",
  r.english?.description ?? "",
  r.english?.bodyHtml ?? "",
  JSON.stringify(r.english?.jsonLd ?? []),
];

test("one page per enumerated body, BG and EN", async (t) => {
  if (!bodies) return t.skip();
  assert.equal(routes.length, bodies, "a body lost its page");
  for (const r of routes) {
    assert.ok(
      r.bodyHtml && r.bodyHtml.length > 200,
      `${r.path}: thin bodyHtml`,
    );
    assert.ok(
      r.english?.bodyHtml && r.english.bodyHtml.length > 200,
      `${r.path}: thin EN bodyHtml`,
    );
    // The path carries no leading or trailing slash — what keeps the family on
    // the no-slash URL contract for free.
    assert.match(r.path, /^court\/[a-z0-9][a-z0-9-]*$/, `${r.path}: bad path`);
  }
});

test("never tells a COURT that the statistics cover the courts", async (t) => {
  if (!bodies) return t.skip();
  for (const r of routes) {
    const kind = kindOf.get(r.path);
    const bg = /статистиката обхваща съдилищата/.test(r.bodyHtml ?? "");
    const en = /the statistics cover the courts/.test(
      r.english?.bodyHtml ?? "",
    );
    if (bg || en) {
      assert.ok(
        kind === "prosecution" || kind === "investigation",
        `${r.path} (${kind}) carries the prosecution/investigation exclusion clause — on a court it is self-contradicting`,
      );
    }
  }
});

test("no count disagrees with its noun", async (t) => {
  if (!bodies) return t.skip();
  const bad =
    /\b1 (магистрати|съдии|magistrates|judges|declaring magistrates)\b|\b1 магистрати подават\b/;
  for (const r of routes) {
    for (const s of surfaces(r)) {
      const m = s.match(bad);
      assert.ok(!m, `${r.path}: "${m?.[0]}" — singular count, plural noun`);
    }
  }
});

test("meta text is pre-escape — the emitter escapes it again", async (t) => {
  if (!bodies) return t.skip();
  // An HTML entity reaching `title`/`description` ships as `&amp;amp;` in the
  // <meta>, and inside a JSON-LD string it is simply wrong text.
  const entity = /&(amp|lt|gt|quot|#\d+);/;
  for (const r of routes) {
    for (const [label, s] of [
      ["title", r.title],
      ["description", r.description],
      ["jsonLd", JSON.stringify(r.jsonLd ?? [])],
      ["en.title", r.english?.title ?? ""],
      ["en.description", r.english?.description ?? ""],
      ["en.jsonLd", JSON.stringify(r.english?.jsonLd ?? [])],
    ] as const) {
      assert.ok(!entity.test(s), `${r.path}: HTML entity in ${label}`);
    }
  }
});

test("the EN page localises the seat and never links a slashed /en/", async (t) => {
  if (!bodies) return t.skip();
  for (const r of routes) {
    const enLd = JSON.stringify(r.english?.jsonLd ?? []);
    assert.ok(
      !/"https:\/\/electionsbg\.com\/en\/"/.test(enLd),
      `${r.path}: JSON-LD names /en/, which 301s to /en`,
    );
  }
  // Cyrillic in EN prose is expected for the body's NAME (there is no official
  // English register) but not for the seat, which place_dim carries.
  const sofia = routes.find((r) => r.path === "court/sgs");
  if (sofia) {
    assert.match(
      sofia.english?.bodyHtml ?? "",
      /seated in Sofia/,
      "the EN page still prints the Bulgarian seat name",
    );
  }
});

test("no page links a magistrate roster it has no magistrates for", async (t) => {
  if (!bodies) return t.skip();
  const byPath = new Map(
    (await readSeoCourts()).map((b) => [`court/${b.bodyCode}`, b]),
  );
  for (const r of routes) {
    const b = byPath.get(r.path)!;
    const linksRoster = /\/persons\?court=/.test(r.bodyHtml ?? "");
    if (!b.sourcesBuilt || b.magistrates === 0) {
      assert.ok(
        !linksRoster,
        `${r.path}: links a roster filter that returns no rows`,
      );
    }
  }
});
