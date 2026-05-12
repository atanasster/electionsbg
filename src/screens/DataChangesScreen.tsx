import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import { proseClasses } from "@/components/article/proseClasses";
import { Card, CardContent } from "@/ux/Card";
import {
  useDataChanges,
  type DataChangeEntry,
} from "@/data/dataChanges/useDataChanges";

type Group = { date: string; entries: DataChangeEntry[] };

const groupByDate = (entries: DataChangeEntry[]): Group[] => {
  const map = new Map<string, DataChangeEntry[]>();
  for (const e of entries) {
    const bucket = map.get(e.date) ?? [];
    bucket.push(e);
    map.set(e.date, bucket);
  }
  return Array.from(map.entries())
    .map(([date, list]) => ({
      date,
      entries: list
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
};

export const DataChangesScreen = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useDataChanges();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";

  const groups = useMemo(
    () => groupByDate(data?.entries ?? []),
    [data?.entries],
  );

  const formatDate = (iso: string): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(
      lang === "bg" ? "bg-BG" : "en-GB",
      { year: "numeric", month: "long", day: "numeric" },
    );

  return (
    <ArticleLayout
      title={t("data_changes_title")}
      description={t("data_changes_description")}
      breadcrumb={null}
      seoType="website"
    >
      {isLoading ? (
        <p className={proseClasses.p}>{t("loading")}</p>
      ) : groups.length === 0 ? (
        <p className={proseClasses.p}>{t("data_changes_empty")}</p>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.date}>
              <h2 className={proseClasses.h2}>{formatDate(g.date)}</h2>
              <div className="grid grid-cols-1 gap-3">
                {g.entries.map((e) => (
                  <EntryCard key={`${e.timestamp}-${e.skill}`} entry={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </ArticleLayout>
  );
};

const EntryCard = ({ entry }: { entry: DataChangeEntry }) => {
  const { t } = useTranslation();
  const skillLabel = t(`data_changes_skill_${entry.skill}`, {
    defaultValue: entry.skill,
  });
  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base md:text-lg font-semibold text-foreground">
            {skillLabel}
          </h3>
          {entry.source ? (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {entry.source}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[14px] md:text-[15px] leading-6 text-foreground/90">
          {entry.summary}
        </p>
        {entry.links && entry.links.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {entry.links.map((l) => (
              <Link
                key={`${l.to}-${l.labelKey}`}
                to={l.to}
                className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors"
              >
                {t(l.labelKey, { defaultValue: l.to })}
              </Link>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
