# Integrated chat dependency audit — 2026-09-10

The layout audit below originally identified both source and backend dependencies. The LLM backend migration is now covered by `llm-main-project-migration.md`; the remaining frontend source dependency must still be addressed before deleting `ai/`.

- Main-site entry: `src/screens/ChatScreen.tsx` imports `ai/App.tsx`, evaluation, toolbar, navigation, storage and data-client modules. These are bundled locally into the main site, not downloaded from standalone Hosting. Removing the `ai/` source directory would break the main build.
- Design system: chat uses main `src/components/ui`, theme context and theme tokens. The standalone entry itself imports main `src/index.css` and `src/App.css`; it is not an independent design system. Integrated language is provided by the main router/i18n context.
- Layout correction: all three integrated screens now use `src/layout/Layout.tsx`, including the standard header, community strip, content container and footer. The conversation retains its inner scroll area for answer-following behavior and does not create a second main landmark; the site footer follows the content. Standalone screens retain their own entry for now.
- Data: the integrated entry sets the DB origin to the main site's same origin. Shared public datasets and evaluation artifacts remain separate data dependencies.
- AI backend: now owned by elections-bg, using `https://elections-bg.web.app/api/llm`, main-project secrets and the migrated Firestore usage ledger. The old function is disabled and legacy Hosting temporarily redirects its API to the main endpoint. The stable Firebase hostname avoids the pending marketing-domain redirect. See the migration record for validation.


Before shutdown, move the chat module into a main-site-owned source location and remove standalone-only UI branches/build configuration. The backend migration is recorded separately. Only then retire the old Hosting/project and update obsolete links. This audit does not authorize project deletion.

Validation: main typecheck and scoped lint pass; the complete preview build/postbuild and five entry/home performance checks pass. Twelve local BG/EN desktop/320px cases confirm a single main landmark, a single shared footer, composer availability and no horizontal overflow. Review caught an initial scrolling regression; retaining the existing bounded inner conversation scroller repairs it. No outstanding review findings remain.
The refreshed isolated preview also passes all twelve equivalent hosted layout cases. Production shutdown was not performed; the subsequent backend migration is recorded above.
