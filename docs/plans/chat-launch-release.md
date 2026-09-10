# Chat launch: review, release and recovery

## Production release — 2026-09-11

The user approved Hosting deployment and publication of the article and homepage card. This release supersedes the earlier pending-publication notes below.

- Publication commit: `e3b03755be` (article `draft: false`, invitation `published: true`).
- Previous Hosting version: `7b562cd3deaae777`; first release: `36a9bce56bfb5b01`; final release: `a6d31a59c74c585b`.
- Completed Hosting → DB function → identical Hosting sequence; DB revision `db-00142-sag`, ACTIVE.
- Verified entry `/assets/index-duKUsvYg.js`, SHA-256 `0ccd3cbf751bdadf4437fbf12fc23b318900234ce990a96a509d4f030827accd`, against local output on the homepage, chat/tools/evals, article, function-served company page and direct DB function shell. All returned 200 and referenced the same JavaScript asset.
- Build, production packaging guard, budget tests, AI regression suite and tools harness, and 614 function tests passed. Lint had no errors and one existing Fast Refresh warning in `InterregTile.tsx`.
- Browser checks passed for the published homepage card, BG/EN article and GitHub issue link, chat/tools/evals full-width toolbar and footer. A non-AI budget starter returned the period 2026-07-31; a real Gemini follow-up completed in 5.1 seconds. All eight article screenshots matched local SHA-256 hashes.
- `naiasno.bg` still redirects to `electionsbg.com`; no DNS or standalone-site changes were made in this release.


Backend update (2026-09-10): the LLM function, secrets and usage ledger have moved to elections-bg. The stable API is `https://elections-bg.web.app/api/llm`; legacy Hosting redirects its API and the old function stays disabled. See [the migration record](llm-main-project-migration.md). Earlier statements below about retaining the backend/ledger in electionsbg-ai describe the pre-migration state and are superseded. No article publication or project deletion occurred.

Prepared 2026-09-10. Owner: Atanas / the operator carrying out the approved release. This is a runbook, not a record that production was released.

## Current state and review links

The integrated screens and completed draft are on the isolated, noindex preview:

- Homepage: https://elections-bg--chat-launch-gu0gkopz.web.app
- Bulgarian article: https://elections-bg--chat-launch-gu0gkopz.web.app/articles/2026-09-10-popitai-naiasno
- English article: https://elections-bg--chat-launch-gu0gkopz.web.app/en/articles/2026-09-10-popitai-naiasno
- Chat / tools / evaluations: `/chat`, `/chat/tools`, `/chat/evals`, plus `/en` equivalents.

The channel expires 2026-09-17 unless refreshed. Preview is publicly reachable by link, not access-controlled. Main production Hosting and DB have not been deployed for this launch. Article `draft` remains true; `src/lib/chatLaunchPublication.json` remains false. The normal build removes draft bodies and the launch image directory. An explicit preview build cannot pass the main Hosting production guard.

Already applied: additive AI function origins/Turnstile hostnames, the Managed widget's exact hostnames, and bucket CORS preserving its pre-existing origins. The LLM endpoint stays `https://ai.electionsbg.com/api/llm` in project `electionsbg-ai`, with its existing secrets and Firestore allowance ledger. No SQL migration or data reload.

## Saved rollback references

Observed live releases before main rollout:

| Site | Version | Release | Observed release time (UTC) |
| --- | --- | --- | --- |
| elections-bg | `ee3224614d0809ab` | `1788907860186000` | 2026-09-08 22:51:00.186 |
| electionsbg-ai | `8454e01f222a333e` | `1789025531755000` | 2026-09-10 07:32:11.755 |

Re-read both live channels immediately before release; another operator may have shipped since these observations. Preserve each then-current live version using a named prelaunch channel before overwriting it, or record a retained Console rollback version. The CLI's supported clone syntax is `site:channel`, not `site:version`. For example, after creating the task-owned destination channels:

```sh
firebase hosting:clone elections-bg:live elections-bg:chat-prelaunch -P elections-bg
firebase hosting:clone electionsbg-ai:live electionsbg-ai:chat-prelaunch -P electionsbg-ai
```

Record the actual resulting versions and channel expiry in the release log. Keep those channels through the transition. Save the verified build and effective Hosting config outside public output; never include environment files or secrets in rollback artifacts.

## Execute only after complete rendered editorial approval

1. Review both articles, homepage and example links together. Confirm the publication date is still accurate; recheck dated competitive availability if release is delayed. The evidence manifest is `chat-launch-assets/examples.json`; research limitations are in `chat-launch-assets/research.md`. The price-map screenshots with provider watermarks are excluded. The underlying chat price map watermark remains a known presentation limitation, not evidence that its figures are wrong.
2. Build normally without `VITE_CHAT_LAUNCH_PREVIEW`. Leave publication false and article draft true for the first production deployment. Run the production packaging guard. Deploy the integrated routes without the invitation/article using the repository order: main Hosting → `npm run deploy:db` → `npm run deploy:fast` with that same verified build. The second Hosting release purges the edge after the function's cached HTML shell refresh. Do not substitute the AI function deploy for the main DB deploy.
3. Verify all six routes on production, a real normal Turnstile verification and AI answer, a No AI price/budget card, tools deep-link JSON, source navigation and query privacy. Check a representative illustrated budget response against the dated screenshot. If materially changed, refresh the capture and prose before publication. Keep the unadvertised rollout only if those checks pass.
4. Publish as one source change: set the publication JSON to true and remove/set false the launch article's `draft` field. The package gate requires agreement. Rebuild normally, run article/packaging/performance checks, then repeat the same Hosting → DB → Hosting release order. Verify article lists, canonical/hreflang/OG, sitemap inclusion, images and homepage links in BG/EN. Do not promote the editorial preview artifact to live.
5. Build and deploy the prepared old-site transition using `npm run deploy:ai` only after main chat is working. The standalone UI now includes a move/export notice and `/legacy-export`, preserves the browser's existing `naiasno.chat.v1` storage, and has no standalone GA initialization. Use the same browser on the old origin to confirm a saved conversation can be restored and exported as Markdown/PDF. Verification tokens are not transferred.
6. Keep the notice before permanent redirects. Proposed transition: at least 14 days after publication; record an actual start/end date with the release. This is a manual follow-up, not an automation. Do not remove recovery merely because the interval elapsed.
7. After the transition and another production destination check, copy the exact rules from `scripts/chat-launch/legacy-redirects.json` into **only** the AI Hosting target's `redirects` array, retaining its API and recovery rewrites. Review that concrete config before deploying. There is deliberately no wildcard page redirect. Run `node scripts/chat-launch/verify-legacy-redirects.mjs https://ai.electionsbg.com` after deployment. Check the legacy API's main-origin OPTIONS response still returns 204, then complete a real integrated AI question. The probe itself only reads page responses; it never spends AI quota.

The transition still depends on the standalone build. Do not delete `ai/main.tsx`, `vite.config.ai.ts`, recovery assets or `deploy:ai` while `/legacy-export` depends on them. Retain `deploy:ai:functions` while the AI backend is in that project.

## Redirect proof and its limits

The exact root/tools/evals 301 rules were deployed to a task-owned one-day Firebase Hosting channel on 2026-09-10. Real Hosting preserved decoded Bulgarian questions (including `?`, `&`, `+`, `%`), JSON arguments, language and area across all five route forms. The local Hosting emulator double-encoded `%3F`; the regression probe detects that failure and actual Hosting passed. Preserve the query rather than adding an unsafe global double-decode to the application.

The proof's API and recovery paths were static fixtures and were not redirected; its unknown route returned 404. This proves rule selection, not a working LLM function or historical conversation. The real transition keeps the `/api/llm` function rewrite. Its intentional unknown-page fallback is a readable recovery link (SPA HTTP 200); it does not invent a main-site destination. The distinct `/legacy-export` route is never in the redirect set and its HTML is noindex.

## Roll back

Before advertising: restore the saved main Hosting version/channel, then refresh the DB's served shell and repeat Hosting with that restored build/version. If restoring from the Console, verify the function-served HTML matches the restored entry hash before calling recovery complete.

After advertising: disable the invitation and unpublish the article together if its claims no longer describe the available experience. Restore the prior main release or ship a verified corrective build using the same shell-refresh sequence. Keep additive backend origins and quota data intact.

For a broken legacy redirect destination, restore the preceding AI Hosting config/version. Permanent redirects may be cached in visitors' browsers; point affected visitors directly to `https://ai.electionsbg.com/legacy-export`, which was never redirected. Keep a working recovery build at that URL even if the root route cannot immediately recover. Never “fix” access by disabling Turnstile, deleting quota data or copying tokens between origins.

## Manual launch observation

Check aggregate invitation clicks, chat starts, successful answers, source clicks, follow-ups, fallback/limit rates and errors after release. No raw questions, URLs containing `q`/`args`, or conversation content belongs in analytics. Some prompt-link sessions are deliberately uncounted by the privacy guard. A launch is technically successful when citizens reach useful sourced answers; routing-test percentages are not answer-accuracy claims.

Production publication, old-host notice deployment, transition dates and permanent redirects remain pending the stated release gates. The later domain move is covered separately in `chat-launch-rebrand-handoff.md`.
