// The documents a company has announced in the Commerce Registry — ГФО, доклад за
// дейността, the чл. 38 no-activity declaration, устав, покани — on /company/:eik.
// Source: tr_announced_act (205) via /api/db/company-filings; each row links to the
// registry's own PDF (portal.registryagency.bg/CR/api/Documents/{ActID}).
//
// ⚠️ ABSENCE IS NOT NON-FILING, and the tile says so on every render. The index is built
// from the TR daily feed, which stopped listing ГФО on 2026-10-12 (ДВ бр. 92/2026 moved
// it into a separate stream), plus per-company registry captures. So a year missing here
// can be a year the company filed and we have not indexed — the tile never renders a
// „не е подал" claim, only what was announced, with the window it covers.
//
// Self-hides on an empty list: for a company with no indexed acts, an empty card would
// read as „filed nothing", which is the one claim this source cannot support.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";

export type FilingFamily = "gfo" | "report" | "declaration" | "other";

export interface FilingAct {
  actId: string;
  kind: string;
  family: FilingFamily;
  fiscalYear: number | null;
  description: string | null;
  announcedOn: string | null;
  firstSeenFeedDay: string | null;
  erased: boolean | null;
}

export interface CompanyFilings {
  acts: FilingAct[];
  inCr: boolean;
  coverage: {
    feedFrom: string | null;
    feedTo: string | null;
    feedGfoTo: string | null;
  } | null;
}

const useCompanyFilings = (eik: string) =>
  useQuery({
    queryKey: ["company-filings", eik] as const,
    queryFn: async (): Promise<CompanyFilings> => {
      const r = await fetch(
        `/api/db/company-filings?eik=${encodeURIComponent(eik)}`,
      );
      if (!r.ok) throw new Error(`company-filings failed: ${r.status}`);
      return (await r.json()) as CompanyFilings;
    },
    staleTime: Infinity,
  });

export const documentUrl = (actId: string) =>
  `https://portal.registryagency.bg/CR/api/Documents/${actId}`;

const fmtDate = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null;

/** The date to show beside an act: the announcement, else the day our feed first saw it. */
const actDate = (a: FilingAct, bg: boolean): string | null => {
  if (a.announcedOn) return fmtDate(a.announcedOn);
  const seen = fmtDate(a.firstSeenFeedDay);
  return seen ? (bg ? `в регистъра към ${seen}` : `listed by ${seen}`) : null;
};

const FAMILIES: Exclude<FilingFamily, "other">[] = [
  "gfo",
  "report",
  "declaration",
];

const familyLabel = (f: FilingFamily, bg: boolean) =>
  ({
    gfo: bg ? "Финансов отчет" : "Financial statements",
    report: bg ? "Доклад за дейността" : "Activity report",
    declaration: bg ? "Декларация по чл. 38" : "Art. 38 declaration",
    other: bg ? "Друго" : "Other",
  })[f];

export type YearRow = {
  year: number | null;
  byFamily: Record<Exclude<FilingFamily, "other">, FilingAct[]>;
};

/** Group the annual-reporting family by fiscal year, newest first; no-year acts last. */
export const groupByYear = (acts: FilingAct[]): YearRow[] => {
  const rows = new Map<number | null, YearRow>();
  for (const a of acts) {
    if (a.family === "other") continue;
    let r = rows.get(a.fiscalYear);
    if (!r) {
      r = {
        year: a.fiscalYear,
        byFamily: { gfo: [], report: [], declaration: [] },
      };
      rows.set(a.fiscalYear, r);
    }
    r.byFamily[a.family].push(a);
  }
  return [...rows.values()].sort((x, y) =>
    x.year == null ? 1 : y.year == null ? -1 : y.year - x.year,
  );
};

// A description that only restates the year („за 2008 г.", „Годишен финансов отчет 2016")
// says nothing the row does not; one that names the component („ОПР", „Баланс",
// „Одиторски доклад") is what tells a split filing's links apart.
const YEAR_ONLY =
  /^(за\s*)?((19|20)\d\d)\s*г?\.?$|^годишен финансов отчет\s*(за\s*)?((19|20)\d\d)\s*(г\.?)?$/i;

const named = (a: FilingAct): string | null => {
  const d = a.description?.trim();
  return d && !YEAR_ONLY.test(d) ? d : null;
};

/** Link text: the component name when the filing gives one, else PDF — numbered among
 *  the cell's unnamed links when there are several. */
export const actLabel = (a: FilingAct, cell: FilingAct[]): string => {
  const name = named(a);
  if (name) return name;
  const unnamed = cell.filter((x) => !named(x));
  return unnamed.length > 1 ? `PDF ${unnamed.indexOf(a) + 1}` : "PDF";
};

const YEARS_PREVIEW = 6;
const OTHER_PREVIEW = 5;

const ActLink: FC<{ act: FilingAct; bg: boolean; label?: string }> = ({
  act,
  bg,
  label,
}) => {
  const date = actDate(act, bg);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <a
        href={documentUrl(act.actId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-accent hover:underline"
        title={act.description ?? act.kind}
      >
        {label ?? "PDF"}
        <ExternalLink className="h-3 w-3" />
      </a>
      {date && <span className="text-xs text-muted-foreground">{date}</span>}
    </span>
  );
};

export const CompanyFilingsView: FC<{ data: CompanyFilings }> = ({ data }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [allYears, setAllYears] = useState(false);
  const [allOther, setAllOther] = useState(false);

  const years = useMemo(() => groupByYear(data.acts), [data.acts]);
  const other = useMemo(
    () => data.acts.filter((a) => a.family === "other"),
    [data.acts],
  );

  if (data.acts.length === 0) return null;
  const shownYears = allYears ? years : years.slice(0, YEARS_PREVIEW);
  const shownOther = allOther ? other : other.slice(0, OTHER_PREVIEW);
  const gfoTo = fmtDate(data.coverage?.feedGfoTo ?? null);
  const feedFrom = fmtDate(data.coverage?.feedFrom ?? null);

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        <h2 className="text-base font-semibold flex-1">
          {bg
            ? "Обявени документи в Търговския регистър"
            : "Documents announced in the Commerce Registry"}
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {data.acts.length}
        </span>
      </div>

      {years.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">
                  {bg ? "Година" : "Year"}
                </th>
                {FAMILIES.map((f) => (
                  <th key={f} className="py-1 pr-3 font-medium">
                    {familyLabel(f, bg)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownYears.map((r) => (
                <tr key={r.year ?? "none"} className="border-t align-top">
                  <td className="py-1.5 pr-3 font-medium tabular-nums">
                    {r.year ?? (bg ? "без година" : "no year")}
                  </td>
                  {FAMILIES.map((f) => (
                    <td key={f} className="py-1.5 pr-3">
                      {r.byFamily[f].length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {r.byFamily[f].map((a, _i, all) => (
                            <ActLink
                              key={a.actId}
                              act={a}
                              bg={bg}
                              label={actLabel(a, all)}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {years.length > YEARS_PREVIEW && (
            <button
              type="button"
              onClick={() => setAllYears((v) => !v)}
              className="mt-2 text-sm text-accent hover:underline"
            >
              {allYears
                ? bg
                  ? "Покажи по-малко"
                  : "Show fewer"
                : bg
                  ? `Покажи всички ${years.length} години`
                  : `Show all ${years.length} years`}
            </button>
          )}
        </div>
      )}

      {other.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            {bg ? "Други обявени актове" : "Other announced acts"} (
            {other.length})
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {shownOther.map((a) => (
              <li
                key={a.actId}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <span className="min-w-0">{a.description ?? a.kind}</span>
                <ActLink act={a} bg={bg} />
              </li>
            ))}
          </ul>
          {other.length > OTHER_PREVIEW && (
            <button
              type="button"
              onClick={() => setAllOther((v) => !v)}
              className="self-start text-sm text-accent hover:underline"
            >
              {allOther
                ? bg
                  ? "Покажи по-малко"
                  : "Show fewer"
                : bg
                  ? `Покажи всички ${other.length}`
                  : `Show all ${other.length}`}
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {bg
          ? `Източник: Агенция по вписванията, Търговски регистър. Списъкът е по обявленията в регистъра${feedFrom ? ` от ${feedFrom}` : ""}${gfoTo ? `; финансовите отчети, обявени след ${gfoTo}, са включени само ако фирмата е проверена в регистъра след тази дата` : ""}. Липсващ отчет тук не означава, че фирмата не го е подала.`
          : `Source: Registry Agency, Commerce Registry. Listed from the registry's announcements${feedFrom ? ` since ${feedFrom}` : ""}${gfoTo ? `; statements announced after ${gfoTo} appear only if the company was checked in the registry since` : ""}. A statement missing here does not mean the company did not file it.`}
      </p>
    </Card>
  );
};

export const CompanyFilingsTile: FC<{ eik: string }> = ({ eik }) => {
  const { data } = useCompanyFilings(eik);
  return data ? <CompanyFilingsView data={data} /> : null;
};
