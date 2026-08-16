# Declared crypto assets — v1

**Status:** in progress · **Owner:** this change · **Date:** 2026-08-16

## The problem

The corpus HAS the crypto. The page throws it away.

`declaration_asset` holds 103 crypto rows across 12 declarants (~€1.87m declared). Every
figure reconciles with what we have already published: Недина's въстъпване €109,319 and
напускане €95,492, Пекanov's €2,655 — all four coins each, summed from `value_eur`.

What the reader gets on `/person/:slug` is four indistinguishable rows:

```
Инвестиции                                    €66 030
Инвестиции                                    €28 050
Инвестиции                                     €9 614
Инвестиции                                     €5 625
```

Three separate omissions produce that:

1. **`PersonDeclarations.tsx` renders `{category} {description}` only.** The coin name lives
   in `declaration_asset.detail`, which no asset row ever prints.
2. **`declaration_detail()` (090) does not carry `amount` / `currency`.** The unit count
   ("30 етериума") is not in the payload at all, so no client fix alone can show it.
3. **There is no crypto surface anywhere** — no block on the profile, no register page. A
   reader who wants to compare Недина with Пекanov has nowhere to land.

The two shapes crypto arrives in differ by filing year, which is why a single-category
answer does not work:

| years | category | coin lives in | count lives in |
|---|---|---|---|
| 2019–2025 | `security` (table 9) | `detail` (ticker) | `share` |
| 2026 (служебен cabinet) | `investment` (table 8) | `detail` = `currency` | `amount` |

## Identification — `is_crypto_asset()`

ONE definition, in SQL only. No TypeScript twin: everything that needs the classification
(profile payload, filing counts, register matview) is server-side, so the drift class that
`asset_share_multiplier` / `shlyo_query_fold` have to be gated for cannot arise here.

A row is crypto when it is **not a liability** and either:

* **B — the declarant said so:** `description`/`detail` matches `крипто|crypto`. Covers all
  98 `security` rows („Криптовалута", „крипто валута", „Крипто"). Note „акции · Coinbase"
  does NOT match — an equity in an exchange is not a crypto holding, and the string
  "Coinbase" contains no "crypto".
* **A — the unit of account is not money:** `currency` is present and normalises to
  something outside the fiat set, is not numeric garbage, and is not a precious metal.

### Why A is not a ticker allowlist

An allowlist misses every coin a future filing names, and misses it **silently** — the
row still renders, just not as crypto. Rule A auto-classifies a new coin.

### The three carve-outs A needs, all measured against the live corpus

* **Fiat, including Cyrillic homoglyph typos.** `ЕUR` (Cyrillic Е), `ВGN` (Cyrillic В),
  `УСД`, `шв. фр.`, `ЕВРО`, `лева`, and `ФЖХ` — the last is a BGN mistype, provable
  because its €/unit is exactly the 1.95583 peg. Without this list, six fiat rows publish
  as crypto.
* **Precious metals.** `XAU`, `злато`, `инвестиционно злато`. Matched on **exact**
  normalised equality, never substring — `PAX Gold` must stay crypto (it is a
  gold-backed token, and the declarant holds it on an exchange), and a substring rule
  on "gold"/"злато" would eat it.
* **Numeric garbage.** `currency = '9448'` is a mis-keyed cell, not a unit.

### The residue must be loud, not silent

`declared_crypto.data.test.ts` asserts every DISTINCT non-fiat `currency` in the corpus is
classified **deliberately** — each is either in an exclusion list or accepted as crypto.
So a new COIN classifies itself (the point of rule A), while a new fiat SPELLING fails the
test instead of being published as a crypto holding. This is the "no silent caps" rule
applied to a classifier.

## Tiers

### T0 — the root-cause fix (090)

* `is_crypto_asset(category, description, detail, currency)` beside
  `asset_share_multiplier` in `090_person_wealth.sql` — same file for the same reason: a
  shared classifier several migrations read.
* `declaration_detail()` asset rows gain `amount`, `currency`, `isCrypto`.
* `person_declarations()` rows gain `cryptoCount` / `cryptoEur`, so the profile knows
  whether a crypto block is worth mounting **without** fetching any filing detail.
* `PersonDeclarations.tsx` renders `detail` when it adds information — suppressed when it
  merely restates a fiat currency code (bank rows carry `detail = 'EUR'`), which is what
  makes the same edit surface vehicle makes and security issuers too — and renders the
  native quantity (`amount` + unit, or `share` for table-9 rows).

### T1 — the profile block

„Криптоактиви" inside the existing `#declarations` section, under the stat cards. Reads
the latest asset-bearing filing's detail — the SAME query the expander uses, so React
Query dedupes it — and only when `cryptoCount > 0`, so no extra request for the ~56.8k
people who hold none. Per coin: unit count, ticker, declared €. Never a live market
price: the declaration states a value AT FILING and we publish declared, not audited.

### T2 — `/declarations/crypto`

A cross-tier register, because the holders are not one population — Михайлов is an MP,
Недина and Пеканov are служебен cabinet. `/mp-cars` (matview 105, ns-scoped, MP-only) is
the wrong shape to extend; this follows `/officials/assets` in kind.

* migration `159_person_crypto.sql` — `person_crypto_table` matview, one row per declared
  crypto holding, applied + refreshed by `load_declarations_pg.ts` phase 2.
* `db_table.js` resource `crypto_holdings`.
* `CryptoRegistryScreen.tsx`, route `/declarations/crypto`, prerender entry, sitemap
  `<loc>` in BOTH route_defs lists, `og:image`, and a tile on `/governance/declarations`.

## What this does NOT do

* **No market valuation.** The register publishes the declared value only. Marking 30 ETH
  to today's price would state a number the declarant never filed, on a page whose whole
  premise is what the register says.
* **No net-worth change.** Crypto rows already count toward assets via their categories;
  nothing here re-buckets them, so no headline figure moves.
