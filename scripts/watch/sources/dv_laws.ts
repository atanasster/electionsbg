// Държавен вестник — promulgation watcher for the budget-package laws.
//
// The gap this closes: nothing in the watcher read ДВ for a *new law*. The
// only budget-law signal was `budget_law`, which does not read
// dv.parliament.bg at all — it fingerprints the Wayback CDX index of
// `minfin.bg/upload/*.pdf`, so it (a) lags by however long Wayback takes to
// re-crawl a WAF-blocked host and (b) matches only ЗДБ/ЗДБРБ/удължителен
// filenames. The ЗБДОО and ЗБНЗОК halves of the annual budget package are
// invisible to it by construction — minfin is not even their publisher — so
// ДВ бр. 68 от 28.07.2026 (ЗБДОО-2026 + ЗБНЗОК-2026) passed with no signal.
//
// Source: ДВ publishes an RSS feed of the *current* issue's official section
// at `DVWeb/rss_newspaper.jsp` — plain XML, no Cloudflare, no JSF postback.
// Each <item> carries the issuing body as <title> and the act's full name as
// <description>. The feed has no issue number, so the issue list at
// `broeveList.faces` is scraped alongside it purely to label the issue and to
// detect issues that published between two watcher runs.
//
// LIMITATION (structural, not fixable here): the RSS is a rolling window over
// ONE issue. ДВ publishes ~2×/week, so a daily cadence sees every issue — but
// an issue that publishes while the watcher is down is gone from the feed for
// good. That is what the gap tracking is for: a skipped issue number is
// recorded permanently in `meta.gaps` and reported as a change, so the
// operator knows to open that брой by hand.
//
// Because the feed only ever shows one issue, the fingerprint is CUMULATIVE:
// it hashes every budget-package law seen so far plus every uninspected issue
// number. An ordinary issue with no budget law leaves both sets untouched and
// reports `unchanged`; a promulgation appends and flips exactly once.
//
// PACKAGE COMPLETENESS: the annual budget is three laws (ЗДБРБ + ЗБДОО +
// ЗБНЗОК) that need not land in the same брой. Once any member for a year
// promulgates, the still-missing members are tracked as `pending` and reported
// every relevant run — so a partial promulgation (ДВ бр. 68 от 2026 carried the
// two fund laws but NOT the ЗДБРБ) can never be mistaken for a complete budget.
//
// The feed carries no idMat (every <link> points at the same issue object), so
// the operator still resolves the idMat on dv.parliament.bg and adds the row to
// LAW_DV_MATERIALS / INTERIM_BUDGET_LAWS / AMENDMENT_DV_MATERIALS in
// scripts/budget/fetch_sources.ts. Maps to `update-budget`.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";
import { readState } from "../state";

const SOURCE_ID = "dv_laws";
const RSS = "https://dv.parliament.bg/DVWeb/rss_newspaper.jsp";
const ISSUE_LIST = "https://dv.parliament.bg/DVWeb/broeveList.faces";

// The acts this repo's budget pipeline actually consumes. Matched against the
// act's full name; `kind` is the short label carried into the report line so
// the operator knows which catalogue in fetch_sources.ts to extend.
//
// ЗИД forms are covered by the same patterns — "Закон за изменение и
// допълнение на Закона за държавния бюджет…" still contains the phrase.
//
// ORDER IS LOAD-BEARING: first match wins, and the удължителен law's own title
// names all three laws it bridges to ("…до приемането на Закона за държавния
// бюджет на Република България за 2026 г., Закона за бюджета на държавното
// обществено осигуряване…"). Checked last it would be filed as ЗДБРБ, so the
// most specific pattern goes first.
const LAW_PATTERNS: { kind: string; re: RegExp }[] = [
  {
    kind: "удължителен",
    re: /събирането\s+на\s+приходи\s+и\s+извършването\s+на\s+разходи/i,
  },
  { kind: "ЗДБРБ", re: /за\s+държавния\s+бюджет\s+на\s+република\s+българия/i },
  {
    kind: "ЗБДОО",
    re: /бюджета\s+на\s+държавното\s+обществено\s+осигуряване/i,
  },
  {
    kind: "ЗБНЗОК",
    re: /бюджета\s+на\s+националната\s+здравноосигурителна\s+каса/i,
  },
];

// Only acts that are themselves laws. Постановления routinely reallocate money
// "по бюджета на …" and would otherwise match every pattern above.
// NB: `\b` is useless here — JS word boundaries are ASCII-only, so there is no
// boundary between "закон" and the following space. Match the space directly.
const IS_LAW = /^\s*закон(\s|$)/i;

export interface DvLawMatch {
  date: string; // ISO promulgation date (the issue's date)
  issue: number; // ДВ брой; 0 when the issue list was unreachable
  kind: string; // ЗДБРБ | ЗБДОО | ЗБНЗОК | удължителен
  title: string;
  year?: number; // fiscal year parsed from the title ("… за 2026 г.")
}

// The annual budget package is three separate laws that need not promulgate in
// the same брой — ДВ бр. 68 от 2026 carried ЗБДОО + ЗБНЗОК but NOT the ЗДБРБ.
// Positive-only tracking (report what landed) makes a partial promulgation read
// as "the budget laws landed" and the missing ЗДБРБ goes silent — which is
// exactly how a two-of-three package gets mistaken for a complete one. So once
// ANY package member for a year is promulgated, the still-missing members are
// surfaced as `pending` until they land (or forever, if the year runs on the
// удължителен bridge and the real ЗДБРБ never comes).
const PACKAGE_KINDS = ["ЗДБРБ", "ЗБДОО", "ЗБНЗОК"] as const;

// The year this watcher began observing ДВ. Package members from earlier years
// are either long done (promulgated before the watcher existed, so they will
// never appear in the rolling feed) or reachable only as a ЗИД, which amends a
// completed package rather than joining an open one. Either way they can never
// clear, so a pre-observation year must not pend — an unclearable warning is one
// operators learn to ignore, which reintroduces the very failure this tracks.
const PACKAGE_FIRST_YEAR = 2026;

const yearOf = (title: string): number | undefined => {
  const m = /за\s+(20\d\d)\s+г/i.exec(title);
  return m ? Number(m[1]) : undefined;
};

// A match's fiscal year: the title is the authoritative source, but budget laws
// promulgate in or adjacent to the year they govern, so the promulgation-date
// year is a safe fallback when an upstream title deviates from "за 20NN г." —
// better than dropping the member and under-reporting completeness.
const matchYear = (m: DvLawMatch): number | undefined =>
  m.year ?? yearOf(m.title) ?? (Number(m.date.slice(0, 4)) || undefined);

export interface PendingPackage {
  year: number;
  missing: string[]; // package kinds not yet seen for that fiscal year
}

// Stable comparison key for a pending entry — shared by the fingerprint input
// and the describe() change-detection so the two can never drift apart.
const pendingKey = (p: PendingPackage): string =>
  `${p.year}:${p.missing.join(",")}`;

// BG verb agreement for the "N law(s) missing" phrasing — one law "липсва",
// several "липсват". Used by both operator-facing surfaces (detail + describe)
// so they never disagree on the same fact.
const missingVerb = (missing: string[]): string =>
  missing.length > 1 ? "липсват" : "липсва";

// Years that have ≥1 package law promulgated but are still missing others.
// Derives the year from each match's title so it also works on state written
// before `year` was stored. The удължителен law is NOT a package member (its
// own title names all three, but classifyAct files it as "удължителен"), so it
// never counts toward completeness — a year on the bridge stays pending.
export const pendingPackages = (matches: DvLawMatch[]): PendingPackage[] => {
  const seen = new Map<number, Set<string>>();
  for (const m of matches) {
    if (!(PACKAGE_KINDS as readonly string[]).includes(m.kind)) continue;
    const y = matchYear(m);
    if (y == null || y < PACKAGE_FIRST_YEAR) continue;
    let set = seen.get(y);
    if (!set) seen.set(y, (set = new Set()));
    set.add(m.kind);
  }
  const out: PendingPackage[] = [];
  for (const [year, kinds] of seen) {
    const missing = PACKAGE_KINDS.filter((k) => !kinds.has(k));
    if (missing.length > 0) out.push({ year, missing: [...missing] });
  }
  return out.sort((a, b) => a.year - b.year);
};

interface DvLawsMeta {
  matches?: DvLawMatch[];
  gaps?: number[]; // issue numbers that published between runs, never inspected
  pending?: PendingPackage[]; // years with a partially-promulgated package
  lastIssue?: number;
  lastDate?: string;
}

const decode = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// <item> descriptions of the current issue's official section. The channel-level
// <title>/<description> are double-encoded junk in the upstream feed — parsing
// per-item avoids them entirely.
const feedItems = async (): Promise<{ acts: string[]; date: string }> => {
  const xml = await fetchText(RSS, {
    headers: { Accept: "application/rss+xml, text/xml, */*" },
  });
  if (!xml) return { acts: [], date: "" };
  const acts: string[] = [];
  let date = "";
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const desc = /<description>([\s\S]*?)<\/description>/.exec(block)?.[1];
    if (desc) acts.push(decode(desc));
    if (!date) {
      // "2026-07-28 00:00:00.0"
      const pub = /<pubDate>\s*(\d{4}-\d{2}-\d{2})/.exec(block)?.[1];
      if (pub) date = pub;
    }
  }
  return { acts, date };
};

// "Брой 68, 28.7.2026 г." → { issue: 68, date: "2026-07-28" }
const issueList = async (): Promise<{ issue: number; date: string }[]> => {
  let html: string | null = null;
  try {
    html = await fetchText(ISSUE_LIST);
  } catch {
    return []; // decoration only — never fail the whole source on this
  }
  if (!html) return [];
  const out: { issue: number; date: string }[] = [];
  const re = /Брой\s+(\d+),\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html.replace(/<[^>]*>/g, " ")))) {
    out.push({
      issue: Number(m[1]),
      date: `${m[4]}-${m[3].padStart(2, "0")}-${m[2].padStart(2, "0")}`,
    });
  }
  return out.sort((a, b) => b.issue - a.issue);
};

// Exported for unit tests — this is the whole editorial judgment of the source.
export const classifyAct = (act: string): string | null => {
  if (!IS_LAW.test(act)) return null;
  for (const { kind, re } of LAW_PATTERNS) if (re.test(act)) return kind;
  return null;
};

const key = (m: DvLawMatch): string => `${m.date}|${m.kind}|${m.title}`;

export const dvLaws: WatchSource = {
  id: SOURCE_ID,
  label: "ДВ — обнародвани бюджетни закони (ЗДБРБ / ЗБДОО / ЗБНЗОК)",
  url: RSS,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const { acts, date } = await feedItems();
    if (acts.length === 0) {
      throw new Error("ДВ RSS returned no items for the current issue");
    }

    const issues = await issueList();
    // Prefer the issue whose date matches the feed; fall back to the newest.
    const issue =
      issues.find((i) => i.date === date)?.issue ?? issues[0]?.issue ?? 0;

    const prev = (readState(SOURCE_ID)?.meta ?? {}) as DvLawsMeta;
    const prevMatches = prev.matches ?? [];
    const prevGaps = prev.gaps ?? [];
    const lastIssue = Number(prev.lastIssue ?? 0);

    // Issues that published between two runs are gone from the rolling feed.
    // Record them once, permanently, so the operator can open them by hand.
    // Skipped on the first run — there is no "since" to measure against.
    const gaps = [...prevGaps];
    if (lastIssue > 0 && issue > lastIssue + 1) {
      for (let n = lastIssue + 1; n < issue; n++) {
        if (!gaps.includes(n)) gaps.push(n);
      }
    }
    gaps.sort((a, b) => a - b);

    const merged = new Map(prevMatches.map((m) => [key(m), m] as const));
    const fresh: DvLawMatch[] = [];
    for (const act of acts) {
      const kind = classifyAct(act);
      if (!kind) continue;
      const match: DvLawMatch = {
        date,
        issue,
        kind,
        title: act,
        year: yearOf(act),
      };
      if (merged.has(key(match))) continue;
      merged.set(key(match), match);
      fresh.push(match);
    }

    const matches = [...merged.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind),
    );

    const pending = pendingPackages(matches);

    // `pending` is a pure function of `matches`, so it is deliberately NOT in
    // the hash: every real transition (a member lands, or the last missing one
    // lands) already moves `matches` and flips the value. Folding `pending` in
    // would add no discriminating power and would flip once on the first run
    // after this rule shipped, with no new law — routing update-budget at
    // nothing. The signal lives in `detail` + `meta`, where it does work.
    const value = sha256Short(
      [...matches.map(key), ...gaps.map((n) => `gap:${n}`)].join("\n"),
    );

    const issueLabel = issue > 0 ? `бр. ${issue}` : "бр. ?";
    const detailParts = [
      `${issueLabel} от ${date || "?"} · ${acts.length} акт(а) в официалния раздел`,
      `${matches.length} бюджетен(ни) закон(а) проследени`,
    ];
    if (fresh.length > 0) {
      detailParts.push(`нови: ${fresh.map((f) => f.kind).join(", ")}`);
    }
    // Persistent, so even an unchanged run shows the package is still short a
    // law — the missing ЗДБРБ never quietly disappears from the source line.
    if (pending.length > 0) {
      detailParts.push(
        pending
          .map(
            (p) =>
              `непълен пакет ${p.year}: ${missingVerb(p.missing)} ${p.missing.join(", ")}`,
          )
          .join("; "),
      );
    }
    if (gaps.length > 0) {
      detailParts.push(`неинспектирани броеве: ${gaps.join(", ")}`);
    }

    return {
      value,
      detail: detailParts.join(" · "),
      meta: {
        matches,
        gaps,
        pending,
        lastIssue: issue || lastIssue,
        lastDate: date,
      } satisfies DvLawsMeta,
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevMeta = (prev.meta ?? {}) as DvLawsMeta;
    const currMeta = (curr.meta ?? {}) as DvLawsMeta;
    const seen = new Set((prevMeta.matches ?? []).map(key));
    const fresh = (currMeta.matches ?? []).filter((m) => !seen.has(key(m)));
    const prevGaps = new Set(prevMeta.gaps ?? []);
    const newGaps = (currMeta.gaps ?? []).filter((n) => !prevGaps.has(n));

    const lines: string[] = [];
    if (fresh.length > 0) {
      const what = fresh
        .map((f) => `${f.kind} (ДВ бр. ${f.issue} от ${f.date})`)
        .join("; ");
      lines.push(
        `обнародван(и) ${what} — run /update-budget: resolve the idMat on ` +
          `dv.parliament.bg and add the row to LAW_DV_MATERIALS / ` +
          `INTERIM_BUDGET_LAWS / AMENDMENT_DV_MATERIALS in ` +
          `scripts/budget/fetch_sources.ts, then re-verify the simulator ` +
          `constants in src/lib/bgTax.ts + src/lib/bgTaxPolicy.ts`,
      );
    }
    if (newGaps.length > 0) {
      lines.push(
        `ДВ бр. ${newGaps.join(", ")} published between runs and is no longer ` +
          `in the rolling RSS window — open it manually on dv.parliament.bg`,
      );
    }

    // Package completeness. A year that gains its first member but is still
    // short others (or whose missing set changes) is called out explicitly, so
    // a two-of-three promulgation is never mistaken for a done budget.
    const prevPending = new Map(
      (prevMeta.pending ?? []).map((p) => [p.year, pendingKey(p)] as const),
    );
    const currPending = currMeta.pending ?? [];
    const currYears = new Set(currPending.map((p) => p.year));
    for (const p of currPending) {
      if (prevPending.get(p.year) === pendingKey(p)) continue;
      // Name the ACTUAL missing set in both the diagnosis and the instruction —
      // the order in which the three land is not fixed (FY2023 split the other
      // way), so a hardcoded "докато ЗДБРБ …" contradicts itself when a fund law
      // is what is missing. The catalogue differs by kind (ЗДБРБ →
      // LAW_DV_MATERIALS, ЗБДОО/ЗБНЗОК → FUND_BUDGET_LAWS), so point at
      // fetch_sources.ts generically.
      const miss = p.missing.join(", ");
      lines.push(
        `непълен бюджетен пакет за ${p.year} г.: ${missingVerb(p.missing)} ${miss} ` +
          `— НЕ третирай бюджета за зареден, докато ${miss} не се обнародва(т) ` +
          `(обикновено в следващ брой) и не се добави(ят) в съответния каталог в ` +
          `scripts/budget/fetch_sources.ts`,
      );
    }
    for (const [year] of prevPending) {
      if (!currYears.has(year)) {
        lines.push(
          `бюджетният пакет за ${year} г. вече е пълен — ЗДБРБ + ЗБДОО + ЗБНЗОК обнародвани`,
        );
      }
    }
    return lines.length > 0 ? lines.join(" · ") : curr.detail;
  },
};
