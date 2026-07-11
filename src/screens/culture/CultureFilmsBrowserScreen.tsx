// /culture/films — browse & search the full НФЦ film-subsidy corpus (949 awards,
// 2014–2025). The "See all" target of the /culture film-awards tile: a client-side
// DataTable (the corpus is small enough to ship whole) with free-text search,
// sortable columns, discipline × year facets and CSV/JSON/PDF export. Rows link to
// the per-film record page. Plan §5.1 tile 12.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { Title } from "@/ux/Title";
import { ProcurementThematicNav } from "@/screens/components/procurement/ProcurementThematicNav";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { formatEur } from "@/lib/currency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCultureFilms } from "@/data/culture/useCulture";
import type { FilmAward, FilmDiscipline } from "@/data/culture/types";
import { filmId } from "@/data/culture/filmId";
import { DISCIPLINE_COLOR, disciplineLabel } from "./cultureLabels";

const ALL = "__all__";
const DISCIPLINES: FilmDiscipline[] = [
  "feature",
  "documentary",
  "animation",
  "other",
];

export const CultureFilmsBrowserScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useCultureFilms();
  const films = useMemo(() => data?.films ?? [], [data]);

  const [discipline, setDiscipline] = useState<string>(ALL);
  const [year, setYear] = useState<string>(ALL);

  const years = useMemo(
    () => [...new Set(films.map((f) => f.year))].sort((a, b) => b - a),
    [films],
  );

  const rows = useMemo(
    () =>
      films.filter(
        (f) =>
          (discipline === ALL || f.discipline === discipline) &&
          (year === ALL || String(f.year) === year),
      ),
    [films, discipline, year],
  );

  const columns = useMemo<DataTableColumns<FilmAward, unknown>>(
    () => [
      {
        accessorKey: "year",
        header: bg ? "Година" : "Year",
        className: "tabular-nums",
      },
      {
        id: "discipline",
        accessorFn: (r) => disciplineLabel(r.discipline, lang),
        header: bg ? "Вид" : "Type",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-sm ${DISCIPLINE_COLOR[row.original.discipline]}`}
            />
            {disciplineLabel(row.original.discipline, lang)}
          </span>
        ),
      },
      {
        accessorKey: "title",
        header: bg ? "Проект" : "Project",
        cell: ({ row }) => (
          <Link
            to={`/culture/film/${filmId(row.original)}`}
            className="font-medium text-primary hover:underline"
            title={row.original.title}
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "producer",
        header: bg ? "Продуцент" : "Producer",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.producer}</span>
        ),
      },
      {
        accessorKey: "subsidyEur",
        header: bg ? "Субсидия" : "Subsidy",
        sortDescFirst: true,
        className: "text-right tabular-nums whitespace-nowrap font-medium",
        cell: ({ row }) => formatEur(row.original.subsidyEur, lang),
      },
    ],
    [bg, lang],
  );

  const title = bg ? "Всички филмови субсидии" : "All film subsidies";

  return (
    <>
      <Title
        description={
          bg
            ? "Пълният регистър на държавните субсидии за кино на Националния филмов център (2014–2025) — търсене, сортиране и филтри по вид и година, с износ."
            : "The full register of the National Film Center's state film subsidies (2014–2025) — search, sort and filter by discipline and year, with export."
        }
      >
        {title}
      </Title>
      <ProcurementThematicNav />

      <div className="mt-2">
        <Link
          to="/culture"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {bg ? "Към Култура" : "Back to Culture"}
        </Link>
      </div>

      <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold">
        <Clapperboard className="h-6 w-6" />
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {bg
          ? `${films.length} проекта, 2014–2025 · показани ${rows.length}`
          : `${films.length} projects, 2014–2025 · showing ${rows.length}`}
      </p>

      <div className="mt-4">
        <DataTable<FilmAward, unknown>
          title="culture-films"
          pageSize={25}
          columns={columns}
          data={rows}
          initialSort={[{ id: "subsidyEur", desc: true }]}
          toolbarItems={
            <div className="flex gap-2">
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger className="w-[11rem]">
                  <SelectValue
                    placeholder={bg ? "Всички видове" : "All types"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {bg ? "Всички видове" : "All types"}
                  </SelectItem>
                  {DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {disciplineLabel(d, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-[8rem]">
                  <SelectValue
                    placeholder={bg ? "Всички години" : "All years"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {bg ? "Всички години" : "All years"}
                  </SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      </div>
    </>
  );
};
