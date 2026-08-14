// Server-rendered head + crawlable body for the two page families that are too
// numerous to prerender: /funds/contract/<number> and /company/<eik>.
//
// WHY THIS EXISTS
// Both are real routes with real data behind them, and both served the SPA
// shell — which carries the HOMEPAGE's <title>, description and canonical. To a
// crawler, all 81,910 contract URLs and every company URL were duplicates of
// the homepage. That is an eligibility failure, not a ranking one: the pages
// could not compete for their own query because they never claimed to be about
// anything. Measured 2026-08-02:
//
//   curl -sL /funds/contract/BG16RFOP002-2.089-3686-C01
//   -> <title>Парламентарни избори 2026 — резултати и анализ от 2005</title>
//
// WHY NOT PRERENDER
// dist already holds 247,617 files; 81,910 contracts plus ~46,000 companies in
// two languages is ~256,000 more, and a 453k-file dist has failed to deploy
// before. Firebase's ceiling is on file COUNT, so this is the wall, not size.
//
// The same `db` function already serves a page URL ahead of its API gates (the
// /officials 301), so the shape is established — see functions/index.js.
//
// THE SHELL
// The function has no dist/, so it fetches one prerendered page once per
// instance and swaps the two marker blocks the prerender writes
// (<!-- SEO --> and <!-- BODY -->). That keeps the hashed asset script tags
// current with whatever hosting is actually serving, with no build coupling and
// no committed artifact. If the fetch fails the page still renders correct head
// tags without the SPA bundle — degraded for a human, complete for a crawler,
// which is the right way round for a failure nobody is watching.

const SEO_BLOCK = /<!-- SEO -->[\s\S]*?<!-- \/SEO -->/;
const BODY_BLOCK = /<!-- BODY -->[\s\S]*?<!-- \/BODY -->/;

const { SITE_ORIGIN } = require("./site_origin");
const SITE_URL = SITE_ORIGIN;

/** ИСУН contract numbers are [-.0-9A-Z] by construction (verified at ingest). */
const CONTRACT_NUMBER = /^[A-Za-z0-9.\-\s]{3,120}$/;
/** Bulgarian EIK/BULSTAT: 9 or 13 digits. */
const EIK = /^\d{9}(\d{4})?$/;

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Inline JSON-LD must escape the two sequences that can terminate or reopen a
// <script> element from inside its text: "</" and "<!--". A payload string is
// raw ИСУН text, so both are reachable.
// https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
const jsonLdScript = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--")}</script>`;

/** Cut a label to `max` chars on a word boundary. ИСУН free text is unbounded —
 *  contract titles run past 300 characters (the COVID schemes spell out the
 *  whole eligibility rule) and beneficiary names reach 199 — and a 340-char
 *  <title> is not a title. */
const truncateAtWord = (text, max) => {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:—–-]+$/, "")}…`;
};

const eur = (n, lang) =>
  `${Math.round(Number(n) || 0).toLocaleString(lang === "bg" ? "bg-BG" : "en-US").replace(/ /g, " ")} €`;

/** eur(), but NULL/undefined yields "" so a caller's `.filter(([, v]) => v)`
 *  can drop the row entirely.
 *
 *  eur() coerces null to "0 €", and "0 €" is truthy — so an absent figure
 *  survived that filter and was published as a zero. Measured: keep_id 28171
 *  has a NULL eu_funding_eur on a €1,407,400 project, and the crawlable body
 *  asserted "Средства от ЕС: 0 €" while FundsInterregScreen, on the same URL,
 *  rendered "—". A head that contradicts its own page is the one failure this
 *  module exists to prevent. Note €0 is a REAL value here — 30 operations carry
 *  a published total_budget_eur of 0 — so the test is on null, never on zero. */
const eurOrBlank = (n, lang) => (n == null ? "" : eur(n, lang));

/**
 * Parse a request path into the page we should render, or null when this
 * request is not ours.
 *
 * NOT wired into vite/db-api.ts: the dev server has no hosting rewrite, so
 * `npm run dev` serves these URLs through Vite's SPA fallback exactly as
 * production did before this module. The head-injection is therefore
 * production-only, and its tests are the parity check.
 */
const matchSpaPage = (path) => {
  if (typeof path !== "string" || !path) return null;
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  const en = clean.startsWith("/en/");
  const rest = en ? clean.slice(3) : clean;

  const contract = /^\/funds\/contract\/(.+)$/.exec(rest);
  if (contract) {
    const number = safeDecode(contract[1]);
    if (!number || !CONTRACT_NUMBER.test(number)) return null;
    return { kind: "contract", key: number, lang: en ? "en" : "bg" };
  }

  // The company page's sub-tabs (/company/<eik>/funds etc.) are the same entity
  // with a different default panel, so they take the same head rather than
  // falling through to the homepage's.
  const company = /^\/company\/(\d{9,13})(?:\/[a-z-]+)?$/.exec(rest);
  if (company) {
    if (!EIK.test(company[1])) return null;
    return { kind: "company", key: company[1], lang: en ? "en" : "bg" };
  }

  // Interreg operations. ~1,954 of them, so prerendering is affordable in
  // principle — but they land here for the same reason the contract family did:
  // without a head of their own every one served the HOMEPAGE's title,
  // description and canonical, so to a crawler they were all duplicates of "/".
  // Worse than dormant, since the My-Area and company tiles link into them.
  const interreg = /^\/funds\/interreg\/([1-9]\d{0,8})$/.exec(rest);
  if (interreg) {
    return { kind: "interreg", key: interreg[1], lang: en ? "en" : "bg" };
  }
  return null;
};

/** The URL a match names, in one place. Three kinds with three path shapes was
 *  already a two-branch ternary at the call site; a fourth would have made the
 *  canonical and the og:url easy to get quietly out of step with each other. */
const selfUrlFor = (match) => {
  const path =
    match.kind === "contract"
      ? `/funds/contract/${encodeURIComponent(match.key)}`
      : match.kind === "company"
        ? `/company/${match.key}`
        : `/funds/interreg/${match.key}`;
  return match.lang === "en" ? `${SITE_URL}/en${path}` : `${SITE_URL}${path}`;
};

// True for every path the hosting rewrites send here. Load-bearing and separate
// from matchSpaPage: once firebase.json routes /funds/contract/** and /company/**
// to this function, RETURNING FALSE IS NOT AN OPTION — the request would fall
// through to the /api/db gates below and a page URL would be answered with
// `{"error":"GET only"}` or a 403 on a foreign Origin. Anything under these
// prefixes that we cannot enrich gets the plain SPA shell instead, which is
// exactly the behaviour these URLs had before.
const isSpaPagePath = (path) => {
  if (typeof path !== "string" || !path) return false;
  const clean = path.split("?")[0];
  const rest = clean.startsWith("/en/") ? clean.slice(3) : clean;
  const stripped = rest.replace(/\/+$/, "");
  return (
    stripped === "/funds/contract" ||
    stripped === "/company" ||
    stripped === "/funds/interreg" ||
    rest.startsWith("/funds/contract/") ||
    rest.startsWith("/company/") ||
    rest.startsWith("/funds/interreg/")
  );
};

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** The <head> block and the crawlable body for one contract.
 *
 *  The ИСУН project name leads the <h1>, but it must NOT lead the <title>: it
 *  is a scheme label, not a per-contract one. 61% of the 82,011 contracts share
 *  their first 65 characters with another contract, and one prefix alone
 *  ("Преодоляване недостига на средства и липсата на ликвидност…") covers
 *  23,622 of them — so the ~60 characters a SERP actually renders were byte-
 *  identical across thousands of siblings. Google rewrote the title rather than
 *  truncating it, and the slice it kept read as a mangled company name:
 *  "2009 ЕООД — договор BG16RFPR001-1.004-2616" for a beneficiary whose name is
 *  "Национал - 2009 ЕООД". Beneficiary + contract number is unique on the first
 *  60 characters for 97% of the corpus, and is what a human searches, so it
 *  leads instead. The project name is not lost — it is still the <h1>, the
 *  JSON-LD name and the crawlable body. */
const contractPage = (row, lang, selfUrl) => {
  const bg = lang === "bg";
  // Beneficiary names reach 199 chars (p50 16, p90 33); cut the tail rather
  // than let one push the contract number out of the rendered slice.
  const who = truncateAtWord(row.beneficiaryName || row.title, 60);
  const title = bg
    ? `${who} — договор ${row.contractNumber} | Европейски средства`
    : `${who} — contract ${row.contractNumber} | EU funds`;
  const description = bg
    ? `${row.beneficiaryName} по ${row.programName}: ${eur(row.totalEur, lang)} договорени, ${eur(row.paidEur, lang)} изплатени. Договор ${row.contractNumber} от регистъра на ИСУН 2020.`
    : `${row.beneficiaryName} under ${row.programName}: ${eur(row.totalEur, lang)} contracted, ${eur(row.paidEur, lang)} paid. Contract ${row.contractNumber} from the ИСУН 2020 register.`;
  const base = bg ? SITE_URL : `${SITE_URL}/en`;
  const rows = [
    [bg ? "Бенефициент" : "Beneficiary", escapeHtml(row.beneficiaryName)],
    [bg ? "Програма" : "Programme", escapeHtml(row.programName)],
    [bg ? "Договорени" : "Contracted", eur(row.totalEur, lang)],
    [bg ? "Изплатени" : "Paid", eur(row.paidEur, lang)],
    [bg ? "Статус" : "Status", escapeHtml(row.status)],
    [bg ? "Място" : "Location", escapeHtml(row.locationRaw)],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`)
    .join("");
  const links = [
    row.beneficiaryEik
      ? `<a href="${base}/company/${escapeHtml(row.beneficiaryEik)}">${escapeHtml(row.beneficiaryName)}</a>`
      : null,
    row.programCode
      ? `<a href="${base}/funds/programme/${escapeHtml(row.programCode)}">${escapeHtml(row.programName)}</a>`
      : null,
    `<a href="${base}/funds">${bg ? "Европейски средства" : "EU funds"}</a>`,
  ].filter(Boolean);
  return {
    title,
    description,
    selfUrl,
    // ИСУН publishes this text in Bulgarian only, so the English page differs
    // from the Bulgarian in boilerplate alone. It stays navigable for a reader
    // on the English UI but points its canonical at the Bulgarian URL rather
    // than competing with it — the same call the procedure pages make.
    canonicalUrl: bg ? selfUrl : selfUrl.replace(`${SITE_URL}/en`, SITE_URL),
    lang,
    bodyHtml: `<h1>${escapeHtml(row.title)}</h1>
<p><strong>${escapeHtml(row.contractNumber)}</strong></p>
<table><tbody>${rows}</tbody></table>
<p>${links.join(" · ")}</p>`,
  };
};

/** The <head> block and the crawlable body for one Interreg operation.
 *
 *  TWO MONEY FIGURES, both named. The operation total is the whole cross-border
 *  project and the Bulgarian partners' share is a fraction of it — €1,419,208
 *  against Малко Търново's €357,183 on BSB00963. A description carrying only
 *  the first would tell a searcher the Bulgarian side received four times what
 *  it did, which is the single error this whole corpus is designed to prevent.
 *
 *  The title PREFERS the Bulgarian one and falls back to English. keep.eu has a
 *  `title_bg` for 272 of the 1,954 operations, so the fallback is the common
 *  case rather than the only one — an earlier draft of this comment claimed the
 *  corpus had none, from a 107-project sample. Inventing a translation for the
 *  remaining 1,682 would be a fabrication the page itself then contradicts, so
 *  they carry the English title and the description — which is Bulgarian and
 *  names the programme, the period and both money figures — does the work of
 *  making the result legible to a Bulgarian searcher. The same
 *  `titleBg ?? titleEn` rule runs in FundsInterregScreen, so head and page
 *  never disagree; the EN canonical points at the BG URL either way.
 */
const interregPage = (row, lang, selfUrl) => {
  const bg = lang === "bg";
  const title = truncateAtWord(row.titleBg || row.titleEn || "", 70);
  const programme =
    (bg ? row.programmeBg : row.programmeEn) || row.programmeCode || "";
  const head = bg
    ? `${title} — Interreg | Трансгранични проекти`
    : `${title} — Interreg | Cross-border projects`;
  const partners = row.partnerCount ?? (row.partners || []).length;
  // A missing total is said to be unpublished rather than printed as zero — the
  // description is the SERP snippet, so "0 €" there is a claim about the money.
  const money = bg
    ? row.totalBudgetEur == null
      ? `бюджетът на целия проект не е публикуван; ${eur(row.bgBudgetEur, lang)} за ${row.bgPartnerCount} български партньор(а) от общо ${partners}`
      : `целият проект ${eur(row.totalBudgetEur, lang)}, от които ${eur(row.bgBudgetEur, lang)} за ${row.bgPartnerCount} български партньор(а) от общо ${partners}`
    : row.totalBudgetEur == null
      ? `whole-project budget unpublished; ${eur(row.bgBudgetEur, lang)} to ${row.bgPartnerCount} Bulgarian partner(s) of ${partners}`
      : `${eur(row.totalBudgetEur, lang)} whole project, of which ${eur(row.bgBudgetEur, lang)} to ${row.bgPartnerCount} Bulgarian partner(s) of ${partners}`;
  const description = bg
    ? `${programme} (${row.period}): ${money}. Данни от keep.eu (INTERACT) — Interreg не се управлява през ИСУН.`
    : `${programme} (${row.period}): ${money}. Data from keep.eu (INTERACT) — Interreg is not run through ИСУН.`;
  const base = bg ? SITE_URL : `${SITE_URL}/en`;
  const rows = [
    [bg ? "Програма" : "Programme", escapeHtml(programme)],
    [bg ? "Период" : "Period", escapeHtml(row.period)],
    [
      bg ? "Целият проект" : "Whole project",
      eurOrBlank(row.totalBudgetEur, lang),
    ],
    [
      bg ? "Български партньори" : "Bulgarian partners",
      eurOrBlank(row.bgBudgetEur, lang),
    ],
    [
      bg ? "Средства от ЕС" : "EU funding",
      eurOrBlank(row.euFundingEur, lang),
    ],
    [bg ? "Статус" : "Status", escapeHtml(row.status)],
    [
      bg ? "Държави" : "Countries",
      escapeHtml((row.countries || []).join(", ")),
    ],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`)
    .join("");
  // Every partner, foreign ones included — a crawlable body describing a
  // cross-border project as Bulgarian-only would describe a project that does
  // not exist. Linked by EIK where keep.eu published one (2021-2027 only).
  const partnerList = (row.partners || [])
    .map((p) => {
      const name = escapeHtml(p.name || p.nameEn || "");
      const linked = p.eik
        ? `<a href="${base}/company/${escapeHtml(p.eik)}">${name}</a>`
        : name;
      const money =
        p.budgetEur != null
          ? ` — ${eur(p.budgetEur, lang)}`
          : bg
            ? " — без публикуван бюджет"
            : " — no published budget";
      return `<li>${linked} (${escapeHtml(p.country)})${money}${
        p.isLead ? (bg ? " · водещ" : " · lead") : ""
      }</li>`;
    })
    .join("");
  return {
    title: head,
    description,
    selfUrl,
    // keep.eu is English-only, so the two language pages differ in boilerplate
    // alone. Same call the contract family makes: stay navigable on the English
    // UI, point the canonical at the Bulgarian URL rather than compete with it.
    canonicalUrl: bg ? selfUrl : selfUrl.replace(`${SITE_URL}/en`, SITE_URL),
    lang,
    bodyHtml: `<h1>${escapeHtml(row.titleBg || row.titleEn || "")}</h1>
<p><strong>${escapeHtml(programme)}</strong>${row.operationId ? ` · ${escapeHtml(row.operationId)}` : ""}</p>
<table><tbody>${rows}</tbody></table>
<ul>${partnerList}</ul>
<p><a href="${base}/funds">${bg ? "Европейски средства" : "EU funds"}</a> · <a href="https://keep.eu/">keep.eu</a></p>`,
  };
};

/** The <head> block and the crawlable body for one company. */
const companyPage = (co, money, lang, selfUrl) => {
  const bg = lang === "bg";
  const base = bg ? SITE_URL : `${SITE_URL}/en`;
  const title = bg
    ? `${co.name} (ЕИК ${co.uic}) — обществени поръчки и европейски средства`
    : `${co.name} (EIK ${co.uic}) — public contracts and EU funds`;
  const parts = [];
  if (money.contracts > 0)
    parts.push(
      bg
        ? `${money.contracts} обществени поръчки за ${eur(money.contractsEur, lang)}`
        : `${money.contracts} public contracts worth ${eur(money.contractsEur, lang)}`,
    );
  if (money.fundsEur > 0)
    parts.push(
      bg
        ? `${eur(money.fundsEur, lang)} по европейски програми`
        : `${eur(money.fundsEur, lang)} in EU funding`,
    );
  const description = parts.length
    ? bg
      ? `${co.name}: ${parts.join(" и ")}. Профил по данни от Търговския регистър, АОП и ИСУН 2020.`
      : `${co.name}: ${parts.join(" and ")}. Profile from the Commerce Registry, the public-procurement register and ИСУН 2020.`
    : bg
      ? `${co.name} (ЕИК ${co.uic}) — профил на фирмата по данни от Търговския регистър: правна форма, седалище, статус и публично финансиране.`
      : `${co.name} (EIK ${co.uic}) — company profile from the Commerce Registry: legal form, seat, status and public money received.`;
  const rows = [
    [bg ? "ЕИК" : "EIK", escapeHtml(co.uic)],
    [bg ? "Правна форма" : "Legal form", escapeHtml(co.legal_form)],
    [bg ? "Седалище" : "Seat", escapeHtml(co.seat)],
    [bg ? "Статус" : "Status", escapeHtml(co.status)],
    money.contracts > 0
      ? [bg ? "Обществени поръчки" : "Public contracts", String(money.contracts)]
      : null,
    money.contractsEur > 0
      ? [
          bg ? "Стойност на поръчките" : "Contract value",
          eur(money.contractsEur, lang),
        ]
      : null,
    money.fundsEur > 0
      ? [bg ? "Европейски средства" : "EU funds", eur(money.fundsEur, lang)]
      : null,
  ]
    .filter((r) => r && r[1])
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`)
    .join("");
  return {
    title,
    description,
    selfUrl,
    // Company names come from the Търговски регистър in Bulgarian only — see
    // the note on contractPage.
    canonicalUrl: bg ? selfUrl : selfUrl.replace(`${SITE_URL}/en`, SITE_URL),
    ogImage: "/og/procurement.webp",
    lang,
    bodyHtml: `<h1>${escapeHtml(co.name)}</h1>
<table><tbody>${rows}</tbody></table>
<p><a href="${base}/procurement">${bg ? "Обществени поръчки" : "Public procurement"}</a> · <a href="${base}/funds">${bg ? "Европейски средства" : "EU funds"}</a></p>`,
  };
};

// A page under our prefixes that we could not name keeps the shell's head —
// which is the HOMEPAGE's. That is the very duplication this module exists to
// end, so mark it noindex: it is an unknown contract number or a malformed EIK,
// it is in no sitemap, and it should never enter the index as a homepage twin.
//
// The shell already carries `<meta name="robots" content="index, follow" />`
// from index.html, OUTSIDE the SEO block we replace — so appending a second tag
// left the page shipping two conflicting directives. Google resolves that our
// way (the most restrictive wins), but a page that relies on conflict
// resolution reads as a defect to anyone auditing it and is only as safe as the
// next crawler's tie-break. Strip every existing robots meta first, then emit
// exactly one.
const ROBOTS_META = /<meta\b[^>]*\bname=["']robots["'][^>]*>[ \t]*\n?[ \t]*/gi;

const noindex = (shell) =>
  shell
    .replace(ROBOTS_META, "")
    .replace(
      /<!-- SEO -->/,
      () => '<!-- SEO -->\n    <meta name="robots" content="noindex" />',
    );

/** True when a shell carries both blocks renderIntoShell replaces. */
const hasMarkers = (shell) =>
  typeof shell === "string" && SEO_BLOCK.test(shell) && BODY_BLOCK.test(shell);

/**
 * Swap the prerender's two marker blocks in a shell.
 *
 * Throws on a shell without them rather than returning it unchanged: a silent
 * no-op serves the HOMEPAGE's head at a 200, which is precisely the bug this
 * module exists to fix, and nothing downstream would notice.
 */
const renderIntoShell = (shell, page) => {
  if (!hasMarkers(shell))
    throw new Error("spa shell is missing its SEO/BODY marker blocks");
  const canonical = page.canonicalUrl ?? page.selfUrl;
  const bgUrl = page.selfUrl.replace(`${SITE_URL}/en`, SITE_URL);
  const enUrl = bgUrl.replace(SITE_URL, `${SITE_URL}/en`);
  const seo = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(page.selfUrl)}" />`,
    `<meta property="og:locale" content="${page.lang === "en" ? "en_US" : "bg_BG"}" />`,
    // The shell's SEO block carries these and we replace the whole block, so
    // omitting them would REGRESS the social card against today's behaviour.
    `<meta property="og:image" content="${SITE_URL}${page.ogImage ?? "/og/funds.webp"}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(page.title)}" />`,
    `<meta name="twitter:image" content="${SITE_URL}${page.ogImage ?? "/og/funds.webp"}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    // Only the canonical page advertises alternates — a variant that points its
    // canonical elsewhere is not an alternate of anything.
    ...(page.canonicalUrl && page.canonicalUrl !== page.selfUrl
      ? []
      : [
          `<link rel="alternate" hreflang="bg" href="${escapeHtml(bgUrl)}" />`,
          `<link rel="alternate" hreflang="en" href="${escapeHtml(enUrl)}" />`,
          `<link rel="alternate" hreflang="x-default" href="${escapeHtml(bgUrl)}" />`,
        ]),
    jsonLdScript({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.title,
      description: page.description,
      url: canonical,
      inLanguage: page.lang,
    }),
  ].join("\n    ");
  // The replacements are FUNCTIONS, not strings: String.replace interprets `$&`,
  // `$\``, `$'` and `$1` inside a string replacement, and ИСУН contract titles
  // are arbitrary text. A title containing `$&` spliced the homepage's <title>
  // and canonical straight back into the head — escapeHtml does not help,
  // because `$` is not an HTML metacharacter.
  const html = shell
    .replace(SEO_BLOCK, () => `<!-- SEO -->\n    ${seo}\n    <!-- /SEO -->`)
    .replace(
      BODY_BLOCK,
      () =>
        `<!-- BODY -->\n    <div id="ssg-content" hidden>${page.bodyHtml}</div>\n    <!-- /BODY -->`,
    );
  // <html lang> ships as "bg"; an English page must not claim otherwise.
  return page.lang === "en"
    ? html.replace(/<html lang="bg"/, () => '<html lang="en"')
    : html;
};

// A shell with correct head tags and no SPA bundle. Used only when the shell
// fetch fails — a crawler still gets the full, correct page; a human gets a
// readable stub with a link out rather than a blank screen.
const FALLBACK_SHELL = `<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- SEO --><!-- /SEO -->
</head><body><!-- BODY --><!-- /BODY -->
<p><a href="/">Наясно</a></p></body></html>`;

/**
 * Handle a request as a server-rendered SPA page.
 *
 * @returns {Promise<boolean>} true when the response has been sent.
 */
const handleSpaPageRequest = async (req, res, deps) => {
  if (!isSpaPagePath(req.path)) return false;

  // `transient` separates "this entity does not exist" from "the database was
  // unreachable for a moment". Collapsing them would cache a blip for an hour
  // AND mark a working URL noindex — on a real page, from one bad second.
  const sendShell = async (page, { transient = false } = {}) => {
    let shell = FALLBACK_SHELL;
    try {
      const fetched = await deps.loadShell();
      if (hasMarkers(fetched)) shell = fetched;
      else console.error("spa shell has no marker blocks; using fallback");
    } catch (e) {
      console.error("spa shell fetch failed, serving bundle-less page", e);
    }
    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      // The rows behind a page change only on a re-ingest, so an hour at the
      // edge is safe. A transient failure is never cached — it would pin a
      // wrong answer to a working URL.
      .set(
        "Cache-Control",
        transient
          ? "no-store"
          : "public, max-age=300, s-maxage=3600",
      )
      .send(page ? renderIntoShell(shell, page) : noindex(shell));
    return true;
  };

  const match = matchSpaPage(req.path);
  // Under our prefixes but not an entity we can name (a malformed number, an
  // unknown sub-route): serve the SPA untouched rather than inventing a head.
  if (!match) return sendShell(null);
  // Same reasoning as the /officials 301: this is a PAGE url, so HEAD must work
  // — link checkers and half the crawlers use it.
  if (req.method !== "GET" && req.method !== "HEAD") return sendShell(null);

  const selfUrl = selfUrlFor(match);

  let page = null;
  try {
    page =
      match.kind === "contract"
        ? await deps.loadContract(match.key, match.lang, selfUrl)
        : match.kind === "company"
          ? await deps.loadCompany(match.key, match.lang, selfUrl)
          : await deps.loadInterreg(match.key, match.lang, selfUrl);
  } catch (e) {
    console.error("spa page lookup error", match.kind, match.key, e);
    // A database blip must not take the page down: serve the SPA, which fetches
    // its own data client-side. Uncached, because it will work again shortly.
    return sendShell(null, { transient: true });
  }
  // Unknown entity — the SPA renders its own not-found state. Inventing a head
  // here would mint an indexable 200 for every typo.
  return sendShell(page);
};

module.exports = {
  interregPage,
  selfUrlFor,
  matchSpaPage,
  isSpaPagePath,
  renderIntoShell,
  contractPage,
  companyPage,
  handleSpaPageRequest,
  FALLBACK_SHELL,
  SITE_URL,
};
