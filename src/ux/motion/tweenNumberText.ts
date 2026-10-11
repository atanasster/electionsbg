// Tween between two ALREADY-FORMATTED figures — „€3,3 млрд." → „€12,1 млрд." — without
// knowing the locale that formatted them.
//
// The KPI band receives strings, not numbers (`HubKpi.value` is "already formatted and
// localized"), and re-plumbing every hub to pass a raw value plus a formatter would touch
// thirteen callers for a 480 ms effect. So the figure's own text is the template: the one
// numeric run is read, its separators classified, and intermediate frames are re-emitted in
// the same shape.
//
// ⚠️ IT REFUSES RATHER THAN GUESSES, and a refusal is a SNAP, never a wrong number. Every
// ambiguity returns null and the caller swaps the text instantly:
//   · prefix or suffix differs   — „€930 млн." → „€1,2 млрд." changes UNIT; rolling the
//                                  digits across it would show „€540 млрд." on the way down;
//   · not exactly one numeric run — „2019–2023" has two;
//   · a lone „,"/„." before exactly three digits — „1,234" is 1234 in en and 1.234 in bg —
//     unless the caller passes the locale's decimal separator, which settles it;
//   · the fraction length differs — the two figures were rounded to different precisions.
// And whatever the frames show, t = 1 returns the target string VERBATIM, so the settled
// figure is always exactly what the caller formatted.

/** The decimal separator of the locale that formatted the figure: „," for bg, „." for en. */
export type DecimalSep = "," | ".";

/** Integer length at which each locale starts grouping thousands: en groups „1,234", bg
 *  leaves „1234" and groups „12 345". */
const GROUP_FROM: Record<DecimalSep, number> = { ".": 4, ",": 5 };

const WS_SEP = new Set([" ", "\u00a0", "\u202f"]);

/** One digit run with optional internal single-char separators. */
const RUN = /\d(?:[\d \u00a0\u202f.,]*\d)?/g;

interface Parsed {
  prefix: string;
  suffix: string;
  int: string;
  frac: string;
  decimalSep: string | null;
  groupSep: string | null;
  /** Whether the integer part was printed with group separators. */
  grouped: boolean;
}

const parse = (text: string, decimalHint?: DecimalSep): Parsed | null => {
  const runs = [...text.matchAll(RUN)];
  if (runs.length !== 1) return null;
  const m = runs[0];
  const run = m[0];
  const prefix = text.slice(0, m.index);
  const suffix = text.slice(m.index! + run.length);

  const groups = run.split(/[^\d]/);
  const seps = run.match(/[^\d]/g) ?? [];
  if (groups.some((g) => g === "")) return null; // two separators in a row

  if (seps.length === 0)
    return {
      prefix,
      suffix,
      int: run,
      frac: "",
      decimalSep: null,
      groupSep: null,
      grouped: false,
    };

  const last = seps[seps.length - 1];
  const lastGroup = groups[groups.length - 1];
  const before = seps.slice(0, -1);

  let decimalSep: string | null;
  let groupSeps: string[];
  if (lastGroup.length !== 3) {
    decimalSep = last;
    groupSeps = before;
  } else if (WS_SEP.has(last)) {
    decimalSep = null;
    groupSeps = seps;
  } else if (before.length > 0 && before.every((s) => s === last)) {
    decimalSep = null;
    groupSeps = seps;
  } else if (before.length > 0) {
    decimalSep = last;
    groupSeps = before;
  } else if (decimalHint) {
    decimalSep = last === decimalHint ? last : null;
    groupSeps = decimalSep ? [] : seps;
  } else {
    return null; // „1,234" — locale-ambiguous
  }

  const groupSep = groupSeps[0] ?? null;
  if (groupSeps.some((s) => s !== groupSep)) return null;
  if (groupSep !== null && groupSep === decimalSep) return null;

  const intGroups = decimalSep ? groups.slice(0, -1) : groups;
  // Grouping must be the ordinary thousands shape: a 1–3 digit head, then threes.
  if (intGroups.length > 1) {
    if (intGroups[0].length > 3) return null;
    if (intGroups.slice(1).some((g) => g.length !== 3)) return null;
  }
  return {
    prefix,
    suffix,
    int: intGroups.join(""),
    frac: decimalSep ? lastGroup : "",
    decimalSep,
    groupSep,
    grouped: intGroups.length > 1,
  };
};

const groupDigits = (int: string, sep: string): string =>
  int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** An interpolator over eased progress `t` ∈ [0, 1], or null when the two figures are not
 *  safely tweenable — in which case the caller should swap the text instantly. */
export const tweenNumberText = (
  from: string,
  to: string,
  decimalHint?: DecimalSep,
): ((t: number) => string) | null => {
  if (from === to) return null;
  const a = parse(from, decimalHint);
  const b = parse(to, decimalHint);
  if (!a || !b) return null;
  if (a.prefix !== b.prefix || a.suffix !== b.suffix) return null;
  if (a.frac.length !== b.frac.length) return null;
  const decimalSep = a.decimalSep ?? b.decimalSep;
  if (a.decimalSep && b.decimalSep && a.decimalSep !== b.decimalSep)
    return null;
  if (a.groupSep && b.groupSep && a.groupSep !== b.groupSep) return null;
  const groupSep = a.groupSep ?? b.groupSep;

  // When does an intermediate frame get grouped? With a locale hint, the locale's own
  // threshold. Without one, learn it from the two endpoints: the shortest integer printed WITH
  // grouping, unless an endpoint printed a longer one WITHOUT (bg leaves 4-digit integers
  // ungrouped, en does not).
  const groupedLens = [a, b].filter((p) => p.grouped).map((p) => p.int.length);
  const ungroupedLens = [a, b]
    .filter((p) => !p.grouped)
    .map((p) => p.int.length);
  let minGroupLen = groupedLens.length ? Math.min(...groupedLens) : Infinity;
  for (const l of ungroupedLens) if (l >= minGroupLen) minGroupLen = l + 1;
  if (decimalHint) minGroupLen = GROUP_FROM[decimalHint];

  const k = b.frac.length;
  const scale = Math.pow(10, k);
  const va = Number(a.int + a.frac);
  const vb = Number(b.int + b.frac);
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;

  return (t: number) => {
    if (t >= 1) return to;
    if (t <= 0) return from;
    const scaled = Math.round(va + (vb - va) * t);
    const intPart = Math.floor(scaled / scale).toString();
    const fracPart = k ? (scaled % scale).toString().padStart(k, "0") : "";
    const intText =
      groupSep && intPart.length >= minGroupLen
        ? groupDigits(intPart, groupSep)
        : intPart;
    return `${b.prefix}${intText}${k ? `${decimalSep}${fracPart}` : ""}${b.suffix}`;
  };
};
