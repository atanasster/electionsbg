// „Хора в изданието" — the people this outlet assesses most often, with how it
// frames each of them (news-person-sentiment-v1 §7).
//
// ⚠️ PER (OUTLET, PERSON), NEVER AN OUTLET AVERAGE. Each row is this outlet's
// treatment of one person, ordered by how often it covered them; there is no
// figure for the outlet as a whole.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { usePersonsIndex } from "../data";
import { FreezeBanner } from "./FreezeBanner";
import { useNewsLocale } from "../i18n";
import { displayName, rowFigures } from "../personPage";
import { ToneBuckets } from "./PersonCharts";

const LIMIT = 20;

export const OutletPeople = ({ domain }: { domain: string }) => {
  const { isEnglish, tr } = useNewsLocale();
  const index = usePersonsIndex();
  const rows = (index.data?.persons ?? [])
    .map((r) => ({ r, f: rowFigures(r, domain) }))
    .filter(({ f }) => f.n > 0)
    .sort((a, b) => b.f.n - a.f.n || a.r.id.localeCompare(b.r.id))
    .slice(0, LIMIT);
  // §8.2 — a withheld window says so here too, rather than the section
  // silently disappearing.
  if (!rows.length)
    return index.data?.withheld ? <FreezeBanner stamps={index.data} /> : null;
  return (
    <section aria-labelledby="outlet-people" data-testid="outlet-people">
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="outlet-people" className="text-sm font-medium">
            {tr("Хора в изданието", "People in this outlet")}
          </h2>
          {index.data?.matrix ? (
            <Link
              to={`/persons/media?outlet=${encodeURIComponent(domain)}`}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              {tr("Медиите и хората", "The media and the people")} →
            </Link>
          ) : null}
        </div>
        <FreezeBanner stamps={index.data} className="mt-2" />
        <p className="mt-0.5 text-xs text-muted-foreground">
          {tr(
            "Хората, които изданието отразява най-често, и как ги представя — по човек, никога средно за изданието.",
            "The people this outlet covers most, and how it frames each — per person, never an average for the outlet.",
          )}
        </p>
        <ul className="mt-2 divide-y">
          {rows.map(({ r, f }) => (
            <li
              key={r.id}
              className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,40%)] items-center gap-2 py-1.5 text-sm"
            >
              <Link
                to={`/person/${r.id}?outlet=${encodeURIComponent(domain)}`}
                className="truncate underline-offset-4 hover:underline"
              >
                {displayName(r, isEnglish) ?? r.id}
              </Link>
              <span className="text-right tabular-nums text-muted-foreground">
                {f.n}
              </span>
              <ToneBuckets counts={f.counts} total={f.n} compact />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
