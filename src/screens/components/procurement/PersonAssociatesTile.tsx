// Inner circle for the DB person page — the people who co-appear as officers
// across THIS person's companies (person_associates), ranked by the number of
// shared firms. The person's business partners / co-directors: the network view
// no plain officer table exposes. Each associate links to their own /person page
// and lists the shared companies (→ /db/company). Company-entity officers are
// filtered server-side, so these read as people. Name-only match — a lead, not
// proof (namesakes collapse), same caveat as the rest of the page.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { decodeEntities } from "@/lib/decodeEntities";
import { EvidenceBasis } from "./EvidenceBasis";

export interface Associate {
  name: string;
  shared: number;
  companies: { eik: string; name: string | null }[];
}

const num = new Intl.NumberFormat("bg-BG");

/** `person_associates` (024_person_api.sql) ends in `LIMIT 20`, so a list AT that length
 *  is a truncation the reader cannot see — there is no total beside it and no drill-in.
 *  Below it the list is complete, and saying "up to 20" then would understate what the
 *  page actually knows. Hence the cap is named only when it binds. */
const ASSOCIATE_LIMIT = 20;

export const PersonAssociatesTile: FC<{ associates: Associate[] }> = ({
  associates,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  if (associates.length === 0) return null;
  const atLimit = associates.length >= ASSOCIATE_LIMIT;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4" />
          {bg ? "Кръг от партньори" : "Inner circle"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {bg
              ? "Лица, съуправляващи или съсобственици в общи фирми"
              : "People who co-run or co-own the same companies"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {/* ⚠️ Do NOT restore a "mass nominees are excluded" claim here. `person_associates`
            joins `officer_name_counts … company_count <= 300`, and 024's own comment calls
            that a mega-hub cut — but measured 2026-08-25 the predicate excludes exactly ONE
            name-fold corpus-wide, and it is not a person: „Заличено обстоятелство." (4,383),
            the registry's deleted-fact placeholder. The real nominees sit at 292 / 285 / 251
            (98 folds between 100 and 300) and all PASS, so they render here as this person's
            partners. The filter must stay — the entity-name regexes below it do not match the
            placeholder, so the count cut is the only thing keeping it out of every list — but
            the copy may only claim what it actually does. The tile whose job is to calibrate
            trust in a list must not overstate how clean the list is. */}
        <EvidenceBasis>
          {bg
            ? "Основа: съвместно вписване в Търговския регистър. Изключени са само служебните записи на регистъра (напр. „Заличено обстоятелство.“). Лица, вписани в стотици фирми — регистрирани агенти и пълномощници — може да се появят тук като партньори."
            : "Basis: co-entry in the Commerce Registry. Only the registry's own bookkeeping entries (e.g. „Заличено обстоятелство.“) are excluded — people entered in hundreds of companies, such as registered agents and nominees, can still appear here as partners."}
          {atLimit
            ? bg
              ? ` Показани са първите ${num.format(ASSOCIATE_LIMIT)} по брой общи фирми — възможно е да има още.`
              : ` Showing the top ${num.format(ASSOCIATE_LIMIT)} by shared companies — there may be more.`
            : null}
        </EvidenceBasis>
        <ul className="divide-y divide-border rounded-md border bg-card">
          {associates.map((a) => (
            <li key={a.name} className="px-3 py-2 text-sm">
              <div className="flex items-baseline gap-2">
                <Link
                  to={`/person/${encodeURIComponent(a.name)}`}
                  className="font-medium text-accent hover:underline"
                >
                  {a.name}
                </Link>
                <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {num.format(a.shared)}{" "}
                  {bg
                    ? a.shared === 1
                      ? "обща фирма"
                      : "общи фирми"
                    : a.shared === 1
                      ? "shared company"
                      : "shared companies"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {a.companies.map((c) => (
                  <Link
                    key={c.eik}
                    to={`/company/${c.eik}`}
                    className="hover:text-foreground hover:underline"
                  >
                    {decodeEntities(c.name) || c.eik}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
