// The fund finder on /pensions — the 31 private pension funds.
//
// Client-indexed with no extra request: the page's KfnFundsTile already fetches
// the whole КФН archive, so this reads the same query-cache entry.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PiggyBank } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { useKfnLatest } from "@/data/budget/useBudget";
import { kfnFundSlug, kfnFundName } from "@/lib/kfnFundSlug";

export const PensionsSearchBox: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const latest = useKfnLatest();

  const index = useMemo(() => {
    if (!latest?.funds?.length) return null;
    return buildEntityIndex(
      latest.funds,
      (f) => ({
        id: kfnFundSlug(f.pillar, f.companyEn),
        // Composed, not `fundName` — that field is in the ARCHIVE's language.
        label: kfnFundName(f.pillar, f.companyBg, f.companyEn, bg),
        sub: bg ? f.pillarLabelBg : f.pillarLabelEn,
        href: `/pension-fund/${kfnFundSlug(f.pillar, f.companyEn)}`,
      }),
      // Both company spellings and both pillar labels: a reader types the
      // company ("Доверие" / "Doverie") far more often than the fund's name.
      (f) => [
        f.companyBg,
        f.companyEn,
        f.fundName,
        f.pillarLabelBg,
        f.pillarLabelEn,
      ],
      (f) => f.netAssetsEur ?? 0,
    );
  }, [latest, bg]);

  const groups = useMemo(
    () => [
      entityGroup("fund", "Пенсионни фондове", "Pension funds", index, {
        loading: !latest,
        icon: PiggyBank,
      }),
    ],
    [index, latest],
  );

  return (
    <SectorEntitySearch
      idPrefix="pensions-search"
      groups={groups}
      title={{ bg: "Намери пенсионен фонд", en: "Find a pension fund" }}
      placeholder={{
        bg: "фонд, дружество или стълб…",
        en: "fund, company or pillar…",
      }}
      hint={{
        bg: "Търси по дружество, фонд или стълб — приема и изписване на латиница.",
        en: "Search by company, fund or pillar — Latin-typed queries work too.",
      }}
    />
  );
};
