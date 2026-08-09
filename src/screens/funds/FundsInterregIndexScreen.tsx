// /funds/interreg — the cross-border corpus ИСУН does not hold.
//
// AN INDEX, NOT YET A PICKER, and the first draft's header claimed otherwise. It said this page
// „gives the ~1,954 parameterised operation pages a way in"; `InterregTile` renders its movers
// and programme rows as plain spans and links to no operation at all, so the claim was false as
// written. There is no operations-list route to build a real picker on — `interreg_overview()`
// returns oblasts, periods and programmes, and nothing enumerating keep_ids.
//
// So the page says what is true: it fronts the corpus, and it sends a reader who wants a
// specific operation to the finder on /funds, which DOES search Interreg by title and partner
// (through the BG→EN bridge, since keep.eu publishes 86% of these titles in English only).
// Building the real picker needs a list route and is left named rather than faked.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THIS MONEY IS NOT ADDABLE TO THE ИСУН FIGURES, and the page must not let a reader think it
// is. `fund_projects` holds ZERO Interreg rows — a system boundary, since Interreg runs on Jems
// — and the two quantities differ even in kind:
//
//     ИСУН      a CONTRACT VALUE                        €44.07 bn
//     Interreg  a partner's PUBLISHED BUDGET             €396.39 m  (Bulgarian partners only)
//
// So there is no combined total anywhere on this page. What there is instead is the reason the
// distinction matters: because Interreg is cross-border by definition, its money lands almost
// entirely on BORDER municipalities — the ones an ИСУН-only per-capita ranking understated.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsHubStats } from "@/data/funds/useFundsHubStats";
import { InterregTile } from "./InterregTile";
import { formatEur, formatInt } from "@/lib/currency";

export const FundsInterregIndexScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: stats } = useFundsHubStats();

  const title = t("funds_interreg_index_title") || "Interreg";
  const description =
    t("funds_interreg_index_description") ||
    "Трансграничните проекти, които ИСУН изобщо не съдържа — колко са, кои български организации участват и защо парите падат основно по границите.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_interreg_index_title"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={
              t("funds_interreg_operations") || "Проекти с български участник"
            }
            hint={
              t("funds_interreg_operations_hint") ||
              "Трансгранични проекти с поне една българска организация. Целият регистър на keep.eu съдържа повече — те нямат български участник."
            }
          >
            <div className="flex items-baseline gap-2">
              <Globe2 className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {stats
                  ? formatInt(stats.interreg.bgOperationCount, i18n.language)
                  : "—"}
              </span>
            </div>
            {/* THE CORPUS-WIDE COUNT as context, explicitly labelled. Without it the page shows
                1 115 while the tile below shows its own filtered figure and a reader has no way
                to tell which universe either belongs to. */}
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatInt(stats.interreg.operationCount, i18n.language)}{" "}
                {t("funds_interreg_all_ops") || "в целия регистър"}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_interreg_partners") || "Български участници"}
            hint={
              t("funds_interreg_partners_hint") ||
              "Различни организации. Една организация, участвала в пет проекта, се брои веднъж — затова числото е по-малко от броя на участията."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats
                ? formatInt(stats.interreg.bgPartnerOrgCount, i18n.language)
                : "—"}
            </div>
            {/* BOTH counts, because they differ by 52% and „партньори" is ambiguous between
                them. Publishing the row count as the organisation count over-states the partner
                base by half. */}
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatInt(stats.interreg.bgPartnerRowCount, i18n.language)}{" "}
                {t("funds_interreg_participations") || "участия общо"}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={
              t("funds_interreg_budget") || "Бюджет на българските партньори"
            }
            /* NOT a contract value, and not addable to the ИСУН total. The hint says so
               because the number sits two clicks from a €44 bn figure. */
            hint={
              t("funds_interreg_budget_hint") ||
              "Публикуваният бюджет на българските партньори — това е друга величина от договорената стойност по ИСУН и двете не се сумират."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats
                ? formatEur(stats.interreg.bgBudgetEur, i18n.language)
                : "—"}
            </div>
          </StatCard>
        </div>

        {/* The way in to a single operation, said plainly — this page cannot list them. */}
        <p className="mt-4 text-sm text-muted-foreground">
          {t("funds_interreg_find") ||
            "За конкретен проект използвайте търсачката на страницата „Европейски средства“ — тя търси и по заглавие, и по партньор."}{" "}
          <Link to="/funds" className="text-primary hover:underline">
            {t("funds_interreg_find_link") || "Към търсачката"}
          </Link>
        </p>

        <div className="mt-6">
          <InterregTile />
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground/80">
          {t("funds_interreg_source") ||
            "Източник: keep.eu (INTERACT) — Interreg се управлява през Jems, не през ИСУН, затова тези проекти липсват от останалите страници тук."}{" "}
          <a
            href="https://keep.eu"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            keep.eu <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>
    </>
  );
};
