# Наясно flip — the finalization runbook (v1)

> ## ✅ FLIPPED 2026-09-11, ~01:45 local (22:45Z on 09-10)
>
> `naiasno.bg` and `www.naiasno.bg` serve; `electionsbg.com` is the console
> redirect pointing at `naiasno.bg`. Verified the same hour, against the live
> hosts and not the emulator:
>
> - Console redirect: 301, one hop, path + query + percent-encoding intact, `/en`
>   without a slash — every probe from §2.5's table, now in the forward direction.
> - **Top-1,000 ranked URLs replayed against the old domain: 1,000/1,000 land on
>   a 200 at naiasno.bg.** 795 in one hop; 205 in two, every one of them a
>   documented accepted shape (trailing-slash normalisation, or a pre-existing
>   `/officials/*` → `/person/*` slug retirement plus the domain hop). Zero 404s,
>   zero 302s, zero chains of three.
> - Three-step deploy complete; `/`, `/person/**`, `/company/**` and
>   `/funds/contract/**` all serve one bundle hash.
> - `/api/db` same-origin from naiasno.bg: 200. Bucket fetch from naiasno.bg: 200.
>   LLM proxy from naiasno.bg: reached, `403 invalid_verification` on a fake token
>   — i.e. CORS passes and only the Turnstile step is unproven headlessly.
> - Step 11 done: ai.electionsbg.com → naiasno.bg/chat (5 rules, query preserved
>   verbatim, `/legacy-export` still 200). `.env.production` flipped before the
>   `dist-ai` rebuild.
> - Step 15 done: robots.txt resolves through the old domain and names the new
>   sitemap index.
>
> **Still open:** B4 (Turnstile hostnames — confirm by asking one AI question on
> naiasno.bg in a browser), GSC sitemap submission on the naiasno.bg property
> (§4 step 12 — do it now), off-site profile links (step 13), Change of Address
> at T+7 (§6), and `www.electionsbg.com`, which has never had a certificate.

**Status at authoring: local work COMPLETE, nothing deployed.** `SITE_ORIGIN` was
`https://naiasno.bg` in the repo; production still served `electionsbg.com` and
`naiasno.bg` was still parked as a 301 pointing the other way.

This is the operational sequence. It supersedes §7 of
[`naiasno-rebrand-v1.md`](naiasno-rebrand-v1.md), which was written before the
chat launched on the main site, before the LLM backend moved, and before the
console redirect was measured. Read that plan for the *reasoning* — §2.5 in
particular, which is why there is no `legacy` hosting site — and this file for
the *order*.

It also absorbs [`chat-launch-rebrand-handoff.md`](chat-launch-rebrand-handoff.md),
which owns the chat-specific verification list. Where the two disagree, that
one wins on chat details.

---

## 0. What is already done, so nobody redoes it

| | state |
|---|---|
| `SITE_ORIGIN` / `functions/site_origin.js` | `https://naiasno.bg` |
| Titles, JSON-LD, canonicals, `og:url`, hreflang | new origin, `\| Наясно` / `\| Naiasno` |
| Sitemaps (20 files, 152,862 `<loc>`), `llms.txt`, `llms-full*.txt` | new origin, brand rewritten |
| Bucket CORS (`scripts/bucket_cors.json`) | carries **both** origins + `ai.naiasno.bg` |
| `functions/llm_origins.js` | carries all four naiasno hosts + every old one |
| `functions/index.js` `SCENARIO_ALLOWED_ORIGINS` / `DB_ALLOWED_ORIGINS` | carry naiasno |
| Icons, favicon, `og_image.webp`, manifest, `theme-color` | regenerated from `brandMark.ts` |
| Articles (14 + `index.json`), chat exports, CSV filenames | Наясно |
| Header lockup, About page, README | Наясно — and Latin on `/en` |
| `scripts/chat-launch/legacy-redirects.json` + its probe | expect `naiasno.bg` |
| `ai/app/legacyRoutes.test.ts` | expects `naiasno.bg` |

**The committed `public/og/*.png` screenshots need NO recapture.** Checked by
opening them: they are content-only crops with no header, no logo and no domain
footer, so the rebrand does not reach them. The RENDERED cards
(`scripts/og/cardRenderer.ts`, `candidateCard.ts`) do carry a footer stamp — now
derived from `SITE_HOST` — and are rebuilt by `postbuild` on every deploy.

**`ai.electionsbg.com` is NOT being renamed in this window.** The chat is an
in-site route now; that origin's job is the legacy standalone plus the
old-origin conversation recovery, and it must keep working. `ai.naiasno.bg` is
allowlisted everywhere for a later move, but no DNS is being pointed at it here.

---

## 1. Blockers — fix BEFORE the flip, in the repo

These are not flip steps. They are things that are wrong today and would be
launched onto a new domain as if they were the new site's own defects.

> **✅ B1, B2 and B3 are DONE (2026-09-10, `65ff364c4d`).** The three `/chat`
> routes are in `route_defs.ts` and the sitemap; `chat/tools` and `chat/evals`
> have a `bodyHtml` with an `<h1>`; all three have their own `og:image` (they
> were falling through to the site-wide card — found while fixing the other
> two); and `session.test.ts` pins the moved LLM endpoint.
>
> **B4 is still open, and it is the one nobody here can close** — it lives in the
> Cloudflare console, not the repo.
>
> `distHeadings.data.test.ts` reads `dist/`, so it stays red until the next
> build. That is the gate working, not a residue.

**B1 — ✅ FIXED — the three `/chat` routes were prerendered with no sitemap `<loc>`.**
`scripts/prerender/ogAndSitemapCoverage.test.ts` fails on `chat`, `chat/tools`,
`chat/evals` in both languages. Launching a domain whose flagship new feature is
undiscoverable is the opposite of the point.

> ⚠️ **Do NOT fix this with a bare `npm run sitemap`.** That regenerates the
> whole URL set from the LOCAL corpus, and on a machine missing the presidential
> data it silently drops ~1,522 pages — measured, during this work. Regenerate,
> then diff the `<loc>` COUNT against the committed file before staging. If it
> fell, the corpus is short, not the sitemap.

**B2 — ✅ FIXED — `chat/tools` and `chat/evals` carried no `<h1>`** (`distHeadings.data.test.ts`,
4 pages counting the `/en` mirrors). Either give the route a `bodyHtml` heading
or list it in `NO_H1_ROUTES` with a reason.

**B3 — ✅ FIXED — `ai/llm/session.test.ts` pinned `https://ai.electionsbg.com/api/llm`** and
the endpoint is now `https://elections-bg.web.app/api/llm`. A stale fixture from
the LLM migration, not from the rebrand — left for that work stream, but it must
be green before a release.

**B4 — ⛔ OPEN — Cloudflare Turnstile hostnames.** The **Naiasno AI Chat** managed widget
held 9 hostnames on 2026-09-10 and the UI allows 10; `naiasno.bg` and
`www.naiasno.bg` need TWO slots. Remove the expired chat-launch preview host
first, and verify the live list rather than trusting this line. Get this wrong
and the chat's verification fails on the new domain from the first minute —
every other page fine, the flagship feature dead.

The remaining `test:unit` failures (22 total) are data vintages and the parallel
chat/LLM work. None references `SITE_ORIGIN`, an origin, or a brand constant —
checked by grep. They do not block the flip.

---

## 2. T-7 days

1. **Lower TTL to 300s** on the `naiasno.bg` A/AAAA records at Cloudflare. This
   is what makes the rollback minutes rather than hours.
2. **Both properties verified in Search Console**, and note the method — Change
   of Address (§6) requires both, and re-verifying under time pressure is how a
   migration stalls.
3. **Confirm the bucket CORS is LIVE**, not merely committed:
   `npm run bucket:cors`, then load a chart page from a browser. The config file
   being right proves nothing; `gsutil` has to have applied it.
   > Miss this and naiasno.bg serves a perfectly indexed, perfectly canonical,
   > **completely blank** site — every number refused by CORS, every SEO gate green.
4. **Re-probe the console redirect in the direction we will actually use it.**
   §2.5 measured it on `naiasno.bg → electionsbg.com` and the behaviour is a
   property of the feature, not the direction — but attach a throwaway subdomain
   with the checkbox on and curl a deep path with a query string anyway. One hop,
   301, path + query + percent-encoding intact, or fall back to the two-site
   design in §2.5.

## 3. T-1 day

5. **Edit `.env.production`** — it is **gitignored**, so no commit carries this
   and no gate can see it:

   ```
   VITE_DB_API_ORIGIN=https://naiasno.bg      # was https://electionsbg.com
   VITE_DATA_BASE_URL=…/data-electionsbg-com  # UNCHANGED — the bucket is not renamed
   ```

   Only `ai/tools/dataClient.ts` reads the first: the standalone AI app is a
   separate Firebase project with no `db` function, so its `/api/db` calls are
   cross-origin. Left on the old value it points at a host that 301s, and **a
   CORS preflight does not follow redirects** — so the standalone chat's data
   calls fail while the main site is fine.

   The bucket name is infrastructure, not brand. Renaming it would invalidate
   every `VITE_DATA_BASE_URL` and every CORS entry for nothing.

6. **Full `npm run build`.** Then, on `dist/` and not on the source:
   - canonicals, `og:url` and every hreflang carry `https://naiasno.bg`;
   - the trailing-slash contract survived — `/` keeps its slash, `/en` has none;
   - `robots.txt` names `${SITE_ORIGIN}/sitemap_index.xml` and nothing else.
7. **`npm run test:seo` against the new build**, pointed at the new origin. Its
   "no declared canonical / og:url / hreflang may redirect" assertion is the
   single best gate this migration has. Confirm it is actually pointed at the
   new origin and not passing against the old one.

   > ⚠️ **Never read a prerendered page through `npm run preview`.** It runs the
   > SPA fallback, so the no-slash URL — the one production serves the file at —
   > falls through to the homepage prerender. Read `dist/<path>/index.html`
   > directly, or curl the deployed site.

## 4. Flip day, in this order

8. **Attach `naiasno.bg` + `www.naiasno.bg` to the `main` target** (target
   `main` → site `elections-bg`, per `.firebaserc`). **Remove the parking
   redirect first** — it currently points at `electionsbg.com` and would loop.
   Wait for the certificate: Firebase issues it after the A records resolve,
   which can be minutes or ~24h. Do not proceed until `https://naiasno.bg`
   serves the real site **with data** — open a page with charts, not the shell.

9. **Deploy, THREE steps, and the third is not optional:**

   ```bash
   npm run deploy                    # 1. hosting live with the new bundle
   npm run deploy:db                 # 2. fresh function instances fetch the CURRENT shell
   SKIP_PREDEPLOY=1 npm run deploy   # 3. purge the edge entries step 2 could not
   ```

   Two independent reasons both halves must ship, and neither is optional here:
   `functions/spa_page.js` carries its own `SITE_URL`, so the ~256k
   function-served `/funds/contract`, `/funds/interreg`, `/company` and
   non-prerendered `/person` pages would otherwise declare a canonical on the
   dead domain; and the bundle hash MOVES on this build, so a warm function
   instance serves the pre-deploy shell — advertising an `/assets/index-<hash>.js`
   that hosting has just deleted — and `/person/**`'s `s-maxage=3600` pins that
   into the CDN for an hour. Verify:

   ```bash
   curl -s https://naiasno.bg/person/mp-3643 | grep -oE '/assets/index-[^"]+\.js'
   curl -s https://naiasno.bg/ | grep -oE '/assets/index-[^"]+\.js'
   ```

   The two hashes must match. Spot-checking a *prerendered* person page will look
   fine either way — that is what makes this easy to miss.

10. **Move `electionsbg.com` + `www.electionsbg.com` onto the console redirect**,
    pointed at `naiasno.bg`. From this moment the old domain 301s. Do this
    AFTER step 9, never before: hosting first would point every URL at a
    function that no longer answers for that host.

11. **Deploy the standalone AI app's legacy redirects.** `scripts/chat-launch/legacy-redirects.json`
    now names `https://naiasno.bg/chat`, so it must land **after** step 8 — before
    it, `ai.electionsbg.com/` would 301 into a domain that 301s back. Then run the
    real Hosting proof (`scripts/chat-launch/verify-legacy-redirects.mjs`) against
    the deployed site, with Bulgarian punctuation and JSON arguments. **The local
    emulator is not sufficient** — its query encoding differed in the launch proof.

12. **Search Console.** Submit the new sitemap index. Leave the old one submitted
    so Google re-crawls the old URLs and sees the 301s.

13. **Off-site profiles.** Facebook page + group, YouTube, Instagram, LinkedIn, X,
    the GitHub repo description and About. `src/lib/community.ts` is the in-repo
    source of truth and is already correct; these are the copies it cannot reach.

## 5. T+1 hour — verification, not vibes

14. **Replay the top-1,000 URLs** from `data-reports/seo-baseline-2026-08/regression-urls.txt`
    against the OLD domain. Every one must return **exactly one** 301 to a **200**
    on the new domain. Any 302, any chain, any 404 is stop-and-fix.

    Traffic is concentrated, so weight the eyeballing: `/candidate/*` is 56.6% of
    ranked clicks, `/sections/*` 17.4%, `/section/*` 15.9%, `/` 5.6%.

    The known-acceptable exception is the **slash form** at two hops
    (`/about/` → `/about/` → `/about`). Every URL this repo emits is the no-slash
    form, so that costs only hand-typed and third-party links.

15. `https://electionsbg.com/robots.txt` still resolves through the redirect, and
    the new `robots.txt` names the new sitemap index.
16. **The chat, end to end, on the new domain:** Turnstile verification, a real
    AI answer, the explicit no-AI fallback, `/chat/tools` state and area,
    `/chat/evals`, and both generations of recovery page. localStorage is
    per-origin — a conversation saved on electionsbg.com does **not** appear on
    naiasno.bg — so confirm the export instructions are present and do not
    promise an import that does not exist.

## 6. T+7 days

17. **Only now submit Change of Address** in Search Console. It requires both
    properties verified and the old homepage 301ing to the new one. A week of
    proven-correct redirects first means you are not asking Google to follow a
    move that is still being debugged.

## 7. T+30 / T+90

18. Compare against the §1 baseline. Expect a dip; expect recovery. Track
    indexed-page count on both properties — the old should fall as the new
    rises, roughly in step.

19. **Look at the `/en` share deliberately.** It went 0.69% → 4.34% between the
    two GSC pulls, against the 5% gate that decided `.bg` over `.com` (D1). That
    margin narrowed from 7× to 1.15×, and **`.bg` ccTLD geotargeting is permanent
    and cannot be removed in Search Console.** Nothing to act on today; it is the
    one D1 premise that has visibly moved, and it should be re-read rather than
    assumed.

---

## Rollback

**Before Change of Address is submitted:** revert `SITE_ORIGIN`, rebuild,
`deploy` → `deploy:db` → `SKIP_PREDEPLOY=1 deploy`, re-attach `electionsbg.com`
to `main`, remove the redirect. Minutes, given the 300s TTL. Keep the
`.env.production` edit reverted too, or the standalone chat breaks the other way.

**After Change of Address** it is no longer clean — which is exactly why step 17
sits a week out.

**Keep `electionsbg.com` registered for at least 5 years.** The 301s are the
migration; the day they lapse, the equity goes with them.
