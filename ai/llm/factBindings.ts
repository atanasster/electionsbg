import { digitRuns } from "./grounding";
// Focused field/value checks for observed civic-data failure modes. This does
// not parse arbitrary prose or prove entailment; unmatched syntax is still a
// limitation. Matched claims must use values from their own measure.
const MEASURES = [
  {
    keys: ["assets", "declared_assets", "declared_assets_eur"],
    label: "(?:declared )?assets|актив(?:и|ите)",
  },
  {
    keys: ["debts", "declared_debts", "declared_debts_eur"],
    label: "(?:declared )?debts|задължени(?:я|ята)|пасив(?:и|ите)",
  },
  {
    keys: ["paid", "paid_amount", "paid_amount_eur"],
    label: "(?:the )?paid(?: amount)?|(?:из)?платената сума",
  },
];
export function factBindingsGrounded(prose: string, facts: unknown): boolean {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return true;
  const f = facts as Record<string, unknown>;
  for (const { keys, label } of MEASURES) {
    const values = keys
      .filter((k) => Object.prototype.hasOwnProperty.call(f, k))
      .map((k) => String(f[k]));
    if (!values.length) continue;
    const allowed = new Set(values.flatMap(digitRuns));
    const re = new RegExp(
      `(?<![\\p{L}])(?:${label})\\s+(?:(?:are|were|is|was|of|total|totaled|са|е|бяха|беше)\\s+)?(?:[€$]\\s*)?(\\d(?:[\\d.,\\u00a0\\u202f ]*\\d)?)`,
      "giu",
    );
    for (const m of prose.matchAll(re))
      if (!digitRuns(m[1]).every((v) => allowed.has(v))) return false;
  }
  if (f.turnout !== undefined && f.total_votes !== undefined) {
    if (
      /turnout[^.!?]{0,100}out of[^.!?]{0,60}\bvotes\b|активност[^.!?]{0,100}(?<![\p{L}])от(?![\p{L}])[^.!?]{0,60}(?:гласа|действителни гласували)/iu.test(
        prose,
      )
    )
      return false;
    if (/\btotal votes cast\b|всички подадени бюлетини/iu.test(prose))
      return false;
  }
  if (
    f.record_basis !== undefined &&
    f.municipalities !== undefined &&
    /\b\d+\s+(?:budget )?transfers\s+(?:distributed|across)|\d+\s+(?:бюджетни )?трансфера/iu.test(
      prose,
    )
  )
    return false;
  return true;
}
