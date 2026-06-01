# Наясно — Facebook-first launch plan

Status: **2026-06-01.** Brand chosen (**Наясно** = на + ясно, "into clarity").
Domain `naiasno.bg` + `naiasno.com` confirmed available (WHOIS) but
**registration deliberately deferred.** Until it lands, all share links point
to the current live site (`electionsbg.com`); we swap to `naiasno.bg` after the
domain + route migration.

Accent palette: **charcoal/ink + amber highlighter** — deliberately not party
colours (no GERB cyan-blue, no BSP red).

---

## 1. Why Facebook-first works without the domain

- The FB brand launches independently. Posts are native image cards; links go
  to existing `electionsbg.com` deep pages now, re-pointed later.
- Locking the name + handles now prevents squatting while the domain is on hold.
- Nothing about the artwork, the Page, the Group, the rules, or the first 90
  days of content depends on the new domain being live.

## 2. Build order (priority)

1. **Artwork** (generated via Gemini + canvas) — `scripts/brand/generate_brand_art.ts`
   → `brand/`: profile mark, Page cover, Group cover, share-card sample.
2. **Page** "Наясно" — broadcast/brand/ads surface.
3. **Group** "Наясно — данните за България" — community + "Питай данните".
4. **Seed content** — pre-load ~15 cards before opening to the public.
5. **Site funnel hooks** (later, small code): share buttons, "join" CTA, footer links.

## 3. Page vs Group

- **Page = Наясно** — official identity, ad-eligible, the amplifier (broadcast).
- **Group = Наясно — данните за България** — where people participate; home of
  "Питай данните". Link the Group from the Page.

## 4. Page copy

- **Name:** `Наясно`
- **Username:** `@naiasno` (fallback `@naiasno.bg`)
- **Category:** Информационен сайт / News & media website (alt: Организация с нестопанска цел)
- **Intro (short):** „Изборите, парите и властта в България — с данни, не с мнения."
- **About (long):**
  „Наясно е независима платформа, която показва къде отиват гласовете, парите и
  властта в България — обществени поръчки, бюджет, евросредства, декларации на
  политиците, парламентарни гласувания и изборни данни до секция. Всичко е
  обвързано с източник. Без мнения, без партийна страна — само проверими данни,
  така че всеки гражданин да е наясно."
- **CTA button:** „Научи повече" → site (later → naiasno.bg); pin the Group link.
- **EN bio:** "Independent data on where Bulgaria's votes, money and power go.
  No spin, no party line — just sourced, verifiable data."

## 5. Group copy

- **Name:** `Наясно — данните за България`
- **Privacy:** **Public** (discoverable + shareable; better for growth/SEO) with
  **membership questions + admin post-approval** on at launch for quality.
- **Description:**
  „Група за хора, които искат да са наясно какво прави властта — с данни, не със
  слухове. Тук споделяме и обсъждаме обществени поръчки, бюджет, евросредства,
  декларации, гласувания в НС и изборни резултати. Едно правило над всички:
  твърдиш — покажи източник."
- **3 membership questions:**
  1. Защо искаш да се присъединиш към „Наясно"?
  2. Съгласен/на ли си с правилото „твърдиш — покажи източник"? (да/не)
  3. Коя тема те вълнува най-много: пари и поръчки · избори · парламент · моята община?
- **Rules:**
  1. **Данни, не мнения.** Твърдиш нещо — сложи източник или линк.
  2. **Без партийна агитация и обиди.** Атакувай аргумента, не човека.
  3. **По темата.** Власт, пари, избори, данни за България.
  4. **Без фалшиви новини / манипулирани графики.** Изтриваме.
  5. **Местните теми са добре дошли** — питай за твоята община.
  6. Модераторите имат последна дума; спам = бан.
- **Pinned welcome post:**
  „Добре дошъл/дошла в Наясно. Тук превръщаме официалните данни в разбираеми
  графики — и ги обсъждаме без партийни лозунги. Правилото е едно: *твърдиш —
  покажи източник.* Започни оттук → представи се с един коментар: коя община/тема
  те интересува, и какво искаш да проверим в данните? Рубриката **Питай данните**
  е твоя — пишеш въпрос, ние вадим графиката."

## 6. Content pillars + first seed posts

Each post = native image card (charcoal+amber) + short text + link in first
comment to the live site. Pillars map to existing data domains.

| Pillar | Hook | Links to (current live path) |
|---|---|---|
| Следите на парите | „2,4 млрд. лв. поръчки без конкуренция" | /procurement, /funds |
| Числото на седмицата | one striking stat | varies |
| Твоят град | per-municipality deep dive | /municipality/:id, /my-area |
| Парламентът тази седмица | roll-call / attendance | /votes, /parliament |
| Проверка на изборите | risk score / Benford | /risk-score, /benford |
| Декларациите | MP cars/assets/connections | /mp-cars, /mp-assets, /connections |
| Обяснено | repackage an article | /articles/:slug |
| Питай данните | member question → chart | varies |

Seed list (10 to pre-load): top procurement contractor; an MP's declared cars;
turnout anomaly map; "where your tax lev goes" (budget); biggest EU-funds
beneficiary; a party's donor list; parliament attendance ranking; a problem-
sections example; a governments-since-2005 timeline card; one article carousel.

## 7. Artwork — specs & regeneration

Generator: `scripts/brand/generate_brand_art.ts` (Gemini bg + canvas text;
crisp Cyrillic guaranteed because text is canvas, not AI).

| Asset | File | Size |
|---|---|---|
| Page/IG profile | profile_1080.png | 1080×1080 (shown circular) |
| Page cover | page_cover_1640x624.png | 1640×624 (mobile-safe center) |
| Group cover | group_cover_1640x856.png | 1640×856 |
| Share card sample | share_card_sample_1080.png | 1080×1080 |

Regenerate / iterate:
```
node_modules/.bin/tsx scripts/brand/generate_brand_art.ts                       # flash 3.1 (default)
BRAND_IMAGE_MODEL=gemini-3-pro-image node_modules/.bin/tsx scripts/brand/generate_brand_art.ts   # pro 3.0
```
Raw Gemini backgrounds saved as `brand/_raw_*.png` for inspection.

## 8. Handles to reserve now

`@naiasno` (or `@naiasno.bg`) on Facebook (Page + Group), Instagram, YouTube,
Telegram, TikTok, X — even if dormant. Consistency + anti-squatting.

## 9. Launch checklist

- [ ] Approve artwork (this step)
- [ ] Reserve handles
- [ ] Create Page; set name, @username, category, intro, about, profile, cover, CTA
- [ ] Create Group; privacy, description, questions, rules, cover; link to Page
- [ ] Pre-load ~15 seed posts (drafts)
- [ ] Pinned welcome post + "Питай данните" prompt
- [ ] Soft launch to personal network; recruit 2–3 volunteer moderators
- [ ] Begin 3–4×/week cadence; contribute data into local/town groups
- [ ] (later) site funnel hooks: share buttons, join CTA, footer FB links

## 10. When the domain lands (deferred)

Register `naiasno.bg` (+ `.com`, optional `.eu`) via a Bulgarian registrar (NOT
GoDaddy — it can't sell `.bg`). Then: 301 every `electionsbg.com` path →
`naiasno.bg`; update canonical/hreflang/sitemaps; Search Console Change of
Address; swap footer/CTA + share-card watermark from `electionsbg.com` to
`naiasno.bg`; build the portal homepage (Избори / Пари / Власт / Общество hubs).
