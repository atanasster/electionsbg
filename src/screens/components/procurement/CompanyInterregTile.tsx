// Interreg money for one company or institution, on /company/:eik.
//
// TIER L ONLY, AND THAT IS A HARD CEILING, not a gap to be closed later.
// keep.eu's national-id field exists only in the 2021-2027 template: 0 of 1,080
// Bulgarian 2014-2020 partner rows carry one, against 336 of 413. So this tile
// can answer for roughly a third of the corpus and is structurally blind to the
// rest — an organisation active in both periods gets its 2021-2027 half back
// and nothing else. Община Гоце Делчев returns €712,599.55 while seven further
// rows worth €1,665,237.72 sit under the identical partner_name with a NULL eik.
//
// The tile therefore renders `periods` rather than a bare total. A caller that
// sees a 2021-2027 entry and no 2014-2020 one knows the answer is limited by the
// SOURCE, not by the organisation — which is the difference between an honest
// partial and a wrong total. Self-hides when there is nothing linked at all,
// because an empty tile here means "cannot link", not "no money", and a €0
// would assert the second.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

interface InterregCompany {
  partnerCount: number;
  operationCount: number;
  budgetEur: number;
  unpublishedPartnerCount: number;
  periods: Record<string, { operationCount: number; budgetEur: number }>;
  operations: {
    keepId: number;
    programmeBg: string | null;
    period: string;
    titleEn: string;
    titleBg: string | null;
    isLead: boolean;
    budgetEur: number | null;
    startDate: string | null;
  }[];
}

const useInterregCompany = (eik: string | undefined) =>
  useQuery({
    queryKey: ["interreg", "company", eik ?? ""] as const,
    queryFn: async (): Promise<InterregCompany> => {
      const r = await fetch(
        `/api/db/interreg-company?eik=${encodeURIComponent(eik!)}`,
      );
      if (!r.ok) throw new Error(`interreg-company failed: ${r.status}`);
      return (await r.json()) as InterregCompany;
    },
    enabled: !!eik,
    staleTime: Infinity,
  });

export const CompanyInterregTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = bg ? "bg" : "en";
  const { data } = useInterregCompany(eik);

  if (!data || data.operationCount === 0) return null;

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold flex-1">
          {bg
            ? "Трансгранични проекти (Interreg)"
            : "Cross-border projects (Interreg)"}
        </h2>
        <span className="text-sm font-bold tabular-nums">
          {formatEur(data.budgetEur, lang)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {bg
          ? `${numFmt.format(data.operationCount)} проекта по Interreg — програми, ` +
            `които не минават през ИСУН, затова не са в европейските средства по-горе. ` +
            `Сумата е бюджетът на тази организация, не общият бюджет на проектите.`
          : `${numFmt.format(data.operationCount)} Interreg projects — programmes ` +
            `that do not run through ИСУН, so they are absent from the EU-funds ` +
            `figures above. The amount is this organisation's own budget, not the ` +
            `whole-project totals.`}
      </p>

      {/* THE CEILING, stated on the tile rather than left for a reader to
          discover. Without this line an organisation with 2014-2020 Interreg
          money reads as having none. */}
      {/* UNCONDITIONAL. The first draft only showed this when the company's own
          period set was {2021-2027} — which ties a CORPUS-level ceiling to one
          company's data. The moment a single 2014-2020 row gains an EIK, that
          one company loses the caveat while the 2014-2020 arm stays ~0% covered
          for everybody else, and its page becomes the one that overstates. */}
      <p className="text-[10px] text-muted-foreground">
        {bg
          ? "Показаните проекти са само от периода 2021-2027. keep.eu публикува ЕИК " +
            "на партньора единствено за него, така че по-стари проекти на тази " +
            "организация може да съществуват, без да могат да бъдат свързани с нея."
          : "Only 2021-2027 projects are shown. keep.eu publishes a partner's " +
            "national ID for that period alone, so older projects by this " +
            "organisation may exist without being linkable to it."}
      </p>

      <ul className="divide-y text-xs">
        {data.operations.slice(0, 6).map((o) => (
          <li key={o.keepId} className="flex flex-col gap-0.5 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link
                to={`/funds/interreg/${o.keepId}`}
                className="min-w-0 flex-1 font-medium underline"
              >
                {/* keep.eu is English-only for titles; rendering the English
                    one is honest, inventing a Bulgarian one would not be. */}
                {o.titleBg ?? o.titleEn}
              </Link>
              <span className="shrink-0 tabular-nums">
                {o.budgetEur != null
                  ? formatEur(o.budgetEur, lang)
                  : bg
                    ? "без публикуван бюджет"
                    : "no published budget"}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
              <span>{o.programmeBg ?? "—"}</span>
              <span>·</span>
              <span>{o.period}</span>
              {o.isLead ? (
                <>
                  <span>·</span>
                  <span>{bg ? "водещ партньор" : "lead partner"}</span>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-[10px] text-muted-foreground">
        {bg ? "Източник: " : "Source: "}
        <a
          href="https://keep.eu/"
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          keep.eu
        </a>
        {" (INTERACT)"}
      </p>
    </Card>
  );
};
