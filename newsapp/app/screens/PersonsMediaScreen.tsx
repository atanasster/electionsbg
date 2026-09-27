// „Медиите и хората" — the outlet × person grid (news-person-sentiment-v1 §7.1).
//
// ⚠️ THIS COMPARES HOW OUTLETS FRAME ONE PERSON — IT DOES NOT RATE OUTLETS.
// Rows are ordered by coverage and columns by outlet volume, never by tone,
// and there is no row or column average anywhere on the page (the payload
// carries none). A cell under five (outlet, story) units shows no colour, and
// every cell leads to the articles behind it.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import {
  usePersonMatrix,
  usePersonsIndex,
  type MatrixPeriod,
  type PersonMatrix,
} from "../data";
import { FreezeBanner } from "../components/FreezeBanner";
import { toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { cellView, offeredPeriods, type MatrixMode } from "../personMatrix";
import { BUCKETS, BUCKET_FILL, displayName } from "../personPage";

const PERIOD_LABEL: Record<"30" | "90" | "all", [string, string]> = {
  "30": ["последните 30 дни", "last 30 days"],
  "90": ["последните 90 дни", "last 90 days"],
  all: ["целия период", "the whole period"],
};

const Cell = ({
  personId,
  personName,
  domain,
  grid,
  rules,
  mode,
}: {
  personId: string;
  personName: string;
  domain: string;
  grid: MatrixPeriod;
  rules: PersonMatrix["rules"];
  mode: MatrixMode;
}) => {
  const { language, tr } = useNewsLocale();
  const cell = grid.cells[personId]?.[domain];
  const view = cellView(cell, mode, rules);
  const n = cell?.n ?? 0;
  const what =
    view.state === "blank"
      ? tr("под 5 материала", "under 5 units")
      : mode === "position"
        ? toneMeta(view.bucket!, language).label
        : view.deviation === -1
          ? tr("по-неблагоприятно от обичайното", "less favourable than usual")
          : view.deviation === 1
            ? tr("по-благоприятно от обичайното", "more favourable than usual")
            : tr("в рамките на обичайното", "within the usual range");
  const label = `${domain} — ${personName}: ${what} · n ${n}`;
  return (
    <Link
      to={`/person/${personId}?outlet=${encodeURIComponent(domain)}`}
      aria-label={label}
      title={label}
      data-testid={`cell-${view.state}`}
      className="relative flex size-7 items-center justify-center rounded-sm border border-border/60 text-[9px] text-muted-foreground"
    >
      {view.state === "blank" ? (
        "·"
      ) : (
        <span
          aria-hidden
          className={`absolute inset-0.5 rounded-[2px] ${view.fill} ${view.state === "hatched" ? "opacity-50" : ""}`}
        />
      )}
    </Link>
  );
};

export const PersonsMediaScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const matrix = usePersonMatrix();
  const index = usePersonsIndex();
  const [mode, setMode] = useState<MatrixMode>("position");
  const [chosen, setChosen] = useState<"30" | "90" | "all" | null>(null);

  if (matrix.error && !matrix.data)
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Медиите и хората", "The media and the people")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "Мрежата още не е публикувана.",
            "The grid is not published yet.",
          )}
        </p>
        <FreezeBanner stamps={index.data} className="mt-2" />
      </Card>
    );
  if (!matrix.data) return <Skeleton className="h-40 rounded-xl" />;
  const m = matrix.data;
  const periods = offeredPeriods(m);
  const period = chosen && periods.includes(chosen) ? chosen : periods[0];
  const grid = period ? m.periods[period] : null;
  const nameOf = (r: MatrixPeriod["rows"][number]) =>
    displayName(r, isEnglish) ?? r.id;

  return (
    <div className="space-y-5">
      <header className="border-b pb-4">
        <p className="app-eyebrow mb-2">{tr("Хора", "People")}</p>
        <h1 className="app-page-title">
          {tr("Медиите и хората", "The media and the people")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {tr(
            "Как всяко издание представя хората, които отразява най-много. Сравнява отношението на изданията към един и същи човек — не оценява изданията и не ги класира.",
            "How each outlet frames the people it covers most. It compares outlets' treatment of the same person — it does not rate or rank the outlets.",
          )}
        </p>
        <FreezeBanner stamps={m} className="mt-3" />
      </header>

      {!grid ? (
        <Card
          className="p-4 text-sm text-muted-foreground"
          data-testid="matrix-not-offered"
        >
          {tr(
            "Още няма достатъчно материали за мрежа, която може да се чете — повечето клетки биха били празни.",
            "There are not yet enough articles for a readable grid — most cells would be empty.",
          )}
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {periods.length > 1 ? (
              <PackSelect
                ariaLabel={tr("Период", "Period")}
                value={period!}
                onChange={(v) => setChosen(v)}
                options={periods.map((p) => ({
                  value: p,
                  label: tr(PERIOD_LABEL[p][0], PERIOD_LABEL[p][1]),
                }))}
              />
            ) : (
              <span className="text-muted-foreground">
                {tr(PERIOD_LABEL[period!][0], PERIOD_LABEL[period!][1])}
              </span>
            )}
            <div
              role="group"
              aria-label={tr("Изглед", "View")}
              className="flex gap-1"
            >
              {(["position", "deviation"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={mode === v}
                  onClick={() => setMode(v)}
                  className={`rounded-full border px-2.5 py-1 ${mode === v ? "border-foreground bg-foreground text-background" : ""}`}
                >
                  {v === "position"
                    ? tr("позиция", "position")
                    : tr("спрямо обичайното", "against the usual")}
                </button>
              ))}
            </div>
          </div>

          <p
            className="text-xs text-muted-foreground"
            data-testid="matrix-legend"
          >
            {mode === "position"
              ? tr(
                  "Цвят = как изданието средно представя човека. Сивото е неутрално — повечето материали са такива, и това е находка, не празнота.",
                  "Colour = how the outlet frames the person on average. Grey is neutral — most articles are, and that is a finding, not an absence.",
                )
              : tr(
                  "Цвят само там, където изданието представя човека забележимо различно от останалите издания (95% интервал без нула). Сивото = в рамките на обичайното.",
                  "Colour only where an outlet frames the person noticeably differently from the other outlets (95% interval excluding zero). Grey = within the usual range.",
                )}{" "}
            {tr(
              "· = под 5 (издание, история); избледнял = под 10.",
              "· = under 5 (outlet, story) units; faded = under 10.",
            )}
          </p>
          {mode === "position" ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {BUCKETS.map((b) => (
                <li key={b}>
                  <span
                    aria-hidden
                    className={`mr-1 inline-block size-2 rounded-sm align-middle ${BUCKET_FILL[b]}`}
                  />
                  {toneMeta(b, language).label}
                </li>
              ))}
            </ul>
          ) : null}

          <Card className="overflow-x-auto p-3" data-testid="matrix-grid">
            <table className="border-separate border-spacing-0.5 text-xs">
              <caption className="sr-only">
                {tr("Издания по хора", "Outlets by person")}
              </caption>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card" />
                  {grid.cols.map((c) => (
                    <th
                      key={c.domain}
                      scope="col"
                      className="h-24 w-7 align-bottom font-normal text-muted-foreground"
                    >
                      <span className="inline-block rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">
                        {c.domain}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.id}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-40 truncate bg-card pr-2 text-left font-normal"
                    >
                      <Link
                        to={`/person/${r.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {nameOf(r)}
                      </Link>
                    </th>
                    {grid.cols.map((c) => (
                      <td key={c.domain}>
                        <Cell
                          personId={r.id}
                          personName={nameOf(r)}
                          domain={c.domain}
                          grid={grid}
                          rules={m.rules}
                          mode={mode}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p
            className="text-xs text-muted-foreground"
            data-testid="matrix-omitted"
          >
            {tr(
              `Показани са ${grid.rows.length} души и ${grid.cols.length} издания с достатъчно материали; ${grid.omitted.people} души и ${grid.omitted.outlets} издания не са включени — с твърде малко материали или извън най-отразяваните. Броят в клетка е само за избрания период и за дни с достатъчно оценени статии; клетката води към всички материали на изданието за този човек.`,
              `Shown: ${grid.rows.length} people and ${grid.cols.length} outlets with enough articles; ${grid.omitted.people} people and ${grid.omitted.outlets} outlets are left out — too few articles, or beyond the most covered. A cell counts only the chosen period and days with enough scored articles; it leads to all of that outlet's articles on the person.`,
            )}{" "}
            <Link
              to="/methodology#person-pages"
              className="underline underline-offset-4"
            >
              {tr("методология", "methodology")}
            </Link>
          </p>
        </>
      )}
    </div>
  );
};
