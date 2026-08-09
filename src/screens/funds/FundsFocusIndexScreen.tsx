// /funds/focus — the PICKER for /funds/focus/:slug.
//
// The dashboard-hub skill §4: "Seeded destinations are a smell — prefer a picker." A tile
// pointing at `/x/:id` needs a seed the generator chooses, which means the reader lands on a
// subject somebody else picked with no way to reach their own, and the tile omits itself
// entirely whenever no seed is produced. `/funds/focus/:slug` had five dossiers and no way in.
//
// Five is a small enough set to render whole, so this is a list rather than a search — the
// picker's job here is reachability, not filtering.

import { type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Search } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent } from "@/ux/Card";
import { useFundsThemesIndex } from "@/data/funds/useFundsThemes";

export const FundsFocusIndexScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isPending } = useFundsThemesIndex();
  const bg = i18n.language !== "en";

  const title = t("funds_focus_index_title") || "Фокус";
  const description =
    t("funds_focus_index_description") ||
    "Тематични досиета по европейските средства — какво показват данните за къщите за гости, пътищата, земеделието, училищата и общинската инфраструктура.";

  const themes = data?.themes ?? [];

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_focus_index_title"
        />

        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          {t("funds_focus_index_intro") ||
            "Всяко досие събира договорите по една тема и показва какво се вижда в тях. Темите са подбрани, не изчерпателни — това е начало на проверка, не заключение."}
        </p>

        {themes.length ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {themes.map((th) => (
              <Card key={th.slug}>
                <CardContent className="p-4">
                  <Link
                    to={`/funds/focus/${encodeURIComponent(th.slug)}`}
                    className="flex items-center gap-2 font-medium text-primary hover:underline"
                  >
                    <Search className="h-4 w-4 shrink-0" aria-hidden />
                    {bg ? th.labelBg : th.labelEn}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {bg ? th.summaryBg : th.summaryEn}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isPending ? (
          // „Няма заредени досиета" while the fetch is still in flight is a claim about the
          // corpus made before the corpus has answered.
          <div className="mt-6 h-40 animate-pulse rounded-xl border bg-card" />
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            {t("funds_focus_index_empty") || "Няма заредени досиета."}
          </p>
        )}

        <p className="mt-4 text-[11px] text-muted-foreground/80">
          {t("funds_index_source_hint") ||
            "Източник: публичният регистър на бенефициентите в ИСУН 2020."}{" "}
          <a
            href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            2020.eufunds.bg <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>
    </>
  );
};
