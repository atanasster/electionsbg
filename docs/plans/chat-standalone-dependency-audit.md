# Integrated chat dependency audit — 2026-09-10

The integrated chat is not yet independent of the standalone AI project. Do not retire that project as part of the layout correction.

- Main-site entry: `src/screens/ChatScreen.tsx` imports `ai/App.tsx`, evaluation, toolbar, navigation, storage and data-client modules. These are bundled locally into the main site, not downloaded from standalone Hosting. Removing the `ai/` source directory would break the main build.
- Design system: chat uses main `src/components/ui`, theme context and theme tokens. The standalone entry itself imports main `src/index.css` and `src/App.css`; it is not an independent design system. Integrated language is provided by the main router/i18n context.
- Layout correction: all three integrated screens now use `src/layout/Layout.tsx`, including the standard header, community strip, content container and footer. The conversation retains its inner scroll area for answer-following behavior and does not create a second main landmark; the site footer follows the content. Standalone screens retain their own entry for now.
- Data: the integrated entry sets the DB origin to the main site's same origin. Shared public datasets and evaluation artifacts remain separate data dependencies.
- AI backend: `ai/llm/session.ts` defaults to `https://ai.electionsbg.com/api/llm`. The AI Hosting target rewrites this to the `llm` function, and `.firebaserc` associates that target with `electionsbg-ai`. Removing the standalone site or Firebase project would interrupt verification and AI answers.

Before shutdown, move the chat module into a main-site-owned source location and remove standalone-only UI branches/build configuration. Separately migrate the LLM function, secrets, Turnstile configuration and quota/session ledger to the intended surviving backend, wire the main-site endpoint, and verify real AI access plus quota behavior there. Merely changing the URL is not sufficient. Only then retire the old Hosting/project and update obsolete links. This audit does not perform a backend migration or project deletion.

Validation: main typecheck and scoped lint pass; the complete preview build/postbuild and five entry/home performance checks pass. Twelve local BG/EN desktop/320px cases confirm a single main landmark, a single shared footer, composer availability and no horizontal overflow. Review caught an initial scrolling regression; retaining the existing bounded inner conversation scroller repairs it. No outstanding review findings remain.
The refreshed isolated preview also passes all twelve equivalent hosted layout cases. Production shutdown and backend migration were not performed.
