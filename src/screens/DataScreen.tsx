import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Database, Download, History } from "lucide-react";
import { Title } from "@/ux/Title";
import { useHashScroll } from "@/ux/useHashScroll";
import { Card, CardContent } from "@/ux/Card";
import { Anchor } from "@/ux/Anchor";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DataSources } from "@/screens/components/DataSources";
import {
  useDataChanges,
  type DataChangeEntry,
} from "@/data/dataChanges/useDataChanges";

const BUCKET_URL = "https://storage.googleapis.com/data-electionsbg-com";
const REPO_URL = "https://github.com/atanasster/electionsbg";

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

const NavPill: React.FC<{ href: string; children: React.ReactNode }> = ({
  href,
  children,
}) => (
  <a
    href={href}
    className="inline-flex items-center rounded-full border border-border bg-secondary/40 px-3.5 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors"
  >
    {children}
  </a>
);

export const DataScreen = () => {
  const { t } = useTranslation();
  // Re-run on every render so a `#sources`/`#changes`/`#downloads` deep link
  // catches up after the cards render asynchronously.
  useHashScroll([]);

  return (
    <>
      <Title description={t("data_description")}>{t("data_title")}</Title>
      <div className="-mt-4 mb-6 flex flex-col items-center gap-4">
        <p className="max-w-2xl text-center text-sm text-muted-foreground md:text-base">
          {t("data_description")}
        </p>
        <nav className="flex flex-wrap justify-center gap-2">
          <NavPill href="#sources">{t("data_sources_heading")}</NavPill>
          <NavPill href="#changes">{t("data_recent_changes_heading")}</NavPill>
          <NavPill href="#downloads">{t("data_downloads_heading")}</NavPill>
        </nav>
      </div>

      <section aria-label={t("data_title")} className="my-4">
        <DashboardSection
          id="sources"
          title={t("data_sources_heading")}
          subtitle={t("data_sources_intro")}
          icon={Database}
        >
          <DataSources />
        </DashboardSection>

        <DashboardSection
          id="changes"
          title={t("data_recent_changes_heading")}
          subtitle={t("data_changes_description")}
          icon={History}
        >
          <RecentChanges />
        </DashboardSection>

        <DashboardSection
          id="downloads"
          title={t("data_downloads_heading")}
          icon={Download}
        >
          <Downloads />
        </DashboardSection>
      </section>
    </>
  );
};

const RecentChanges = () => {
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

  if (isLoading) {
    return <p className="text-muted-foreground">{t("loading")}</p>;
  }
  if (groups.length === 0) {
    return <p className="text-muted-foreground">{t("data_changes_empty")}</p>;
  }
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.date}>
          <h3 className="scroll-mt-24 font-display text-xl md:text-2xl font-bold tracking-tight text-foreground">
            {formatDate(g.date)}
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 items-start">
            {g.entries.map((e) => (
              <EntryCard key={`${e.timestamp}-${e.skill}`} entry={e} />
            ))}
          </div>
        </section>
      ))}
    </div>
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
          <h4 className="text-base md:text-lg font-semibold text-foreground">
            {skillLabel}
          </h4>
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

const Downloads = () => {
  const { t } = useTranslation();
  const linkClass =
    "text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-colors";
  return (
    <Card>
      <CardContent className="p-5 md:p-6 space-y-4">
        <p className="text-sm md:text-base text-muted-foreground">
          {t("data_downloads_intro")}
        </p>
        <ul className="space-y-3">
          <li className="flex items-start">
            <span
              aria-hidden
              className="mr-2 mt-2 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
            />
            <span>
              <Anchor
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                {t("data_downloads_license_label")}
              </Anchor>
              {" — "}
              {t("data_downloads_license_note")}
            </span>
          </li>
          <li className="flex items-start">
            <span
              aria-hidden
              className="mr-2 mt-2 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
            />
            <span>
              <Anchor
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                {t("data_downloads_repo_label")}
              </Anchor>
              {" — "}
              {t("data_downloads_repo_note")}
            </span>
          </li>
          <li className="flex items-start">
            <span
              aria-hidden
              className="mr-2 mt-2 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
            />
            <span>
              {t("data_downloads_json_note")}{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">
                {BUCKET_URL}/&lt;YYYY_MM_DD&gt;/cik_parties.json
              </code>
            </span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
};
