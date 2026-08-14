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
import { SITE_ORIGIN } from "@/lib/siteOrigin";

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

// ── titles and descriptions ─────────────────────────────────────────────────
// The old description was a noun pile — "35 332 договора · 30 092 бенефициенти ·
// €2,228,915,357 договорени" — with no verb and, decisively, no entity names.
// The one thing that makes a funds snippet clickable is recognising a company or
// a municipality in it, and it is also what an answer engine quotes.

/** €2.23 млрд. / €2.23bn — a title has ~60 useful characters, not 13 digits. */
export const compactEur = (n: number, lang: "bg" | "en"): string => {
  const v = Number(n) || 0;
  const bg = lang === "bg";
  // Each rung is chosen AFTER rounding, so 999,600 reads "€1.0 млн." rather
  // than the "€1000 хил." a round-then-classify order produces.
  const scale = (div: number, digits: number): number =>
    Number((v / div).toFixed(digits));
  if (scale(1e6, 1) >= 1000 || v >= 1e9)
    return `€${(v / 1e9).toFixed(2)}${bg ? " млрд." : "bn"}`;
  if (scale(1e3, 0) >= 1000 || v >= 1e6)
    return `€${(v / 1e6).toFixed(1)}${bg ? " млн." : "m"}`;
  if (v >= 1e3) return `€${Math.round(v / 1e3)}${bg ? " хил." : "k"}`;
  return `€${Math.round(v)}`;
};

/**
 * The first `n` beneficiary names, for the "Най-големи получатели" clause.
 *
 * Returns [] for a FLAT scheme — one where the leaders all received the same
 * amount. BG16RFOP002-2.089 paid every one of its 4,356 beneficiaries exactly
 * €25,520, so "largest recipients" is not a fact about them: the ranking is the
 * alphabetical tie-break, and the snippet read `" Екодин " ООД, "17 Сиракови"
 * ЕАД ЕАД, „Абсент“ ЕООД` — arbitrary names presented as a finding. Saying
 * nothing beats saying something that is true of the sort order.
 */
export const topBeneficiaryNames = (
  data: FundsTableRows,
  n: number,
): string[] => {
  const rows = (data.topBeneficiaries ?? []).filter((b) => b?.beneficiaryName);
  const head = rows.slice(0, n);
  if (head.length === 0) return [];
  // Flat when the leaders are indistinguishable from the next one down. The
  // test is RELATIVE, not exact equality: BG-RRP-1.014's top four span €0.46 on
  // €1.77M — the same defect as 2.089 one decimal place down, and Math.round
  // would have called it varied. A tie at a grant cap is suppressed for the
  // same reason: naming three of four identical recipients reports the sort
  // order, not a fact about them.
  const window = rows.slice(0, n + 1);
  const amounts = window.map((b) => Number(b.totalEur) || 0);
  const max = Math.max(...amounts);
  const min = Math.min(...amounts);
  const FLAT_SPREAD = 0.01; // 1% of the leader
  if (window.length > 1 && (max <= 0 || (max - min) / max < FLAT_SPREAD))
    return [];
  return head
    .map((b) => b.beneficiaryName.replace(/\s+/g, " ").trim())
    .filter(Boolean);
};

/**
 * A meta description that answers the question the searcher asked, and names
 * somebody — with the names ahead of the figures, so they survive truncation.
 */
export const buildFundsDescription = (
  lang: "bg" | "en",
  opts: {
    lead: string;
    contracts: number;
    beneficiaries: number;
    totalEur: number;
    paidEur: number;
    names: string[];
  },
): string => {
  const bg = lang === "bg";
  const int = bg ? fmtInt : fmtIntEn;
  // Names FIRST. They are the reason this description was rewritten, and behind
  // the figures they began past character 160 on three quarters of the pages —
  // below where Google truncates, which is the same as not being there.
  const parts = [
    bg
      ? `Кой получи парите по ${opts.lead}?`
      : `Who received the money under ${opts.lead}?`,
  ];
  if (opts.names.length)
    parts.push(
      bg
        ? `Най-големи получатели: ${opts.names.join(", ")}.`
        : `Largest recipients: ${opts.names.join(", ")}.`,
    );
  parts.push(
    bg
      ? `${int(opts.contracts)} ${opts.contracts === 1 ? "договор" : "договора"} на ${int(opts.beneficiaries)} ${opts.beneficiaries === 1 ? "бенефициент" : "бенефициенти"}, ${compactEur(opts.totalEur, lang)} договорени и ${compactEur(opts.paidEur, lang)} изплатени по данни от ИСУН 2020.`
      : `${int(opts.contracts)} ${opts.contracts === 1 ? "contract" : "contracts"} across ${int(opts.beneficiaries)} ${opts.beneficiaries === 1 ? "beneficiary" : "beneficiaries"}, ${compactEur(opts.totalEur, lang)} contracted and ${compactEur(opts.paidEur, lang)} paid, from the ИСУН 2020 register.`,
  );
  return parts.join(" ");
};

/**
 * An ItemList of the ranked beneficiaries, so the leaders the body renders are
 * machine-readable rather than only visible.
 *
 * Returns [] when there is nothing honest to rank — the same flat-scheme rule
 * `topBeneficiaryNames` applies, because a structured ItemList asserting a
 * "position" over four identical amounts is a stronger claim than the prose
 * version, not a weaker one.
 */
export const beneficiaryItemList = (
  data: FundsTableRows,
  url: string,
  lang: "bg" | "en" = "bg",
  siteUrl = SITE_ORIGIN,
): object[] => {
  const rows = (data.topBeneficiaries ?? [])
    .filter((b) => b?.beneficiaryName)
    .slice(0, 10);
  if (rows.length === 0 || topBeneficiaryNames(data, 3).length === 0) return [];
  return [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: lang === "bg" ? "Най-големи получатели" : "Largest recipients",
      url,
      numberOfItems: rows.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: rows.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Organization",
          name: b.beneficiaryName,
          ...(b.beneficiaryEik
            ? {
                identifier: b.beneficiaryEik,
                // Absolute: a JSON-LD consumer reading this script block has
                // no base IRI, and the HTML table above emits the same link
                // absolute.
                url: `${siteUrl}${lang === "bg" ? "" : "/en"}/company/${b.beneficiaryEik}`,
              }
            : {}),
        },
      })),
    },
  ];
};
