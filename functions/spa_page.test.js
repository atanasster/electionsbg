const test = require("node:test");
const assert = require("node:assert");
const {
  matchSpaPage,
  renderIntoShell,
  contractPage,
  companyPage,
  handleSpaPageRequest,
  FALLBACK_SHELL,
  isSpaPagePath,
} = require("./spa_page.js");

// A shell shaped like the one hosting serves: homepage head + body inside the
// prerender's marker blocks, which is exactly what must be replaced.
const SHELL = `<!doctype html>
<html lang="bg"><head>
<meta name="robots" content="index, follow" />
<!-- SEO -->
<title>Парламентарни избори 2026 | electionsbg.com</title>
<meta name="description" content="homepage" />
<link rel="canonical" href="https://electionsbg.com/" />
<!-- /SEO -->
<script src="/assets/index-abc123.js"></script>
</head><body>
<!-- BODY --><div id="ssg-content" hidden><h1>Начало</h1></div><!-- /BODY -->
<div id="root"></div></body></html>`;

const CONTRACT = {
  contractNumber: "BG16RFOP002-2.089-0001",
  title: "Подкрепа за малки предприятия",
  beneficiaryEik: "203740812",
  beneficiaryName: 'НК "ЖИ" ЕАД',
  programCode: "2014BG16RFOP002",
  programName: "Иновации и конкурентоспособност",
  totalEur: 25520,
  paidEur: 25520,
  status: "Приключен",
  locationRaw: "гр.София",
};

test("matchSpaPage claims the two page families in both languages", () => {
  assert.deepEqual(matchSpaPage("/funds/contract/BG16RFOP002-2.089-0001"), {
    kind: "contract",
    key: "BG16RFOP002-2.089-0001",
    lang: "bg",
  });
  assert.deepEqual(matchSpaPage("/en/funds/contract/BG-RRP-1.015-0042"), {
    kind: "contract",
    key: "BG-RRP-1.015-0042",
    lang: "en",
  });
  assert.deepEqual(matchSpaPage("/company/203740812"), {
    kind: "company",
    key: "203740812",
    lang: "bg",
  });
  assert.deepEqual(matchSpaPage("/en/company/203740812"), {
    kind: "company",
    key: "203740812",
    lang: "en",
  });
});

test("a company sub-tab is the same entity, not the homepage", () => {
  // /company/<eik>/funds is the same company with a different default panel;
  // falling through would give it the homepage's title.
  assert.deepEqual(matchSpaPage("/company/203740812/funds"), {
    kind: "company",
    key: "203740812",
    lang: "bg",
  });
});

test("matchSpaPage decodes a percent-encoded contract number", () => {
  assert.equal(
    matchSpaPage("/funds/contract/BG16RFOP002-2.089-0001%20").key,
    "BG16RFOP002-2.089-0001 ",
  );
});

test("matchSpaPage claims nothing else", () => {
  for (const p of [
    "/",
    "/funds",
    "/funds/programme/2014BG16RFOP002",
    "/api/db/fund-payload",
    "/company/",
    "/company/12345", // too short for an EIK
    "/company/abc123456",
    "/funds/contract/", // no number
    "/funds/contract/../../etc/passwd",
    "",
    null,
    undefined,
  ]) {
    assert.equal(matchSpaPage(p), null, `should not claim ${JSON.stringify(p)}`);
  }
});

test("renderIntoShell replaces the head and body, keeping the bundle", () => {
  const html = renderIntoShell(
    SHELL,
    contractPage(CONTRACT, "bg", "https://electionsbg.com/funds/contract/x"),
  );
  // The homepage's identity is gone …
  assert.ok(!html.includes("Парламентарни избори 2026"));
  assert.ok(!html.includes('content="homepage"'));
  assert.ok(!html.includes('href="https://electionsbg.com/" />'));
  // … replaced by this page's, and the SPA bundle survives.
  assert.ok(html.includes("<title>НК &quot;ЖИ&quot; ЕАД — договор BG16RFOP002-2.089-0001"));
  assert.ok(html.includes('canonical" href="https://electionsbg.com/funds/contract/x"'));
  assert.ok(html.includes("/assets/index-abc123.js"));
  assert.ok(html.includes('<div id="root">'));
  assert.ok(html.includes("BG16RFOP002-2.089-0001"));
});

test("the English page does not claim lang=bg", () => {
  const html = renderIntoShell(
    SHELL,
    contractPage(CONTRACT, "en", "https://electionsbg.com/en/funds/contract/x"),
  );
  assert.ok(html.includes('<html lang="en"'));
  assert.ok(!html.includes('<html lang="bg"'));
  assert.ok(html.includes("Contracted"));
});

// The row exactly as fund_projects holds it for the contract that surfaced the
// defect. ИСУН's beneficiary field is title-case ("Национал - 2009 ЕООД"); the
// all-caps "НАЦИОНАЛ - 2009 ЕООД" a reader sees on the page is the PROJECT
// title's spelling, and the <title> is built from the beneficiary field.
const NATIONAL_2009 = {
  contractNumber: "BG16RFPR001-1.004-2616",
  title:
    "Подобряване на производствения капацитет в семейното предприятие НАЦИОНАЛ - 2009 ЕООД",
  beneficiaryEik: "205308765",
  beneficiaryName: "Национал - 2009 ЕООД",
  programCode: "2021BG16RFPR001",
  programName:
    'Програма "Конкурентоспособност и иновации в предприятията" 2021-2027',
  totalEur: 91887,
  paidEur: 0,
  status: "В изпълнение",
  locationRaw: "гр.Хисаря",
};

// Roughly what a SERP renders before it truncates. Not a promise about Google —
// the point is that the whole beneficiary name fits inside any plausible cut,
// so no rewrite can leave a reader with a fragment of a company name.
const SERP_CHARS = 60;

test("a hyphenated company name reaches the SERP whole, not as its tail", () => {
  // Google rendered "2009 ЕООД — договор BG16RFPR001-1.004-2616" for this page:
  // a contiguous slice of a 145-char <title> that begins mid-company-name and
  // reads as a different company. Both languages, through the full shell
  // splice, since that is what the crawler is served.
  for (const [lang, url] of [
    ["bg", "https://electionsbg.com/funds/contract/BG16RFPR001-1.004-2616"],
    ["en", "https://electionsbg.com/en/funds/contract/BG16RFPR001-1.004-2616"],
  ]) {
    const html = renderIntoShell(
      SHELL,
      contractPage(NATIONAL_2009, lang, url),
    );
    const title = /<title>([^<]*)<\/title>/.exec(html)[1];
    const visible = title.slice(0, SERP_CHARS);

    // The name is present in full, and the segment before the hyphen — the part
    // that went missing — is inside the rendered window, not past the cut.
    assert.ok(
      visible.includes("Национал - 2009 ЕООД"),
      `beneficiary not whole in the first ${SERP_CHARS} chars: ${visible}`,
    );
    // "2009 ЕООД" must never be what the title leads with.
    assert.ok(!title.startsWith("2009 ЕООД"));
    assert.ok(title.startsWith("Национал - 2009 ЕООД"));
    // The contract number survives the cut too, so the exact-match query for it
    // still shows a title a human can identify.
    assert.ok(visible.includes("BG16RFPR001-1.004-2616"), visible);
  }
});

test("the scheme label never leads the contract <title>", () => {
  // 61% of the 82,011 ИСУН contracts share their first 65 title characters with
  // another contract, and one scheme prefix covers 23,622 of them — so leading
  // with row.title made the whole rendered SERP slice identical across
  // thousands of sibling pages, and Google rewrote it into what looked like a
  // truncated company name. The beneficiary and the contract number are what
  // distinguish the page, so both must land inside the first 60 characters.
  const page = contractPage(
    {
      ...CONTRACT,
      title:
        "Преодоляване недостига на средства и липсата на ликвидност, настъпили в резултат от епидемичния взрив от COVID-19",
    },
    "bg",
    "https://electionsbg.com/funds/contract/x",
  );
  assert.ok(!page.title.startsWith("Преодоляване"));
  assert.ok(page.title.slice(0, 60).includes('НК "ЖИ" ЕАД'));
  assert.ok(page.title.slice(0, 60).includes("BG16RFOP002-2.089-0001"));
  // The scheme label is not lost — it is still the <h1> and the crawlable body.
  assert.ok(page.bodyHtml.includes("<h1>Преодоляване недостига"));
});

test("a beneficiary name long enough to bury the contract number is cut", () => {
  const page = contractPage(
    { ...CONTRACT, beneficiaryName: "Сдружение ".repeat(20).trim() },
    "bg",
    "https://electionsbg.com/funds/contract/x",
  );
  assert.ok(page.title.includes("…"));
  assert.ok(page.title.includes("договор BG16RFOP002-2.089-0001"));
});

test("ИСУН text is escaped — names routinely carry quotes", () => {
  const hostile = 'x <img src=y onerror=1> & "z" </script><!--';
  const html = renderIntoShell(
    SHELL,
    contractPage(
      { ...CONTRACT, title: hostile },
      "bg",
      "https://electionsbg.com/funds/contract/x",
    ),
  );
  // Nothing hostile survives as markup in the head or the body …
  const outsideJsonLd = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    "",
  );
  assert.ok(!outsideJsonLd.includes("<img src=y"));
  assert.ok(outsideJsonLd.includes("&amp;"));
  assert.ok(outsideJsonLd.includes("&quot;ЖИ&quot;"));
  // … and inside the JSON-LD nothing can terminate or reopen the <script>.
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
    html,
  );
  assert.ok(ld, "JSON-LD block present");
  assert.ok(!ld[1].includes("</"));
  assert.ok(!ld[1].includes("<!--"));
});

test("the company head names the money when there is any", () => {
  const page = companyPage(
    {
      uic: "203740812",
      name: "Фонд мениджър ЕАД",
      legal_form: "ЕАД",
      seat: "гр.София",
      status: "active",
    },
    { contracts: 3, contractsEur: 1000, fundsEur: 2000 },
    "bg",
    "https://electionsbg.com/company/203740812",
  );
  assert.ok(page.title.includes("203740812"));
  assert.ok(page.description.includes("3 обществени поръчки"));
  assert.ok(page.bodyHtml.includes("Фонд мениджър ЕАД"));
});

test("a company with no public money still gets its own description", () => {
  const page = companyPage(
    {
      uic: "203740812",
      name: "Тиха ЕООД",
      legal_form: "ЕООД",
      seat: "гр.Русе",
      status: "active",
    },
    { contracts: 0, contractsEur: 0, fundsEur: 0 },
    "bg",
    "https://electionsbg.com/company/203740812",
  );
  assert.ok(page.description.includes("Тиха ЕООД"));
  assert.ok(!page.description.includes("undefined"));
  assert.ok(!page.description.includes("NaN"));
});

// ── handleSpaPageRequest ────────────────────────────────────────────────────

const fakeRes = () => {
  const r = {
    statusCode: null,
    headers: {},
    body: null,
    status(c) {
      r.statusCode = c;
      return r;
    },
    set(k, v) {
      r.headers[k] = v;
      return r;
    },
    send(b) {
      r.body = b;
      return r;
    },
  };
  return r;
};

const deps = (over = {}) => ({
  loadShell: async () => SHELL,
  loadContract: async (key, lang, selfUrl) =>
    contractPage(CONTRACT, lang, selfUrl),
  loadCompany: async () => null,
  ...over,
});

test("handleSpaPageRequest serves a matched contract", async () => {
  const res = fakeRes();
  const handled = await handleSpaPageRequest(
    { path: "/funds/contract/BG16RFOP002-2.089-0001", method: "GET" },
    res,
    deps(),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("<title>НК &quot;ЖИ&quot; ЕАД — договор BG16RFOP002-2.089-0001"));
});

test("HEAD is served — link checkers and half the crawlers use it", async () => {
  const res = fakeRes();
  assert.equal(
    await handleSpaPageRequest(
      { path: "/funds/contract/x-0001", method: "HEAD" },
      res,
      deps(),
    ),
    true,
  );
});

test("a POST under our prefix still gets HTML, never the JSON API", async () => {
  const res = fakeRes();
  const handled = await handleSpaPageRequest(
    { path: "/funds/contract/x-0001", method: "POST" },
    res,
    deps(),
  );
  assert.equal(handled, true);
  assert.ok(res.body.includes("<!doctype html>"));
});

test("isSpaPagePath owns everything the hosting rewrites send here", () => {
  // Returning false for any of these would drop the request into the /api/db
  // gates, and a page URL would be answered with {"error":"GET only"}.
  for (const p of [
    "/funds/contract/anything",
    "/funds/contract/",
    "/en/funds/contract/x",
    "/company/12345",
    "/company/",
    "/en/company/abc",
  ])
    assert.equal(isSpaPagePath(p), true, p);
  for (const p of ["/", "/funds", "/api/db/x", "/companyx/1", "", null])
    assert.equal(isSpaPagePath(p), false, String(p));
});

test("an unknown entity gets the untouched SPA, not an invented head", async () => {
  const res = fakeRes();
  const handled = await handleSpaPageRequest(
    { path: "/funds/contract/NOPE-0001", method: "GET" },
    res,
    deps({ loadContract: async () => null }),
  );
  // Handled — hosting already routed it here, so falling through would answer
  // a page URL from the JSON API. But the head stays the shell's.
  assert.equal(handled, true);
  assert.ok(res.body.includes("Парламентарни избори 2026"));
  // …but it must not enter the index as a homepage twin, which is the exact
  // duplication this module exists to end.
  assert.ok(res.body.includes('name="robots" content="noindex"'));
  // …and it must say so ONCE. The shell carries `index, follow` from
  // index.html, outside the SEO block, so appending shipped two conflicting
  // directives. Google resolves that our way, but a page whose indexing depends
  // on a tie-break reads as a defect and is only as safe as the next crawler.
  const robots = res.body.match(/<meta\b[^>]*\bname="robots"[^>]*>/g) ?? [];
  assert.equal(robots.length, 1, robots.join(" | "));
  assert.match(robots[0], /content="noindex"/);
});

test("an enriched page keeps the shell's single indexable robots tag", () => {
  // The strip runs only on the noindex path — an entity we CAN name is a real
  // page and must stay indexable, with the shell's one tag untouched.
  const html = renderIntoShell(
    SHELL,
    contractPage(CONTRACT, "bg", "https://electionsbg.com/funds/contract/x"),
  );
  const robots = html.match(/<meta\b[^>]*\bname="robots"[^>]*>/g) ?? [];
  assert.equal(robots.length, 1, robots.join(" | "));
  assert.match(robots[0], /content="index, follow"/);
});

test("a lookup failure serves the SPA instead of 500ing a page URL", async () => {
  const res = fakeRes();
  const handled = await handleSpaPageRequest(
    { path: "/funds/contract/x-0001", method: "GET" },
    res,
    deps({
      loadContract: async () => {
        throw new Error("db down");
      },
    }),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('<div id="root">'));
});

test("a shell fetch failure still serves correct head tags", async () => {
  // Degraded for a human, complete for a crawler — the right way round for a
  // failure nobody is watching.
  const res = fakeRes();
  const handled = await handleSpaPageRequest(
    { path: "/funds/contract/x-0001", method: "GET" },
    res,
    deps({
      loadShell: async () => {
        throw new Error("hosting down");
      },
    }),
  );
  assert.equal(handled, true);
  assert.ok(res.body.includes("<title>НК &quot;ЖИ&quot; ЕАД — договор BG16RFOP002-2.089-0001"));
  assert.ok(res.body.includes("BG16RFOP002-2.089-0001"));
});

test("a $-pattern in ИСУН text cannot splice the homepage back in", () => {
  // String.replace interprets $&, $`, $' and $1 in a STRING replacement, and a
  // contract title is arbitrary text. This spliced the homepage's <title> and
  // canonical straight into the head before the replacements became functions.
  const html = renderIntoShell(
    SHELL,
    contractPage(
      { ...CONTRACT, title: "цена $& и $` и $' и $1" },
      "bg",
      "https://electionsbg.com/funds/contract/x",
    ),
  );
  assert.ok(!html.includes("Парламентарни избори 2026"));
  assert.ok(!html.includes('content="homepage"'));
  assert.equal((html.match(/<title>/g) || []).length, 1);
});

test("a marker-less shell throws rather than serving the homepage head", () => {
  // Returning it unchanged is a 200 carrying the wrong identity, which is the
  // exact bug this module exists to fix — and nothing downstream would notice.
  assert.throws(
    () =>
      renderIntoShell(
        "<html><head></head><body></body></html>",
        contractPage(CONTRACT, "bg", "https://electionsbg.com/x"),
      ),
    /marker blocks/,
  );
});

test("the canonical page advertises hreflang; the /en duplicate does not", () => {
  const bg = renderIntoShell(
    SHELL,
    contractPage(CONTRACT, "bg", "https://electionsbg.com/funds/contract/x"),
  );
  assert.ok(bg.includes('hreflang="bg"'));
  assert.ok(bg.includes('hreflang="x-default"'));
  const en = renderIntoShell(
    SHELL,
    contractPage(CONTRACT, "en", "https://electionsbg.com/en/funds/contract/x"),
  );
  // It canonicalises back to BG, so it is not an alternate of anything.
  assert.ok(!en.includes("hreflang="));
  assert.ok(
    en.includes('canonical" href="https://electionsbg.com/funds/contract/x"'),
  );
});

test("the social card survives the block replacement", () => {
  // We replace the shell's whole SEO block, so omitting these would REGRESS
  // og:image against today.
  const html = renderIntoShell(
    SHELL,
    contractPage(CONTRACT, "bg", "https://electionsbg.com/funds/contract/x"),
  );
  assert.ok(html.includes('property="og:image"'));
  assert.ok(html.includes('name="twitter:image"'));
});

test("a transient failure is never cached; a real miss is", async () => {
  const bad = fakeRes();
  await handleSpaPageRequest(
    { path: "/funds/contract/x-0001", method: "GET" },
    bad,
    deps({
      loadContract: async () => {
        throw new Error("db down");
      },
    }),
  );
  // Caching a blip would pin a wrong answer to a working URL for an hour.
  assert.equal(bad.headers["Cache-Control"], "no-store");

  const miss = fakeRes();
  await handleSpaPageRequest(
    { path: "/funds/contract/x-0001", method: "GET" },
    miss,
    deps({ loadContract: async () => null }),
  );
  assert.ok(miss.headers["Cache-Control"].includes("s-maxage"));
});

test("isSpaPagePath owns the bare prefixes too", () => {
  // `/company` alone would otherwise fall into the /api/db gates.
  assert.equal(isSpaPagePath("/company"), true);
  assert.equal(isSpaPagePath("/funds/contract"), true);
  assert.equal(isSpaPagePath("/en/company/"), true);
});

test("the fallback shell carries both marker blocks", () => {
  // Without them renderIntoShell would silently emit a page with no head.
  assert.ok(FALLBACK_SHELL.includes("<!-- SEO -->"));
  assert.ok(FALLBACK_SHELL.includes("<!-- /SEO -->"));
  assert.ok(FALLBACK_SHELL.includes("<!-- BODY -->"));
  assert.ok(FALLBACK_SHELL.includes("<!-- /BODY -->"));
});
