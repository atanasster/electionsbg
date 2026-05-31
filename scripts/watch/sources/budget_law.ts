// State Budget Law promulgation watcher (via Wayback).
//
// The annual "Закон за държавния бюджет на Република България" is promulgated
// in Държавен вестник and ingested into the budget pipeline by hand: the
// operator resolves the DV material id and adds a row to LAW_DV_MATERIALS in
// scripts/budget/fetch_sources.ts (which then emits per-spending-unit
// appropriations + the Article 53 municipal-transfer envelope for that year).
// Nothing else in the watcher tracks that promulgation — the КФП execution
// feed flips monthly but never tells us a *law* landed — so a year's budget
// can be adopted (or, like FY2026, NOT adopted and replaced by an interim
// "Закон за събирането на приходи и извършването на разходи") with no signal.
//
// This watcher closes that gap. The Ministry of Finance hosts the law itself
// (and the interim/удължителен bridging law + their amendments) as PDFs under
// `minfin.bg/upload/` — e.g. `ZDB 2013-DV 102.pdf`,
// `ZAKON_za_dyrjavniq_budjet_na_Republika_Bylgariq_za_2014.pdf`,
// `ZDBRB 2019.pdf`. The live site is Cloudflare-blocked, so — exactly like the
// minfin_program_otchet / minfin_mreports watchers — we read the file set via
// the Wayback Machine CDX API and fingerprint it.
//
// Limitation (documented, same class as minfin_program_otchet): because
// minfin.bg WAF-blocks crawlers, Wayback's capture of the *newest* law PDF can
// lag — so this is a best-effort early-warning that complements, not replaces,
// the operator's manual check of dv.parliament.bg / minfin.bg/bg/1770. When it
// flips, run /update-budget and resolve the new DV idMat into LAW_DV_MATERIALS
// (annual law) or INTERIM_BUDGET_LAWS (bridging law / ЗИД).

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const CDX = "https://web.archive.org/cdx/search/cdx";
// Narrow on the server (urlkey tokens) to keep the payload small, then refine
// precisely in JS. `zdb` catches ZDB / ZDBRB; `budjet` catches the full
// ZAKON_za_dyrjavniq_budjet form; `prihodi` catches the interim
// "събирането на приходи" bridging law.
const LAW_QUERY =
  "url=www.minfin.bg/upload/&matchType=prefix" +
  "&filter=mimetype:application/pdf&filter=statuscode:200" +
  "&filter=urlkey:.*(zdb|budjet|prihodi).*" +
  "&collapse=urlkey&limit=4000&output=json";

// Keep: the budget law (ZDB / ZDBRB / ZAKON…budjet), the interim revenue-and-
// expenditure bridging law (sabiraneto/subiraneto na prihodi, удължителен), and
// their изменение/ЗИД amendments.
const INCLUDE =
  /(zakon[_+ -]*za[_+ -]*d\w*[_+ -]*budjet|(^|[/_+ -])zdb[ _+-]|zdbrb|sabiraneto[_+ -]*na[_+ -]*prihodi|subiraneto[_+ -]*na[_+ -]*prihodi|udulj)/i;
// Drop the surrounding material that is NOT the law text: drafts (Proekt /
// ПЗДБРБ), motives, council decisions (РМС), reports, and the unrelated
// "Закон за устройството на държавния бюджет" (Budget Structure Act).
const EXCLUDE =
  /(proekt|motivi|doklad|(^|[^a-z])rms[^a-z]|pzdbrb|asbp|application|letter|nss|zemedelie|ustrojstvo|accounts|paragraph)/i;
const YEAR_RE = /(20\d{2})/;

type CdxRow = [string, string, string, string, string, string, string];

interface LawFile {
  year: number; // 0 when the filename carries no 4-digit year (e.g. a ЗИД)
  url: string;
}

const enumerate = async (): Promise<LawFile[]> => {
  const rows = await fetchJson<CdxRow[]>(`${CDX}?${LAW_QUERY}`);
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const seen = new Set<string>();
  const out: LawFile[] = [];
  for (const row of rows.slice(1)) {
    const url = row[2].replace(/^http:\/\//, "https://");
    if (seen.has(url)) continue;
    seen.add(url);
    const fn = decodeURIComponent(url.split("/").pop() ?? "");
    if (!INCLUDE.test(fn) || EXCLUDE.test(fn)) continue;
    const m = YEAR_RE.exec(fn);
    out.push({ year: m ? Number(m[1]) : 0, url });
  }
  out.sort((a, b) => a.year - b.year || a.url.localeCompare(b.url));
  return out;
};

const latestYear = (files: LawFile[]): number =>
  files.reduce((mx, f) => Math.max(mx, f.year), 0);

export const budgetLaw: WatchSource = {
  id: "budget_law",
  label: "State Budget Law promulgation (minfin, via Wayback)",
  url: "https://www.minfin.bg/bg/1770",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const files = await enumerate();
    if (files.length === 0) {
      throw new Error("Wayback CDX returned no minfin State Budget Law PDFs");
    }
    const value = createHash("sha256")
      .update(files.map((f) => f.url).join("\n"))
      .digest("hex");
    const ly = latestYear(files);
    return {
      value,
      detail: `${files.length} budget-law file(s) cached · latest FY ${ly || "?"}`,
      meta: { count: files.length, latestYear: ly },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.fingerprint === curr.value) return curr.detail;
    const prevCount = Number(prev.meta?.count ?? 0);
    const currCount = Number(curr.meta?.count ?? 0);
    const delta = currCount - prevCount;
    const prevFy = Number(prev.meta?.latestYear ?? 0);
    const currFy = Number(curr.meta?.latestYear ?? 0);
    if (delta > 0 && currFy > prevFy) {
      return `new budget-law document(s) · latest FY ${currFy} (was ${prevFy}) — run /update-budget (resolve the ДВ idMat → LAW_DV_MATERIALS / INTERIM_BUDGET_LAWS)`;
    }
    if (delta > 0) {
      return `${delta} new budget-law document(s) · latest FY ${currFy || "?"} — run /update-budget (resolve the ДВ idMat → LAW_DV_MATERIALS / INTERIM_BUDGET_LAWS)`;
    }
    return `budget-law file set churn (count ${currCount}, latest FY ${currFy || "?"}) — Wayback re-cached`;
  },
};
