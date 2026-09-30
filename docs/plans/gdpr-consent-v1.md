# GDPR / cookie consent — v1

Status: Phase 1 LIVE 2026-09-30 (hosting, `db` and `scenarios` functions, Umami public) — see §7. Phase 2 awaits the lawyer.

## 0. The premise, corrected

The move to `naiasno.bg` does not change which law applies. GDPR applies because the
operator is established in the EU (Bulgaria) and serves EU residents. It applied to
`electionsbg.com` in exactly the same way. The TLD only makes the КЗЛД (Bulgarian DPA)
jurisdiction more obvious.

Two separate rules are in play and they need different fixes:

| rule | Bulgarian transposition | what it demands here |
| ---- | ----------------------- | -------------------- |
| ePrivacy art. 5(3), cookies and device storage | ЗЕС чл. 4а | **prior opt-in** before any non-essential cookie or storage write, i.e. a consent banner |
| GDPR art. 13/14, transparency | ЗЗЛД + GDPR directly | a **privacy notice** covering every processing operation, including the people the site publishes data about |

A banner on its own does not satisfy the second rule. The privacy notice is the bigger
piece of work, because of §1.7.

## 1. What the site actually does today (audited 2026-09-26)

### 1.1 Google Analytics 4: the one real consent violation

`src/App.tsx` loads `react-ga4` with `G-NWEG367BN9` on `requestIdleCallback` for **every
visitor, with no consent**. GA4 sets `_ga` / `_ga_<id>` cookies and sends the visitor's
browser and device data to Google (a US transfer, covered today by the EU-US Data Privacy
Framework). Under ЗЕС чл. 4а this needs opt-in consent first. The existing mitigations are
good but do not replace consent: skipping webdriver, `page_referrer` trimmed to origin, and
`chatAnalyticsPrivacy.ts` disabling GA on chat URLs.

### 1.2 localStorage: exempt, but it has to be disclosed

About 20 keys, all written by the site itself, never sent anywhere, and each one either
remembers a choice the user made or holds something the user asked the site to keep:

- theme, language, map options, consolidated toggle, reports toggle, CTA dismissal
- procurement watchlist, person watchlist, price basket, budget-scenario submit marker
- AI chat history and prompt history (`ai/app/Chat.tsx`), recent tools, model routing
- `sessionStorage` stale-chunk reload guard (`main.tsx`)

These count as "strictly necessary / explicitly requested" storage, so they need no
consent. They do belong in the privacy notice's storage table.

### 1.3 Server side: legitimate interest, disclose with retention periods

- `/api/db`, `/api/sql`: in-memory per-IP rate limit, not persisted.
- Budget scenarios (`functions/index.js`): a salted, truncated SHA-256 of the IP
  (`ipHash`) is stored in Firestore on `scenario_submissions` and `scenario_rate`, **with
  no expiry**. A salted IP hash is still pseudonymous personal data. It needs a retention
  period and a TTL.
- AI chat (`functions/llm_security.js`): an HMAC of the IP goes to `ai_usage` with
  `expiresAt` set 2 days out. This only deletes anything if a **Firestore TTL policy** is
  enabled on that field, so check that it is.
- Cloud Run / Firebase Hosting request logs contain IPs (GCP default retention).

### 1.4 AI chat: third-party processors

The prompt text goes through our function (`functions/llm_http.js`) to the **Google Gemini API**
(`generativelanguage.googleapis.com`). An earlier draft of this plan said OpenRouter; that was
wrong. Cloudflare **Turnstile** runs in the page. Voice input uses the browser's speech
recognition, which in Chrome sends audio to Google as the browser vendor. `ai/app/ChatPolicy.tsx`
already disclosed the Gemini and Turnstile parts. ⚠ Verify the Gemini key is on a **paid**
(billing-enabled) project: on the free tier Google may use prompts to improve its products,
which the privacy notice does not currently say.

### 1.5 Map tiles

Every Leaflet map (`LeafletMap`, `SectionsMap`, `SectorPointMap`, `LocalSectionsMap`,
`RiskClustersMap`) loads `tile.openstreetmap.org` directly, so the visitor's IP and
Referer go to the OSM Foundation (UK, which has an adequacy decision). This is not a
cookie issue. Disclose it, and optionally proxy or self-host the tiles later (§5).

### 1.6 Geolocation: fine

`AreaSniperButton` / `MyAreaEntryScreen` resolve the position against a bundled
settlements list **in the browser** and send nothing to a server. The browser's own prompt
is the consent. One sentence in the notice is enough.

### 1.7 The published corpus: the largest GDPR exposure, and no banner touches it

The site publishes personal data about **natural persons who are not visitors**: MPs,
officials, magistrates and their asset declarations (including spouses' holdings); Commerce
Registry officers and owners, including ~68k private "Tier V" owners; ЕРИК donors;
councillors' named votes; candidates. This is GDPR art. 14 processing. It needs:

- a stated **legal basis**: art. 6(1)(f) legitimate interest (public accountability, data
  already published by a public register) plus the freedom-of-expression / journalistic
  derogation in art. 85, which Bulgaria transposes in ЗЗЛД чл. 25з;
- a written **legitimate-interest / balancing assessment**, kept internally;
- a **data-subject section** in the notice: sources (each register named), categories,
  recipients, and how to object or request correction;
- a **contact channel and a handling process** for such requests.

The corpus already has privacy-by-design decisions worth citing: no ЕГН is stored, `np-`
natural-person contractors are not linked, ИСУН natural persons are dropped at parse time,
and name-only matches are refused rather than attributed. The assessment should build on
these.

This part is legal and editorial more than engineering. **A lawyer should review the §1.7
wording before it is published.** The engineering side is small: a page, a contact
address, and possibly a suppression list (§5).

## 2. Decisions (2026-09-26)

1. **The controller is the site owner, as a natural person.** The notice names them and
   gives a contact e-mail. Whether a postal address is also required, and whether to put
   the site under a legal entity, is a question for the lawyer. It is not a blocker for
   Phase 1.
2. **GA4 is removed. GA history is accepted as lost.** It is replaced with cookieless
   analytics (option C). Search Console is a separate product and is unaffected; only the
   GA↔GSC report goes away.
3. **Lawyer available in ~2 weeks.** So the work splits into Phase 1, which the owner can
   decide alone, and Phase 2, which is the §1.7 wording and needs legal review.

### Consequence: no consent banner

Once GA is gone, the site writes nothing to the device that is not strictly necessary or
explicitly requested (§1.2). No cookie is set by us, OSM tiles set none, and Turnstile's
storage is anti-abuse, so it falls under the strictly-necessary exemption. ЗЕС чл. 4а then
requires **no consent prompt**. The obligation that remains is transparency: the privacy
notice. That is a better outcome for readers than any banner. **Confirm it with the lawyer
in Phase 2**, together with §1.7.

This holds only as long as nothing re-introduces a non-essential cookie or tracker. The
T5 storage-table gate keeps localStorage honest. Any future third-party embed (YouTube, a
social widget) has to be checked against this section first.

### Analytics provider: still open

| option | cost | ops | notes |
| ------ | ---- | --- | ----- |
| **Plausible Cloud (EU-hosted)** | paid, tiered by monthly pageviews | none | ~1 KB script, no cookies, a DPA is available, custom events are supported |
| Umami, self-hosted on Cloud Run + a separate database on the existing Cloud SQL | ~free | a service to run and upgrade | no third party at all; open source, cookieless; puts write load on the serving Postgres box |

Both are cookieless, and each identifies a visitor by a daily-rotating salted hash of IP
and UA that is never stored raw. The legal basis is legitimate interest (audience
measurement), disclosed in the notice. **Recommendation: Plausible**, unless the pageview
price at the site's traffic is a problem. It is zero-ops, and it keeps analytics writes off
the Cloud SQL box the rest of this repo is careful about.

## 3. Phase 1: now, no lawyer needed

### T1: Remove GA4

- `src/App.tsx`: delete `initAnalytics` and the `react-ga4` import. Remove the
  `react-ga4` dependency.
- `index.html:76`: delete the `googletagmanager.com` preconnect.
- `src/lib/chatAnalyticsPrivacy.ts` (+ test): retire it. **Keep its rule**: a URL carrying
  `?q=` / `?args=` is chat state and must never reach analytics. Carry that rule into T2
  instead of deleting it.
- `tests/perf.spec.ts:1048` mentions `react-ga4` in the vendor-chunk comment. Update it and
  re-check the entry-chunk budget, which should shrink.
- After deploy, delete the GA4 property data or schedule it for deletion in GA admin
  (manual step), so data already collected is not kept indefinitely.

### T2: Cookieless analytics behind the existing seam

- `src/lib/analytics.ts` is already the only vendor seam (`trackEvent`, 4 call sites plus
  `electionSurfaceAnalytics.ts`). Repoint it at the chosen provider's event API. No call
  site should change.
- Load the provider script the same way GA was: after idle, skipped under
  `navigator.webdriver` and in DEV.
- Send **pathname only**, never the query string. That covers the chat rule and every
  `?q=` DbDataTable search.
- ⚠ **`trackSearch` / `trackSearchSelection` send the raw search term and the selected
  label.** On this site those are very often a person's name, i.e. personal data about a
  third party, sent to an analytics vendor. Drop `search_term` and `result_label`. Keep
  `result_type` and the result count, which is what the product question actually needs.
- Unit test: no event payload contains a query string or a free-text term.

### T3: Server-side retention

- Add an `expiresAt` of 90 days on `scenario_submissions` and `scenario_rate`, and enable
  Firestore TTL on that field. `scenario_agg` holds no IP and is unchanged.
- Verify that the TTL policy on `ai_usage.expiresAt` is actually enabled (§1.3).
- Ship order: functions (`deploy:db`) first, then hosting.

### T4: AI chat hint

Add one line under the chat input: „Въпросите се обработват от външен AI доставчик — не
въвеждайте лични данни." It links to `/privacy#ai`.

### T5: `/privacy`, visitor half (bg + en)

- A prerendered route with a sitemap `<loc>` in both `route_defs` lists. Use
  `ArticleLayout` / `ArticleProse`. Footer link „Поверителност" in `src/layout/Footer.tsx`.
- Sections:
  1. Who is responsible: the owner's name and e-mail.
  2. What happens when you visit, as a table (purpose / data / basis / recipient /
     retention):
     - analytics
     - server logs and rate limiting
     - scenario submissions
     - AI chat (OpenRouter, the model provider, Turnstile)
     - map tiles (OSM)
     - geolocation (in-browser only)
  3. **"No cookies, no consent prompt — here is why"**, followed by the storage table of
     every localStorage/sessionStorage key.
  4. Your rights, including the complaint to КЗЛД (cpdp.bg).
  5. **An interim "people in our data" paragraph**: which public registers the data
     comes from, and the same e-mail for objection or correction requests. The full
     art. 14 section comes in Phase 2.
  6. Last-updated date.
- Gate: a test that fails when a `localStorage`/`sessionStorage` key written in `src/` or
  `ai/` is missing from the page's storage table. This is what keeps the "no banner"
  conclusion true over time.

Phase 1 ships as one functions deploy followed by one hosting deploy. Effort is about 1–1.5
days, plus provider signup if Plausible is chosen.

## 4. Phase 2: with the lawyer (~2 weeks)

Bring the lawyer three things:

- **§1.7 in full.** The art. 14 notice for published persons: sources, categories,
  recipients, legal basis (6(1)(f) + art. 85 / ЗЗЛД чл. 25з), how long data is kept,
  rights. Also the written balancing assessment, which I can draft beforehand from the
  corpus's existing privacy-by-design rules so the lawyer reviews it rather than writes it.
- **The "no banner" conclusion** in §2.
- **Controller questions**: is a postal address needed, and should the site sit under an
  entity rather than the owner personally, given the owner's personal exposure for a site
  that publishes about officials?

Then publish the reviewed §1.7 into `/privacy` and set up the request handling: a mailbox
and a documented response process (GDPR gives 1 month). A suppression mechanism in the
person-layer loaders is designed only if a real objection is upheld.

## 5. Out of scope / later

- Proxying or self-hosting OSM tiles, so the visitor IP never leaves our infrastructure.
- A record of processing activities (GDPR art. 30), which is internal and not code.

## 6. Still needed from the owner

1. The name and e-mail to publish on `/privacy`. Suggested: a dedicated
   `privacy@naiasno.bg` rather than a personal address; `reference_electionsbg_dns_mail.md`
   covers the mail DNS.
2. Plausible or self-hosted Umami.

## 7. Phase 1: what was built (2026-09-26)

- **GA4 removed.** Gone from `App.tsx`, the `react-ga4` dependency, `chatAnalyticsPrivacy.ts`
  and the `googletagmanager` preconnect.
- **Third-party preconnects removed from `index.html`.** OSM a/b/c and parliament.bg were
  preconnected on EVERY page. That opened a connection to a third party, and handed it the
  visitor's IP, for pages that never used it. MP photos are self-hosted, so nothing loads from
  parliament.bg at all. `privacyContent.test.ts` now refuses any third-party preconnect.
- **`src/lib/analytics.ts` rewritten around self-hosted Umami 3.4.**
  - First-party at `/stats/*`; `firebase.json` rewrites `/stats/**` to the Cloud Run service
    `umami` in europe-west3.
  - The tracker is configured with `data-exclude-search`, `-hash`, `-do-not-track`, `-domains`
    and `data-host-url`, plus a before-send hook that drops the page title.
  - `sanitizeProps` refuses free-text prop keys.
  - Search tracking now sends only the result count and type. Previously the raw term and the
    chosen result's name went to Google.
- **`scripts/umami/privacy.sql`** runs in the umami database. It enforces server-side what the
  notice promises:
  - no city, no page title, no query string, no click ids;
  - a 25-month retention sweep, run by a once-a-day statement trigger.

  Tested on a local Umami 3.4 container: it applies idempotently and every rule was exercised.
  Umami must run with `SALT_ROTATION=day` (default is month). The notice says the identifier
  changes daily.
- **Budget scenarios.**
  - `ipHash` is no longer written on `scenario_submissions`. The header comment already claimed
    it was not, and nothing read it.
  - `scenario_rate` docs get `expiresAt` +2 days.
  - `scripts/privacy/strip_scenario_iphash.mjs` (dry-run by default) cleans the 3 existing
    docs.
  - The `ai_usage` TTL was verified ACTIVE.
- **Chat hint** added under the input. It links to `/privacy#ai`.
- **`/privacy` page (bg + en).** Everything is rendered from `src/screens/privacy/privacyContent.ts`
  for both the React screen and the prerender.
  - It has the footer link, both sitemap lists, the regenerated sitemap and an og card.
  - `privacyContent.test.ts` fails when a new storage writer appears without a row, when a
    cookie is set, or when GA returns.
- Verified facts the notice states:
  - `_Default` log bucket = 30 days;
  - data bucket = EUROPE-WEST3;
  - `llm` / `scenarios` functions = us-central1, hence the DPF sentence.

### Infrastructure created 2026-09-26

- Cloud SQL: role `umami`, a plain LOGIN with no superuser, createdb or createrole, and
  `CONNECTION LIMIT 10`. It owns database `umami`, and `CONNECT` is revoked from PUBLIC.
  `postgres` is granted `umami` so it can administer it.
- Secret Manager (europe-west3): `UMAMI_DATABASE_URL` (unix-socket URL) and `UMAMI_APP_SECRET`.
  Readable only by `umami-run@`.
- Artifact Registry `europe-west3/umami`: `umami:3.4.0`, copied from ghcr.io (same digest as the
  locally tested image). **Upgrade** = copy the new tag, redeploy, re-apply
  `scripts/umami/privacy.sql`.
- Service account `umami-run@`: `roles/cloudsql.client` plus access to the two secrets only.
- Cloud Run `umami` in europe-west3: **private** (`--no-allow-unauthenticated`), 0–2 instances,
  1 GiB. Env: `SALT_ROTATION=day`, `TRACKER_SCRIPT_NAME=stats/script.js`,
  `COLLECT_API_ENDPOINT=/stats/api/send`, telemetry and update checks off. Migrations applied on
  first boot.
- `scripts/umami/privacy.sql` applied to the `umami` database. Its three triggers are present.
- Firestore TTL on `scenario_rate.expiresAt` enabled. `ai_usage.expiresAt` was already ACTIVE.

### Still to do before Phase 1 is live

1. **Owner:**
   - open the dashboard through `gcloud run services proxy umami --region europe-west3 --port 3001`;
   - change the default `admin` / `umami` password;
   - add the website `naiasno.bg`;
   - hand over the Website ID.
2. Set `UMAMI_WEBSITE_ID` in `src/lib/analytics.ts`. While it is empty the tracker never loads.
3. Make the service public: `gcloud run services add-iam-policy-binding umami --region
   europe-west3 --member allUsers --role roles/run.invoker`. Firebase Hosting's rewrite needs it,
   and it must happen only AFTER step 1.
4. Set `CONTROLLER_NAME` in `privacyContent.ts`, the owner's name.
5. Deploy: `firebase deploy --only functions:scenarios`, then `npm run deploy`.
6. Owner runs `node scripts/privacy/strip_scenario_iphash.mjs --apply` (3 submissions, 1 rate doc).
7. After deploy, schedule deletion of the old GA4 property's data in GA admin.
8. ~~Verify the Gemini API key's project has billing enabled (§1.4).~~ Done 2026-09-30: the key
   belongs to `gen-lang-client-0866766809`, which has billing enabled (paid tier). /privacy#ai says so.

### Went live 2026-09-30

- The owner changed the Umami admin password and created website
  `4a29eca9-f428-4064-b974-0654598cce76`. The service was then made public.
- Deploys: `functions:scenarios`, then the three-step hosting → `deploy:db` →
  `SKIP_PREDEPLOY=1 deploy`. After it, the homepage and `/person/mp-3643` both served
  `index-BhDU3NJs.js`.
- The first hosting attempt failed its predeploy: 80 `ai:test` cases, all `tool threw:`. The cause
  was the LOCAL `electionsbg-pg` container, stopped 14 h earlier. The AI regression harness runs
  the real `/api/db` handlers against local Postgres. `npm run db:pg:up`, then 2168/2168.
- Verified live:
  - `/privacy` and `/en/privacy` return 200;
  - `/stats/script.js` returns 200 with `max-age=86400`;
  - `/stats/api/send` returns 405 to a GET and 200 to a POST;
  - `/stats/login` returns 404, so the dashboard is not exposed through the site;
  - no GA on the homepage.

  One pageview was stored as `/privacy` with `url_query` and `page_title` NULL, and `city` NULL.
- ⚠ Found live: Chrome never runs an idle callback in a hidden tab, so background-opened tabs
  were not counted. Fixed by `requestIdleCallback(load, { timeout: 5000 })`. It ships with the
  next hosting deploy.
- Still owed by the owner:
  - `node scripts/privacy/strip_scenario_iphash.mjs --apply`;
  - GA4 property data deletion.
