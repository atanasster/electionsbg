// General Commerce-Registry company lookup for the AI chat. Unlike contractSearch, this
// searches the full ~1M-row company_browse_table, so a company does not need a public contract
// (or any other public-money signal) to be findable by name.

import { fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";
import { legalFormLabel } from "../../src/lib/legalForm";

type CompanyHit = {
  uic: string;
  name: string;
  legalForm: string | null;
  status: string | null;
};

type CompanyRecord = {
  uic: string;
  name: string | null;
  legal_form: string | null;
  seat: string | null;
  subject_of_activity: string | null;
  status: string | null;
  funds_amount: string | number | null;
  funds_currency: string | null;
  entity_class: string | null;
};

type CompanyPayload = {
  company: CompanyRecord | null;
  summary: {
    contracts: number;
    contract_rows?: number;
    contracts_eur: string | number;
  } | null;
  officers: { active: boolean }[];
  funds: {
    contract_count: number | null;
    contracted_eur: string | number | null;
  } | null;
  subsidies: { totalEur?: number | null } | null;
};

type CompanyTable = { rows: CompanyHit[] };

const fold = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("bg")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Accept both a clean model argument and a full fallback-router utterance. */
export const cleanCompanyQuery = (raw: string): string => {
  const quoted = raw.match(/[„“"']([^„“"']{2,})[„“"']/u)?.[1];
  if (quoted) return quoted.trim();
  const afterKind = raw.match(
    /(?:фирма(?:та)?|компания(?:та)?|дружество(?:то)?|company|firm)(?:\s+(?:с\s+име|named))?\s+(.+)$/iu,
  )?.[1];
  return (afterKind ?? raw)
    .replace(
      /^(?:кажи|разкажи|покажи|дай)(?:\s+ми)?\s+(?:информация\s+|данни\s+)?за\s+/iu,
      "",
    )
    .replace(/^(?:tell me about|show me|information about|profile of)\s+/iu, "")
    .replace(/[?!.;,]+$/u, "")
    .trim();
};

const resolveCompany = async (raw: string): Promise<CompanyHit[] | string> => {
  const eik = raw.match(/(?:^|\D)(\d{9,13})(?:\D|$)/)?.[1];
  if (eik) return eik;
  const query = cleanCompanyQuery(raw);
  if ([...query].length < 3) return [];
  const page = await fetchDb<CompanyTable>("table", {
    q: JSON.stringify({
      resource: "companies",
      page: 0,
      pageSize: 6,
      sort: [
        { id: "name", desc: false },
        { id: "uic", desc: false },
      ],
      filters: { global: query, columns: [] },
    }),
  });
  const hits = page.rows ?? [];
  const exact = hits.filter((h) => fold(h.name) === fold(query));
  return exact.length ? exact : hits;
};

const statusLabel = (status: string | null, bg: boolean): string => {
  if (status === "active") return bg ? "активна" : "active";
  if (status === "inactive") return bg ? "неактивна" : "inactive";
  return status || "—";
};

const clipped = (s: string, max = 360): string =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export const companyProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.company ?? "").trim();
  const resolved = await resolveCompany(raw);

  if (Array.isArray(resolved) && resolved.length > 1) {
    return {
      tool: "companyProfile",
      domain: "people",
      kind: "scalar",
      title: bg ? "Коя фирма имате предвид?" : "Which company do you mean?",
      clarify: {
        prompt: bg
          ? `Намерих няколко фирми за „${cleanCompanyQuery(raw)}“.`
          : `I found several companies matching “${cleanCompanyQuery(raw)}”.`,
        options: resolved.map((h) => ({
          label: h.name,
          sublabel: [h.legalForm, `ЕИК ${h.uic}`].filter(Boolean).join(" · "),
          tool: "companyProfile",
          args: { company: h.uic },
        })),
      },
      facts: { query: cleanCompanyQuery(raw) },
      viz: "none",
      provenance: ["db:table/companies"],
    };
  }

  const eik = typeof resolved === "string" ? resolved : resolved[0]?.uic;
  if (!eik) {
    return {
      tool: "companyProfile",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Не намерих фирма „${cleanCompanyQuery(raw)}“`
        : `No company matching “${cleanCompanyQuery(raw)}”`,
      subtitle: bg
        ? "Пробвайте с точно име или ЕИК. Търсенето обхваща целия Търговски регистър."
        : "Try the exact registered name or EIK. The search covers the full Commerce Registry.",
      facts: { query: cleanCompanyQuery(raw) },
      viz: "none",
      provenance: ["db:table/companies"],
    };
  }

  const data = await fetchDb<CompanyPayload>("company", { eik });
  const company = data?.company;
  if (!company) {
    return {
      tool: "companyProfile",
      domain: "people",
      kind: "scalar",
      title: bg ? `Няма профил за ЕИК ${eik}` : `No profile for EIK ${eik}`,
      facts: { eik, eik_id: eik },
      viz: "none",
      provenance: ["db:company"],
    };
  }

  const rows: Row[] = [];
  const legalForm = bg
    ? legalFormLabel(company.legal_form)
    : company.legal_form;
  const add = (metric: string, value: string | number | null | undefined) => {
    if (value != null && value !== "" && value !== "—")
      rows.push({ metric, value });
  };
  add(bg ? "ЕИК" : "EIK", eik);
  add(bg ? "Правна форма" : "Legal form", legalForm);
  add(bg ? "Състояние" : "Status", statusLabel(company.status, bg));
  add(bg ? "Седалище" : "Registered seat", company.seat);
  if (company.funds_amount != null)
    add(
      bg ? "Капитал" : "Registered capital",
      `${company.funds_amount} ${company.funds_currency ?? ""}`.trim(),
    );
  add(
    bg ? "Активни вписани лица" : "Active registered officers",
    (data.officers ?? []).filter((o) => o.active).length,
  );
  if (company.subject_of_activity)
    add(
      bg ? "Предмет на дейност" : "Registered activity",
      clipped(company.subject_of_activity),
    );

  const contracts = Number(data.summary?.contract_rows ?? 0);
  const contractEur = Number(data.summary?.contracts_eur ?? 0);
  if (contracts > 0)
    add(
      bg
        ? "Обществени поръчки като изпълнител"
        : "Public contracts as supplier",
      `${fmtInt(contracts, ctx.lang)} · ${fmtEurCompact(contractEur, ctx.lang)}`,
    );
  const fundContracts = Number(data.funds?.contract_count ?? 0);
  if (fundContracts > 0)
    add(
      bg ? "Договори по европейски програми" : "EU-programme contracts",
      `${fmtInt(fundContracts, ctx.lang)} · ${fmtEurCompact(Number(data.funds?.contracted_eur ?? 0), ctx.lang)}`,
    );
  const subsidyEur = Number(data.subsidies?.totalEur ?? 0);
  if (subsidyEur > 0)
    add(
      bg ? "Земеделски субсидии" : "Farm subsidies",
      fmtEurCompact(subsidyEur, ctx.lang),
    );

  const columns: Column[] = [
    { key: "metric", label: bg ? "Показател" : "Field" },
    { key: "value", label: bg ? "Стойност" : "Value" },
  ];
  return {
    tool: "companyProfile",
    domain: "people",
    kind: "table",
    title: company.name || eik,
    subtitle: bg
      ? `Търговски регистър · ${statusLabel(company.status, true)}`
      : `Commerce Registry · ${statusLabel(company.status, false)}`,
    columns,
    rows,
    cellLinks: [
      {
        row: 0,
        column: "value",
        text: eik,
        href: `/company/${encodeURIComponent(eik)}`,
      },
    ],
    viz: "none",
    facts: {
      company: company.name || eik,
      eik_id: eik,
      legal_form: legalForm || "—",
      status: statusLabel(company.status, bg),
      registered_seat: company.seat || "—",
      active_officers: (data.officers ?? []).filter((o) => o.active).length,
      public_contracts: contracts,
      public_contract_value: fmtEurCompact(contractEur, ctx.lang),
      eu_programme_contracts: fundContracts,
      farm_subsidies: fmtEurCompact(subsidyEur, ctx.lang),
    },
    provenance: ["db:table/companies", "db:company"],
  };
};
