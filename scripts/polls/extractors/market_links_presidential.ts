import type {
  PollBase,
  PollResidual,
} from "../../../src/data/polls/pollsTypes";
import type { ShareClaim } from "../lib/evidence_gate";

/** Measured against Market Links' November 2021 PDF: each candidate has
 * an all-respondent bar followed by a voter bar. Preserve both denominators. */
export const extractMarketLinksPresidential = (
  text: string,
):
  | {
      wording: string;
      claims: ShareClaim[];
      base: PollBase;
      residual: PollResidual;
      extraEvidence: Record<string, string>;
    }[]
  | null => {
  const heading = /Електорални нагласи\s*[-–]\s*президентски избори/iu.exec(
    text,
  );
  if (!heading) return null;
  const after = text.slice(heading.index + heading[0].length);
  const base = /База:\s*всички\s+(\d+)\s+и\s+гласуващи\s+(\d+)/iu.exec(after);
  if (!base) return null;
  const chart = after.slice(0, base.index);
  if (!/Всички[\s\S]*Гласуващи/u.test(chart)) return null;
  const lines = chart.split(/\r?\n/);
  const name =
    /([А-Я][а-я]+(?:[ \t]+[А-Я][а-я]+){1,2}|Не съм решил|Друг кандидат-президент|Няма да гласувам)[ \t]+(\d{1,3}(?:[.,]\d+)?)%[ \t]*(?:Всички)?[ \t]*$/u;
  const number = (value: string) => Number(value.replace(",", "."));
  const labels = lines.flatMap((line, index) => {
    const match = name.exec(line);
    return match
      ? [
          {
            label: match[1].replace(/\s+/g, " "),
            line: index,
            column: match.index,
          },
        ]
      : [];
  });
  if (labels.length < 2) return null;
  const chartColumn = Math.min(...labels.map((label) => label.column));
  const values = lines.flatMap((line, index) => {
    const match =
      /(\d{1,3}(?:[.,]\d+)?)%[ \t]*(?:Всички|Гласуващи)?[ \t]*$/u.exec(line);
    return match && match.index >= chartColumn
      ? [{ value: number(match[1]), line: index }]
      : [];
  });
  // Labels are vertically centered on two bars, and pdftotext may place the
  // label beside either one. Their order and enclosing line positions must
  // agree with exactly two adjacent percentage labels per candidate.
  if (values.length !== labels.length * 2) return null;
  const rows = labels.map((label, i) => {
    const pair = values.slice(i * 2, i * 2 + 2);
    return {
      label: label.label,
      values: pair.map((v) => v.value),
      aligned: label.line >= pair[0].line && label.line <= pair[1].line,
      quote: lines.slice(pair[0].line, pair[1].line + 1).join("\n"),
    };
  });
  if (rows.some((row) => !row.aligned)) return null;
  if (
    !["Не съм решил", "Няма да гласувам", "Друг кандидат-президент"].every(
      (label) => rows.some((row) => row.label === label),
    )
  )
    return null;
  if (
    rows.length < 2 ||
    new Set(rows.map((r) => r.label)).size !== rows.length ||
    rows.some((r) => r.values.some((v) => v > 100))
  )
    return null;
  // This measured chart publishes an exhaustive set including undecided and
  // non-voters. A missing/misread row cannot silently become a partial series.
  if (
    [0, 1].some(
      (column) =>
        Math.abs(rows.reduce((sum, r) => sum + r.values[column], 0) - 100) > 1,
    )
  )
    return null;
  return [0, 1].map((column) => ({
    wording: heading[0],
    extraEvidence: {
      base: base[0],
      ...Object.fromEntries(
        rows
          .filter((r) =>
            [
              "Не съм решил",
              "Няма да гласувам",
              "Друг кандидат-президент",
            ].includes(r.label),
          )
          .map((r) => [`residual:${r.label}`, r.quote]),
      ),
    },
    base: {
      kind: column === 0 ? "all_respondents" : "likely_voters",
      label:
        column === 0
          ? { bg: "Всички", en: "All respondents" }
          : { bg: "Гласуващи", en: "Voters" },
      respondents: Number(base[column + 1]),
      includesNone: null,
    },
    residual: {
      undecided:
        rows.find((r) => r.label === "Не съм решил")?.values[column] ?? null,
      wontVote:
        rows.find((r) => r.label === "Няма да гласувам")?.values[column] ??
        null,
      wontSay: null,
      otherNamedMinor:
        rows.find((r) => r.label === "Друг кандидат-президент")?.values[
          column
        ] ?? null,
    },
    claims: rows
      .filter(
        (r) =>
          ![
            "Не съм решил",
            "Няма да гласувам",
            "Друг кандидат-президент",
          ].includes(r.label),
      )
      .map((r) => ({
        label: r.label,
        value: r.values[column],
        quote: r.quote,
      })),
  }));
};
