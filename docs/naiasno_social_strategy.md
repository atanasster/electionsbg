# Наясно — social posting strategy

Written 2026-08-14, after the four staffed channels went live. Companion to
`docs/naiasno_channels_setup.md` (how the channels were opened) and
`docs/plans/naiasno-rebrand-v1.md` (§10 decides which channels exist at all).

This is a strategy, not a calendar. It says what the channels are FOR, what goes where,
what the sustainable rate is, and what would make it fail — so a week of enthusiasm does
not turn into six months of silence.

---

## 0. The constraint, stated first

**Two people, who are also rebuilding the homepage and migrating a domain.** Every number
below is sized for that, not for a team with a social manager. The single most likely
failure is not "we posted the wrong thing" — it is **posting ten times in a fortnight and
then nothing for four months**, which reads as abandoned and is worse than never starting.

The good news is that the content constraint is already solved: **52 rendered cards sit
unposted** in `brand/posts/`. At the cadence below that is roughly six months of material
before a single new card is needed. **The bottleneck is packaging and posting, not
finding things to say.**

---

## 1. What the channels are for

They are not interchangeable, and treating them as one broadcast is the most common way
this goes wrong.

| Channel | Audience | What it is for | Realistic ceiling |
|---|---|---|---|
| **Facebook Page** | broadest BG reach; 67.8% national penetration | Reach. The default home of a data card. | Largest raw numbers |
| **Facebook Group** | self-selected, engaged | Conversation, "питай данните", requests. The only channel where readers talk back usefully. | Small, high value |
| **Instagram** | under-40s who will never search for this | Reach into an audience the site cannot otherwise touch | Grows slowly, compounds |
| **LinkedIn** | journalists, analysts, NGOs, municipal staff, institutions | **Citation and reuse.** The multiplier. | Smallest audience, highest value per reader |
| **YouTube** | search + depth | A second search surface, and the only place a 12-minute argument fits | Slow, durable |

### The asymmetry worth exploiting

**LinkedIn has the smallest audience and deserves disproportionate care.** One journalist
who starts citing the site — in an article, in a broadcast, in a committee submission —
is worth more than a thousand Instagram followers, because they bring an audience the
project could never reach directly and they confer credibility the project cannot claim
for itself. The Search Console baseline shows the site earns its traffic from people who
already know what they are looking for; **the multiplier audience is how that pool grows.**

Practically: LinkedIn posts get the method paragraph, the source names, and the honest
caveat. That is not padding — for that reader it is the content.

### The seasonal reality

The 16-month baseline (`data-reports/seo-baseline-2026-08/`) is unambiguous: traffic is
election-driven, peaking at 3,196 clicks in the month after the April 2026 vote and
decaying since. The temptation is to treat the inter-election period as the quiet season.

**It is the opposite. The quiet period is when the audience that shows up at the next
election gets built.** Followers acquired now are reach you already own when it matters;
followers acquired during an election are competing with everyone else's noise. Judge
this strategy on whether the next election peak is higher than the last one, not on this
month's engagement.

---

## 2. Cadence

**Sustainable beats impressive.** These are floors to hold, not targets to beat.

| Channel | Rate | Notes |
|---|---|---|
| Facebook Page | **2 / week** | The workhorse |
| Facebook Group | **1 / week** + replies | Same card as the Page sometimes, but framed as a question |
| Instagram | **2 / week** | Same cards, caption rewritten, link in bio |
| LinkedIn | **1 / week** | Never more. Low volume is correct for this audience |
| YouTube | **1 / month** at most | An explainer is days of work; do not force it |

That is 5–6 posts a week across everything, drawn from ONE or TWO findings. A single card
serves the Page, Instagram and the Group with three different framings — that is the
economy that makes this sustainable.

**If a week is going to be missed, miss it deliberately and say nothing.** Silence is
cheap; an apology post is not.

---

## 3. What goes where

The same finding is not the same post. Concretely, using
`2026-08-06-malko-tarnovo-eu-projects`:

| Channel | Framing | Link mechanics |
|---|---|---|
| **FB Page** | The number and the surprise. Short. | Link in the **first comment**, per the existing draft convention |
| **FB Group** | The same card, ending in a question — "познавате ли друга община с този профил?" | Link in the post |
| **Instagram** | Hook in the first 125 chars, no link possible — caption names the destination in words | **Bio only.** No URL is clickable anywhere else |
| **LinkedIn** | The method paragraph and the source names. The caveat is the content. | **Clickable in the body** |
| **YouTube** | Only if it is part of a bigger argument | Description |

### Rules that follow from the platforms, not from taste

- **Instagram makes no URL clickable outside the bio** — not in captions, not in
  comments. Every caption must name its destination in words.
- **LinkedIn links are clickable.** Use them. No first-comment workaround needed.
- **Hooks are hard-limited by the fold**: ~125 chars on Instagram, ~140 on LinkedIn
  desktop. The finding must land before "see more".
- **Hashtags**: 3–5 on Instagram where they still do discovery work; 2 on LinkedIn;
  none on Facebook.
- **A Page with no followers reaches nobody.** On LinkedIn especially, resharing one post
  from a personal profile IS the distribution. Do it for anything that matters.

---

## 4. The pipeline

Two sources of material, and they run at different speeds.

### 4.1 The bank — 52 cards, ~6 months

`brand/posts/` holds 52 rendered cards never posted anywhere. Topic mix:

```
избори 21 · пари 9 · парламент/гласувания 7 · потребление 5 · бюджет 5
procurement 4 · общини 4 · декларации 4 · макро 3 · ЕС 3 · демография 3
```

**Rotate topics deliberately; do not post the bank in date order.** It is 40% elections,
and three election cards in a row teaches the audience that Наясно is an elections site —
the exact belief the rebrand exists to change. Alternate: money → place → parliament →
prices → elections.

The worklist is a command, not a spreadsheet:

```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts status fb-page
```

### 4.2 New findings — the watcher

108 sources are checked daily; `process-watch-report` turns changes into ingests. A
refreshed dataset is a posting prompt, and `naiasno-post` already enforces the standard:
grounded in our own data, independently confirmed against a public source, dup-checked
against the registry, non-partisan, no emojis.

Four skills produce material, and they are not interchangeable:

| Skill | Use for |
|---|---|
| `naiasno-post` | Any number-led finding — the default |
| `settlement-post` | A single village or town profile. Reliably the best-performing shape |
| `person-compare-post` | Two named people's declarations, side by side. Highest care required |
| `naiasno-video` | A finding that needs 10 minutes, or a 9:16 cutdown |

**Never loosen the grounding gate to hit a cadence.** The whole proposition is „без
мнения, само данни"; one unsourced claim costs more than a month of silence. If there is
nothing verified to say this week, post from the bank.

### 4.3 Always stamp

```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts posted <slug[,slug...]> <channels>
```

Unstamped posts make `status` lie, and the dup-check degrades with it.

---

## 5. What not to post

- **Anything ungrounded.** No estimate, no "roughly", no figure without a source.
- **Anything partisan.** The data may embarrass a party; the framing never targets one.
  A finding about GERB and ДПС voting alike is a fact about a voting record. Any sentence
  that would not survive the subject being a different party does not ship.
- **Engagement bait.** No "коментирайте с ✋", no polls for their own sake.
- **A person's declared wealth without the comparability gate.** `person-compare-post`
  exists because comparing two people's declarations across different years or forms is
  a false claim about named individuals.
- **Reposting the same card to the same channel.** That is what `postedTo` is for.
- **An apology for not posting.** Just resume.

---

## 6. Where video fits

One explainer is rendered and ready (`brand/videos/2026-08-09-election-risk-explainer/`).
Video is the highest-effort, highest-durability format: a 12-minute explainer is days of
work and then earns for years through search.

**Cadence: one a month at most, and only when the subject genuinely needs the length.**
A finding that fits on a card should stay on a card.

The 9:16 SHORT cut is the exception worth batching: one render feeds Instagram Reels,
Facebook Reels and YouTube Shorts. **If 4–6 shorts ever exist as a batch, that is also
the trigger to open TikTok** (§6 of the channels runbook).

---

## 7. Measuring it

**Monthly, never weekly.** The baseline settles this: at 16,577 clicks over 16 months,
weekly noise is larger than any signal a posting change produces. Judging a week is
self-deception in both directions.

Four numbers, once a month:

1. **Search clicks** vs `data-reports/seo-baseline-2026-08/daily.csv`. Are the deep
   families — procurement, budget, funds — moving off zero? That is the discovery gap
   closing, and it is the point.
2. **Follower growth per channel.** Direction matters, absolute numbers do not yet.
3. **Referral traffic from social.** Small is expected; zero means the link mechanics are
   broken, which is a bug rather than a content problem.
4. **Citations.** Did a journalist, NGO or institution reference the site? Unmeasurable
   automatically and the most important of the four. Write them down when they happen.

**What not to measure:** per-post engagement rate. It will be volatile at this scale and
optimising for it produces exactly the content this project should not make.

---

## 8. Failure modes to watch for

| Signal | What it means | Fix |
|---|---|---|
| Three weeks with no posts | Cadence was set too high | Drop to 1/week everywhere and hold it |
| The bank draining fast | Posting is outrunning production | Slow down; the bank is a buffer, not a backlog to clear |
| All recent posts are elections | The rotation lapsed | Force the topic alternation in §4.1 |
| A post needed a correction | The grounding gate was skipped | Correct publicly, then find out which step was skipped |
| Instagram captions pointing at an empty bio | Bio links lost in an edit | Check after every profile change |
| `status` disagreeing with reality | Stamping lapsed | Backfill with `posted --at` |

---

## 9. The first month, concretely

1. **Claim the four remaining handles** (TikTok, X, Pinterest, Telegram). Reservations
   only — §6 of the channels runbook.
2. **Hold 2/week on the Page and Instagram, 1/week on LinkedIn**, entirely from the bank.
   No new production while the homepage hub is being built.
3. **Publish the explainer to YouTube** and cross-post it once to each channel.
4. **Reshare one LinkedIn post from a personal profile each week.** That is the only
   distribution the Page has at zero followers.
5. **At the end of the month, look at the four numbers in §7** — and nothing else.
