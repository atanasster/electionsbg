// How each outlet covered ONE subject — the party or person whose archive this
// is.
//
// ⚠️ NEVER A RATING OF THE OUTLET. Every row is scoped to this subject, so
// „pik.bg — преобладаващо негативен" means „pik.bg's coverage OF THIS PARTY",
// which is a different claim from „pik.bg is negative". The heading names the
// subject and the note says so.
//
// ⚠️ THE SUMMARY IS A READING AID AND THE DISTRIBUTION IS THE FACT, so both
// are rendered. A grouped line alone puts „pik.bg · 5" under „преобладаващо
// негативен", which reads as five negative articles when it may be three
// neutral and two negative — the mitigation this file's comments promised
// while rendering no counts at all. `NewsPersonScreen`'s „По издание" block
// already does the right thing (a ToneBar per outlet, „never one inferred tone
// per outlet"); this follows it and adds the scannable summary above it.

import { Link } from "react-router-dom";
import type { OutletBreakdownRow, Tone } from "../data";
import { toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { ToneBar } from "./ToneBar";
import {
  outletGroup,
  outletGroupKey,
  TONE_GROUP_ORDER,
  type OutletGroupKind,
} from "../outletTone";

const FILL: Record<Tone, string> = {
  favorable: "bg-positive",
  neutral: "bg-muted-foreground",
  unfavorable: "bg-negative",
  mixed: "bg-foreground",
};

// The order groups appear in: the three framings, then one-article outlets,
// then the ones we could not summarize, then the ones with no assessment.
const GROUP_ORDER: string[] = [
  ...TONE_GROUP_ORDER.map((tone) => `dominant:${tone}`),
  ...TONE_GROUP_ORDER.map((tone) => `single:${tone}`),
  "split",
  "unassessed",
];

export const OutletBreakdown = ({
  rows,
  subject,
}: {
  rows: OutletBreakdownRow[];
  subject: string;
}) => {
  const { language, tr } = useNewsLocale();
  if (!rows.length) return null;

  const grouped = new Map<
    string,
    { group: OutletGroupKind; outlets: OutletBreakdownRow[] }
  >();
  for (const row of rows) {
    const group = outletGroup(row.counts, row.assessed);
    const key = outletGroupKey(group);
    const entry = grouped.get(key) ?? { group, outlets: [] };
    entry.outlets.push(row);
    grouped.set(key, entry);
  }
  const groups = [...grouped.entries()].sort(
    (a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]),
  );

  const label = (group: OutletGroupKind) => {
    if (group.kind === "unassessed") {
      return tr("без публикувана оценка", "no published assessment");
    }
    if (group.kind === "split") {
      return tr("без преобладаваща рамка", "no single framing");
    }
    const tone = toneMeta(group.tone, language)?.label ?? group.tone;
    // ⚠️ ONE ARTICLE IS NEVER „MOSTLY".
    return group.kind === "single"
      ? tr(`един материал — ${tone}`, `one article — ${tone}`)
      : `${tr("преобладаващо", "mostly")} ${tone}`;
  };

  return (
    <section className="mt-4 border-t pt-3" aria-labelledby="by-outlet">
      <h2 id="by-outlet" className="text-sm font-medium">
        {tr(
          `Кои медии как отразяват ${subject}`,
          `How each outlet covers ${subject}`,
        )}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {tr(
          "Разпределението в материалите на всяко издание за този субект — не оценка на самото издание.",
          "The distribution across each outlet's articles about this subject — not an assessment of the outlet itself.",
        )}{" "}
        <Link
          to="/methodology#archive-aggregates"
          className="underline underline-offset-4"
        >
          {tr("методология", "methodology")}
        </Link>
        .
      </p>

      <ul className="mt-2 space-y-1.5">
        {groups.map(([key, { group, outlets }]) => (
          <li
            key={key}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
          >
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <span
                aria-hidden
                className={`inline-block size-2 rounded-sm ${
                  group.kind === "dominant" || group.kind === "single"
                    ? FILL[group.tone]
                    : "bg-muted"
                }`}
              />
              <span className="text-xs font-medium text-muted-foreground">
                {label(group)}
              </span>
            </span>
            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
              {outlets.map((outlet) => (
                <span key={outlet.domain} className="whitespace-nowrap">
                  {outlet.domain}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <ul className="mt-3 space-y-2 border-t pt-2">
        {rows.map((outlet) => (
          <li key={outlet.domain}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <Link
                to={`/outlet/${outlet.domain}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {outlet.domain}
              </Link>
              <span className="text-xs text-muted-foreground">
                {/* ⚠️ The denominator is spelled out, never a bare „2/5":
                    `rows` is the coverage that exists and `assessed` the part
                    of it carrying a published tone, and a slash says neither. */}
                {tr(
                  `${outlet.assessed} оценени от ${outlet.rows}`,
                  `${outlet.assessed} assessed of ${outlet.rows}`,
                )}
              </span>
            </div>
            <ToneBar counts={outlet.counts} total={outlet.assessed} />
          </li>
        ))}
      </ul>
    </section>
  );
};
