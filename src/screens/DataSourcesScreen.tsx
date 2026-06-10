import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Title } from "@/ux/Title";
import { useHashScroll } from "@/ux/useHashScroll";
import { Card, CardContent } from "@/ux/Card";
import { Anchor } from "@/ux/Anchor";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DataSources } from "@/screens/components/DataSources";
import { DataNav } from "@/screens/components/DataNav";

const BUCKET_URL = "https://storage.googleapis.com/data-electionsbg-com";
const REPO_URL = "https://github.com/atanasster/electionsbg";

export const DataSourcesScreen = () => {
  const { t } = useTranslation();
  // Catch up `#downloads` (and legacy `#sources-*`) deep links after the
  // cards render asynchronously.
  useHashScroll([]);

  return (
    <>
      <Title description={t("data_sources_intro")}>
        {t("data_sources_heading")}
      </Title>
      <div className="-mt-4 mb-6 flex flex-col items-center gap-4">
        <p className="max-w-2xl text-center text-sm text-muted-foreground md:text-base">
          {t("data_sources_intro")}
        </p>
        <DataNav active="sources" />
      </div>

      <section aria-label={t("data_sources_heading")} className="my-4">
        <DataSources />

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
