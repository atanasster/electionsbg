# Chat and article handoff for naiasno.bg

Backend update (2026-09-10): the LLM function, secrets and usage ledger have moved to elections-bg. The stable API is `https://elections-bg.web.app/api/llm`; legacy Hosting redirects its API and the old function stays disabled. See [the migration record](llm-main-project-migration.md). Earlier statements below about retaining the backend/ledger in electionsbg-ai describe the pre-migration state and are superseded. No article publication or project deletion occurred.

Prepared 2026-09-10. This supplements `naiasno-rebrand-v1.md`; it does not execute the domain migration. Complete the electionsbg.com chat launch and its editorial gate first. No DNS changes are authorized by this handoff.

## Stable public contract

Keep these paths and language behavior on the final domain:

| Bulgarian | English |
| --- | --- |
| `/chat` | `/en/chat` |
| `/chat/tools` | `/en/chat/tools` |
| `/chat/evals` | `/en/chat/evals` |
| `/articles/2026-09-10-popitai-naiasno` | `/en/articles/2026-09-10-popitai-naiasno` |

Question URLs carry `q`; tools carry `v`, `tool`, JSON `args`, optional `area`, and legacy `lang`. Preserve them exactly through redirects. Legacy `lang` normalizes to the main path language. Query URLs canonicalize to the base chat/tools page and do not become sitemap entries. Sharing re-asks a question; it does not preserve the old answer or full conversation.

## Before switching traffic

- Add the exact final HTTPS origin(s) to `functions/llm_origins.js` and any DB/bucket CORS policy that requires them. Preserve still-active old origins. Deploy additive function changes before the frontend switches. Verify OPTIONS and normal session/start/completion/finish calls from the new origin; retain the existing Firestore ledger and secrets.
- Add the corresponding hostnames to the existing Cloudflare **Naiasno AI Chat** Managed widget, with no pre-clearance and the same public key. On 2026-09-10 it contained nine hosts: ai.electionsbg.com, the two AI Firebase domains, electionsbg.com, the two main Firebase domains, the two staging Firebase domains, and the chat-launch preview. The widget UI allows ten. Remove the expired task preview hostname when it is no longer needed before adding both naiasno.bg and www.naiasno.bg; verify the current list first. Never remove an active review hostname prematurely or weaken verification to work around the limit.
- Keep `https://ai.electionsbg.com/api/llm` working while it is the configured service endpoint. Page migration alone does not require moving that backend. A later endpoint relocation needs its own proof and cannot silently create a new allowance ledger.
- Set `src/lib/siteOrigin.ts` with the broader site migration and run `scripts/lib/siteOrigin.test.ts` to find its static copies. Update canonical/OG/hreflang, sitemaps, robots and llms output together. Do not hand-edit only the article canonical.
- Main chat forces its DB client to same-origin in `src/screens/ChatScreen.tsx`. The legacy standalone build still uses its configured `VITE_DB_API_ORIGIN`; update that configuration only if the old data origin is being retired, and rebuild the recovery frontend.

## Redirects and local conversations

Update the legacy page redirect destinations directly to the final domain, avoiding ai.electionsbg.com → electionsbg.com → naiasno.bg chains. Include electionsbg.com's corresponding path redirects in the broader migration. Preserve the API and old-origin recovery routes.

The candidate `scripts/chat-launch/legacy-redirects.json` and probe currently expect electionsbg.com deliberately. Change their expected destination origin together for the new release, then run the real Hosting proof again with Bulgarian punctuation and JSON arguments. The local emulator alone is insufficient: its query-encoding behavior differed in the launch proof.

Browser localStorage is origin-specific a second time. A conversation saved on electionsbg.com does not automatically appear on naiasno.bg, and an in-memory AI token must be reverified. Before redirecting electionsbg.com, provide a distinct, non-redirected recovery URL on that origin too; the recovery on **ai.electionsbg.com** can only access the earlier AI-origin storage. Keep clear export instructions and do not promise an import feature that does not exist. Do not implement automatic cross-origin transfer or server conversation storage as an incidental domain change.

## Editorial and verification handoff

Replace the article's “domain move coming soon” sentence once the move has actually happened. Review old domain labels in the homepage artwork, screenshots and captions. Preserve the dates of historical data examples; do not silently relabel a September capture as current. Recapture any figure whose controls or explanation materially changed.

On the new domain, repeat:

- BG/EN direct loads, reload and Back/Forward for all three screens; starter and same-route question links; tools state and area; article links and full-size figures.
- Normal Turnstile verification and a real AI answer; explicit No AI fallback; expiry/allowance wording; source/dashboard navigation.
- CORS and asset content types, one visible H1, correct canonical/hreflang/OG, article index/sitemap presence, and mobile/light/dark layout.
- Main entry/preload and homepage header budgets, plus analytics inspection with a task-owned prompt URL. No prompt, tool args or conversation may enter telemetry.
- Old root/tools/evals redirects and both generations of recovery pages. Test actual saved export in the same browser on each relevant origin.

Use the broader migration's approved Hosting/function/cache-purge sequence and rollback versions. Keep prior domain/endpoint access during rollback. No automation is created by this checklist.

## Completion boundary

The current chat project supplies integrated routes, origin-safe relative article links, verified launch examples, publication safeguards, old AI-origin recovery, tested redirect candidates and a release runbook. Adding naiasno.bg origins, changing DNS/canonicals, new-origin recovery, final-domain redirects and recaptures remain actions for the separate rebrand release.
