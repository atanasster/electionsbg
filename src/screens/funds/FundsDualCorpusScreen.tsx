// /funds/dual-corpus — the firms that take BOTH public-procurement contracts and EU grants.
//
// This page exists mainly to get its payload off the hub. `/api/db/dual-corpus-rankings` is
// **247 KB — 63% of everything /funds fetched** — and it was pulled on every hub view to draw a
// preview leaderboard. Here it is loaded because the reader asked for the ranking.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE HEADLINE MUST BE WHAT THIS PAGE CAN SHOW. `companyCount` is 5,689, the cached payload
// carries a top-1,000, and the page ranks 50 — three numbers, and „5 689 фирми" over any of the
// smaller lists is the dashboard-hub skill's „destination counts a different set" trap: a tile
// saying 240 that lands on a page listing 2,120. Both are published and each is labelled for
// what it is — the corpus size, and the slice this page ranks.
//
// The matching is EIK-to-EIK, so its denominator is the EIK-keyed arm of the funds corpus
// (46,164), not the 47,599 that counts organisations by name as well. Any share quoted here is
// over the former.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Layers } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useDualCorpusRankings } from "@/data/funds/useDualCorpusRankings";
import { DualCorpusLeaderboardTile } from "./DualCorpusLeaderboardTile";
import { formatEur, formatInt } from "@/lib/currency";

/** How many rows this page RANKS — and the number its label quotes.
 *
 *  One constant feeds both the tile and the caption, because the first draft read
 *  `data.rows.length` (1 000, the payload's size) while the tile below rendered 15. That is the
 *  dashboard-hub skill's „quote what the destination DRAWS" rule, broken inside the very page
 *  written to satisfy it. 50 rather than the hub preview's 15: this page IS the ranking, and one
 *  showing the same rows as the card that linked to it has added nothing. */
const RANKED_ROWS = 50;

export const FundsDualCorpusScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data } = useDualCorpusRankings();

  const title = t("funds_dual_title") || "Договори и грантове";
  const description =
    t("funds_dual_description") ||
    "Фирмите, които печелят и обществени поръчки, и европейски грантове — подредени по сбора на двете.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_dual_title"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t("funds_dual_companies") || "Фирми в двата корпуса"}
            hint={
              t("funds_dual_companies_hint") ||
              "Съвпадение по ЕИК между регистъра на обществените поръчки и този на европейските средства. Организациите без ЕИК не могат да бъдат сверени и не участват."
            }
          >
            <div className="flex items-baseline gap-2">
              <Layers className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {data ? formatInt(data.companyCount, i18n.language) : "—"}
              </span>
            </div>
            {/* THE SLICE, NAMED. Without this the heading counts 5 689 and the table under it
                lists 1 000 — two different sets, one page. */}
            {data && data.companyCount > RANKED_ROWS ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {t("funds_dual_showing") || "в класацията отдолу:"}{" "}
                {formatInt(RANKED_ROWS, i18n.language)}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_dual_combined") || "Сбор от двата източника"}
            hint={
              t("funds_dual_combined_hint") ||
              "Стойността на обществените поръчки плюс европейските средства за същите фирми. Двата регистъра са различни, но и двете суми са договорени стойности."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {data ? formatEur(data.combinedEur, i18n.language) : "—"}
            </div>
          </StatCard>
          <StatCard
            label={t("funds_dual_mp") || "Свързани с депутат"}
            hint={
              t("funds_dual_mp_hint") ||
              "Фирми със съвпадение по ЕИК с деклариран интерес на депутат. Сигнал за проверка, не заключение."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {data ? formatInt(data.mpTiedCount, i18n.language) : "—"}
            </div>
          </StatCard>
        </div>

        <div className="mt-6">
          <DualCorpusLeaderboardTile rowCount={RANKED_ROWS} />
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground/80">
          {t("funds_dual_source") ||
            "Източници: АОП/ЦАИС ЕОП (обществени поръчки) и ИСУН 2020 (европейски средства), свързани по ЕИК."}{" "}
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
