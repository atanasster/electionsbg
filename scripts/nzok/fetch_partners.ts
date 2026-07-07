// Scrape НЗОК's public "договорни партньори" (contracted-partners) register for
// the hospital list — the ONLY authoritative source that carries НЗОК's own
// Рег.№ ЛЗ (the 10-digit facility number in hospital_payments.json) AND, per
// facility, the manager (управител) + exact settlement + address. That extra
// identity is what turns the otherwise-fragile name match against the commerce
// register into a verifiable one (see write_hospital_eik.ts). The register does
// NOT publish EIK — so it can't be the crosswalk on its own, but it is the anchor.
//
// The entry point services.nhif.bg/references/lists/opl.xhtml 302-redirects to a
// plain-HTML app at reports.nhif.bg/nhif_reports/nhif_partners/. Its hospital
// page (?page=hospitals&rzok=NN) server-renders one card per facility:
//   <h4>N. УМБАЛ Пълмед ООД</h4> … Управител: … Населено място: … Адрес: …
//   onclick="openClinicPathsWindowByCode('1622211036')"   ← the Рег.№ ЛЗ
// We walk all 28 РЗОК and cache the parsed cards under raw_data/nzok/ (gitignored).
//
// Usage: tsx scripts/nzok/fetch_partners.ts [--force]
// (write_hospital_eik.ts calls fetchPartners() directly, fetching only if the
// cache is missing/stale.)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, "../../raw_data/nzok/partners.json");
const ENTRY = "https://services.nhif.bg/references/lists/opl.xhtml";
const BASE = "https://reports.nhif.bg/nhif_reports/nhif_partners/";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";
// 28 РЗОК codes (one regional health fund per oblast; "22" = София град).
const RZOKS = Array.from({ length: 28 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

export interface PartnerCard {
  /** 10-digit Рег.№ ЛЗ — the exact join key to hospital_payments.json. */
  regNo: string;
  /** РЗОК-abbreviated facility name (same short form as the payment file). */
  name: string;
  /** Comma-separated manager(s) — the verification signal for the EIK match. */
  managers: string;
  settlement: string;
  obshtina: string;
  oblast: string;
  address: string;
  rzok: string;
}

const decode = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const field = (body: string, label: string): string => {
  const m = new RegExp(`${label}:</b>\\s*([^<]+)`).exec(body);
  return m ? decode(m[1]) : "";
};

/** Parse the hospital cards out of one РЗОК page's HTML. */
const parseCards = (html: string, rzok: string): PartnerCard[] => {
  const cards: PartnerCard[] = [];
  const re = /<h4>(.*?)<\/h4>([\s\S]*?)(?=<h4>|<\/div><\/div><\/div>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decode(m[1].replace(/<[^>]+>/g, "")).replace(/^\d+\.\s*/, "");
    const body = m[2];
    const code = /openClinicPathsWindowByCode\('(\d+)'\)/.exec(body);
    if (!code) continue;
    cards.push({
      regNo: code[1],
      name,
      managers: field(body, "Управител"),
      settlement: field(body, "Населено място"),
      obshtina: field(body, "Община"),
      oblast: field(body, "Област").replace(/,.*$/, "").trim(),
      address: field(body, "Адрес"),
      rzok,
    });
  }
  return cards;
};

const fetchText = async (url: string, cookie: string): Promise<Response> =>
  fetch(url, { headers: { "User-Agent": UA, ...(cookie ? { Cookie: cookie } : {}) } });

/** Fetch and parse all 28 РЗОК hospital pages. */
export const scrapePartners = async (): Promise<PartnerCard[]> => {
  // Warm the reports host (the entry .xhtml 302s to it; a session cookie may be set).
  let cookie = "";
  const warm = await fetch(ENTRY, { headers: { "User-Agent": UA } });
  const setc = warm.headers.get("set-cookie");
  if (setc) cookie = setc.split(";")[0];

  const all: PartnerCard[] = [];
  for (const rz of RZOKS) {
    const r = await fetchText(`${BASE}?page=hospitals&rzok=${rz}&district=`, cookie);
    if (!r.ok) throw new Error(`GET rzok=${rz} → ${r.status}`);
    const c = r.headers.get("set-cookie");
    if (c && !cookie) cookie = c.split(";")[0];
    const cards = parseCards(await r.text(), rz);
    all.push(...cards);
  }
  if (all.length < 300)
    throw new Error(
      `partners scrape returned only ${all.length} cards (expected ~380) — layout may have changed`,
    );
  return all;
};

/** Return the cached partner cards, scraping + caching if missing or --force. */
export const fetchPartners = async (
  force = false,
): Promise<PartnerCard[]> => {
  if (!force && fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as PartnerCard[];
  }
  const cards = await scrapePartners();
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cards, null, 1));
  return cards;
};

// CLI entry — refresh the cache.
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes("--force");
  scrapePartners()
    .then((cards) => {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cards, null, 1));
      const byRzok = new Map<string, number>();
      for (const c of cards) byRzok.set(c.rzok, (byRzok.get(c.rzok) ?? 0) + 1);
      console.log(
        `Wrote ${CACHE_FILE}\n  ${cards.length} hospital cards across ${byRzok.size} РЗОК` +
          `${force ? " (forced refresh)" : ""}`,
      );
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
