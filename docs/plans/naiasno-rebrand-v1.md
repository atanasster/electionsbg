# Наясно rebrand — domain, SEO, social and video channels (v1)

Status: **plan, nothing executed.** Written 2026-08-09.

The platform outgrew "elections" years ago. It now carries procurement, the state
budget, EU funds, declarations, roll-call votes, the judiciary, health, agriculture,
prices, schools, demographics and local elections — but every title on it still ends
`| electionsbg.com`, its `og:site_name` is `Elections Bulgaria`, and its Organization
JSON-LD says the same. The rebrand to **Наясно** closes that gap.

The one thing this plan insists on: **the rename and the domain move are separate
projects with separate risk.** Renaming is near-zero-risk and can ship this week. A
domain move of ~147,000 indexed URLs is the highest-risk change this repo has ever
made, and it earns its own gate, its own baseline and its own rollback.

---

## 0. Decisions needed before anything is executed

### D1 — Which domain is canonical: `naiasno.bg` or `naiasno.com`?

Both were **verified available at the registry on 2026-08-09**
(`whois -h whois.register.bg naiasno.bg` → `registration status: available`;
`whois -h whois.verisign-grs.com naiasno.com` → `No match`). Register **both**
regardless — the second one is defensive and costs a rounding error.

The choice matters because **`.bg` is a ccTLD and is hard-geotargeted to Bulgaria by
Google. That geo-signal cannot be removed** — Search Console's International Targeting
control is unavailable for ccTLDs. The site ships a full English mirror (`/en/...`),
roughly half the prerendered surface, plus `llms-full.en.txt` for AI crawlers.

| | `naiasno.bg` | `naiasno.com` |
|---|---|---|
| In-market trust (BG readers, journalists, institutions) | strongest | neutral |
| EN mirror's international reach | permanently suppressed | unaffected |
| Registration friction | ID/company docs at a BG registrar | instant, any registrar |
| Matches the FB-first, BG-language strategy | yes | yes |

**Recommendation: `naiasno.bg` canonical, `naiasno.com` 301 → it — gated on one
measurement.** Pull Search Console and check what share of clicks land on `/en/`
paths. If EN is under ~5% of clicks, `.bg` is clearly right and the loss is noise. If
EN is materially larger, flip the recommendation and make `.com` canonical with `.bg`
redirecting to it.

**Rejected: splitting BG onto `.bg` and EN onto `.com`.** Cross-domain hreflang is a
known footgun, it doubles the surface every sitemap/canonical/prerender gate has to
cover, and `tests/seo.spec.ts`'s "no declared URL may redirect" assertion would have to
learn about two origins. Not worth it for a mirror this size.

### D2 — Does `ai.electionsbg.com` move in the same window?

It should. Leaving "Наясно AI" on an `electionsbg.com` subdomain after the main site is
`naiasno.bg` is exactly the brand split this project exists to end, and it keeps a
second Search Console property alive on a dead brand. It is a separate Firebase site
(`electionsbg-ai`, target `ai`) with its own `dist-ai`, ~12 hardcoded domain strings in
`ai/index.html` and a handful in `ai/app/`, so it is a small job — but it must be in
the same runbook, because `functions/send_json.js` CORS-allowlists the AI origin and
`functions/index.js` sends `HTTP-Referer: https://electionsbg.com` to OpenRouter.

### D3 — When?

Not during an election period, and not in the week before a planned launch. The rename
(§4–§5) has no such constraint; only the flip (§7) does.

---

## 1. Step 0 — baseline, and why it blocks everything

**Nothing in §7 may start until this exists.** Without a baseline there is no way to
tell a migration dip from ordinary seasonality, and the decision "roll back or wait"
becomes a guess.

1. Search Console → export **16 months** of Performance data for `electionsbg.com`,
   both by query and by page. Store under `data-reports/seo-baseline-2026-08/`.
2. Record the **top 1,000 URLs by clicks** as a separate list. This is the regression
   set: after the flip, every one of them must 301 in exactly one hop to a live 200.
3. Record totals: clicks/impressions/CTR/position per week, and the same split by
   `/en/` vs BG (this is also the input to **D1**).
4. GA4: sessions by landing page, same window.
5. Note current indexed-page count (Coverage report) against the ~147,020 URLs the
   sitemaps declare — the gap is worth knowing before you change anything, so it is not
   later misread as migration damage.

Also verify **both** future properties in Search Console as soon as DNS exists, and
confirm how `electionsbg.com` is currently verified (there is **no** verification file
in `public/` and no `google-site-verification` meta in `index.html`, so it is verified
by DNS TXT or via Google Analytics — find out which, because a DNS change during the
move can silently unverify a TXT-verified property and the Change of Address tool
refuses to run without both sides verified).

---

## 2. Register the domain and connect it to Firebase

### 2.1 Registration (`.bg`)

`.bg` is run by **Register.BG**. GoDaddy is not a `.bg` registrar and falsely reports
`.bg` names as taken — ignore it. Use Register.BG directly or a Bulgarian registrar
(SuperHosting, ICDSoft, Jump.bg).

What the registry requires: the name must be 3–63 chars, Latin or Cyrillic letters,
digits and hyphen, first and last a letter or digit — `naiasno` qualifies — and
**identification of the registrant**: a valid ID document for an individual, or company
documents (актуално състояние / ЕИК) for a legal entity. Signing the application with a
**КЕП** (qualified electronic signature) satisfies the identification step directly and
is the fastest path; without one, expect a signed заявка and possibly a пълномощно, and
a manual review of a day or more rather than minutes.

Decide the registrant now: **register it to the legal entity if one exists**, not to a
person. A personal registration is painful to transfer later and ties the brand to one
individual.

Also register, same session:
- `naiasno.com` — defensive, and the fallback canonical under **D1**.
- Optionally `наясно.бг` (Cyrillic IDN). **Not recommended to use** — it adds punycode
  confusion to every share link for no reach — but it is cheap to deny to a squatter.

### 2.2 DNS

Point the domain's nameservers at a DNS host you can change quickly. Register.BG's own
DNS works; **Cloudflare DNS is the better choice** purely for operational speed —
instant record changes and per-record TTL control, which matters on flip day.

**Lower TTLs to 300s at least 48h before the flip** and raise them back afterwards. A
24h TTL on the old A records turns a rollback from "five minutes" into "tomorrow".

### 2.3 Firebase custom domains — and the one constraint that shapes the whole design

**Firebase Hosting redirects are configured per SITE, not per domain.** There is no host
condition in `firebase.json`'s `redirects` — the full-config reference documents
`source`/`regex`/`destination`/`type` and nothing that reads the `Host` header. So:

> **Attaching both `electionsbg.com` and `naiasno.bg` to the `main` target serves byte-identical
> content on both origins with no 301 between them.** That is duplicate content across two
> domains, Google picks a canonical on its own, and the migration silently does not happen.

The correct shape is **two hosting sites**:

| Site | Target | Domains | Content |
|---|---|---|---|
| `elections-bg` (existing) | `main` | `naiasno.bg`, `www.naiasno.bg` | `dist` — the real site |
| **new**, e.g. `electionsbg-legacy` | `legacy` | `electionsbg.com`, `www.electionsbg.com`, `naiasno.com` | an empty dir + **one catch-all 301** |

The legacy site's entire hosting entry is a redirect table. It must carry **no**
rewrites — in particular none of the `db`-function rewrites for `/funds/contract/**`,
`/funds/interreg/**`, `/company/**` or `/person/*`, which would answer 200 on the old
origin instead of redirecting.

Sketch (exact capture syntax must be verified against the emulator — see the trap
below):

```jsonc
{
  "target": "legacy",
  "public": "legacy-root",          // holds only a robots.txt; NOT dist
  "trailingSlash": false,
  "redirects": [
    { "source": "/",        "destination": "https://naiasno.bg/",    "type": 301 },
    { "source": "/en",      "destination": "https://naiasno.bg/en",  "type": 301 },
    { "source": "/:rest*",  "destination": "https://naiasno.bg/:rest", "type": 301 }
  ]
}
```

Three traps in that block, all of which produce a *working-looking* site that leaks
ranking:

- **Redirect chains.** The site's URL contract is the **no-slash** form, with the two
  roots inverting it (`/` keeps its slash, the EN root is `/en` and **not** `/en/`). A
  request for `https://electionsbg.com/about/` must land on `https://naiasno.bg/about`
  in **one** hop, not via `https://naiasno.bg/about/` → `https://naiasno.bg/about`.
  Whether hosting's `trailingSlash: false` normalisation runs before or after the
  redirect table is not something to assume — test it, and add explicit slash-form rules
  if it does not.
- **First match wins.** Hosting applies the first rule whose pattern matches, so the two
  root rules must precede the catch-all.
- **Query strings and encoding.** `?elections=`, `?pscope=`, `?cabinet=` and the rest of
  the URL contract must survive, and so must percent-encoded Cyrillic paths (settlement
  and person slugs). Both go in the flip-day check list.

Because the legacy site is redirect-only, it has no file-count exposure — which matters,
since `dist/` is already ~248k files and a 453k-file deploy has failed outright.

Attachment order on flip day: add `naiasno.bg` to `main` and let its certificate
provision **first** (Firebase issues the cert after the A records resolve; this can take
from minutes to ~24h). Only once `https://naiasno.bg` serves the real site do you move
`electionsbg.com` onto the legacy target.

---

## 3. Make the domain a variable (do this **before** the flip)

Today `https://electionsbg.com` is a literal in at least these places:

| File | What it feeds |
|---|---|
| `scripts/prerender/routes.ts:35` | `SITE_URL` — ~590 `${SITE_URL}` links across `scripts/prerender/` |
| `scripts/prerender/jsonLd.ts:1` | `SITE_URL` + `ORG_ID` / `WEBSITE_ID` `@id` URIs |
| `scripts/llms/buildIndex.ts:17` | `llms.txt` |
| `scripts/llms/buildFull.ts:40` | `llms-full.txt` / `llms-full.en.txt` (450 occurrences each) |
| `functions/spa_page.js:35` | `SITE_URL` for `/funds/contract`, `/funds/interreg`, `/company` |
| `functions/index.js:130,497` | OpenRouter `HTTP-Referer`; the SPA-shell fetch origin |
| `src/ux/SEO.tsx` | the client-side canonical `baseUrl` |
| `index.html` | canonical, `og:url`, `og:image`, `twitter:image` |
| `public/robots.txt` | both `Sitemap:` lines |
| `scripts/sitemap/` | every `<loc>` and the sitemap-index entries |
| `scripts/bucket_cors.json`, `scripts/gcs-cors.json` | **see below** |
| `vite.config.ts`, `vite.config.ai.ts`, `ai/*` | build + AI app |

**Introduce one exported constant with an environment override** (`SITE_ORIGIN`,
defaulting to the current value) and have every one of the above read it. That is the
"make the change easy, then make the easy change" step: it turns the flip into a
one-line edit plus a rebuild, and — more importantly — turns a **rollback** into the
same. Ship this refactor and deploy it while the value is still `electionsbg.com`, so it
is proven to be a no-op before it carries any risk.

> ### ⚠️ The one that takes the site down, and no SEO test can see it
>
> `scripts/bucket_cors.json` / `scripts/gcs-cors.json` allowlist request origins on the
> GCS bucket that serves **every JSON payload the app fetches**. React Query reads from
> `storage.googleapis.com` on essentially every page.
>
> **If the bucket's CORS origin list does not include `https://naiasno.bg` before the
> flip, the new domain serves a perfectly prerendered, fully indexed, completely blank
> site.** The HTML is right, the canonical is right, `tests/seo.spec.ts` is green, and
> not one number renders. Add the new origin (keeping the old) as part of §3, not §7,
> and verify with a browser request against the bucket from the new origin.

Same class, smaller blast radius: `functions/send_json.js`'s CORS allowlist for the AI
origin, and `functions/index.js`'s `HTTP-Referer` (OpenRouter attributes usage by it).

---

## 4. Brand rename in-product — ship independently, before the flip

Zero domain risk. All of it is name and copy.

1. **Title suffix.** 338 occurrences of `| electionsbg.com` across
   `scripts/prerender/{routes,articleRoutes,institutions,curatedProjectRoutes,dynamicRoutes}.ts`
   and `src/ux/seoTitle.ts`. Replace with `| Наясно` (BG) / `| Naiasno` (EN). Extract the
   suffix into a single constant while doing it — it should never have been typed 338
   times.
2. **`og:site_name`** in `index.html`: `Elections Bulgaria` → `Наясно`.
3. **JSON-LD Organization / WebSite** (`scripts/prerender/jsonLd.ts`): `name: "Наясно"`,
   and — this is the part that actually helps the migration — `alternateName: ["Elections
   Bulgaria", "electionsbg.com", "naiasno.bg"]` plus a **`sameAs`** array pointing at the
   Facebook page, the Facebook group, the YouTube channel and the GitHub repo. `sameAs`
   is how you tell Google that the entity under the new name is the same entity; keep
   `alternateName` carrying the old name for at least a year.
4. **`public/site.webmanifest`**: `name`/`short_name` are still `electionsBG` and the
   description still says only "parliamentary elections since 2005". Rewrite both, and
   align `theme_color` (`#1F1A14`) with the actual brand navy `#0b1224`.
5. **`src/ux/SEO.tsx`**: the client-side title wrapper is `` `${t("elections")} | ${title}` `` —
   every SPA-rendered tab says "Избори | …" regardless of whether the page is about
   procurement or hospital tariffs. Replace with the brand. Also drop the hardcoded
   keyword list (`bulgaria, elections, izbori, парламентарни избори, избори 2024`) —
   `<meta name="keywords">` has been ignored by Google for two decades and the 2024
   literal is simply stale.
6. **`twitter:creator`** is `electionsbg.com`, which is not a Twitter handle. Either set
   a real handle or remove the tag.
7. **OG card renderers**: `scripts/og/cardRenderer.ts:178` and
   `scripts/og/candidateCard.ts:207` stamp `electionsbg.com` into the footer of every
   generated card. `scripts/posts/cardKit.ts` is already on the Наясно navy+coral theme
   — bring the OG renderers onto the same palette so the site's share cards and the
   Facebook cards stop looking like two products.
8. **Favicon / icons / `og_image.webp`** — regenerate from the Наясно wordmark
   (`scripts/brand/generate_brand_art.ts` already produces the artwork).
9. **On-site transition banner** — a dismissible "electionsbg.com вече е **Наясно**" strip
   for ~90 days after the flip. Cheap, and it is the difference between a returning
   reader thinking "they rebranded" and thinking "this is a different site".

---

## 5. SEO titles and descriptions — widen them to the actual scope

The homepage description is already broad and decent. The problem is elsewhere.

**What is wrong today**

- The homepage `<title>` leads with `Парламентарни избори` and the H1 anchor of the whole
  site is elections, while the majority of the URL surface is not about elections.
- `src/ux/SEO.tsx` prefixes **every** client-rendered title with "Избори |".
- `AboutScreen` passes `description="About page"` — a literal placeholder, shipped.
- The keyword list is frozen at "избори 2024".
- `public/robots.txt` opens with the comment `# electionsbg.com — open data…`.

**What to do**

1. Rewrite the homepage title/description around the four pillars the platform actually
   covers — **избори · пари · власт · общество** — with elections named but not leading.
   Both `index.html` and `HOME_TITLE` / `HOME_TITLE_EN` in `scripts/prerender/routes.ts`.
2. Audit the per-family templates in `scripts/prerender/routes.ts` (274 domain
   occurrences there are almost entirely title suffixes, so this is the same sweep as
   §4.1 — do them together, once).
3. Give `/about` a real description (§6).
4. Rewrite `llms.txt`'s preamble in `scripts/llms/buildIndex.ts` to describe the full
   corpus. This is the file the AI crawlers explicitly allowlisted in `robots.txt` read
   first, and it currently under-sells the platform to exactly the audience that is
   growing fastest.
5. **Do not change any URL path in the same window as the domain move.** Every path must
   be 1:1 across the flip. Route restructuring is a separate project, afterwards.

---

## 6. The About page

`src/screens/AboutScreen.tsx` is structurally fine — hero, AI section, team cards — and
the content lives in `about_p_1..4` / `about_ai*` / `project_about` in
`src/locales/{bg,en}/translation.json`. What it needs:

- A real `<SEO description>` (currently `"About page"`).
- The **name story**: what Наясно means, and that electionsbg.com is the same project.
  This page is where a journalist checks whether the site is who it claims to be.
- A **coverage section** — one line per domain (избори, парламент, бюджет, обществени
  поръчки, еврофондове, декларации, съдебна власт, здравеопазване, земеделие, цени,
  образование, демография, местни избори) each linking to its hub. This is also an
  internal-linking win: `/about` is one of the few pages that gets crawled on every
  visit, and it currently links to almost nothing.
- **Methodology and sources** links (`/data`, `/data/sources`, `/data/updates`) — the
  "без мнения, само данни" claim should be one click from proof.
- **Channels row**: Facebook page, Facebook group, YouTube, GitHub.
- Update the AI link when `ai.electionsbg.com` moves (**D2**).

---

## 7. The flip — ordered runbook

Do not start until §1 (baseline), §3 (constant + **bucket CORS**) and §4–§6 (rename) are
deployed and green.

**T-7 days**
1. `naiasno.bg` registered, DNS live, TTL lowered to 300s.
2. Both domains verified in Search Console. Note the verification method.
3. GCS bucket CORS carries **both** origins. Verified from a browser, not assumed.
4. Legacy hosting site created and its redirect table tested in the emulator, including:
   root, `/en`, a deep BG path, a percent-encoded Cyrillic settlement path, a path with
   `?elections=` + `?pscope=`, and a `/funds/contract/...` URL (which must 301, not be
   answered by the `db` function).

**T-1 day**
5. Full `npm run build` with `SITE_ORIGIN=https://naiasno.bg`. Confirm sitemaps,
   `robots.txt`, `llms*.txt`, canonicals, `og:url` and every hreflang carry the new
   origin, and that the `/` -keeps-slash / `/en` -no-slash asymmetry survived.
6. `npm run test:seo` against the new build. Its "no declared canonical / og:url /
   hreflang may redirect" assertion is the migration's single best gate — make sure it
   is pointed at the new origin and not silently passing against the old one.

**Flip day, in this order**
7. Attach `naiasno.bg` + `www` to the `main` target. Wait for the certificate. Verify the
   real site serves, **with data** (open a page with charts, not just the shell).
8. `npm run deploy:db` — `functions/spa_page.js` carries its own `SITE_URL` and serves the
   contract/company/interreg pages' head tags. Old value here means those ~256k
   function-served pages declare a canonical on the dead domain.
9. `npm run deploy` — hosting with the new-origin build.
10. Move `electionsbg.com` + `www` onto the `legacy` target. From this moment the old
    domain 301s.
11. Move `ai.electionsbg.com` → `ai.naiasno.bg` (**D2**), including the `send_json.js`
    CORS allowlist and the `index.js` `HTTP-Referer`.
12. Submit the new sitemap index in Search Console; leave the old one submitted so
    Google re-crawls the old URLs and sees the 301s.
13. Update the Facebook page/group links, the GitHub repo description and About, and any
    other off-site profile.

**T+1 hour — verification, not vibes**
14. Replay the **top-1,000-URL** list from §1 against the old domain. Every one must
    return **exactly one** 301 to a **200** on the new domain. Any 302, any chain, any
    404 is a stop-and-fix.
15. Confirm `https://electionsbg.com/robots.txt` still resolves (via the redirect) and
    that the new `robots.txt` names the new sitemaps.

**T+7 days**
16. Only now submit **Change of Address** in Search Console. It requires both properties
    verified and the old homepage 301ing to the new one. A week of proven-correct
    redirects first means you are not asking Google to follow a broken move.

**T+30 / T+90**
17. Compare against the §1 baseline. Expect a dip; expect recovery. Track indexed-page
    count on both properties — the old should fall as the new rises, roughly in step.

**Rollback.** Before the Change of Address is submitted, rollback is: revert
`SITE_ORIGIN`, rebuild, `deploy:db` + `deploy`, re-attach `electionsbg.com` to `main`,
detach the legacy site. Minutes, given the 300s TTL. **After** Change of Address it is no
longer clean — which is exactly why step 16 sits a week out.

**Keep the old domain registered for at least 5 years.** The 301s are the migration; the
day they stop, the equity stops with them.

---

## 8. Social and internal links

- `src/lib/community.ts` + `ai/app/community.ts` are already the single source of truth
  for `GROUP_URL` / `PAGE_URL`. Add `YOUTUBE_URL` there and nowhere else.
- `src/layout/Footer.tsx`: currently About / Data / db / Наясно AI / GitHub / Общност. Add
  YouTube; update the AI href per **D2**.
- The GitHub repo is `github.com/atanasster/electionsbg` — renaming it gives a redirect
  from the old path automatically, but the clone URLs in docs and `README.md` should be
  updated. Low priority, do it with the rename.
- `src/locales/{bg,en}/translation.json:5545` (`machine_only_footer`) carries the literal
  "electionsbg.com" in reader-facing copy — the only such string in the locales. There
  are also literals in `video/src/specs/*.ts`, `public/articles/index.json`,
  `scripts/stats-briefing/doc.html` and four screens.
- Facebook page (`facebook.com/naiasno`) and group already exist and are already branded
  Наясно — nothing to migrate there, which is the one piece of luck in this project.

---

## 9. YouTube channel and the first video

The video is **already built and awaiting publication**:
`brand/videos/2026-08-09-election-risk-explainer/` — `yt.mp4` (12:44, 1920×1080, 48.9 MB),
`captions.vtt`, `transcript.txt`, `thumb.png` (1280×720), and `draft.md` carrying a
finished BG title, description and tag set. `brand/videos/index.json` has it at
`status: "draft"`.

**Channel setup**
1. Create the channel as a **Brand Account**, not on a personal Google account. This is
   the one decision that is painful to reverse: a Brand Account can have multiple
   managers and can be transferred; a personal channel cannot.
2. Handle `@naiasno`; channel name **Наясно**; banner and avatar from `brand/`.
3. **Verify the account by phone** — custom thumbnails and videos over 15 minutes both
   require it, and the next explainer will exceed 15 minutes even if this one does not.
4. Channel description + links to the site, the FB page and the FB group.
5. Default upload settings: language Bulgarian, category News & Politics, "not made for
   kids".

**Upload**
6. Title/description/tags verbatim from `draft.md`. **Point the description links at
   whichever domain is live at upload time** — if the flip has not happened, use
   `electionsbg.com` and let the 301 carry them later.
7. Upload `captions.vtt` as a Bulgarian subtitle track (do not rely on auto-captions;
   the `.vtt` is derived from the signed-off script and cannot mis-transcribe).
8. Custom thumbnail `thumb.png`.
9. Add chapters to the description — 59 scenes over 12:44 is exactly the shape that needs
   them.
10. Set `status: "published"` and record the video ID in `brand/videos/index.json`.

**On-site — this is where the SEO value actually is**
11. A `/videos` index page plus a per-video page embedding the YouTube player with the
    **transcript rendered underneath**. The transcript is already written and reviewed;
    it costs nothing and gives a crawler a text surface that an embed does not.
12. **`VideoObject` JSON-LD, emitted from `scripts/prerender/jsonLd.ts`** — prerendered,
    for the same reason every other meta tag here is. Injected client-side, Google never
    sees it. `embedUrl` for the YouTube player.
13. A `sitemap_video.xml` shard once there is more than a handful.
14. **MP4s go in the GCS bucket, never in `dist/`** — the deploy ceiling is on file count.
    `scripts/bucket_sync_paths.ts` refuses unlisted subtrees by design, so a `video/`
    entry there is required, not optional.
15. Cross-post: the FB group and page (native upload beats a YouTube link on Facebook
    reach), plus a link from `/risk-analysis`, which is what the video explains.

---

## 10. Which other channels are worth it

Grounded on July 2026 Bulgaria figures (NapoleonCat / DataReportal): total social
penetration ~67%; **Facebook 4.51M (67.8%)**, **Messenger 3.77M (56.7%)**, **Instagram
2.21M (33.2%)**, **LinkedIn 1.80M (27%)**. That source publishes no TikTok, Pinterest or
YouTube figure for Bulgaria, so the reasoning for those three is qualitative and is
labelled as such below.

| Channel | Verdict | Why |
|---|---|---|
| **YouTube** | **Yes — already committed** | It is a search engine, not a social network. Videos surface in Google, the embed + transcript builds an on-site text surface, and hosting/transcoding/bandwidth are free. Highest-value new channel by a distance. |
| **Instagram** | **Yes — cheapest possible win** | 33.2% penetration, and the FB Page already exists: cross-posting from a Page to a linked IG account is a settings toggle, and the post cards in `brand/posts/` are already square 1080×1080. Near-zero marginal cost. |
| **LinkedIn** | **Yes — small effort, high-leverage audience** | 27% penetration, and it is disproportionately the *multiplier* audience: journalists, analysts, NGOs, institutional staff. Repost the same card with the same copy. One post a week. |
| **TikTok** | **Yes, but not yet** | The largest BG audience the project cannot currently reach — under-35s who will never visit a data site. But it demands a different format (9:16, 25–50s), which `naiasno-video` supports as SHORT, and it punishes irregular posting hard. **Gate: do not open the account until 4–6 shorts exist as a batch.** Then one render feeds TikTok + IG Reels + FB Reels + YouTube Shorts. |
| **Pinterest** | **No — grab the handle, do not staff it** | It is a visual-discovery and purchase-intent engine; BG civic-data demand there is negligible. The only honest argument is that the 50+ infographic PNGs in `brand/posts/` are evergreen and Pinterest is a search surface — but the expected BG traffic does not justify a posting cadence. Reserve `@naiasno` defensively and revisit only if some other channel proves the infographics travel. |
| **Telegram / RSS** | **Worth considering separately** | Not a video channel, but it is the missing low-effort distribution the earlier strategy notes flagged: the daily watcher already produces change events. Out of scope here. |
| **X / Twitter** | **Handle only** | BG reach does not justify the cadence. |

**Do first, before anything is announced publicly: reserve `naiasno` on YouTube, TikTok,
Instagram, LinkedIn, X, Pinterest and Telegram.** It costs an hour and it is the only
part of this plan that becomes impossible if someone else does it first.

### 10.1 Handle reservation pack

**All seven verified free on 2026-08-09.** Facebook (`facebook.com/naiasno`) is already
ours. Re-verify before claiming — this window will not stay open indefinitely.

| Platform | Claim at | Verified by |
|---|---|---|
| YouTube | `youtube.com/@naiasno` | 404 |
| TikTok | `tiktok.com/@naiasno` | "Couldn't find this account" |
| Instagram | `instagram.com/naiasno` | "Profile isn't available" (browser; plain HTTP returns a misleading 200) |
| LinkedIn | `linkedin.com/company/naiasno` | "Page not found" |
| X | `x.com/naiasno` | "User Profile Not Found" |
| Pinterest | `pinterest.com/naiasno` | "User not found" |
| Telegram | `t.me/naiasno` | generic contact page, no display name |

**Paste-ready profile fields** (no emojis, per house style):

- **Name:** `Наясно`
- **Handle:** `naiasno` (`@naiasno` where the platform prefixes it)
- **Tagline:** `Бъди наясно.`
- **Bio (BG, ~150 chars):** `Изборите, парите и властта — с отворени данни. Бюджет,
  обществени поръчки, еврофондове, декларации, гласувания. Без мнения. Само данни.`
- **Bio (EN):** `Bulgaria's elections, money and power — in open data. Budget,
  procurement, EU funds, declarations, votes. No opinions. Just data.`
- **Website:** the canonical domain per **D1**
- **Avatar / banner:** `brand/profile_1080.png`, `brand/page_cover_1640x624.png`

**Per-platform traps, in claim order:**

1. **YouTube — the one irreversible choice.** Create the channel on a **Brand Account**,
   not a personal Google account: a personal channel cannot be transferred or
   co-managed. The `@handle` is separate from the channel name — set both. Verify by
   phone in the same session; custom thumbnails and uploads over 15 minutes both require
   it, and the first explainer is 12:44 with longer ones planned.
2. **Instagram — create it as a Professional/Business account and link it to the existing
   Facebook Page in Meta Business Suite.** That link is what makes Page→IG cross-posting
   the settings toggle §10 assumes. A personal account claims the handle but not the
   workflow.
3. **Telegram — claim `@naiasno` for a CHANNEL, not a personal account.** A username can
   only belong to one entity; spending it on a personal account burns the public
   `t.me/naiasno` the project actually wants. Note Telegram reclaims usernames left
   inactive.
4. **LinkedIn — a Company Page needs a personal profile as its admin** and a website
   field. Add a second admin immediately; a page with one admin is one lost account away
   from being unrecoverable.
5. **TikTok — the username can only be changed once every 30 days.** Get it right first
   time.
6. **Pinterest / X — handle only.** Fill the profile, post nothing, revisit per §10.

Record every claimed URL in `src/lib/community.ts` (and its `ai/app/community.ts` twin),
which is already the single source of truth for the Facebook destinations — not inline in
the footer or the About page.

---

## 11. Explicitly out of scope

- Any change to URL **paths**. 1:1 across the flip, no exceptions.
- Route restructuring, hub reorganisation, or the money-flows hub — separate projects,
  after the move has settled.
- Splitting BG and EN across two domains (**D1**, rejected with reasons).
- Retiring the `electionsbg.com` registration. Keep it, and keep the 301s, for years.

---

## Appendix — measured surface

| Thing | Count | Source |
|---|---|---|
| URLs in sitemaps | ~147,020 across 16 shards | `grep -c '<loc>' public/sitemap*.xml` |
| Largest shards | candidates 49,000 · static 49,000 · sections 16,951 · static_2 16,139 | same |
| Files in `dist/` | ~248k (453k has failed to deploy) | `CLAUDE.md` |
| Function-served page URLs | ~256k (`/funds/contract/**`, `/company/**`) + ~101k non-prerendered `/person/*` | `CLAUDE.md` |
| `| electionsbg.com` title suffixes | **338** across 6 files | `grep -rn "| electionsbg.com" scripts/ src/` |
| `${SITE_URL}` links in `scripts/prerender/` | ~590 | `grep -rn 'SITE_URL}' scripts/prerender/` |
| `SITE_URL` constant definitions | 4 in `scripts/`, 1 in `functions/spa_page.js` | `grep -rn "SITE_URL *="` |
| Domain literals in `llms-full{,.en}.txt` | 450 each (build-generated) | `grep -c` |
| Hosting targets today | `main` → `elections-bg`, `ai` → `electionsbg-ai` | `.firebaserc` |
| `naiasno.bg` / `naiasno.com` availability | **both available 2026-08-09** | registry WHOIS |

Sources consulted for the external facts:
[Register.BG](https://www.register.bg/),
[SuperHosting: .BG registration](https://help.superhosting.bg/register-domain-bg.html),
[Firebase Hosting full config](https://firebase.google.com/docs/hosting/full-config),
[NapoleonCat — Social media users in Bulgaria](https://stats.napoleoncat.com/social-media-users-in-bulgaria/),
[DataReportal — Digital 2026: Bulgaria](https://datareportal.com/reports/digital-2026-bulgaria).
