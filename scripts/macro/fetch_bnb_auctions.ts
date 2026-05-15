/**
 * Scrape Bulgarian National Bank (BNB) domestic government securities (ДЦК)
 * auction results. BNB acts as fiscal agent for the Ministry of Finance and
 * publishes one HTML page per auction with the emission details, allotment,
 * weighted-average yield, etc. Coverage on the public site begins 2019.
 *
 * Output: data/debt-emissions-domestic.json — list of DebtEmission records
 * with the same schema the UI consumes for international Eurobonds (curated
 * in data/debt-emissions.json). The React hook merges both sources.
 *
 * URL patterns:
 *   year index: https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=YYYY
 *   per auction: link target on the index page — varies between
 *                FA_AR_YYYYMMDD_BG and FA_AR_YYYYMMDD_A1_BG (some have _A2,
 *                _A3 for re-runs). Always extracted from the index, never
 *                constructed, to avoid missing variants.
 *
 * Usage:
 *   npx tsx scripts/macro/fetch_bnb_auctions.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(
  __dirname,
  "../../data/debt-emissions-domestic.json",
);

const BASE = "https://www.bnb.bg";
const FIRST_YEAR = 2019;
// Inclusive — caller can clamp via env if needed. Default scrapes through
// the next-calendar-year boundary so a fresh-year auction in early January
// doesn't get missed when the script runs mid-cycle.
const LAST_YEAR = new Date().getFullYear();

// Be polite: small per-request delay so we don't hammer bnb.bg.
const REQUEST_DELAY_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Currency = "EUR" | "BGN";

type DebtEmission = {
  id: string;
  market: "domestic";
  type: "treasury_bond" | "treasury_bill" | "loan";
  bnbEmissionNumber?: string;
  issueDate: string;
  maturityDate?: string;
  termYears?: number;
  currency: Currency;
  principalMillion: number;
  couponPct?: number;
  settlementYieldPct?: number;
  titleEn: string;
  titleBg: string;
  notes?: string;
};

type ScrapeIssue = {
  url: string;
  reason: string;
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; electionsbg-data-bot/1.0; +https://electionsbg.com)",
      "Accept-Language": "bg,en;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`BNB returned ${res.status} for ${url}`);
  }
  return res.text();
};

// Strip HTML, decode &nbsp;, collapse whitespace to a single space. Returns
// the human-readable narrative the auction page renders.
const flattenHtml = (html: string): string => {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ")
    .trim();
};

// Extract auction page hrefs from a year-index page. BNB renders them as
// relative links inside an anchor with the date in Bulgarian. Older years
// use FA_AR_YYYYMMDD_BG; newer years use FA_AR_YYYYMMDD_A1_BG.
const parseIndexAuctions = (html: string): string[] => {
  const hrefs = new Set<string>();
  const re = /href="([^"]*FA_AR_[0-9_A-Z]+_BG)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].startsWith("http")
      ? m[1]
      : `${BASE}${m[1].startsWith("/") ? "" : "/FiscalAgent/FAGSAuctions/FAAuctionResults/"}${m[1]}`;
    hrefs.add(href);
  }
  return [...hrefs];
};

// Convert a Bulgarian "DD.MM.YYYY" or "D месец YYYY г." into ISO YYYY-MM-DD.
// Returns undefined if the input doesn't match either form.
const BG_MONTHS: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

const parseBgDate = (raw: string): string | undefined => {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // 11.02.2026 г.
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(cleaned);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  // 13 май 2026 г.
  const verbal = /^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/u.exec(cleaned);
  if (verbal) {
    const mm = BG_MONTHS[verbal[2].toLowerCase()];
    if (mm) {
      const dd = verbal[1].padStart(2, "0");
      return `${verbal[3]}-${String(mm).padStart(2, "0")}-${dd}`;
    }
  }
  return undefined;
};

// Map the verbal "пет годишни / десетгодишни / тригодишни" form to a year
// count. Falls back to undefined when the term description is missing.
const TERM_WORDS: Record<string, number> = {
  едногодишни: 1,
  двугодишни: 2,
  тригодишни: 3,
  четиригодишни: 4,
  петгодишни: 5,
  "пет годишни": 5,
  шестгодишни: 6,
  седемгодишни: 7,
  осемгодишни: 8,
  деветгодишни: 9,
  десетгодишни: 10,
  "десет годишни": 10,
  дванадесетгодишни: 12,
  петнадесетгодишни: 15,
  двадесетгодишни: 20,
};

const parseTermYears = (
  description: string,
  issueDate: string | undefined,
  maturityDate: string | undefined,
): number | undefined => {
  const lower = description.toLowerCase();
  for (const [word, yrs] of Object.entries(TERM_WORDS)) {
    if (lower.includes(word)) return yrs;
  }
  // Fallback: difference between maturity and issue dates.
  if (issueDate && maturityDate) {
    const a = new Date(issueDate).getTime();
    const b = new Date(maturityDate).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return Math.round((b - a) / (365.25 * 24 * 3600 * 1000));
    }
  }
  return undefined;
};

// Auction-page narrative parser. Returns a DebtEmission (or null + reason
// if the page is unexpected — e.g. parsing fails on a layout we haven't
// seen).
const parseAuctionPage = (
  url: string,
  html: string,
): DebtEmission | { error: string } => {
  const text = flattenHtml(html);

  // Emission number + issue date. Example fragments:
  //   "емисия № BG 20 400 26 218/11.02.2026 г."
  //   "емисия BG 20 301 26 119/28.01.2026 г."
  const emissionRe =
    /емисия\s*№?\s*(BG[\s0-9]+?)\s*\/\s*(\d{1,2}\.\d{1,2}\.\d{4})/i;
  const emissionMatch = emissionRe.exec(text);
  if (!emissionMatch) {
    return { error: "no emission number/issue-date match" };
  }
  const bnbEmissionNumber = emissionMatch[1].replace(/\s+/g, " ").trim();
  const issueDate = parseBgDate(emissionMatch[2]);
  if (!issueDate) {
    return { error: `issue date unparseable: ${emissionMatch[2]}` };
  }

  // Term description: word(s) immediately following the emission number,
  // inside parentheses. e.g. "(десетгодишни лихвоносни съкровищни облигации)".
  const termDescRe = /емисия[\s\S]*?\(([^)]+)\)/i;
  const termMatch = termDescRe.exec(text);
  const termDesc = termMatch ? termMatch[1] : "";

  // Maturity date: "с падеж 11.02.2036 г."
  const maturityRe = /падеж\s+(\d{1,2}\.\d{1,2}\.\d{4})/i;
  const maturityMatch = maturityRe.exec(text);
  const maturityDate = maturityMatch
    ? parseBgDate(maturityMatch[1])
    : undefined;

  const termYears = parseTermYears(termDesc, issueDate, maturityDate);

  // Offered principal: "в размер на 210 000 000 евро" or "лв."
  const offeredRe =
    /в\s*размер\s*на\s+([\d\s.,]+?)\s*(евро|лв\.?|лева)\s+и\s+лихвен\s+процент/i;
  const offeredMatch = offeredRe.exec(text);
  if (!offeredMatch) {
    return { error: "no offered amount/coupon clause" };
  }
  const offeredAmount = parseFloat(
    offeredMatch[1].replace(/\s/g, "").replace(",", "."),
  );
  const currency: Currency = /евро/i.test(offeredMatch[2]) ? "EUR" : "BGN";

  // Coupon: "лихвен процент 3.50% годишно" or "лихвен процент 0.01% годишно"
  const couponRe = /лихвен\s+процент\s+([\d.,]+)\s*%/i;
  const couponMatch = couponRe.exec(text);
  const couponPct = couponMatch
    ? parseFloat(couponMatch[1].replace(",", "."))
    : undefined;

  // Approved (sold) amount: "одобрени поръчки в размер на 210 000 000 евро"
  // — appears only when bids were accepted; rejected auctions skip this.
  const approvedRe =
    /одобрени\s+поръчки\s+в\s+размер\s+на\s+([\d\s.,]+?)\s*(евро|лв\.?|лева)/i;
  const approvedMatch = approvedRe.exec(text);
  const approvedAmount = approvedMatch
    ? parseFloat(approvedMatch[1].replace(/\s/g, "").replace(",", "."))
    : 0;
  const rejected = /всички\s+постъпили\s+поръчки\s+бяха\s+отхвърлени/i.test(
    text,
  );

  // Weighted-average yield. Two formats:
  //  - Recent (price table at bottom):
  //      "Среднопретеглена 93.73 4.34%"   (price then yield)
  //  - Older (embedded narrative):
  //      "среднопретеглена годишна доходност в размер на 0.56%"
  let settlementYieldPct: number | undefined;
  const wayTable = /Среднопретеглена\s+[\d.,]+\s+([\d.,]+)\s*%/.exec(text);
  if (wayTable) {
    settlementYieldPct = parseFloat(wayTable[1].replace(",", "."));
  } else {
    const wayNarr =
      /среднопретеглена[^%]*?в\s+размер\s+на\s+([\d.,]+)\s*%/i.exec(text);
    if (wayNarr) {
      settlementYieldPct = parseFloat(wayNarr[1].replace(",", "."));
    }
  }

  // Auction date: extract from URL (FA_AR_YYYYMMDD_*) so we get an unambiguous
  // ID. The narrative usually states it too but URL parsing is sturdier.
  // For domestic series we want the table's "Issued" column to mean the
  // auction (settlement event) date, not the original bond's first-issue
  // date — reopenings of the same emission would otherwise pile up under
  // the same calendar slot. Keep the original issue date in notes.
  const auctionDateMatch = /FA_AR_(\d{8})/.exec(url);
  const auctionDate = auctionDateMatch
    ? `${auctionDateMatch[1].slice(0, 4)}-${auctionDateMatch[1].slice(4, 6)}-${auctionDateMatch[1].slice(6, 8)}`
    : issueDate;
  const isReopening = auctionDate !== issueDate;

  const principalMillion = approvedAmount / 1_000_000;
  const termYearsLabel = termYears ? `${termYears}y` : "—";

  // ID: domestic / auction-date / emission tail. Auction date guarantees
  // uniqueness across reopenings of the same emission.
  const tail = bnbEmissionNumber.split(" ").slice(-1)[0];
  const id = `BG-${auctionDate}-${tail}`;

  const symbol = currency === "EUR" ? "€" : "BGN ";
  const fmtM = (m: number): string => {
    if (m >= 1000) return `${(m / 1000).toFixed(2)}bn`;
    if (m >= 1) return `${m.toFixed(0)}M`;
    return `${(m * 1000).toFixed(0)}k`;
  };

  const titleEn = rejected
    ? `${symbol}${fmtM(offeredAmount / 1_000_000)} ${termYearsLabel} domestic (bids rejected)`
    : `${symbol}${fmtM(principalMillion)} ${termYearsLabel} domestic`;

  const titleBg = rejected
    ? `${symbol}${fmtM(offeredAmount / 1_000_000)}, ${termYearsLabel === "—" ? "" : termYearsLabel + " "}ДЦК (отхвърлени)`
    : `${symbol}${fmtM(principalMillion)}, ${termYearsLabel === "—" ? "" : termYearsLabel + " "}ДЦК`;

  const reopeningNote = isReopening
    ? `; reopening of emission originally issued ${issueDate}`
    : "";
  const notes = rejected
    ? `BNB auction ${auctionDate}; all bids rejected (offered ${(offeredAmount / 1_000_000).toFixed(0)}M ${currency})${reopeningNote}`
    : `BNB auction ${auctionDate}${reopeningNote}`;

  return {
    id,
    market: "domestic",
    type: "treasury_bond",
    bnbEmissionNumber,
    // For domestic: surface the auction (settlement) date as `issueDate` so
    // the UI sorts/displays one row per auction event. The bond's original
    // first-issue date stays in `notes` for reopenings.
    issueDate: auctionDate,
    maturityDate,
    termYears,
    currency,
    principalMillion: rejected ? 0 : principalMillion,
    couponPct,
    settlementYieldPct,
    titleEn,
    titleBg,
    notes,
  };
};

const main = async () => {
  const emissions: DebtEmission[] = [];
  const issues: ScrapeIssue[] = [];

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const idxUrl = `${BASE}/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=${year}`;
    process.stdout.write(`Year ${year}: fetching index... `);
    let idxHtml: string;
    try {
      idxHtml = await fetchText(idxUrl);
    } catch (err) {
      console.error(`failed: ${(err as Error).message}`);
      throw err;
    }
    const auctionUrls = parseIndexAuctions(idxHtml);
    console.log(`${auctionUrls.length} auctions`);
    for (const url of auctionUrls) {
      try {
        await sleep(REQUEST_DELAY_MS);
        const html = await fetchText(url);
        const parsed = parseAuctionPage(url, html);
        if ("error" in parsed) {
          issues.push({ url, reason: parsed.error });
          process.stdout.write(
            `  skip ${url.split("/").pop()}: ${parsed.error}\n`,
          );
          continue;
        }
        emissions.push(parsed);
      } catch (err) {
        issues.push({ url, reason: (err as Error).message });
      }
    }
  }

  // Sort newest auction first.
  emissions.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));

  const payload = {
    fetchedAt: new Date().toISOString(),
    country: "BG",
    source: {
      bnbAuctions:
        "https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm",
    },
    emissions,
    issues,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `\nWrote ${emissions.length} auctions to ${OUT_FILE} (${issues.length} pages skipped)`,
  );
  if (issues.length > 0) {
    console.log("Issues:");
    for (const i of issues.slice(0, 10))
      console.log(`  ${i.url}\n    ${i.reason}`);
    if (issues.length > 10) console.log(`  …and ${issues.length - 10} more`);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
