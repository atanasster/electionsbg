---
keywords:
  - EU funds
  - ИСУН
  - Recovery and Resilience Plan
  - RESTORE battery storage
  - investigative journalism
  - fact-check
  - public beneficiary register
  - beneficial ownership
  - Bulgarian politics
  - Recovery Plan grants
---
# Fact-checking the newsroom: ten EU-funds investigations against the public register

Investigative journalism does the hard part. Reporters at Bivol, Mediapool, Capital, Actualno and others spend months sourcing a story, naming a company, and tying it to a public figure. A data project like this one cannot replace that work — but it can do something narrower and useful: independently check whether the public register agrees with the headline.

This article is that check, run as an experiment. We took **ten published investigations** into Bulgarian EU-fund recipients, pulled the exact company each one named, and looked it up in the EU-funds register that powers our [funds page](/funds). The question was simple: does our copy of the public data corroborate the reporting? It does. All ten companies are in the register with the money the press described, and **four of them match the reported figure to the lev**.

---

## What the system holds

electionsbg.com is built from open Bulgarian datasets, pre-processed into static files and served as a single-page app. Alongside election results it now carries several public-money and public-record features:

- **EU funds (ИСУН).** Every organisation that has signed an EU-funds contract recorded in ИСУН 2020 — **52,780 beneficiaries, 80,706 contracts, €43.5 billion contracted**, spanning the 2014-2020 and 2021-2027 operational programmes and the Recovery and Resilience Plan. The [funds page](/funds) is the overview; it also flags 98 companies (€168.5M contracted) tied to 86 MPs through their asset declarations.
- **Per-company pages.** Each company has a page at `/company/{EIK}` that unifies what the procurement register and the EU-funds register hold for that single firm.
- **Public procurement (АОП)** — the separate state-contracts register; see the [procurement article](/articles/2026-05-13-procurement).
- **MP business connections** — a graph of declared and registered ownership ties between MPs, officials and companies; see the [connections article](/articles/2026-05-04-mp-connections).

![The EU funds overview page — corpus totals and the MP-connected list](/articles/images/funds/01-funds-overview.png)

For this experiment only the EU-funds register matters. One term to fix up front: the register's **contracted funds** (*договорени средства*) is the total contracted project value — the EU grant **plus the beneficiary's own co-financing** — not the grant alone. That distinction is what makes the exact matches below work out.

## The experiment

Every one of the ten reports has the same shape: an outlet names a company, ties it to a public figure, and cites an amount. The check is mechanical — find the company in the register by its **EIK** (the 9-digit Bulgarian company id), read off the contracted figure, and compare it to what was reported.

The richest vein is the **RESTORE** measure — grid-scale battery storage funded by the Recovery Plan, roughly **1.149 billion BGN** across some 82+ approved projects in two rounds (2024-2025, and a second round in December 2025). It drew sustained press attention because so many approved beneficiaries trace back to politicians, ex-ministers and well-known businessmen. All ten cases below are RESTORE beneficiaries — and every company name in the table links to its live page on this site.

## The ten cases

| # | Company | Connected to | Contracted, in the register | Verdict |
|---|---|---|---|---|
| 1 | [ВМ Петролеум ООД](/company/203635576) | mother of ex-MP Veselin Mareshki | 69.4M BGN | exact match |
| 2 | [Верила Солар Парк 2 ООД](/company/206934480) | son of DPS figure Dzhevdet Chakarov | 128.5M BGN | exact match |
| 3 | [Токи Сторидж ЕАД](/company/207274721) | publisher Ivo Prokopiev | 80.2M BGN (7 contracts) | consistent |
| 4 | [МЛД Батери Парк ООД](/company/208031284) | son of ex-interior-minister Mladen Marinov | 40.8M BGN | exact match |
| 5 | [Адванс Грийн Енерджи АД](/company/207958783) | the Domuschiev group | 146.7M BGN | exact match |
| 6 | [СО Сторидж ЕООД](/company/208411297) | ex-finance-minister Milen Velchev and his brother | 105.5M BGN | consistent |
| 7 | [Болкан Пауър Систем ЕООД](/company/208397285) | Dragomir Tanev | 84.2M BGN | consistent |
| 8 | [Адванс Диджитал Пауър АД](/company/208348135) | the Domuschiev brothers | 53.9M BGN (5 contracts) | consistent |
| 9 | [Крита Енерджи 50 АД](/company/207930595) | Haskovo partners of GERB MP Delyan Dobrev | 135.9M BGN | consistent |
| 10 | Filipov storage cluster — 4 companies | auditor Velin Filipov | 41.2M BGN combined | consistent |

Case 10 is a cluster of near-identical companies, each filed for its own grant: [Криводол Енерджи Парк](/company/208376227), [Криводол Сторидж Парк](/company/208376273), [Полски Тръмбеш Сторидж Сълюшън](/company/208336574) and [Полски Тръмбеш Балансинг Систем](/company/208336492) — four of the seven the press described, each in the register at ≈10.3M BGN.

![A company page — the EU funds (ИСУН) card confirms the contracted amount straight from the register](/articles/images/funds/02-company-page.png)

## What matched

Two strengths of confirmation:

**Exact matches (cases 1, 2, 4, 5).** For these, the press published the grant and the co-financing as precise figures. Their sum equals the register's contracted total *to the lev*:

- **ВМ Петролеум** — reported 25,389,855.36 grant + 44,019,262.64 co-financing = **69,409,118 BGN**. Register: 69,409,118 BGN.
- **Верила Солар Парк 2** — reported 41,120,045.44 + 87,380,096.56 = **128,500,142 BGN**. Register: 128,500,142 BGN.
- **МЛД Батери Парк** — reported 15,496,301.20 + 25,283,438.80 = **40,779,740 BGN**. Register: 40,779,740 BGN.
- **Адванс Грийн Енерджи** — reported 57,795,160.02 + 88,893,063.37 = **146,688,223 BGN**. Register: 146,688,223 BGN. This is also the only case in the set where money has actually been *paid out* — ≈57.8M BGN so far, roughly the grant.

**Consistent (cases 3, 6, 7, 8, 9, 10).** Here the press gave a grant figure or a description rather than a precise total; the register confirms the company and a contracted amount in line with the reporting.

Across the ten cases the register accounts for **886.3 million BGN (≈€453M)** of contracted Recovery-Plan money. The full machine-readable cross-reference — every EIK, every figure, every source — is stored in the project's `data/funds/confirmed.json`.

## Check it yourself

Nothing here asks you to take our word for it. Open the [funds page](/funds) for the corpus totals and the MP-connected list, then click any company in the table above to land on its `/company/{EIK}` page, where the **EU funds (ИСУН)** card shows the contracted and paid figures straight from the register. The numbers in this article are exactly what those pages render.

## Caveats

- **"Confirmed" is not an accusation.** Every grant here was awarded through a public, competitive Recovery-Plan procedure. The experiment confirms that a *company the press named* received the *funds the press described* — nothing more. Whether a given award deserves scrutiny is the journalists' argument, not the register's.
- **Exact vs consistent.** Four cases match to the lev; six are corroborated but the press did not publish a precise total to check against.
- **Contracted is not paid.** Nine of the ten show zero disbursed so far — these are signed contracts, not money out the door. Only Адванс Грийн Енерджи has been paid.
- **The connection itself comes from the reporting.** That a company traces to a particular politician or relative is the outlets' sourcing; the register confirms the *funds*, not the family tree.
- **The register is a snapshot.** ИСУН 2020 is refreshed periodically; figures reflect the most recent ingest.

## The investigations

The reports this experiment checked:

- Mediapool — [Mareshki's mother and Chakarov's son among the 112 approved for battery subsidies](https://www.mediapool.bg/maikata-na-mareshki-i-sinat-na-dzhevdet-chakarov-sred-odobrenite-112-za-baterii-za-tok-s-evrosubsidii-news370517.html)
- Mediapool — [Ex-ministers with a Haskovo streak in the battery business](https://www.mediapool.bg/bivshi-ministri-s-haskovska-zhilka-v-udaren-biznes-s-baterii-za-tok-news377895.html)
- Actualno — [The EU millions for power batteries: familiar interesting names take them](https://www.actualno.com/company/milionite-ot-es-za-bateriite-na-tok-poznati-interesni-imena-gi-vzemat-news_2436764.html)
- Actualno — [Advance Green Energy unveils the EU's largest local storage facility](https://www.actualno.com/economy/advans-grijn-enerdji-ad-predstavja-naj-goljamoto-lokalno-syoryjenie-za-syhranenie-na-elektroenergija-v-es-news_2495911.html)
- Capital — [Another 4,000 MWh of batteries for 1.1 billion BGN under RESTORE 2 — who wins](https://www.capital.bg/biznes/energetika/2025/12/22/4866013_novi_4000_mvtch_baterii_za_11_mlrd_lv_po_restore_2_koi/)
- 24chasa — [The new RESTORE 2 beneficiaries](https://www.24chasa.bg/biznes/article/22047579)
- BIRD.bg — [A GERB ex-minister's son among the new battery millionaires](https://bird.bg/gerb-marinov-millionaires/)
- Aferahs — [Delyan Dobrev's Haskovo partners take 58.45 million for power batteries](https://aferahs.com/българия/хасковските-партньори-на-делян-добре/)
- Blitz — [Ivo Prokopiev and Chakarov junior pocketed EU millions](https://blitz.bg/obshtestvo/skandal-ivo-prokopiev-i-chakrov-mladshi-pribrali-milioni-ot-es_news1080166.html)
- Ministry of Energy — [the official RESTORE ranking list](https://www.me.government.bg/news/82-proekta-na-obshta-stoinost-pochti-1-150-mlrd-lv-shte-badat-finansirani-po-restore-3640.html)

If you spot a company we missed, a figure that looks off, or a connection worth chasing, get in touch — the funds dataset and the pipeline that builds it are open source.
