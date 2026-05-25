// Playwright-based discovery aid for ministries whose programme-budget
// execution report URLs aren't surfaceable via curl/CDX. Many BG ministry
// sites render their budget section client-side (React, jQuery tabs, etc.)
// so static HTML scraping returns the page shell without the actual PDF
// links. This script opens each target in a real Chromium, waits for the
// JS to populate, and prints/saves candidate PDF/DOCX/XLSX URLs.
//
// THIS IS A ONE-OFF DEVELOPER TOOL — not wired into the daily watcher or
// CI. Per project memory: "One-off backfills stay manual." Output is a
// candidate list; the operator picks the right file, saves it to
// raw_data/budget/exec-<adminId>-<fy>.pdf, and adds a manual-pdf entry to
// EXECUTION_REPORTS.
//
// Usage:
//   npx tsx scripts/budget/discover_execution_reports.ts              # headed, all targets
//   npx tsx scripts/budget/discover_execution_reports.ts --ministry mon    # headed, single
//   npx tsx scripts/budget/discover_execution_reports.ts --headless        # batch sweep
//
// Headed mode pauses after each ministry so the operator can inspect the
// browser. Headless mode writes data-reports/budget-discovery-<DATE>.md
// and exits.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, option, optional, boolean, string } from "cmd-ts";
import { chromium, type Page } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const REPORT_DIR = path.join(REPO_ROOT, "data-reports");

interface Target {
  key: string;
  adminId: string;
  label: string;
  startUrl: string;
  // Optional second URL to also visit (e.g., a sub-page reached via menu).
  alsoVisit?: string[];
}

const TARGETS: Target[] = [
  {
    key: "mon",
    adminId: "admin-ministerstvoto-na-obrazovanieto-i-naukata",
    label: "МОН — Ministry of Education",
    startUrl: "https://www.mon.bg/mon/byudzheti-i-finansovi-otcheti/",
  },
  {
    key: "mrrb",
    adminId:
      "admin-ministerstvoto-na-regionalnoto-razvitie-i-blagoustroystvoto",
    label: "МРРБ — Regional Development",
    startUrl: "https://www.mrrb.bg/bg/byudzhet/",
  },
  {
    key: "mtitc",
    adminId: "admin-ministerstvoto-na-transporta-i-saobshteniyata",
    label: "МТС — Transport",
    startUrl: "https://www.mtc.government.bg/bg/category/266",
    alsoVisit: [
      "https://www.mtc.government.bg/bg/archive-year/16",
      "https://www.mtc.government.bg/bg/category/257",
    ],
  },
  {
    key: "mc",
    adminId: "admin-ministerstvoto-na-kulturata",
    label: "МК — Culture",
    startUrl: "https://mc.government.bg/",
  },
  {
    key: "me",
    adminId: "admin-ministerstvoto-na-energetikata",
    label: "МЕ — Energy",
    startUrl: "https://www.me.government.bg/bg/budget",
  },
  {
    key: "ms",
    adminId: "admin-ministerskiya-savet",
    label: "МС — Council of Ministers",
    startUrl:
      "https://www.government.bg/bg/administratsia/byudzhet/byudzhet-na-ms",
    alsoVisit: ["https://www.government.bg/bg/administratsia/byudzhet"],
  },
  {
    key: "mvnr",
    adminId: "admin-ministerstvoto-na-vanshnite-raboti",
    label: "МВнР — Foreign Affairs",
    startUrl: "https://www.mfa.bg/bg/ministerstvo/dokumenti/otchetnost",
    alsoVisit: ["https://www.mfa.bg/bg/ministerstvo/dokumenti/budget-mvnr"],
  },
];

// On a budget index page, anchor text containing these keywords usually leads
// to a sub-page that actually lists the PDF report. Following them once gives
// the script a real shot at finding the file.
const FOLLOW_KEYWORDS = [
  "отчет",
  "програмен",
  "програмния",
  "бюджет",
  "финанс",
  "изпълнение",
  "програма",
];

interface Candidate {
  href: string;
  text: string;
  score: number;
  reasons: string[];
}

// Score a link by how likely it is to be a programme-budget execution report.
// Higher = more interesting. Negative = noise.
const scoreCandidate = (href: string, text: string): Candidate => {
  const u = href.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // File-extension boost
  if (/\.pdf(\?|$)/.test(u)) {
    score += 3;
    reasons.push("pdf");
  } else if (/\.docx?(\?|$)/.test(u)) {
    score += 3;
    reasons.push("docx");
  } else if (/\.xlsx?(\?|$)/.test(u)) {
    score += 3;
    reasons.push("xlsx");
  } else if (/\.zip(\?|$)/.test(u)) {
    score += 2;
    reasons.push("zip");
  } else {
    return { href, text, score: -1, reasons: ["not-file"] };
  }

  // Keyword boost — both Latin and Cyrillic spellings
  const hay = `${u} ${t}`;
  if (/otchet|отчет/.test(hay)) {
    score += 4;
    reasons.push("otchet");
  }
  if (/program|програм/.test(hay)) {
    score += 3;
    reasons.push("programme");
  }
  if (/byudzhet|бюджет/.test(hay)) {
    score += 2;
    reasons.push("budget");
  }
  if (/izpaln|изпълнен/.test(hay)) {
    score += 2;
    reasons.push("execution");
  }

  // Year-recency boost
  for (const y of ["2026", "2025", "2024", "2023"]) {
    if (hay.includes(y)) {
      score += y === "2024" || y === "2025" ? 3 : 1;
      reasons.push(y);
      break;
    }
  }

  // 31.12 boost — annual report rather than mid-year
  if (/31[.\-_]12|31\+12/.test(hay)) {
    score += 2;
    reasons.push("annual");
  }

  // Boost for the gold-standard filename pattern that real programme-budget
  // execution reports follow: <chapter>_Otchet_<date>.doc[x] e.g.
  // 1800_Otchet_31.12.2023.doc, 1500-Otchet_programi-31.12.2024.xlsx.
  if (/\d{4}[_-]otchet[_-]\d/i.test(u) || /otchet[_-]programi/i.test(u)) {
    score += 6;
    reasons.push("canonical");
  }

  // Penalty for clearly-unrelated junk (debate transcripts, accessibility, etc.)
  if (/accessibility|стенограф|tender|obyavlenie|обявление/.test(hay)) {
    score -= 4;
    reasons.push("noise");
  }
  // Penalty for energy-efficiency annexes (Закон за енергийната ефективност /
  // АУЕР Forma ZEE) — they match "otchet+programme+budget" textually but
  // they're a different document class, not the programme-budget execution
  // report we want.
  if (/formazee|forma_chl|енергийна\s+ефектив|auer/i.test(hay)) {
    score -= 8;
    reasons.push("energy-eff-form");
  }
  // Penalty for EU operational-programme reports (Програма "Развитие на
  // регионите", Оперативна програма…) — these are progress reports on EU
  // funds, not state-budget execution reports.
  if (
    /оперативна\s+програма|operativna|opru|opic|opos|opdu|opic|оп\s+(околна|развитие|транспорт|конкурентоспособност)/i.test(
      hay,
    )
  ) {
    score -= 6;
    reasons.push("eu-op-prog");
  }

  return { href, text: text.slice(0, 120), score, reasons };
};

const scrapeLinks = async (
  page: Page,
): Promise<Array<{ href: string; text: string }>> => {
  // Wait for the page to settle; some sites lazy-load on scroll.
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);

  return await page.evaluate(() => {
    const out: Array<{ href: string; text: string }> = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = (a as HTMLAnchorElement).href;
      const text = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (href.startsWith("javascript:") || href.startsWith("#")) continue;
      out.push({ href, text });
    }
    return out;
  });
};

// Two-level crawl: visit start URL, collect file-like candidates AND
// budget-keyworded sub-pages, then visit the top few sub-pages and harvest
// THEIR file-like candidates too. Stops there — no deeper recursion (these
// sites have circular nav menus and we'd otherwise wander indefinitely).
const discover = async (target: Target, page: Page): Promise<Candidate[]> => {
  const allLinks = new Map<string, { href: string; text: string }>();
  const visited = new Set<string>();
  const startUrl = target.startUrl;
  const startHost = new URL(startUrl).host;

  const visit = async (url: string): Promise<void> => {
    if (visited.has(url)) return;
    visited.add(url);
    try {
      await page.goto(url, { timeout: 25_000, waitUntil: "domcontentloaded" });
      for (const link of await scrapeLinks(page)) {
        if (!allLinks.has(link.href)) allLinks.set(link.href, link);
      }
    } catch (e) {
      console.warn(`  ⚠ ${url} failed: ${(e as Error).message.slice(0, 100)}`);
    }
  };

  await visit(startUrl);
  for (const u of target.alsoVisit ?? []) await visit(u);

  // Promote sub-pages worth visiting — same host, anchor text hits a budget
  // keyword. Visit up to 8 of them; many sites have a "Бюджет 2024",
  // "Бюджет 2023" sidebar with each year on its own page.
  const subpages: string[] = [];
  for (const { href, text } of allLinks.values()) {
    if (visited.has(href)) continue;
    if (subpages.length >= 8) break;
    try {
      const u = new URL(href);
      if (u.host !== startHost) continue;
    } catch {
      continue;
    }
    // Already a direct file? skip — it's a candidate, not a sub-page to follow.
    if (/\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(href)) continue;
    const hay = `${text} ${href}`.toLowerCase();
    if (FOLLOW_KEYWORDS.some((k) => hay.includes(k))) {
      subpages.push(href);
    }
  }
  for (const sp of subpages) await visit(sp);

  const scored: Candidate[] = [];
  for (const { href, text } of allLinks.values()) {
    const c = scoreCandidate(href, text);
    if (c.score > 0) scored.push(c);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
};

const formatReport = (results: Map<Target, Candidate[]>): string => {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# Budget execution-report discovery — ${today}`,
    "",
    `Playwright sweep of ${results.size} BG ministry budget sections that ` +
      `static HTML scraping misses. Candidates ranked by keyword + recency. ` +
      `The operator picks the right file, saves to ` +
      `\`raw_data/budget/exec-<adminId>-<fy>.pdf\`, and adds a manual-pdf ` +
      `entry in \`scripts/budget/fetch_sources.ts:EXECUTION_REPORTS\`.`,
    "",
  ];
  for (const [target, candidates] of results) {
    lines.push(`## ${target.label}`);
    lines.push(`adminId: \`${target.adminId}\``);
    lines.push(`startUrl: ${target.startUrl}`);
    lines.push("");
    if (candidates.length === 0) {
      lines.push("_no candidates surfaced_");
      lines.push("");
      continue;
    }
    lines.push("| Score | URL | Text | Reasons |");
    lines.push("|------:|-----|------|---------|");
    for (const c of candidates.slice(0, 12)) {
      const text = c.text.replace(/\|/g, "\\|");
      lines.push(
        `| ${c.score} | ${c.href} | ${text} | ${c.reasons.join(", ")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
};

const cmd = command({
  name: "discover-execution-reports",
  description: "Playwright sweep for BG ministry programme-budget reports.",
  args: {
    ministry: option({
      long: "ministry",
      short: "m",
      type: optional(string),
      description: `Single target key (one of: ${TARGETS.map((t) => t.key).join(", ")})`,
    }),
    headless: flag({
      long: "headless",
      type: boolean,
      description: "Run headless (batch mode; writes report to data-reports/)",
    }),
  },
  handler: async ({ ministry, headless }) => {
    const targets = ministry
      ? TARGETS.filter((t) => t.key === ministry)
      : TARGETS;
    if (targets.length === 0) {
      console.error(
        `unknown ministry "${ministry}". Available: ${TARGETS.map((t) => t.key).join(", ")}`,
      );
      process.exit(1);
    }

    const browser = await chromium.launch({ headless });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "bg-BG",
    });
    const page = await ctx.newPage();

    const results = new Map<Target, Candidate[]>();
    for (const target of targets) {
      console.log(`\n→ ${target.label}`);
      console.log(`  start: ${target.startUrl}`);
      const candidates = await discover(target, page);
      results.set(target, candidates);
      console.log(`  candidates: ${candidates.length}`);
      for (const c of candidates.slice(0, 5)) {
        console.log(
          `    [${c.score}] ${c.reasons.join(",")}  ${c.href.slice(0, 140)}`,
        );
      }
      if (!headless && targets.length > 1) {
        console.log(`  (browser open — press Enter for next ministry)`);
        await new Promise<void>((r) => process.stdin.once("data", () => r()));
      }
    }

    await browser.close();

    if (headless) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const file = path.join(REPORT_DIR, `budget-discovery-${today}.md`);
      fs.writeFileSync(file, formatReport(results));
      console.log(`\n→ wrote ${file}`);
    }

    const totalCands = Array.from(results.values()).reduce(
      (s, c) => s + c.length,
      0,
    );
    console.log(
      `\n✓ discovery complete — ${totalCands} candidate(s) across ${results.size} ministry/ies`,
    );
  },
});

run(cmd, process.argv.slice(2));
