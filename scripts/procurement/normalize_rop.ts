// Parse + normalize the pre-ЦАИС РОП (Регистър на обществените поръчки) contract
// register at www.aop.bg, and resolve its name-only rows to EIKs from the
// corpus we already have.
//
// Why this exists. АОП never published a machine-readable annual contracts dump
// for 2018 — data.egov.bg carries only `excl2018.csv` (37 out-of-scope rows).
// The full 2018 corpus (below- AND above-threshold) lives only in the legacy РОП
// web register, whose contract search (esearch_awards_from_to.php) returns a
// server-rendered HTML table by publication-date range. This module parses that
// table and maps each row onto Contract[].
//
// The one hard part: the РОП results table carries NAMES, not EIKs, which
// Contract requires. We resolve them deterministically from our existing corpus:
//   - awarder EIK  ← the УНП prefix (the 5-digit АОП buyer register number is a
//     stable per-buyer id that recurs every year); measured 98% coverage, ~0
//     ambiguity across ~4k buyers.
//   - contractor EIK ← the normalized contractor name, learned from the ~30k
//     contractor names already in the corpus (the РОП formats names identically
//     to the АОП feeds we ingest, so the match is reliable).
// Rows whose EIKs can't be resolved are dropped-and-counted (never guessed).

import fs from "fs";
import path from "path";
import { load } from "cheerio";
import { canonicalEik, isValidEik } from "./eik";
import { isUnp } from "./unp";
import { overrideAmount } from "./amount_overrides";
import { parseBgNumber } from "./normalize_eop";
import { normaliseOrgName } from "../lib/normalize_name";
import { disambiguateContractKeys, hashKey } from "./contract_key";
import { toEur } from "@/lib/currency";
import type { Contract, ContractTag } from "./types";

// One parsed row of the РОП contract search table. Column order (fixed):
// № | Дата на публикуване | УНП | Възложител | Изпълнител | Номер на договора |
// Дата на договора | Предмет | Стойност | Валута
export interface RopRow {
  unp: string;
  publishedDate?: string; // ISO YYYY-MM-DD
  awarderName: string;
  contractorName: string;
  contractNumber: string;
  contractDate?: string; // ISO YYYY-MM-DD
  subject: string;
  amount?: number;
  currency: string;
}

const UNP_RE = /^\d{5}-\d{4}-\d{4,}$/;

// "15.05.2018 г." / "15.05.2018" → "2018-05-15". Tolerates the trailing "&nbsp;г."
// the register appends. Returns undefined when unparseable.
const parseBgDate = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const s = raw.replace(/ /g, " ").trim();
  const m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (!m) return undefined;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const cellText = (s: string): string => s.replace(/ /g, " ").trim();

// Parse one search page's HTML. Returns the data rows plus the pager totals so
// the caller knows how many pages to fetch (page size is 50).
export const parseRopHtml = (
  html: string,
): { rows: RopRow[]; total: number; pages: number } => {
  const $ = load(html);
  const rows: RopRow[] = [];
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 10) return;
    const c = (i: number): string => cellText($(tds[i]).text());
    const unp = c(2);
    if (!UNP_RE.test(unp)) return; // header / layout rows
    rows.push({
      unp,
      publishedDate: parseBgDate(c(1)),
      awarderName: c(3),
      contractorName: c(4),
      contractNumber: c(5),
      contractDate: parseBgDate(c(6)),
      subject: c(7),
      amount: parseBgNumber(c(8)),
      currency: c(9) || "BGN",
    });
  });

  const bodyText = $("body").text().replace(/ /g, " ");
  const totalM = bodyText.match(/Общ брой:\s*(\d+)/);
  const total = totalM ? parseInt(totalM[1], 10) : rows.length;
  const pagesM = bodyText.match(/Страница\s*\d+\s*от\s*(\d+)/);
  const pages = pagesM ? parseInt(pagesM[1], 10) : total > 50 ? Math.ceil(total / 50) : 1;
  return { rows, total, pages };
};

// ---- EIK resolution maps, learned from the on-disk contract corpus ----------

export interface ResolutionMaps {
  awarderByPrefix: Map<string, string>;
  awarderByName: Map<string, string>;
  contractorByName: Map<string, string>;
}

// The 5-digit АОП buyer register number that prefixes every УНП of that buyer.
export const unpPrefix = (unp: string): string => unp.slice(0, 5);

// Normalise an org name for cross-source matching: lowercase (bg), strip quotes,
// and drop the trailing "<city>" clause the register appends — as " - Град"
// (space-dashed, so an internal hyphen like "Бул-Марк" is preserved) OR ", Град"
// (comma). Symmetric between the РОП names and the corpus names (both trace to
// the same АОП naming), so an exact normalised-equality match is reliable.
const LOCATION_SUFFIX =
  /(\s+[-–—]\s+|\s*,\s*)(гр\.?\s*)?[а-яa-z][а-яa-z0-9 .]*$/u;
export const normOrgName = (raw: string): string =>
  raw
    .toLocaleLowerCase("bg")
    .replace(/["„“”«»]/g, "")
    .replace(LOCATION_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();

// A row's contractor cell can concatenate consortium members with commas
// ("Bul-Mark OOD - Varna,DZZD Energetika,..."). When the whole string doesn't
// resolve, matching the first member often does. Returns the normalised keys to
// try in order (full string first, then the first comma-segment).
export const contractorLookupKeys = (raw: string): string[] => {
  const full = normOrgName(raw);
  const keys = [full];
  const firstSeg = raw.split(",")[0];
  const seg = normOrgName(firstSeg);
  if (seg && seg !== full) keys.push(seg);
  return keys;
};

// Pick the most frequent EIK per key (mode) from a key→(eik→count) tally, so a
// rare cross-year EIK change (buyer re-registration, name reuse) resolves to the
// dominant identity rather than flapping.
const modeOf = (
  tally: Map<string, Map<string, number>>,
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [key, eiks] of tally) {
    let best = "";
    let bestN = -1;
    for (const [eik, n] of eiks) {
      if (n > bestN) {
        bestN = n;
        best = eik;
      }
    }
    if (best) out.set(key, best);
  }
  return out;
};

const bump = (
  tally: Map<string, Map<string, number>>,
  key: string,
  eik: string,
): void => {
  let inner = tally.get(key);
  if (!inner) {
    inner = new Map();
    tally.set(key, inner);
  }
  inner.set(eik, (inner.get(eik) ?? 0) + 1);
};

// Walk every month-shard on disk and learn the three resolution maps. The shards
// are the ingest layer's source of truth (already includes the 2020/2021 eop
// backfill), so the maps reflect the full known buyer/contractor universe.
export const buildResolutionMaps = (contractsDir: string): ResolutionMaps => {
  const awarderPfx = new Map<string, Map<string, number>>();
  const awarderNm = new Map<string, Map<string, number>>();
  const contractorNm = new Map<string, Map<string, number>>();

  if (fs.existsSync(contractsDir)) {
    // Only YYYY year dirs hold month-shard arrays; skip siblings like by-id/
    // (per-contract detail objects) and .DS_Store.
    for (const year of fs.readdirSync(contractsDir).sort()) {
      if (!/^\d{4}$/.test(year)) continue;
      const dir = path.join(contractsDir, year);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/^\d{4}-\d{2}\.json$/.test(f)) continue;
        const arr = JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf8"),
        ) as Contract[];
        if (!Array.isArray(arr)) continue;
        for (const r of arr) {
          if (r.awarderEik && isValidEik(r.awarderEik)) {
            if (r.unp && UNP_RE.test(r.unp))
              bump(awarderPfx, unpPrefix(r.unp), r.awarderEik);
            if (r.awarderName)
              bump(awarderNm, normOrgName(r.awarderName), r.awarderEik);
          }
          if (
            r.contractorEik &&
            isValidEik(r.contractorEik) &&
            r.contractorName
          )
            bump(contractorNm, normOrgName(r.contractorName), r.contractorEik);
        }
      }
    }
  }
  return {
    awarderByPrefix: modeOf(awarderPfx),
    awarderByName: modeOf(awarderNm),
    contractorByName: modeOf(contractorNm),
  };
};

// ---- normalization ----------------------------------------------------------

export interface RopNormalizeStats {
  rowsSeen: number;
  rowsEmitted: number;
  droppedNoAwarderEik: number;
  droppedNoContractorEik: number;
  droppedNoAmount: number;
  droppedSelfDeal: number;
}

const emptyStats = (): RopNormalizeStats => ({
  rowsSeen: 0,
  rowsEmitted: 0,
  droppedNoAwarderEik: 0,
  droppedNoContractorEik: 0,
  droppedNoAmount: 0,
  droppedSelfDeal: 0,
});

const contractKey = (
  releaseId: string,
  contractId: string,
  contractorEik: string,
  tag: ContractTag,
): string => hashKey(`${releaseId}::${contractId}::${contractorEik}::${tag}`);

// Map parsed РОП rows onto Contract[], resolving EIKs from the corpus maps.
// `sourceUrl` is the per-day search URL, carried onto every row for citation.
export const normalizeRopRows = (
  rows: RopRow[],
  maps: ResolutionMaps,
  sourceUrl: string,
): { contracts: Contract[]; stats: RopNormalizeStats } => {
  const stats = emptyStats();
  const out: Contract[] = [];
  const discs: string[] = [];
  const tag: ContractTag = "contract";

  for (const row of rows) {
    stats.rowsSeen++;

    // Awarder EIK: УНП prefix first (deterministic), then awarder-name fallback.
    const awarderEik =
      maps.awarderByPrefix.get(unpPrefix(row.unp)) ??
      maps.awarderByName.get(normOrgName(row.awarderName)) ??
      "";
    if (!isValidEik(awarderEik)) {
      stats.droppedNoAwarderEik++;
      continue;
    }
    // Contractor EIK: name match only (the source carries no code). Try the
    // full name, then the first consortium member.
    let contractorEik = "";
    for (const k of contractorLookupKeys(row.contractorName)) {
      const hit = maps.contractorByName.get(k);
      if (hit) {
        contractorEik = hit;
        break;
      }
    }
    if (!isValidEik(contractorEik)) {
      stats.droppedNoContractorEik++;
      continue;
    }

    const unp = isUnp(row.unp) ? row.unp : undefined;
    const rawAmount = row.amount;
    const amount =
      overrideAmount({
        unp,
        contractId: row.contractNumber,
        amount: rawAmount,
      }) ?? rawAmount;
    if (amount === undefined || amount <= 0) {
      stats.droppedNoAmount++;
      continue;
    }

    const awarderName = normaliseOrgName(row.awarderName);
    const contractorName = normaliseOrgName(row.contractorName);
    // Same self-deal guard as the OCDS / eop paths: a supplier EIK equal to the
    // buyer EIK is the register's placeholder for a missing supplier, not a real
    // self-contract.
    if (contractorEik === awarderEik) {
      stats.droppedSelfDeal++;
      continue;
    }

    // The row's calendar date is the publication date (when the spend became
    // public), falling back to the signing date, then the УНП year.
    const rowDate =
      row.publishedDate ||
      row.contractDate ||
      `${row.unp.slice(6, 10)}-12-31`;

    // Synthetic OCDS-style ids, namespaced with `rop-` so they never collide
    // with the OCDS / eop / legacy corpora. УНП is the procedure key;
    // contractNumber distinguishes contracts within a procedure.
    const ocid = `rop-${row.unp}`;
    const releaseId = `rop-${row.unp}-${row.contractNumber || "x"}`;
    const currency = row.currency || "BGN";

    out.push({
      key: contractKey(releaseId, row.contractNumber, contractorEik, tag),
      ocid,
      releaseId,
      contractId: row.contractNumber || undefined,
      unp,
      tag,
      date: rowDate,
      dateSigned: row.contractDate || undefined,
      awarderEik,
      awarderName,
      contractorEik,
      contractorName,
      amount,
      currency,
      amountEur: toEur(amount, currency) ?? undefined,
      title: row.subject || "",
      bundleUuid: "rop-register",
      sourceUrl,
    });
    discs.push(`${row.contractNumber || ""}:${amount ?? ""}`);
    stats.rowsEmitted++;
  }

  // Re-key any within-batch base-key collision (multiple lots under one contract
  // number to the same supplier).
  disambiguateContractKeys(out, (i) => discs[i]);
  return { contracts: out, stats };
};
