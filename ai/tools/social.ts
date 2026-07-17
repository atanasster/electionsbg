// Социално подпомагане tools — the chat surface for the /sector/social pack. Social
// protection is ~€15bn / 37% of государството, but the group procures ~1% of that, so
// the story is disbursement + poverty outcome, not contracts:
//
//   socialSpending       — the 6-EIK group procurement (МТСП/АСП/АЗ/ГИТ/АХУ/АКСУ) by
//                          function + competition, the chat analog of the pack's tiles.
//   socialBenefits       — the benefits АСП pays households (child allowances,
//                          disability, heating aid, GMI) — recipients × amount.
//   socialPovertyImpact  — the poverty-reduction effect of social transfers, BG vs EU
//                          (Eurostat ilc_li10 before vs ilc_li02 after).
//
// ⚠ PENSIONS (НОИ) ARE A SEPARATE VIEW — they have their own noiFunds / noiPension*
// tools; the router routes пенси|НОИ there before it reaches here. Every fact goes
// through ctx.lang and the tool never computes prose numbers — narrate() reads
// env.facts. Mirrors the transport / МВР tools' Envelope shape.

import { fetchDb, fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";
import type { GroupModelPayload } from "@/lib/awarderModel";
import {
  buildSocialModelFromAggregates,
  categoryLabel,
} from "@/lib/socialAttributes";
import { SOCIAL_SECTOR_EIKS, ASP_EIK } from "@/lib/socialReferenceData";

const pct = (share: number | null, lang: "bg" | "en"): string =>
  fmtPct(share == null ? null : Math.round(share * 100), lang);

// "Къде отиват парите за социално подпомагане?" — the 6-EIK group's procurement folded
// by function, the chat analog of the /sector/social pack's procurement tiles.
export const socialSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const payload = await fetchDb<GroupModelPayload>("awarder-group-model", {
    eiks: SOCIAL_SECTOR_EIKS.join(","),
  });
  const m = buildSocialModelFromAggregates(payload);
  const total = m.totalEur;

  const aspEur = payload.byUnit.find((u) => u.eik === ASP_EIK)?.totalEur ?? 0;

  const cats = [...m.categories]
    .filter((c) => c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur);
  const rows: Row[] = cats.map((c) => ({
    function: categoryLabel(c.id, ctx.lang),
    amount: fmtEurCompact(c.totalEur, ctx.lang),
    share: total > 0 ? pct(c.totalEur / total, ctx.lang) : "—",
  }));

  const topCat = cats.find((c) => c.id !== "other");
  const topCon = m.suppliers[0];

  return {
    tool: "socialSpending",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Социално подпомагане — поръчките на групата (МТСП, АСП, АЗ, ГИТ)"
      : "Social assistance — the group's procurement (МТСП, АСП, АЗ, ГИТ)",
    subtitle: bg
      ? "Обществените поръчки са ~1% от бюджета — помощите към домакинствата са отделно (виж socialBenefits)."
      : "Procurement is ~1% of the budget — the household benefits are separate (see socialBenefits).",
    columns: [
      { key: "function", label: bg ? "Функция" : "Function" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_value: fmtEurCompact(total, ctx.lang),
      contracts: fmtInt(m.contractCount, ctx.lang),
      asp_share: total > 0 ? pct(aspEur / total, ctx.lang) : "—",
      top_function: topCat
        ? `${categoryLabel(topCat.id, ctx.lang)} (${fmtEurCompact(topCat.totalEur, ctx.lang)})`
        : "—",
      single_bid_share: pct(m.singleBidShare, ctx.lang),
      direct_award_share: pct(m.directShare, ctx.lang),
      top_contractor: topCon
        ? `${topCon.name} (${fmtEurCompact(topCon.totalEur, ctx.lang)})`
        : "—",
      note: bg
        ? "Това са само обществените поръчки на групата. Помощите, които АСП плаща на домакинствата (~€2–3 млрд./год.), не са поръчки и не са тук. Пенсиите (НОИ) са отделен изглед."
        : "This is only the group's procurement. The benefits АСП pays households (~€2–3bn/yr) are not procurement and are not here. Pensions (НОИ) are a separate view.",
    },
    provenance: ["db:awarder-group-model"],
  };
};

// ---- benefits.json (АСП годишен отчет) --------------------------------------

interface BenefitsFile {
  latestYear: number;
  eurRate: number;
  families: {
    id: string;
    label: { bg: string; en: string };
    law: string;
    recipientNoun: { bg: string; en: string };
    unit: "annual" | "season";
    series: {
      year: number;
      season?: string;
      recipients?: number;
      households?: number;
      amountBgn: number;
    }[];
  }[];
}

// "Колко изплаща държавата за помощи?" — the benefits АСП pays households, per family:
// € paid × recipients (the UK-DWP spend×caseload framing). National/annual.
export const socialBenefits = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<BenefitsFile>("/social/benefits.json");
  const rate = f.eurRate > 0 ? f.eurRate : 1.95583;

  const rowsData = f.families
    .map((fam) => {
      const latest = [...fam.series].sort((a, b) => a.year - b.year).at(-1);
      if (!latest) return null;
      const recip = latest.recipients ?? latest.households ?? 0;
      return {
        id: fam.id,
        label: bg ? fam.label.bg : fam.label.en,
        noun: bg ? fam.recipientNoun.bg : fam.recipientNoun.en,
        recip,
        eur: Math.round(latest.amountBgn / rate),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => b.eur - a.eur);

  const rows: Row[] = rowsData.map((r) => ({
    benefit: r.label,
    amount: fmtEurCompact(r.eur, ctx.lang),
    recipients: `${fmtInt(r.recip, ctx.lang)} ${r.noun}`,
  }));

  const byId = (id: string) => rowsData.find((r) => r.id === id);
  const disability = byId("disability");
  const heating = byId("heating");
  const child = byId("child");
  const gmi = byId("gmi");
  const factFor = (r: ReturnType<typeof byId>) =>
    r
      ? `${fmtEurCompact(r.eur, ctx.lang)} · ${fmtInt(r.recip, ctx.lang)}`
      : "—";

  return {
    tool: "socialBenefits",
    domain: "fiscal",
    kind: "table",
    title: bg ? "Какво плаща АСП на домакинствата" : "What АСП pays households",
    subtitle: bg
      ? `Помощи по вид — сума и получатели (${f.latestYear} г.). Само национално.`
      : `Benefits by type — amount and recipients (${f.latestYear}). National only.`,
    columns: [
      { key: "benefit", label: bg ? "Помощ" : "Benefit" },
      { key: "amount", label: bg ? "Изплатено" : "Paid", numeric: true },
      { key: "recipients", label: bg ? "Получатели" : "Recipients" },
    ],
    rows,
    viz: "none",
    facts: {
      year: String(f.latestYear),
      disability: factFor(disability),
      heating: factFor(heating),
      child: factFor(child),
      gmi: factFor(gmi),
      note: bg
        ? "Национални годишни данни от годишния отчет на АСП. Разбивка по области не се публикува. Пенсиите (НОИ) са отделен изглед."
        : "National annual figures from the АСП annual report. No per-oblast breakdown is published. Pensions (НОИ) are a separate view.",
    },
    provenance: ["social/benefits.json (АСП годишен отчет)"],
  };
};

// ---- poverty_impact.json (Eurostat ilc_li10 / ilc_li02) ---------------------

interface PovertyFile {
  latestYear: number;
  series: Record<string, { year: number; before: number; after: number }[]>;
  latest: Record<
    string,
    { year: number; before: number; after: number; pp: number; pct: number }
  >;
}

// "Намаляват ли социалните трансфери бедността?" — the poverty-reduction effect of
// transfers, BG vs EU (ilc_li10 before vs ilc_li02 after). The differentiator.
export const socialPovertyImpact = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<PovertyFile>("/social/poverty_impact.json");
  const b = f.latest.BG;
  const eu = f.latest.EU27_2020;
  const bgSeries = (f.series.BG ?? []).sort((a, b) => a.year - b.year);

  return {
    tool: "socialPovertyImpact",
    domain: "indicators",
    kind: "series",
    title: bg
      ? "Социалните трансфери и бедността"
      : "Social transfers and poverty",
    subtitle: bg
      ? "Риск от бедност преди и след трансферите (без пенсии), България"
      : "At-risk-of-poverty before and after transfers (excl. pensions), Bulgaria",
    viz: "line",
    value: b?.pct ?? 0,
    valueFormat: "pct",
    categories: bgSeries.map((p) => p.year),
    series: [
      {
        key: "before",
        label: bg ? "Преди трансфери" : "Before transfers",
        points: bgSeries.map((p) => ({ x: p.year, y: p.before })),
      },
      {
        key: "after",
        label: bg ? "След трансфери" : "After transfers",
        points: bgSeries.map((p) => ({ x: p.year, y: p.after })),
      },
    ],
    facts: {
      year: String(f.latestYear),
      bg_reduction: b ? `${fmtInt(b.pct, ctx.lang)}%` : "—",
      eu_reduction: eu ? `${fmtInt(eu.pct, ctx.lang)}%` : "—",
      bg_before: b ? `${b.before}%` : "—",
      bg_after: b ? `${b.after}%` : "—",
      note: bg
        ? "България сваля бедността с малко — под средното за ЕС. Харчи средно (14,4% от БВП), но постига по-малко на евро. Контекст, не причинно-следствена връзка."
        : "Bulgaria cuts poverty by little — below the EU average. It spends an average share (14.4% of GDP) but achieves less per euro. Context, not causation.",
    },
    provenance: ["social/poverty_impact.json (Eurostat ilc_li10 / ilc_li02)"],
  };
};
