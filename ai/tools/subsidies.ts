// Farm-subsidy (ДФ „Земеделие" / CAP) tools. DB-backed off the agri_payloads
// blobs the /subsidies pack serves (functions/db_routes.js → `agri-payload`):
//   • 'overview' (key '' latest / 'all' / '<year>') — national picture
//   • 'recipient' (key = eik) — one legal entity's subsidy rollup
// Amounts are already EUR. Mirrors the fiscal tools' Envelope shape.

import { fetchDb } from "./dataClient";
import { cleanCompany } from "./fiscal";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import type { ToolArgs, ToolContext, Envelope } from "./types";

interface AgriOverview {
  scope: string;
  scopeYear: number | null;
  years: number[];
  headline: {
    totalEur: number;
    entityCount: number;
    individualCount: number;
    topScheme: { scheme: string; totalEur: number } | null;
  };
  byScheme: {
    scheme: string;
    desc?: string;
    totalEur: number;
    share: number;
  }[];
  concentration: {
    entityCount: number;
    top10Share: number;
    top100Share: number;
    top1000Share: number;
  };
  topRecipients: {
    eik: string;
    name: string;
    oblast: string;
    totalEur: number;
  }[];
}

interface AgriRecipient {
  eik: string;
  name: string;
  oblast: string;
  totalEur: number;
  paymentCount: number;
  firstYear: number;
  lastYear: number;
  byYear: { year: number; totalEur: number }[];
  byScheme: { scheme: string; totalEur: number }[];
}

// A general "farm subsidies" question wants the big picture → default to the
// all-years aggregate; a specific year narrows to that CAP financial year.
const scopeKey = (args: ToolArgs): { key: string; label: string } => {
  const y = Number(args.year);
  if (Number.isFinite(y) && y >= 2015)
    return { key: String(y), label: String(y) };
  return { key: "all", label: "" };
};

const scopeLabel = (label: string, lang: "bg" | "en"): string =>
  label
    ? lang === "bg"
      ? `финансова година ${label}`
      : `financial year ${label}`
    : lang === "bg"
      ? "всички години"
      : "all years";

// ---- national overview -------------------------------------------------------
export const subsidiesOverview = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const { key, label } = scopeKey(args);
  const o = await fetchDb<AgriOverview | null>("agri-payload", {
    kind: "overview",
    key,
  });
  if (!o) {
    return {
      tool: "subsidiesOverview",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за субсидии" : "No subsidy data",
      facts: {},
      viz: "none",
      provenance: ["db:agri-payload"],
    };
  }
  const sc = scopeLabel(label, bg ? "bg" : "en");
  const top = o.topRecipients.slice(0, 8);
  return {
    tool: "subsidiesOverview",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Земеделски субсидии (ДФ „Земеделие") — ${sc}`
      : `Farm subsidies (State Fund Agriculture) — ${sc}`,
    subtitle: bg
      ? "Топ получатели (юридически лица; държавни интервенции изключени)"
      : "Top recipients (legal entities; state interventions excluded)",
    columns: [
      { key: "name", label: bg ? "Получател" : "Recipient" },
      { key: "oblast", label: bg ? "Област" : "Region" },
      { key: "total", label: bg ? "Общо" : "Total", numeric: true },
    ],
    rows: top.map((r) => ({
      name: r.name,
      oblast: r.oblast || "—",
      total: fmtEurCompact(r.totalEur, ctx.lang),
    })),
    viz: "none",
    facts: {
      paid: fmtEurCompact(o.headline.totalEur, ctx.lang),
      recipients: fmtInt(
        o.headline.entityCount + o.headline.individualCount,
        ctx.lang,
      ),
      companies: fmtInt(o.headline.entityCount, ctx.lang),
      individuals: fmtInt(o.headline.individualCount, ctx.lang),
      // The cohort sizes ride along as facts so the narrator can name them
      // without introducing a number of its own (narrate.ts's contract).
      top100Count: fmtInt(100, ctx.lang),
      top100Share: fmtPct(o.concentration.top100Share, ctx.lang),
      top1000Count: fmtInt(1000, ctx.lang),
      top1000Share: fmtPct(o.concentration.top1000Share, ctx.lang),
      biggestScheme: o.headline.topScheme?.scheme ?? "—",
      biggestRecipient: top[0]?.name ?? "—",
      scope: sc,
    },
    provenance: ["db:agri-payload"],
  };
};

// ---- by scheme ---------------------------------------------------------------
export const subsidiesByScheme = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const { key, label } = scopeKey(args);
  const o = await fetchDb<AgriOverview | null>("agri-payload", {
    kind: "overview",
    key,
  });
  const sc = scopeLabel(label, bg ? "bg" : "en");
  if (!o || !o.byScheme.length) {
    return {
      tool: "subsidiesByScheme",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни по схема" : "No by-scheme data",
      facts: {},
      viz: "none",
      provenance: ["db:agri-payload"],
    };
  }
  return {
    tool: "subsidiesByScheme",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Земеделски субсидии по схема — ${sc}`
      : `Farm subsidies by scheme — ${sc}`,
    columns: [
      { key: "scheme", label: bg ? "Схема / интервенция" : "Scheme" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows: o.byScheme.slice(0, 10).map((s) => ({
      scheme: s.desc || s.scheme,
      amount: fmtEurCompact(s.totalEur, ctx.lang),
      share: fmtPct(s.share, ctx.lang),
    })),
    categories: o.byScheme.slice(0, 10).map((s) => s.desc || s.scheme),
    series: [
      {
        key: "amount",
        label: bg ? "Сума (€)" : "Amount (€)",
        points: o.byScheme
          .slice(0, 10)
          .map((s) => ({ x: s.desc || s.scheme, y: Math.round(s.totalEur) })),
      },
    ],
    viz: "bar",
    facts: {
      biggestScheme: o.byScheme[0]?.desc || o.byScheme[0]?.scheme || "—",
      biggestAmount: fmtEurCompact(o.byScheme[0]?.totalEur ?? 0, ctx.lang),
      scope: sc,
    },
    provenance: ["db:agri-payload"],
  };
};

// ---- one recipient's subsidies ----------------------------------------------
export const subsidiesForEntity = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.company ?? args.person ?? args.eik ?? "").trim();
  const notFound = (): Envelope => ({
    tool: "subsidiesForEntity",
    domain: "fiscal",
    kind: "scalar",
    title: bg
      ? `Не намерих земеделски субсидии за „${raw}"`
      : `No farm subsidies found for “${raw}”`,
    subtitle: bg
      ? "Само юридически лица с ЕИК; физическите лица не се свързват по име."
      : "Legal entities with an EIK only; individuals aren't linked by name.",
    facts: {},
    viz: "none",
    provenance: ["db:agri_subsidies"],
  });
  if (!raw) return notFound();

  // Resolve to an EIK: a bare 9–13-digit token, else a name search on the
  // subsidy corpus (top match by total, legal entities only carry an eik). The
  // router may hand over the whole question, so strip filler like contractSearch.
  const cleaned = cleanCompany(raw);
  let eik = /^\d{9,13}$/.test(raw)
    ? raw
    : /^\d{9,13}$/.test(cleaned)
      ? cleaned
      : undefined;
  if (!eik && cleaned) {
    const page = await fetchDb<{ rows: { eik: string | null }[] }>("table", {
      q: JSON.stringify({
        resource: "agri_subsidies",
        page: 0,
        pageSize: 1,
        sort: [{ id: "total_eur", desc: true }],
        filters: { global: cleaned },
      }),
    });
    eik = page.rows?.find((r) => r.eik)?.eik ?? undefined;
  }
  if (!eik) return notFound();

  const r = await fetchDb<AgriRecipient | null>("agri-payload", {
    kind: "recipient",
    key: eik,
  });
  if (!r) return notFound();

  return {
    tool: "subsidiesForEntity",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? `${r.name} — земеделски субсидии`
      : `${r.name} — farm subsidies`,
    subtitle: bg
      ? `от ДФ „Земеделие" · ${r.firstYear}–${r.lastYear}`
      : `from the State Fund Agriculture · ${r.firstYear}–${r.lastYear}`,
    categories: r.byYear.map((y) => y.year),
    series: [
      {
        key: "subsidies",
        label: bg ? "Субсидии (€)" : "Subsidies (€)",
        points: r.byYear.map((y) => ({
          x: y.year,
          y: Math.round(y.totalEur),
        })),
      },
    ],
    viz: "bar",
    facts: {
      recipient: r.name,
      eik: r.eik,
      oblast: r.oblast || "—",
      total: fmtEurCompact(r.totalEur, ctx.lang),
      payments: fmtInt(r.paymentCount, ctx.lang),
      period: `${r.firstYear}–${r.lastYear}`,
      topScheme: r.byScheme[0]?.scheme ?? "—",
    },
    provenance: ["db:agri-payload"],
  };
};
