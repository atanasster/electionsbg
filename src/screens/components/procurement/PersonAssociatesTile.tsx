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

export interface Associate {
  name: string;
  shared: number;
  companies: { eik: string; name: string | null }[];
}

const num = new Intl.NumberFormat("bg-BG");

export const PersonAssociatesTile: FC<{ associates: Associate[] }> = ({
  associates,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  if (associates.length === 0) return null;

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
                    to={`/db/company/${c.eik}`}
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
