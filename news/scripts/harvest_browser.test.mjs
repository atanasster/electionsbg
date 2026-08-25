/**
 * Tests for harvest_browser.mjs — the decision logic, without a browser.
 *
 * Run:  node --test news/scripts/harvest_browser.test.mjs
 *
 * Everything here is a pure function on purpose. Driving a real Chromium in
 * CI would be slow, flaky and dependent on 18 third-party sites; what the
 * bugs were actually in is the deciding: a bare->www redirect silently
 * dropped an ENTIRE outlet's harvest (bta.bg reported 0 links), and an
 * over-wide junk-segment set dropped /novini/, which is where several
 * outlets put their real articles.
 */
// vitest, not node:test — the repo's node project runs vitest, and the two
// runners do not compose: vitest imported this file, ran node:test's runner
// inside it, and reported "no tests" while a real assertion was failing.
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import {
  parseCsv, splitCsvLine, parseRobots, pathToRegExp, sameSite, keepLink,
  JUNK_SEGMENTS, NAV_WORDS, BOT_NAME, UA,
} from "./harvest_browser.mjs";

const allowAll = { allows: () => true, delay: null };
const article = (url, title = "Дълго заглавие на истинска новинарска статия") =>
  ({ url, title });

describe("the registry reader", () => {
  test("reads dated columns and quoted cells", () => {
    const rows = parseCsv(
      'domain,feed_method_aug2026,feed_notes_aug2026\n' +
      'ex.bg,browser_render_scrape,"a note, with a comma"\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].domain, "ex.bg");
    assert.equal(rows[0].feed_notes_aug2026, "a note, with a comma");
  });

  test("handles an escaped quote inside a cell", () => {
    assert.deepEqual(splitCsvLine('a,"say ""hi""",c'), ["a", 'say "hi"', "c"]);
  });

  test("a short row does not throw", () => {
    const rows = parseCsv("domain,feed_method_aug2026\nex.bg\n");
    assert.equal(rows[0].feed_method_aug2026, "");
  });
});

describe("the robots.txt reader", () => {
  test("a Disallow prefix blocks", () => {
    const r = parseRobots("User-agent: *\nDisallow: /private/");
    assert.equal(r.allows("/private/a"), false);
    assert.equal(r.allows("/news/a"), true);
  });

  test("a group naming this bot wins over the wildcard", () => {
    const r = parseRobots(
      `User-agent: *\nDisallow:\n\nUser-agent: ${BOT_NAME}\nDisallow: /`);
    assert.equal(r.allows("/anything"), false);
  });

  test("Allow beats a shorter Disallow", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /news/\nAllow: /news/public/");
    assert.equal(r.allows("/news/x"), false);
    assert.equal(r.allows("/news/public/x"), true);
  });

  test("an empty Disallow means allow everything", () => {
    const r = parseRobots("User-agent: *\nDisallow:");
    assert.equal(r.allows("/anything"), true);
  });

  test("a wildcard inside a path is honoured", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*/print");
    assert.equal(r.allows("/news/print"), false);
    assert.equal(r.allows("/news/read"), true);
  });

  test("$ anchors the end", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    assert.equal(r.allows("/a/b.pdf"), false);
    assert.equal(r.allows("/a/b.pdf.html"), true);
  });

  test("Crawl-delay is read, not ignored", () => {
    assert.equal(parseRobots("User-agent: *\nCrawl-delay: 10").delay, 10);
    assert.equal(parseRobots("User-agent: *\nDisallow:").delay, null);
  });

  test("comments and blank lines are skipped", () => {
    const r = parseRobots("# hi\n\nUser-agent: *   # who\nDisallow: /x");
    assert.equal(r.allows("/x/y"), false);
  });

  test("an unparseable file means allowed — unknown is not forbidden", () => {
    assert.equal(parseRobots("<html>404</html>").allows("/a"), true);
    assert.equal(parseRobots("").allows("/a"), true);
  });

  test("a regex metacharacter in a path is escaped, not interpreted", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a+b");
    assert.equal(r.allows("/a+b/c"), false);
    assert.equal(r.allows("/aaab/c"), true);
  });

  test("pathToRegExp anchors at the start", () => {
    assert.equal(pathToRegExp("/news").test("/news/a"), true);
    assert.equal(pathToRegExp("/news").test("/x/news"), false);
  });
});

describe("the same-site rule", () => {
  test("a bare -> www redirect is still the same site", () => {
    // bta.bg serves from www.bta.bg. Comparing raw origins made every one of
    // its links fail, and it reported ZERO articles.
    assert.equal(sameSite("https://www.bta.bg/bg/news/1", "https://bta.bg"), true);
    assert.equal(sameSite("https://bta.bg/x", "https://www.bta.bg"), true);
  });

  test("scheme and case do not matter", () => {
    assert.equal(sameSite("http://EX.bg/a", "https://ex.bg"), true);
  });

  test("an outlet's own subdomain IS the outlet", () => {
    // dir.bg's homepage carries 378 links to dnes.dir.bg, 274 to
    // impressio.dir.bg, 242 to business.dir.bg and 223 to corner.dir.bg.
    // Rejecting them left the #2 outlet with 2 links — a topic index and a
    // film page — while the harvest reported success.
    assert.equal(sameSite("https://dnes.dir.bg/a", "https://dir.bg"), true);
    assert.equal(sameSite("https://business.dir.bg/a", "https://www.dir.bg"), true);
  });

  test("a different site is rejected", () => {
    assert.equal(sameSite("https://other.bg/a", "https://ex.bg"), false);
    assert.equal(sameSite("https://ex.bg.evil.com/a", "https://ex.bg"), false);
  });

  test("a malformed URL is rejected rather than throwing", () => {
    assert.equal(sameSite("not a url", "https://ex.bg"), false);
  });
});

describe("the link filter", () => {
  const origin = "https://ex.bg";

  test("a real article link is kept", () => {
    assert.ok(keepLink(article("https://ex.bg/novini/nesto-vazhno"), origin, allowAll));
  });

  test("/novini/ is NOT junk — several outlets put real articles there", () => {
    assert.equal(JUNK_SEGMENTS.has("novini"), false);
    assert.equal(JUNK_SEGMENTS.has("video"), false,
                 "a video report is still a report");
  });

  test("measured chrome segments are rejected", () => {
    for (const seg of ["vremeto", "horoskop", "tag", "archives", "info"]) {
      assert.equal(keepLink(article(`https://ex.bg/${seg}/x`), origin, allowAll),
                   null, seg);
    }
  });

  test("a short link text is rejected", () => {
    assert.equal(keepLink({ url: "https://ex.bg/a/1", title: "Кратко" },
                          origin, allowAll), null);
  });

  test("a nav word is rejected even when long enough", () => {
    assert.ok(NAV_WORDS.test("Условия"));
    assert.equal(keepLink({ url: "https://ex.bg/a/1", title: "поверителност" },
                          origin, allowAll), null);
  });

  test("the homepage itself is rejected", () => {
    assert.equal(keepLink(article("https://ex.bg/"), origin, allowAll), null);
  });

  test("a robots-disallowed path is rejected", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /private/");
    assert.equal(keepLink(article("https://ex.bg/private/a"), origin, robots), null);
    assert.ok(keepLink(article("https://ex.bg/novini/a"), origin, robots));
  });

  test("two spellings of one article share a dedupe key", () => {
    const a = keepLink(article("https://www.ex.bg/novini/a/"), origin, allowAll);
    const b = keepLink(article("http://ex.bg/novini/a"), origin, allowAll);
    assert.equal(a, b);
  });

  test("a tracking parameter does not split one article into two", () => {
    // Kept, these burn two of the --n slots and the saver then dedupes them
    // away — the harvest silently under-delivers. Measured on 8+ capital.bg
    // URLs in the committed scratch.
    const plain = keepLink(article("https://ex.bg/novini/a"), origin, allowAll);
    for (const q of ["?ref=header", "?utm_source=fb&utm_medium=social",
                     "?fbclid=xyz"]) {
      assert.equal(keepLink(article(`https://ex.bg/novini/a${q}`), origin,
                            allowAll), plain, q);
    }
  });

  test("a meaningful query still distinguishes two articles", () => {
    assert.notEqual(
      keepLink(article("https://ex.bg/novini.php?n=1"), origin, allowAll),
      keepLink(article("https://ex.bg/novini.php?n=2"), origin, allowAll));
  });

  test("distinct articles keep distinct keys", () => {
    assert.notEqual(
      keepLink(article("https://ex.bg/novini/a"), origin, allowAll),
      keepLink(article("https://ex.bg/novini/b"), origin, allowAll));
  });

  test("a query-addressed article is not collapsed", () => {
    // moreto.net addresses every article as novini.php?n=NNNN.
    assert.notEqual(
      keepLink(article("https://ex.bg/novini.php?n=1"), origin, allowAll),
      keepLink(article("https://ex.bg/novini.php?n=2"), origin, allowAll));
  });
});

describe("robots groups are merged, not first-wins", () => {
  test("a second wildcard block still binds", () => {
    // RFC 9309 2.2.1: obey EVERY matching group. Several registry robots.txt
    // files carry a second `User-agent: *` block further down.
    const r = parseRobots(
      "User-agent: *\nDisallow: /a/\n\nUser-agent: Googlebot\nDisallow:\n\n" +
      "User-agent: *\nDisallow: /b/");
    assert.equal(r.allows("/a/x"), false);
    assert.equal(r.allows("/b/x"), false, "the second * block was ignored");
    assert.equal(r.allows("/c/x"), true);
  });
});

describe("the never-click invariant", () => {
  test("the source contains no interaction call whatsoever", async () => {
    // The one property this tier's licence to be automated rests on. Waiting
    // out Cloudflare's ordinary JS challenge is not evasion; clicking a
    // checkbox is, and the difference has to be enforced by something other
    // than a comment.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "harvest_browser.mjs"), "utf-8");
    const code = src.split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    for (const forbidden of [
      ".click(", ".dblclick(", ".tap(", ".type(", ".fill(", ".press(",
      ".selectOption(", ".setChecked(", ".check(", ".uncheck(",
      "mouse.", "keyboard.", "dispatchEvent(", ".hover(", ".dragTo(",
    ]) {
      assert.ok(!code.includes(forbidden),
                `harvest_browser.mjs must never interact: found ${forbidden}`);
    }
  });
});

describe("the identity", () => {
  test("names the bot and a contact URL", () => {
    assert.ok(UA.includes(BOT_NAME));
    assert.ok(UA.includes("http"));
  });

  test("does not claim to be a person's browser", () => {
    assert.ok(!UA.includes("Mozilla"), UA);
    assert.ok(!UA.includes("Safari"), UA);
    assert.ok(!UA.includes("HeadlessChrome"), UA);
  });
});
