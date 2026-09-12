import {
  ROLLCALL_FOLLOWUPS,
  rollcallContinuation,
} from "../../src/lib/rollcallContinuations";
import {
  validateRollcallQuery,
  encodeRollcallQuery,
} from "../../src/lib/rollcallQuery";
import type { Envelope } from "../tools/types";
import type { Suggestion } from "./suggestions";
export function rollcallContinuations(env: Envelope): Suggestion[] {
  if (!env.rollcall) return [];
  const p = validateRollcallQuery({
    ...env.rollcall.query,
    expectedRevision: env.rollcall.result.revision,
  });
  if (!p.ok) return [];
  const focus = p.query.groupBy
    ? []
    : (env.rollcall.result.rows || [])
        .filter((r) => env.rows?.some((v) => v.key === r.key))
        .map((r) => ({ key: String(r.key) }));
  const result = env.rollcall.result;
  const usable = ["success", "partial"].includes(result.status);
  return ROLLCALL_FOLLOWUPS.flatMap(([id, originalBg, originalEn]) => {
    let bg = originalBg,
      en = originalEn;
    if (!usable && !["F18", "F20"].includes(id)) return [];
    if (
      id === "F11" &&
      ["agreement", "alignment", "contested"].includes(p.query.metric)
    )
      return [];
    if (id === "F17") {
      const total = p.query.groupBy
        ? result.groupCount
        : result.totals?.records;
      if (
        !usable ||
        !result.revision ||
        typeof total !== "number" ||
        p.query.offset + p.query.limit >= total
      )
        return [];
      bg = `Покажи следващите ${p.query.limit}.`;
      en = `Show the next ${p.query.limit}.`;
    }
    if (/\{/.test(en)) return [];
    const r = rollcallContinuation(en, p.query, focus);
    if (!r || r.reason) return [];
    if (
      r.query &&
      encodeRollcallQuery(r.query) === encodeRollcallQuery(p.query) &&
      !["F18", "F20"].includes(id)
    )
      return [];
    return [
      {
        questionId: "rollcall-followup-" + id,
        bg,
        en,
        intent: r.query
          ? {
              tool: "rollcallQuery",
              args: {
                query: encodeRollcallQuery(r.query),
                ...(r.notice ? { notice: r.notice } : {}),
              },
            }
          : {
              tool: "rollcallQuestion",
              args: {
                question: r.question || en,
                previous: encodeRollcallQuery(r.previous || p.query),
                notice: r.notice,
              },
            },
      },
    ];
  });
}
