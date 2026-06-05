// Governance — people/oversight tools.

import { fetchData } from "./dataClient";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

type Government = {
  id: string;
  pmBg: string;
  pmEn: string;
  startDate: string;
  endDate: string | null;
  type: string;
  parties: string[];
  partiesEn: string[];
  precedingElection?: string;
};
type GovData = { governments: Government[] };

const yearOf = (d?: string | null) => (d ? d.slice(0, 4) : "—");

export const governments = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const g = await fetchData<GovData>("/governments.json");
  const list = [...g.governments].reverse(); // newest first

  const columns: Column[] = [
    { key: "pm", label: ctx.lang === "bg" ? "Премиер" : "PM" },
    { key: "period", label: ctx.lang === "bg" ? "Период" : "Period" },
    { key: "parties", label: ctx.lang === "bg" ? "Партии" : "Parties" },
  ];
  const rows: Row[] = list.map((gov) => ({
    pm: ctx.lang === "bg" ? gov.pmBg : gov.pmEn,
    period: `${yearOf(gov.startDate)}–${yearOf(gov.endDate)}`,
    parties: (ctx.lang === "bg" ? gov.parties : gov.partiesEn).join(", "),
  }));

  const current = list[0];
  return {
    tool: "governments",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg" ? "Правителства от 2005" : "Governments since 2005",
    columns,
    rows,
    viz: "none",
    facts: {
      count: list.length,
      current_pm: current
        ? ctx.lang === "bg"
          ? current.pmBg
          : current.pmEn
        : "—",
      current_parties: current
        ? (ctx.lang === "bg" ? current.parties : current.partiesEn).join(", ")
        : "—",
    },
    provenance: ["governments.json"],
  };
};
