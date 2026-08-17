// /council/resolution/:id — the function-served municipal-council decisions.
//
// The routing cases are derived FROM THE COMMITTED CORPUS rather than from a
// hand-picked list, because the defect this file exists to catch was a charset
// that looked exhaustive: the id regex required `[A-Z]{3}\d{2}`, which fifteen
// of the sixteen council keys satisfy — and Sofia's synthetic `SOF` does not.
// All 413 Sofia resolutions (826 URLs with the EN mirror) fell through to the
// homepage's head plus a noindex, and every hand-written example anyone would
// think to write happened to be one of the fifteen that worked.

const test = require("node:test");
const assert = require("node:assert");
const { readdirSync, readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const {
  matchSpaPage,
  isSpaPagePath,
  selfUrlFor,
  councilResolutionPage,
} = require("./spa_page.js");

const COUNCIL_DIR = join(__dirname, "..", "data", "council");

/** One real resolution id per council key in the committed shard tree. */
const corpusIds = () => {
  if (!existsSync(COUNCIL_DIR)) return [];
  const out = [];
  for (const code of readdirSync(COUNCIL_DIR, { withFileTypes: true })) {
    if (!code.isDirectory() || code.name === "votes") continue;
    const dir = join(COUNCIL_DIR, code.name);
    for (const year of readdirSync(dir, { withFileTypes: true })) {
      if (!year.isDirectory()) continue;
      const files = readdirSync(join(dir, year.name)).filter((f) =>
        f.endsWith(".json"),
      );
      if (files.length) {
        out.push({ code: code.name, id: files[0].replace(/\.json$/, "") });
        break;
      }
    }
  }
  return out;
};

test("every council key in the corpus routes to the function", () => {
  const ids = corpusIds();
  if (!ids.length) return; // no shard tree on this checkout
  // The tree is committed, so a shrinking corpus is a defect in its own right.
  assert.ok(ids.length >= 10, `only ${ids.length} council(s) found`);
  const missed = [];
  for (const { code, id } of ids) {
    for (const path of [
      `/council/resolution/${id}`,
      `/en/council/resolution/${id}`,
    ]) {
      const m = matchSpaPage(path);
      if (!m || m.kind !== "council" || m.key !== id) missed.push(path);
      // isSpaPagePath is what the hosting rewrite mirrors. It returning true
      // while matchSpaPage returns null is the exact Sofia failure: the request
      // reaches the function and gets the homepage's head with a noindex.
      assert.equal(isSpaPagePath(path), true, `isSpaPagePath false for ${code}`);
    }
  }
  assert.deepEqual(missed, [], `ids the regex does not match: ${missed}`);
});

test("Sofia's digit-less key is covered", () => {
  // Named explicitly as well as corpus-derived: this is the one shape that
  // broke, and it must fail loudly even on a checkout with no shard tree.
  const m = matchSpaPage("/council/resolution/SOF-2026-prot66-r642");
  assert.equal(m?.kind, "council");
  assert.equal(m?.key, "SOF-2026-prot66-r642");
  assert.equal(m?.lang, "bg");
  assert.equal(
    matchSpaPage("/en/council/resolution/SOF-2026-prot66-r642")?.lang,
    "en",
  );
});

test("the prerendered council pages are NOT claimed by the function", () => {
  // /council and /council/:code are prerendered, and Firebase ranks exact-match
  // static content above a rewrite — but claiming them here would still be
  // wrong, and would shadow them if the prerender ever stopped emitting one.
  for (const p of ["/council", "/council/BGS04", "/en/council", "/council/"]) {
    assert.equal(isSpaPagePath(p), false, `${p} must not be claimed`);
  }
});

test("a malformed id gets the plain shell, not a fabricated head", () => {
  for (const bad of [
    "/council/resolution/nonsense",
    "/council/resolution/BGS01-25-prot1-r1", // 2-digit year
    "/council/resolution/bgs01-2025-prot1-r1", // lowercase
    "/council/resolution/BGS01-2025-prot1", // no resolution part
    "/council/resolution/",
  ]) {
    assert.equal(matchSpaPage(bad), null, `${bad} should not match`);
  }
});

test("selfUrlFor round-trips both languages", () => {
  const id = "BGS01-2025-prot23-r16891";
  assert.equal(
    selfUrlFor(matchSpaPage(`/council/resolution/${id}`)),
    `https://electionsbg.com/council/resolution/${id}`,
  );
  assert.equal(
    selfUrlFor(matchSpaPage(`/en/council/resolution/${id}`)),
    `https://electionsbg.com/en/council/resolution/${id}`,
  );
});

const row = (over = {}) => ({
  id: "BGS01-2025-prot23-r16891",
  councilCode: "BGS01",
  councilFrontendCode: "BGS04",
  councilName: "Община Бургас",
  decidedOn: "2025-04-29",
  session: "23",
  number: "16891",
  title: "Приемане на бюджет",
  result: "adopted",
  protocolTally: { for: 40, against: 1, abstain: 2 },
  namedVoteTally: { for: 39, against: 1, abstain: 2 },
  tallyBasisBg: "БГ основание",
  tallyBasisEn: "EN basis",
  hasNamedVotes: true,
  sourceUrl: null,
  votes: [
    { name: "Иван Иванов", personId: 1, personSlug: "ivan-ivanov-1", vote: "for" },
    { name: "Петър Петров", personId: 2, personSlug: null, vote: "against" },
  ],
  ...over,
});

test("the breadcrumb links the FRONTEND code, never the internal key", () => {
  const p = councilResolutionPage(row(), "bg", "https://electionsbg.com/x");
  assert.match(p.bodyHtml, /\/council\/BGS04/);
  // BGS01 is Бургас's council key AND Айтос's obshtina code — linking it sends
  // a reader from Бургас's own decision to "we do not track this council".
  assert.ok(
    !/\/council\/BGS01/.test(p.bodyHtml),
    "must not link the internal council key",
  );
});

test("an unlinkable council renders plain text rather than a broken link", () => {
  const p = councilResolutionPage(
    row({ councilFrontendCode: null }),
    "bg",
    "https://electionsbg.com/x",
  );
  assert.ok(!/\/council\/(BGS01|null|undefined)/.test(p.bodyHtml));
  assert.match(p.bodyHtml, /Община Бургас/);
});

test("vote labels are localised, never the raw enum", () => {
  const bg = councilResolutionPage(row(), "bg", "https://electionsbg.com/x");
  assert.match(bg.bodyHtml, /За<\/span>|— За|>За</);
  assert.ok(
    !/—\s*(for|against|abstain)\b/.test(bg.bodyHtml),
    "raw enum leaked onto the Bulgarian page",
  );
  const en = councilResolutionPage(row(), "en", "https://electionsbg.com/x");
  assert.ok(!/—\s*(for|against|abstain)\b/.test(en.bodyHtml));
  assert.match(en.bodyHtml, /For|Against/);
});

test("a council with no named vote gets a DASH, never a zero", () => {
  const p = councilResolutionPage(
    row({ hasNamedVotes: false, namedVoteTally: {}, votes: [] }),
    "bg",
    "https://electionsbg.com/x",
  );
  assert.match(p.bodyHtml, /&mdash;/);
  // 11 of the 16 councils publish an aggregate only; "против 0" there would
  // assert a unanimity the source never recorded.
  assert.ok(
    !/по имена: за 0/.test(p.bodyHtml),
    "named tally rendered as zeros",
  );
});

test("both tallies are present and labelled", () => {
  const p = councilResolutionPage(row(), "bg", "https://electionsbg.com/x");
  assert.match(p.bodyHtml, /Гласуване по протокол/);
  assert.match(p.bodyHtml, /Гласуване по имена/);
  assert.match(p.bodyHtml, /БГ основание/);
  assert.match(
    councilResolutionPage(row(), "en", "https://electionsbg.com/x").bodyHtml,
    /EN basis/,
  );
});

test("`unknown` is not rendered as a result", () => {
  // It is 43% of the corpus and means "the minutes state no outcome" — not a
  // parse failure, and not a result.
  const p = councilResolutionPage(
    row({ result: "unknown" }),
    "bg",
    "https://electionsbg.com/x",
  );
  assert.ok(!/>unknown</.test(p.bodyHtml), "raw enum rendered as a result");
});

test("person links use the slug and only the slug", () => {
  const p = councilResolutionPage(row(), "bg", "https://electionsbg.com/x");
  assert.match(p.bodyHtml, /\/person\/ivan-ivanov-1/);
  // Петър has a person_id but no servable page — linking on the id would 404.
  assert.ok(!/\/person\/2\b/.test(p.bodyHtml));
  assert.match(p.bodyHtml, /Петър Петров/);
});

test("the untitled fallback matches the React screen byte for byte", () => {
  // 47% of the corpus stores the literal "(no title parsed)". The screen builds
  // its <h1> from council_resolution_untitled, so a divergence here changes the
  // heading on hydration. Both the date format and the null-number placeholder
  // have already diverged once.
  const tpl = JSON.parse(
    readFileSync(
      join(__dirname, "..", "src", "locales", "bg", "translation.json"),
      "utf8",
    ),
  ).council_resolution_untitled;
  const p = councilResolutionPage(
    row({ title: "(no title parsed)" }),
    "bg",
    "https://electionsbg.com/x",
  );
  const day = new Intl.DateTimeFormat("bg-BG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date("2025-04-29T00:00:00Z"));
  const expected = tpl
    .replace("{{number}}", "16891")
    .replace("{{date}}", day);
  assert.match(p.bodyHtml, new RegExp(`<h1>${expected}</h1>`));
});

test("a null number uses the same placeholder on both sides", () => {
  const p = councilResolutionPage(
    row({ title: "(no title parsed)", number: null }),
    "bg",
    "https://electionsbg.com/x",
  );
  // The screen substitutes an em dash; an ASCII hyphen here would change the
  // <h1> on hydration for any badly-parsed protokol.
  assert.match(p.bodyHtml, /<h1>Решение № — от /);
});

test("the function's labels agree with the locale files", () => {
  // A Cloud Function cannot import the locale JSON, so the labels exist twice
  // by necessity. This is what stops the two copies drifting.
  const load = (lang) =>
    JSON.parse(
      readFileSync(
        join(__dirname, "..", "src", "locales", lang, "translation.json"),
        "utf8",
      ),
    );
  for (const lang of ["bg", "en"]) {
    const loc = load(lang);
    const p = councilResolutionPage(row(), lang, "https://electionsbg.com/x");
    for (const key of ["for", "against", "abstain"]) {
      const label = loc[`council_vote_${key}`];
      assert.ok(label, `missing council_vote_${key} in ${lang}`);
    }
    // The two labels this fixture actually renders must be the locale's.
    assert.match(p.bodyHtml, new RegExp(escapeRe(loc.council_vote_for)));
    assert.match(p.bodyHtml, new RegExp(escapeRe(loc.council_vote_against)));
  }
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
