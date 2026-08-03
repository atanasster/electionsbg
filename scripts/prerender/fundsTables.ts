// ИСУН drill-down tables for the prerendered bodies.
//
// A leaf module (imports only ./html) because routes.ts calls these at
// module-evaluation time, and routes.ts <-> bodyBuilders.ts is already a cycle.
//
// The programme and procedure pages hold ranked lists of beneficiaries,
// contracts and municipalities in their summary shard — and, before this, put
// none of it in the HTML. The whole EUR 2.23bn programme page shipped four
// sentences of prose.
//
// The win is citability: answer engines (GPTBot, ClaudeBot, PerplexityBot,
// OAI-SearchBot — all Allowed in robots.txt) do not execute JS, so "кой получи
// най-много по ОПИК" had nothing citable from us and got answered from
// eufunds.bg. Now the ranked answer is in the HTML, attributed, on every page.
//
// The links are a SECOND, partial win, and worth being precise about: they are
// the first JS-free links into the contract and company layers, but those
// destinations are not prerendered yet, so a crawler that follows one still
// gets the SPA shell (T3 of docs/plans/funds-seo-geo-v1.md is what closes it).
// /settlement/ links use обштина codes, whose pages are likewise SPA-only —
// the prerendered settlement tree is EKATTE-keyed. Discovery works today;
// what is discovered becomes readable when T3 lands.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { escapeHtml, escapeAttr, fmtInt, fmtIntEn } from "./html";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// обштина code → display name, for the ranked municipality tables. Sofia's
// districts and the S22 synthetic anchor all roll up to one "Sofia (city)"
// label, mirroring how the choropleth and the SPA tiles present them.
export const loadMuniNames = (): ((
  lang: "bg" | "en",
) => (code: string) => string | undefined) => {
  let rows: Array<{ obshtina: string; name: string; name_en: string }> = [];
  try {
    rows = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../data/municipalities.json"),
        "utf8",
      ),
    );
  } catch {
    rows = [];
  }
  const byLang = {
    bg: new Map<string, string>(),
    en: new Map<string, string>(),
  };
  for (const r of rows) {
    if (!byLang.bg.has(r.obshtina)) byLang.bg.set(r.obshtina, r.name);
    if (!byLang.en.has(r.obshtina)) byLang.en.set(r.obshtina, r.name_en);
  }
  return (lang) => (code) =>
    /^S2[2-5]\d{0,2}$/.test(code)
      ? lang === "bg"
        ? "София (столица)"
        : "Sofia (city)"
      : byLang[lang].get(code);
};

export interface FundsTableRows {
  statusBreakdown?: Array<{
    status: string;
    rollup: { contractCount: number; totalEur: number; paidEur: number };
  }>;
  topBeneficiaries?: Array<{
    beneficiaryEik: string | null;
    beneficiaryName: string;
    contractCount: number;
    totalEur: number;
    paidEur: number;
  }>;
  topContracts?: Array<{
    contractNumber: string;
    title: string;
    beneficiaryName: string;
    totalEur: number;
    paidEur: number;
    status: string;
  }>;
  topMunis?: Array<{ muni: string; contractCount: number; totalEur: number }>;
}

// The four dashboard buckets, spelled out — a crawler reading "completed" gets
// nothing; a reader (or an answer engine) quoting the page should see the word.
const FUNDS_STATUS_LABELS: Record<string, { bg: string; en: string }> = {
  completed: { bg: "Приключени", en: "Completed" },
  "in-progress": { bg: "В изпълнение", en: "In progress" },
  signed: { bg: "Сключени", en: "Signed" },
  terminated: { bg: "Прекратени", en: "Terminated" },
  other: { bg: "Други", en: "Other" },
};

const fundsEur = (n: number, lang: "bg" | "en"): string =>
  `${(lang === "bg" ? fmtInt : fmtIntEn)(n)} €`;

const table = (caption: string, head: string[], rows: string[][]): string => {
  if (rows.length === 0) return "";
  const th = head.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<h2>${escapeHtml(caption)}</h2><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
};

/**
 * Render the ranked lists of an ИСУН summary shard as real HTML tables.
 *
 * `muniName` maps an обштина code to a display name; codes it does not know are
 * printed as-is rather than dropped.
 */
export const buildFundsTables = (
  data: FundsTableRows,
  lang: "bg" | "en",
  siteUrl: string,
  muniName: (code: string) => string | undefined,
  caps: { beneficiaries: number; contracts: number; munis: number },
): string => {
  const bg = lang === "bg";
  const base = bg ? siteUrl : `${siteUrl}/en`;
  const eur = (n: number) => fundsEur(n, lang);
  const int = bg ? fmtInt : fmtIntEn;
  const out: string[] = [];

  out.push(
    table(
      bg ? "По статус на договорите" : "Contracts by status",
      bg
        ? ["Статус", "Договори", "Договорени", "Изплатени"]
        : ["Status", "Contracts", "Contracted", "Paid"],
      // Every row is defensive against a partial shard: these builders run at
      // routes.ts MODULE scope, outside any try, so one malformed row would
      // fail the whole prerender — and with it the sitemap and its own tests.
      (data.statusBreakdown ?? [])
        .filter((s) => s && s.rollup)
        .map((s) => [
          escapeHtml(FUNDS_STATUS_LABELS[s.status]?.[lang] ?? s.status ?? ""),
          int(s.rollup.contractCount ?? 0),
          eur(s.rollup.totalEur ?? 0),
          eur(s.rollup.paidEur ?? 0),
        ]),
    ),
  );

  out.push(
    table(
      bg ? "Водещи бенефициенти" : "Top beneficiaries",
      bg
        ? ["Бенефициент", "Договори", "Договорени", "Изплатени"]
        : ["Beneficiary", "Contracts", "Contracted", "Paid"],
      (data.topBeneficiaries ?? [])
        .filter((b) => b?.beneficiaryName)
        .slice(0, caps.beneficiaries)
        .map((b) => [
          b.beneficiaryEik
            ? `<a href="${base}/company/${escapeAttr(b.beneficiaryEik)}">${escapeHtml(b.beneficiaryName)}</a>`
            : escapeHtml(b.beneficiaryName),
          int(b.contractCount ?? 0),
          eur(b.totalEur ?? 0),
          eur(b.paidEur ?? 0),
        ]),
    ),
  );

  out.push(
    table(
      bg ? "Водещи договори" : "Top contracts",
      bg
        ? ["Договор", "Бенефициент", "Договорени", "Изплатени"]
        : ["Contract", "Beneficiary", "Contracted", "Paid"],
      (data.topContracts ?? [])
        .filter((c) => c?.contractNumber)
        .slice(0, caps.contracts)
        .map((c) => [
          `<a href="${base}/funds/contract/${encodeURIComponent(c.contractNumber)}">${escapeHtml(c.title ?? c.contractNumber)}</a>`,
          escapeHtml(c.beneficiaryName ?? ""),
          eur(c.totalEur ?? 0),
          eur(c.paidEur ?? 0),
        ]),
    ),
  );

  out.push(
    table(
      bg ? "Водещи общини по договорени средства" : "Top municipalities",
      bg
        ? ["Община", "Договори", "Договорени"]
        : ["Municipality", "Contracts", "Contracted"],
      (data.topMunis ?? [])
        .filter((m) => m?.muni)
        .slice(0, caps.munis)
        .map((m) => [
          `<a href="${base}/settlement/${escapeAttr(m.muni)}">${escapeHtml(muniName(m.muni) ?? m.muni)}</a>`,
          int(m.contractCount ?? 0),
          eur(m.totalEur ?? 0),
        ]),
    ),
  );

  return out.filter(Boolean).join("\n");
};

/**
 * Normalise a theme shard's ranked lists onto the shared table shape.
 *
 * The theme builder emits `eik`/`name` where the programme and procedure shards
 * emit `beneficiaryEik`/`beneficiaryName`, and its contracts carry the
 * beneficiary under `beneficiaryName` already — mapping here keeps one table
 * renderer rather than a second near-copy.
 */
export const fundsThemeTableRows = (shard: {
  topBeneficiaries?: Array<{
    eik: string | null;
    name: string;
    contractCount: number;
    totalEur: number;
    paidEur: number;
  }>;
  topContracts?: FundsTableRows["topContracts"];
  topMunis?: FundsTableRows["topMunis"];
}): FundsTableRows => ({
  topBeneficiaries: (shard.topBeneficiaries ?? []).map((b) => ({
    beneficiaryEik: b.eik,
    beneficiaryName: b.name,
    contractCount: b.contractCount,
    totalEur: b.totalEur,
    paidEur: b.paidEur,
  })),
  topContracts: shard.topContracts,
  topMunis: shard.topMunis,
});
