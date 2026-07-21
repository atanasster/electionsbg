// projectLifecycle — the curated procurement project-file (проектно досие) tool
// (§10 Phase 3). Given a flagship slug, returns its grounded honesty summary —
// contracted total, how it was awarded (method mix), the top contractors — read
// from the precomputed data/procurement/projects/summaries.json (built offline by
// scripts/procurement/build_project_members.ts, the same money fold the dossier
// page shows). Numbers only come from the payload; the narrator never invents one.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type Summary = {
  title: { bg?: string; en?: string };
  thesis?: { bg?: string; en?: string };
  contractedEur: number;
  contractCount: number;
  procedureCount: number;
  contractorCount: number;
  methodMix: {
    competitive: number;
    nonCompetitive: number;
    unspecified: number;
  };
  topContractors: Array<{ name: string; eik?: string; eur: number }>;
};

// Prefer the requested language, then the other; treat a present-but-empty
// string as absent so an empty t.bg falls through to t.en (FINDING-004).
const loc = (t: { bg?: string; en?: string } | undefined, bg: boolean) =>
  [bg ? t?.bg : t?.en, bg ? t?.en : t?.bg].find(Boolean) ?? "";

export const projectLifecycle = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const summaries: Record<string, Summary> =
    (await fetchData<Record<string, Summary>>(
      "/procurement/projects/summaries.json",
    ).catch(() => ({}) as Record<string, Summary>)) ?? {};
  const slug = String(args.project ?? "").trim();
  const s = summaries[slug];

  // No (or unknown) slug → list the available curated dossiers.
  if (!s) {
    const slugs = Object.keys(summaries);
    return {
      tool: "projectLifecycle",
      domain: "fiscal",
      kind: "table",
      title: bg ? "Проектни досиета (Наясно)" : "Project files (Наясно)",
      subtitle: bg
        ? "Изберете досие по неговия идентификатор (slug)"
        : "Pick a file by its slug",
      columns: [
        { key: "slug", label: "slug" },
        { key: "name", label: bg ? "Проект" : "Project" },
        {
          key: "contracted",
          label: bg ? "Договорено" : "Contracted",
          numeric: true,
        },
      ],
      rows: Object.entries(summaries).map(([k, v]) => ({
        slug: k,
        name: loc(v.title, bg),
        contracted: fmtEurCompact(v.contractedEur, ctx.lang),
      })),
      viz: "none",
      facts: { count: fmtInt(slugs.length, ctx.lang) },
      provenance: ["data:procurement/projects/summaries.json"],
    };
  }

  const total = s.contractedEur || 1;
  // fmtPct expects a 0–100 value (the tool-wide convention), so scale each ratio
  // to a one-decimal percent of the contracted total before formatting.
  const pct = (part: number) =>
    fmtPct(Math.round((part / total) * 1000) / 10, ctx.lang);
  return {
    tool: "projectLifecycle",
    domain: "fiscal",
    kind: "table",
    title: `${loc(s.title, bg)} — ${bg ? "проектно досие" : "project file"}`,
    subtitle: loc(s.thesis, bg) || undefined,
    columns: [
      { key: "name", label: bg ? "Изпълнител" : "Contractor" },
      { key: "eur", label: bg ? "Стойност" : "Value", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows: s.topContractors.map((c) => ({
      name: c.name,
      eur: fmtEurCompact(c.eur, ctx.lang),
      share: pct(c.eur),
    })),
    viz: "none",
    facts: {
      contracted: fmtEurCompact(s.contractedEur, ctx.lang),
      contracts: fmtInt(s.contractCount, ctx.lang),
      procedures: fmtInt(s.procedureCount, ctx.lang),
      contractors: fmtInt(s.contractorCount, ctx.lang),
      // How it was awarded — the honesty axis. Three separate shares of the
      // contracted total, mirroring the dossier page's открита / без открита /
      // неуточнен strip. `unspecified` (blank procurement_method) is its OWN
      // bucket — never folded into noOpenShare — so the narrator can't assert
      // "no open tender" over money whose method is simply unknown (FINDING-001).
      openShare: pct(s.methodMix.competitive),
      noOpenShare: pct(s.methodMix.nonCompetitive),
      unspecifiedShare: pct(s.methodMix.unspecified),
      topContractor: s.topContractors[0]?.name ?? "—",
      topContractorShare: s.topContractors[0]
        ? pct(s.topContractors[0].eur)
        : "—",
      url: `/procurement/project/${slug}`,
    },
    provenance: ["data:procurement/projects/summaries.json"],
  };
};
