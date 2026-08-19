---
keywords:
  - public procurement red flags
  - procurement risk methodology
  - Bulgaria procurement corruption risk index
  - open contracting red flags
  - single bidder procurement
  - contract amendment 50 percent cap
  - contract splitting threshold
  - Open Contracting Partnership red flags
  - iMonitor OpenTender indicators
schemaType: NewsArticle
updatedAt: 2026-08-18
---

# We are opening up the procurement risk flags

Every rule by which we mark a public contract as risky is now published: [the threshold, the legal basis, when the check applies at all, and what the number does not say](/en/procurement/methodology). The catalogue is [machine-readable](https://github.com/atanasster/electionsbg/blob/main/public/risk-flags.json) and MIT-licensed — take it, check it, reuse it, no need to ask.

The reason is not transparency for its own sake. **When a contract page says "connected to an MP" or "the value grew to the legal cap", that is a claim about a named company.** Until now those definitions lived only in code. Anyone who wanted to dispute such a claim had to take our word for it — which is the opposite of what we are trying to do with public data.

## What we are publishing

Seventeen checks: thirteen on a signed contract and four on the procedure itself, which can fire while bids are still open. Each one now states its threshold, where that threshold comes from, what data it needs before it can be evaluated at all, and how often it fires in the Bulgarian corpus.

A few of those numbers are worth saying out loud, because on their own they answer the question "how bad is it":

- **62.6% of contracts fire no check at all.** Another 30.5% fire exactly one.
- About nine of the checks can actually be evaluated on a typical contract. Contracts where five or more fire number **81 out of 409,392** — 0.02%.
- Splitting purchases below the direct-award ceilings — the flag that sounds most scandalous — fires on **0.09%** of contracts.

So: the tool does not find corruption everywhere. If it did, that would be grounds to doubt the tool rather than the contracts.

## Three things we decided to write down rather than leave out

**One check currently does nothing.** "Submission window too short" is implemented, but the procedure-window fields are unpopulated in the data — across a sample of 20,000 contracts, zero carry those dates. The check neither fires nor counts as passed; it simply drops out. It could have stayed in a list of thirteen and nobody would have known. It says so instead.

**One check points in an unsettled direction.** We score a decision period that is too *short*. The source we build on justifies the risk through the opposite mechanism — that a long decision period leaves room for repeated appeals until the contract reaches a chosen company. The international catalogue we compared against publishes indicators for both directions. Ours has one. That contradiction is unresolved, and it is recorded next to the check itself.

**The two A–F grades use different weights, and we are not certain they should.** The buyer grade was rebalanced in July 2026: the weight on direct award went up and the weight on single bidding went down, because against the European comparison Bulgaria is a dramatic outlier on the first and thoroughly average on the second. The supplier grade kept the old weights. Whether that is deliberate — a supplier does not choose the procedure type — or simply an unfinished change, has not been decided. We publish both sets and say the question is open.

## A flag is not a verdict

The framing is the Open Contracting Partnership's and we adopt it literally: a fired flag may mean a) behaviour that is entirely lawful and unremarkable; b) lawful but poor value for public money; or c) illicit. In that order — the two innocent explanations first.

There is a more uncomfortable caveat, also on the page. A study covering almost the entire population of Italian roadwork contracts found that the most scrutinised red flags are either uncorrelated with corruption or correlated with it **in the opposite direction**. That is the strongest argument against reading any single flag as evidence — and the reason the grades we show for an organisation carry more weight than the letter beside a single contract.

It is also why the denominator works the way it does: the index counts the checks that could actually be evaluated, not all seventeen. A contract with no recorded bid count is not scored zero on competition — the check simply drops out of its denominator. A contract with sparse data does not get to look cleaner than it is.

## How it lines up with the international catalogues

We mapped every check to its closest indicator in OCP's *Red Flags for Integrity* (2024) and in the iMonitor 2.0 methodology. Not from memory — we read the documents. Doing so showed that two of the mappings we had assumed were wrong: the contract-splitting flag pointed at an indicator for a *single* award below the threshold, and the over-estimate flag at one that compares against the category average rather than against the procedure's own estimate.

Four of the seventeen checks have no equivalent anywhere. Two of them are the political-connection ones — an MP or an official recorded as a manager or owner of the winning company. That is the most Bulgaria-specific part of the set, and simultaneously the heaviest claim we make. Which is why it rests on a verified identity for a specific person rather than on a name match.

There is also a difference that cuts against us, and we publish it anyway: we suppress the single-bidder flag in sectors where one bid is the market norm, and on textbooks, where the law provides for a single source. The international catalogues do not. That means **our single-bid rate is not directly comparable to theirs** until the suppression is undone.

## What comes next

The catalogue is versioned. The page shows not the version in the code but the version the flags you are looking at were actually computed under — the two diverge in the window between a site update and a data rebuild, and that is precisely the moment when a citation would be wrong.

If you use any of this, cite the version rather than the date. And if you find an error in a definition, a threshold or a mapping, there is now something concrete to point at.

- [The flag methodology](/en/procurement/methodology) — thresholds, legal bases and limits.
- [risk-flags.json](https://github.com/atanasster/electionsbg/blob/main/public/risk-flags.json) — the machine-readable catalogue.
- [Public procurement](/en/procurement) — the data itself.
