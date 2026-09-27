// `/persons` — the people the news covers enough to have a page
// (news-person-sentiment-v1 §6.2).
//
// ⚠️ A TABLE, NOT A LEADERBOARD. There is no mean on this page and no way to
// sort by tone: a sortable favourability column is the ranking this project
// refuses to publish. Rows are ordered by how much coverage a person has, by
// name, or by when they were last covered.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { searchMatches } from "@/lib/translitSearch";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import { useParties, usePersonsIndex, type PersonIndexRow } from "../data";
import { formatDate } from "../labels";
import { useNewsLocale } from "../i18n";
import { displayName, rowFigures } from "../personPage";
import { ToneBuckets } from "../components/PersonCharts";

type Sort = "coverage" | "name" | "recent";
type Period = "all" | "30" | "90";

const DAY_MS = 86_400_000;

export const PersonsScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const index = usePersonsIndex();
  const parties = useParties();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("coverage");
  const [party, setParty] = useState("any");
  const [outlet, setOutlet] = useState("any");
  const [period, setPeriod] = useState<Period>("all");

  const rows = useMemo(() => index.data?.persons ?? [], [index.data]);
  const partyName = (id: string) =>
    parties.data?.parties.find((p) => p.party_id === id)?.name ?? id;
  const outlets = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows)
      for (const [d, cell] of Object.entries(r.by_outlet ?? {}))
        totals.set(d, (totals.get(d) ?? 0) + (cell[0] ?? 0));
    return [...totals.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [rows]);
  const partyIds = useMemo(
    () => [...new Set(rows.map((r) => r.party).filter(Boolean))] as string[],
    [rows],
  );
  const generated = index.data?.generated_at
    ? Date.parse(index.data.generated_at)
    : null;
  const nameOf = (r: PersonIndexRow) => displayName(r, isEnglish) ?? r.id;

  const shown = rows
    .filter(
      (r) =>
        !q.trim() || searchMatches(`${r.name_bg ?? ""} ${r.name_en ?? ""}`, q),
    )
    .filter((r) => party === "any" || r.party === party)
    .filter((r) => outlet === "any" || (r.by_outlet?.[outlet]?.[0] ?? 0) > 0)
    .filter(
      (r) =>
        period === "all" ||
        (generated !== null &&
          r.last_published !== null &&
          generated - Date.parse(r.last_published) <= Number(period) * DAY_MS),
    )
    .sort((a, b) => {
      if (sort === "name") return nameOf(a).localeCompare(nameOf(b), language);
      if (sort === "recent")
        return (b.last_published ?? "").localeCompare(a.last_published ?? "");
      const o = outlet === "any" ? null : outlet;
      return (
        rowFigures(b, o).n - rowFigures(a, o).n || a.id.localeCompare(b.id)
      );
    });

  if (index.error && !index.data)
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Хора в новините", "People in the news")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "Страниците за хора още не са публикувани.",
            "The person pages are not published yet.",
          )}
        </p>
      </Card>
    );
  if (!index.data) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <div className="space-y-5">
      <header className="border-b pb-4">
        <p className="app-eyebrow mb-2">{tr("Хора", "People")}</p>
        <h1 className="app-page-title">
          {tr("Хора в новините", "People in the news")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {tr(
            `${rows.length} души с достатъчно оценено отразяване. За всеки: колко материала и как представят човека — оценка на текстовете, не на хората. Подредени по обем на отразяването, никога по тон: това не е класация.`,
            `${rows.length} people with enough assessed coverage. For each: how many articles frame them and how — an assessment of the texts, not the people. Ordered by volume of coverage, never by tone: this is not a ranking.`,
          )}
        </p>
        {index.data.matrix ? (
          <Link
            to="/persons/media"
            className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            {tr(
              "Медиите и хората — по издания",
              "The media and the people — by outlet",
            )}{" "}
            →
          </Link>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("Търсене по име (и на латиница)", "Search by name")}
          aria-label={tr("Търсене по име", "Search by name")}
          className="h-8 w-56"
        />
        <PackSelect
          ariaLabel={tr("Подреждане", "Sort")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "coverage", label: tr("по обем", "by coverage") },
            { value: "name", label: tr("по име", "by name") },
            {
              value: "recent",
              label: tr("по последно отразяване", "most recent"),
            },
          ]}
        />
        <PackSelect
          ariaLabel={tr("Период", "Period")}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "all", label: tr("всички", "everyone") },
            {
              value: "30",
              label: tr(
                "отразявани през последните 30 дни",
                "covered in the last 30 days",
              ),
            },
            {
              value: "90",
              label: tr(
                "отразявани през последните 90 дни",
                "covered in the last 90 days",
              ),
            },
          ]}
        />
        {partyIds.length ? (
          <PackSelect
            ariaLabel={tr("Партия", "Party")}
            value={party}
            onChange={setParty}
            options={[
              { value: "any", label: tr("всяка партия", "any party") },
              ...partyIds.map((id) => ({ value: id, label: partyName(id) })),
            ]}
          />
        ) : null}
        <PackSelect
          ariaLabel={tr("Издание", "Outlet")}
          value={outlet}
          onChange={setOutlet}
          contentClassName="max-h-80 overflow-y-auto"
          options={[
            { value: "any", label: tr("всички издания", "all outlets") },
            ...outlets.map(([d]) => ({ value: d, label: d })),
          ]}
        />
      </div>
      {outlet !== "any" ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="persons-outlet-note"
        >
          {tr(
            `Броят и разпределението са само за материалите на ${outlet} — как това издание представя тези хора.`,
            `Counts and distribution are for ${outlet}'s articles only — how this outlet frames these people.`,
          )}
        </p>
      ) : null}

      <Card className="p-0">
        <table className="w-full text-sm" data-testid="persons-table">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-normal">{tr("Лице", "Person")}</th>
              <th className="px-2 py-2 text-right font-normal">n</th>
              <th className="hidden w-1/3 px-2 py-2 font-normal sm:table-cell">
                {tr("Как е представен човекът", "How they are framed")}
              </th>
              <th className="hidden px-2 py-2 text-right font-normal md:table-cell">
                {tr("Издания", "Outlets")}
              </th>
              <th className="hidden px-4 py-2 text-right font-normal md:table-cell">
                {tr("Последно", "Last seen")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const f = rowFigures(r, outlet === "any" ? null : outlet);
              const role = r.role_label?.[isEnglish ? "en" : "bg"];
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-2">
                    <Link
                      to={`/person/${r.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {nameOf(r)}
                    </Link>
                    {role || r.party ? (
                      <p className="text-xs text-muted-foreground">
                        {[role, r.party ? partyName(r.party) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-1 sm:hidden">
                      <ToneBuckets counts={f.counts} total={f.n} compact />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{f.n}</td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <ToneBuckets counts={f.counts} total={f.n} compact />
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums text-muted-foreground md:table-cell">
                    {r.outlet_count}
                  </td>
                  <td className="hidden px-4 py-2 text-right text-xs text-muted-foreground md:table-cell">
                    {formatDate(r.last_published, language)}
                  </td>
                </tr>
              );
            })}
            {!shown.length ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-3 text-sm text-muted-foreground"
                >
                  {tr("Няма хора по тези условия.", "No people match.")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">
        {tr(
          "n = брой (издание, история): петнадесет последващи материала на едно издание за една история са една позиция, не петнадесет.",
          "n = (outlet, story) units: fifteen follow-ups from one outlet on one story are one position, not fifteen.",
        )}{" "}
        <Link
          to="/methodology#person-pages"
          className="underline underline-offset-4"
        >
          {tr("методология", "methodology")}
        </Link>
      </p>
    </div>
  );
};
