import {
  validateProcurementQuery,
  encodeProcurementQuery,
  procurementQueryKey,
} from "../../src/lib/procurementQuery";
import type { Envelope } from "../tools/types";
import type { Suggestion } from "./suggestions";
export function procurementContinuations(env: Envelope): Suggestion[] {
  if (
    !env.procurement ||
    !["success", "partial", "empty"].includes(env.procurement.result.status)
  )
    return [];
  const original = env.procurement.query;
  const variants = [
    {
      bg: "Покажи съответстващите записи",
      en: "Show matching records",
      patch: {
        operation: "list",
        groupBy: undefined,
        compareFrom: undefined,
        compareToExclusive: undefined,
      },
    },
    {
      bg: "Разпредели по възложител",
      en: "Group by buyer",
      patch: {
        operation: "rank",
        groupBy: "buyer",
        compareFrom: undefined,
        compareToExclusive: undefined,
      },
    },
    {
      bg: "Покажи по месеци",
      en: "Show by month",
      patch: {
        operation: "trend",
        groupBy: "month",
        compareFrom: undefined,
        compareToExclusive: undefined,
      },
    },
    {
      bg: "Обясни методологията",
      en: "Explain the methodology",
      patch: {
        operation: "methodology",
        groupBy: undefined,
        compareFrom: undefined,
        compareToExclusive: undefined,
      },
    },
  ];
  if (
    ["contracts", "tenders"].includes(original.corpus) &&
    !original.parentQuery &&
    !original.groupBy &&
    original.operation !== "compare"
  )
    variants.push({
      bg: "Покажи свързаните жалби",
      en: "Show linked complaints",
      patch: {
        operation: "list",
        groupBy: undefined,
        compareFrom: undefined,
        compareToExclusive: undefined,
      },
    });
  const seen = new Set([procurementQueryKey(original)]);
  return variants.flatMap((v) => {
    const parentHop = v.en === "Show linked complaints";
    const args = parentHop
      ? {
          corpus: "appeals",
          operation: "list",
          parentQuery: encodeProcurementQuery(original),
        }
      : Object.fromEntries(
          Object.entries({ ...original, ...v.patch, offset: 0 }).filter(
            ([, v]) => v !== undefined,
          ),
        );
    const parsed = validateProcurementQuery(args);
    if (!parsed.ok) return [];
    const key = procurementQueryKey(parsed.query);
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        bg: v.bg,
        en: v.en,
        questionId: "procurement-continuation",
        intent: { tool: "procurementQuery", args: parsed.query },
      },
    ];
  });
}
