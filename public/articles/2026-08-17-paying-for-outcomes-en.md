---
keywords:
  - outcomes-based contracting
  - paying for results
  - social services procurement
  - award criterion
  - lowest price
  - best quality price ratio
  - delegated state activities
  - Bulgaria public procurement
  - ЗОП article 70
schemaType: NewsArticle
updatedAt: 2026-08-17
---

# Why Bulgaria does not pay for outcomes

In parts of the world the state has spent years buying not activity but **results**: the contract pays when the unemployed person finds work and keeps it, when the child stays in school, when the released prisoner does not return. It is called outcomes-based contracting — payment tied to measured change in people's lives rather than to services delivered.[^golab]

We checked whether anything like it exists in Bulgaria. It does not — and the interesting part is **why**. Not because nobody thought of it, but because the money in question travels a route with nowhere to record a result.

## 1. The register has no field for a result

The corpus we maintain holds **405,812 contracts worth €93.7bn** and 237,601 procedures.[^method] Neither register — not the contracts, not the notices — carries a performance indicator, a payment trigger, a penalty clause or a delivery date. The register records the **award**, not the execution. Amendments record movement in value, not results achieved.

That is not a gap in our processing. It is the shape of the data itself: once signed, a contract disappears from public accounting until the day it is amended.

One field is often mistaken for the signal being sought — the **award criterion** under ЗОП art. 70. But it describes how **bids are scored at the moment of award**, before any delivery at all. "Best quality/price ratio" is a rule for evaluating an offer, not a contract that pays for a result. The two must not be conflated.

## 2. The sector where results matter most barely goes through procurement

| Domain (CPV)                     | Contracts | Value |
| -------------------------------- | --------: | ----: |
| Social work services (853x)      |       241 |  €70m |
| Health and social work (85, all) |     1,542 | €144m |
| Education (80)                   |     1,335 |  €98m |

The two domains together are **0.7% of the contracts** in the corpus. For comparison: general-government spending on social protection was **€15.1bn in 2024 alone**.[^cofog]

The difference is not between "a lot" and "a little" money — it is between two different financial channels. Social services in Bulgaria are funded as **delegated state activities** (делегирани от държавата дейности): transfers to municipalities and licensed providers against a per-unit standard. Nobody "awards a contract" for the service; it is funded by formula. So most of the money outcomes-based contracting would target never becomes a procurement contract at all. What does go through procurement — the 241 contracts above — is a small fringe around a channel two orders of magnitude larger.

**No amount of further ingestion fixes this.** It is a property of the funding model, not of publication.

## 3. Where it is procured, it is bought on price

Here the data said something we did not expect. Ranking the **services** by the share of procedures scored on "best quality/price ratio" (2020 onwards, competitive procedures only):

| Domain (CPV)                       | Procedures | Quality/price share |
| ---------------------------------- | ---------: | ------------------: |
| **Health and social work (85)**    |    **925** |            **9.5%** |
| Agriculture and landscaping (77)   |        964 |               16.6% |
| Repair and maintenance (50)        |      6,340 |               16.7% |
| Supporting transport services (63) |        365 |               17.3% |
| Other services (98)                |        672 |               21.1% |
| IT services (72)                   |      2,554 |               24.1% |
| Transport (60)                     |      2,093 |               24.8% |
| Environment (90)                   |      3,032 |               24.9% |

**Among services, health and social work comes last** — and not narrowly: the next domain sits at 16.6%, seven points higher. More than 90% of those procedures are awarded on lowest price alone, in the domain whose subject is the care of people.

The same shows in ЗОП's lighter regime for "social and other specific services": **148 procedures on lowest price against 61 on quality/price.**

One qualification that should not be skipped: among **supplies** there are domains lower still — fuels (5.0%), medical devices and pharmaceuticals (7.7%), printed matter (9.2%). For a standardised good that is normal and arguably correct: when the specification fixes everything, price is all that is left to compare. What is notable is that medical supplies land there too — so on both channels through which the health system buys, a quality criterion is the exception.

For contrast, construction (CPV 45) runs at **52.2%** across 27,151 procedures. Quality-weighted evaluation is concentrated where the object is easiest to measure and an acceptance protocol does the job — and rarest in services to people, where measurement is hard and the criterion would therefore matter most.

## What we are not claiming

We are not claiming that "best quality/price ratio" is payment for outcomes — it is not. We are not claiming that the low quality-weighted share in CPV 85 is in itself a violation: lowest price is a lawful criterion and sometimes the right one. And we are not claiming that outcomes-based contracting works — the evidence for it is contested and in places thin, by the admission of the researchers who advocate it.[^golab]

We claim only what the data shows: **Bulgaria has neither the instrument nor the field in which it would be recorded** — and in the sector where it would make most sense, buying is done mainly on price.

The award-criterion split by year and contract type is on the [procurement dashboard](/procurement/overview).

[^golab]: Government Outcomes Lab, Blavatnik School of Government, University of Oxford — "Outcomes-based contracting". It also lists the main risks: cherry-picking the easier cases, the attribution problem, high transaction costs, and limited evidence of advantage over the alternatives.

[^method]: Our own corpus: contracts from АОП/ЦАИС ЕОП and procedures from ЦАИС ЕОП, as at 17 Aug 2026. Contract values are post-amendment. Procedure counts by criterion are from 2020 onwards — the award-criterion field only exists in the ЦАИС ЕОП era; before that it is empty and is not shown as a trend. Procedures with no call for bids (direct negotiation, negotiation without prior notice) are excluded: they involve no competitive evaluation and therefore carry no criterion.

[^cofog]: Eurostat, gov_10a_exp, function "Social protection" (GF10), sector S13 general government, 2024. The scope includes municipalities and the social security funds, so it is **not** a decomposition of the state budget and is not directly comparable with procurement contracts. The comparison is one of orders of magnitude, not of matching bases.
