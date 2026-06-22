# Procurement Watchlist v2 — accounts, cloud sync & alerts

Status: PLAN (not started)
Author: planning pass, 2026-06-22
Scope: turn `/procurement/watchlist` from a static localStorage bookmark list into a
world-class personal **monitoring** surface — reachable from everywhere, alive with
"what changed", optionally backed by a Google/email account for cross-device sync and
email alerts.

---

## 1. Where we are today

- **Storage** — `src/data/procurement/useWatchlist.ts`: a module-level store + `useSyncExternalStore`,
  persisted to `localStorage` under `naiasno.procurement.watchlist.v1`, cross-tab synced via the
  `storage` event. No account, no backend. Stores `{ kind, id, label, addedAt }`.
- **Kinds** — `company | awarder | person | place` are all typed and routable, but only
  `company` and `awarder` have an actual Follow affordance.
- **Adding** — `src/screens/components/procurement/FollowButton.tsx`: an 11px text pill that
  exists in exactly two places — the `CompanyByEikScreen` and `AwarderByEikScreen` headers.
- **Viewing** — `src/screens/ProcurementWatchlistScreen.tsx`: a flat list of name + kind + ×.
  No live data, no "what changed". Nothing to come back for.
- **You cannot watch a contract at all** (no `contract` kind), which is the operator's literal
  complaint ("the contracts are very difficult to reach").

### Backend facts (verified)

- 3 Firebase projects (`.firebaserc`): `elections-bg` (prod, electionsbg.com), `electionsbg-staging`,
  `electionsbg-ai` (ai.electionsbg.com).
- Firestore lives in **elections-bg**. `firestore.rules` is currently `allow read, write: if false`
  — written only by the Admin SDK inside the `scenarios` function. **No client Firebase SDK in the app.**
- Functions: `functions/index.js`, Node 22, `us-central1`. `scenarios` (prod) + `llm` (ai). Established
  `/api/*` hosting-rewrite → function pattern.
- Vite already does `manualChunks` — the Firebase client SDK can be a lazy chunk.

---

## 2. Design goals

1. **Reachable** — you can follow any entity (and any contract) from wherever you see it: list rows,
   search results, the risk-flag feed, the flow diagram, the contract page. One click, no drill-down.
2. **Alive** — the watchlist answers "what changed about the things I care about" — new contracts,
   value deltas, newly-tripped risk flags — with an unread badge that earns return visits.
3. **Portable** — survives a device change. Anonymous (localStorage) by default; **optionally** signed
   in (Google / email) for cross-device sync and email alerts.
4. **Cheap & private** — minimal bundle cost (lazy SDK), minimal Firestore cost (per-user docs,
   snapshot subscription), explicit privacy posture (this introduces the site's first PII).
5. **Generalizable** — the `kind` namespace and the auth/Firestore foundation are designed so a
   later site-wide "follow" (MPs, parties, municipalities) reuses the same plumbing.

---

## 3. Architecture decisions

### 3.1 Auth — Firebase Auth on the existing `elections-bg` project
- Enable **Google** + **Email/Password** providers in the Firebase console (no new project).
- Client SDK modules: `firebase/app`, `firebase/auth`, `firebase/firestore` — **lazy-loaded** via
  dynamic `import()` so the main bundle is untouched until a user signs in or opens the watchlist.
- The Firebase web config (apiKey, authDomain, projectId, appId…) is **not secret** — it ships in the
  client; security is enforced by Firestore rules + the Authorized Domains list.
- Authorized domains: `electionsbg.com`, `www.electionsbg.com`, `naiasno.bg`, `localhost`.

### 3.2 Watchlist persistence — client Firestore SDK + uid-scoped rules (NOT a CRUD function)
This is the central call. The repo's current posture is "no client SDK, deny-all rules, Admin-only
writes." For **per-user CRUD that is the wrong tool** — it would mean re-implementing auth-token
verification and CRUD inside a function. The idiomatic, least-code path is the client Firestore SDK
with security rules scoped to `request.auth.uid`. We keep deny-all for every non-user collection, so
the `scenario_*` Admin-only model is unchanged.

**Firestore data model**
```
users/{uid}                      // profile doc
  ├─ createdAt, locale
  ├─ emailDigest: { enabled: bool, frequency: 'daily'|'weekly', email: string }
  └─ lastNotifiedAt: timestamp
users/{uid}/watchlist/{itemId}   // one doc per watched entity; itemId = `${kind}__${id}`
  ├─ kind:  'company'|'awarder'|'person'|'place'|'contract'
  ├─ id, label, addedAt
  ├─ lastSeen:        { at: ts, count: int, totalEur: number, latestDate: string }  // for in-app diff
  └─ notify:          bool         // per-item alert opt-in (default true)
```
Subcollection (not a single array doc) because: per-item `lastSeen` for the diff, no 1 MB doc ceiling,
no array-update races, and `onSnapshot` gives free reactivity.

**Security rules** (additive to the existing deny-all):
```
match /users/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
  match /watchlist/{itemId} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
// everything else stays: allow read, write: if false;  (scenario_* = Admin SDK only)
```

### 3.3 Offline-first store with a pluggable backend
Keep `useWatchlist.ts`'s public API **exactly the same** (`useWatchlist`, `useFollow`, `toggleFollow`,
`isFollowing`, `removeFollow`) so the ~existing call sites and the new universal star don't care where
data lives. Internally the module gains a backend:
- **Signed out** → localStorage (today's behaviour, unchanged).
- **Signed in** → Firestore is the source of truth; an `onSnapshot` subscription mirrors docs into the
  same in-memory store, so every `FollowButton`/`useFollow` consumer stays reactive with zero changes.
  Writes go to Firestore (optimistic local echo).
- **First sign-in merge** → union localStorage items into Firestore by `kind:id` (keep earliest
  `addedAt`); then localStorage becomes a passive cache.

### 3.4 "What changed" — one pipeline-emitted delta file powers BOTH the in-app feed and the email cron
Instead of N per-entity rollup fetches (in-app) or N×users fetches (cron), the data pipeline emits a
single compact delta on each ingest:
```
data/procurement/derived/recent_activity.json   (also sharded if large)
  byEik:     { [eik]:   RecentContract[] }   // keyed by contractor AND awarder EIK
  byEkatte:  { [ekatte]: RecentContract[] }
  byContract:{ [id]:    'new'|'amended' }
  windowDays: 90, generatedAt: ISO
RecentContract = { id?, title, amountEur, date, awarderEik, awarderName, contractorEik, contractorName }
```
- **In-app**: the watchlist screen fetches `recent_activity.json` once, looks up each followed entity,
  diffs against that item's `lastSeen` snapshot → "3 new since you last looked · €4.2M".
- **Cron** (Phase 2): the scheduled function reads the same file once and fans it out per user.
- Generated in `scripts/procurement/` during the existing offline rebuild (diff new corpus vs prior).
  Document as a one-off-free, watcher-driven step (per `feedback_one_off_backfills`).

### 3.5 Email alerts — scheduled function + email provider (Phase 2)
- New `digest` scheduled function (`onSchedule`, `us-central1`) in `functions/index.js`, gated to the
  `elections-bg` project (same lazy-Admin pattern as `scenarios`).
- Runs **after** the daily data deploy. Reads all `users/*` with `emailDigest.enabled`, looks up each
  watched item in `recent_activity.json` (fetched once from the public hosting URL), composes a digest,
  sends, and stamps `lastNotifiedAt` (+ per-item `lastSeen`) so it never repeats.
- Email transport: **Firebase "Trigger Email" extension** (write to a `mail/` collection, extension
  sends via configured SMTP) is the least-code option; alternative is Resend/SendGrid via a
  `defineSecret` API key. Pick at Phase 2 start.
- Every email carries a one-click manage-prefs / unsubscribe link (token in the URL → `/account`).

---

## 4. Phasing

Each phase ships independently and is useful on its own. **Phase 0 delivers the whole UX win with zero
backend** — auth and email are purely additive.

### Phase 0 — Reach + life (localStorage only, no auth) ★ highest leverage — SHIPPED 2026-06-22
Fixes the operator's complaint immediately; no architectural risk. Built + browser-verified
(tsc + lint + production build green). Files: `FollowStar.tsx`, `useWatchlistActivity.ts`,
`WatchlistDigestTile.tsx`, rewritten `useWatchlist.ts` (contract kind + seen-map) +
`ProcurementWatchlistScreen.tsx`; stars wired into the two overview tiles + contract / settlement /
candidate pages; unread badge on the nav pill; bg+en i18n.

**One deferral:** the pipeline-emitted `recent_activity.json` (§3.4) was NOT built in Phase 0 — the
in-app "new since you last looked" diff is computed client-side from the live per-entity rollups
(count / total / latest-date signature vs a localStorage `lastSeen` snapshot). `recent_activity.json`
moves to Phase 2, where the email cron genuinely needs a single fan-out file.

- [ ] **`<FollowStar>`** — new shared compact icon-button (`src/screens/components/procurement/FollowStar.tsx`):
      icon-only, `aria-pressed`, tooltip, sizes sm/md. Refactor `FollowButton` to wrap it (keep the text
      pill for detail-page headers).
- [ ] **Add `contract` to `WatchKind`** (`useWatchlist.ts`); `hrefFor` → `/procurement/contract/${id}`.
      Only render the star on contracts that have a detail page (the bounded by-id subset — guard on the
      12-hex id + presence); for others, no star (or a disabled tooltip "not individually trackable").
- [ ] **Wire the dead kinds**: `person` star on candidate/official procurement pages; `place` star on
      `ProcurementSettlementDetailScreen`.
- [ ] **Roll the star into list rows** (the "hard to reach" fix): `TopContractorsTile`, `TopAwardersTile`,
      `TopMpsTile`, `TopOfficialsTile`, `CompanyTopContractsTile`, `AwarderTopContractsTile`,
      `SettlementProcurementTile` rows, the `/procurement/flags` feed rows, the `/procurement/people`
      scanner results, the concentration table rows, and the global search results. Sankey nodes get a
      "Follow" item in their existing click affordance.
- [ ] **`recent_activity.json`** pipeline emit (`scripts/procurement/recent_activity.ts`, called from the
      offline rebuild). Ship a backfilled first version.
- [ ] **Watchlist screen redesign** (`ProcurementWatchlistScreen.tsx`) into a dashboard:
      - "New activity" section at top (entities whose `recent_activity` exceeds their `lastSeen`),
        expandable to list the new contracts; "Mark all seen" updates snapshots.
      - Grouped, live entity cards (total awarded, # contracts, latest contract, top counterparty, active
        risk badge) — sourced from the rollup hooks already in the app.
      - Sort (recent activity / value / name), filter by kind.
      - Real empty state: inline search box + suggestions (seed from My-Area / governance context).
- [ ] **Unread badge** on the ★ nav pill (`ProcurementNav.tsx`) + optionally the header — count of items
      with activity since `lastSeen` (per-item snapshot stored in localStorage for anon users:
      `naiasno.procurement.watchlist.seen.v1`).
- [ ] **Watchlist digest tile** on the procurement Overview ("2 of your watched buyers awarded new
      contracts this week") so the value is visible without opening the tab.
- [ ] i18n keys (bg + en) for all new strings; `npx eslint . --fix`; tsc + vite build green.

### Phase 1 — Accounts + cloud sync
- [ ] Add `firebase` to deps; **lazy** `src/lib/firebase.ts` (dynamic import of app/auth/firestore;
      exports `getFirebase()` / `getDb()` / `getAuthLazy()`). Add to a dedicated vite manualChunk.
- [ ] Firebase web config in `src/lib/firebaseConfig.ts` (public values; via `import.meta.env`).
- [ ] **`AuthProvider` + `useAuth()`** (`src/data/auth/`): `onAuthStateChanged`, `signInWithGoogle`,
      `signInWithEmail`, `signUpWithEmail`, `sendPasswordReset`, `signOut`, `user`, `loading`.
- [ ] **Sign-in UI**: a modal (Radix dialog) reachable from the watchlist CTA + a header account menu
      (avatar / "Sign in"). Routes: `/account` (prefs + sign out).
- [ ] Firestore rules: add the `users/{uid}` block above; deploy (`firebase deploy --only firestore:rules`).
- [ ] **Pluggable backend in `useWatchlist.ts`**: localStorage ⇄ Firestore (`onSnapshot` mirror,
      optimistic writes, first-sign-in merge). Public API unchanged.
- [ ] Move per-item `lastSeen` into the Firestore doc when signed in (localStorage fallback otherwise).
- [ ] Enable Auth providers + Authorized Domains in the console (manual, document in README).
- [ ] **App Check** (reCAPTCHA v3) for Auth + Firestore abuse protection.

### Phase 2 — Email alerts
- [ ] Profile prefs UI on `/account`: digest on/off, daily/weekly, confirm email.
- [ ] Choose + configure email transport (Trigger Email extension OR Resend/SendGrid secret).
- [ ] **`digest` scheduled function** in `functions/index.js` (gated to elections-bg): read users →
      diff against `recent_activity.json` → compose bilingual digest → send → stamp `lastNotifiedAt`.
- [ ] Unsubscribe / manage-prefs token flow (signed link → `/account`).
- [ ] Deploy script (`deploy:functions` already exists; extend to include `digest`).
- [ ] Sequencing note: cron fires after the daily data deploy (the pipeline is manual/offline today —
      document the order, or trigger the digest at the end of the deploy).

### Phase 3 — Polish & reach
- [ ] **Share / export**: copyable watchlist (URL-encoded `?watch=` for anonymous portability; CSV/JSON
      export). Anonymous users get device-portability without an account.
- [ ] **"Ask AI about my watchlist"** — pass followed EIKs into the existing AI chat tools for a
      narrative summary (cross-origin to ai.electionsbg.com — design as a deep link with the list encoded).
- [ ] Suggestions engine: "Follow your municipality's biggest buyer", "Follow the top 5 contractors in
      <oblast>", driven by My-Area / governance context.
- [ ] Generalize beyond procurement: reuse the auth + `users/{uid}/watchlist` model for MPs / parties /
      municipalities (the `kind` namespace already allows it).

---

## 5. File map (new / touched)

**New**
- `src/screens/components/procurement/FollowStar.tsx`
- `src/lib/firebase.ts`, `src/lib/firebaseConfig.ts`
- `src/data/auth/AuthProvider.tsx`, `src/data/auth/useAuth.ts`
- `src/screens/AccountScreen.tsx` (+ route)
- `src/screens/components/auth/SignInDialog.tsx`, `AccountMenu.tsx`
- `scripts/procurement/recent_activity.ts`
- `data/procurement/derived/recent_activity.json` (generated)

**Touched**
- `src/data/procurement/useWatchlist.ts` (add `contract` kind; pluggable backend; per-item `lastSeen`)
- `src/screens/ProcurementWatchlistScreen.tsx` (dashboard redesign)
- `src/screens/components/procurement/FollowButton.tsx` (wrap FollowStar)
- `src/screens/components/procurement/ProcurementNav.tsx` (unread badge)
- list tiles: `TopContractorsTile`, `TopAwardersTile`, `TopMpsTile`, `TopOfficialsTile`,
  `CompanyTopContractsTile`, `AwarderTopContractsTile`, `SettlementProcurementTile`, flags/scanner/
  concentration rows, `ProcurementFlowSankey`
- `src/screens/ContractDetailScreen.tsx`, settlement + candidate/official pages (stars)
- `src/screens/ProcurementScreen.tsx` (overview digest tile)
- `firestore.rules`, `functions/index.js`, `firebase.json` (cron), `package.json`
- `src/routes.tsx` (`/account`), `src/locales/{bg,en}/translation.json`

---

## 6. Risks & decisions to confirm

1. **Privacy / GDPR** — this introduces the site's first PII (email, per-user watchlist). Needs a
   privacy-policy update, a data-deletion path (delete account → wipe `users/{uid}`), and a clear
   consent at sign-up. BG/EU → GDPR applies. **Confirm appetite before Phase 1.**
2. **Bundle cost** — Firebase auth+firestore ≈ 80–130 KB gz. Mitigated by lazy dynamic import + its own
   chunk; the anonymous experience loads none of it.
3. **Client-SDK departure** — deliberately deviates from the "Admin-only Firestore" posture. Justified
   for uid-scoped per-user data; non-user collections keep deny-all. Document the rationale in `firestore.rules`.
4. **Contract-watch ceiling** — only the bounded by-id subset has detail pages; watching arbitrary
   contracts isn't possible. Star only where a page exists; otherwise omit/disable.
5. **Email deliverability & cost** — provider choice (Trigger Email vs Resend/SendGrid), SPF/DKIM on the
   sending domain (naiasno.bg / electionsbg.com), and the cron's cost at scale. Decide at Phase 2.
6. **Cron sequencing** — the data pipeline is manual/offline today; the digest must run *after* a deploy
   carrying fresh `recent_activity.json`. Either trigger at deploy end or accept day-lag.
7. **Anonymous → account migration edge cases** — merge must be idempotent and conflict-free (union by
   `kind:id`, earliest `addedAt`).

---

## 7. Recommended sequencing

Ship **Phase 0** first and standalone — it fixes "hard to reach" and makes the watchlist *alive* with no
backend, no accounts, no privacy surface. Then gate **Phase 1 (accounts)** on a privacy-policy decision,
and **Phase 2 (email)** on a transport choice. Phase 3 is opportunistic.
