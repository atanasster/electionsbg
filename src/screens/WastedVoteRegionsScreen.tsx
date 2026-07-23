import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { useRegionWastedVotes } from "@/data/wastedVote/useWastedVote";
import { formatPct, formatThousands } from "@/data/utils";
import regionsJson from "@/data/json/regions.json";

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};

const regionLabel = (key: string, isBg: boolean): string => {
  const info = (regionsJson as RegionMeta[]).find((r) => r.oblast === key);
  if (!info) return key;
  return (
    (isBg ? info.long_name || info.name : info.long_name_en || info.name_en) ||
    key
  );
};

export const WastedVoteRegionsScreen = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data: regions } = useRegionWastedVotes();

  return (
    <div className="w-full max-w-5xl mx-auto px-4 pb-12">
      <SEO
        title={t("wasted_votes_regions_full")}
        description={t("wasted_votes_description")}
      />
      <H1 className="text-xl md:text-2xl font-bold text-foreground">
        {t("wasted_votes_regions_full")}
      </H1>

      <div className="mt-4 overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2">{t("region")}</th>
              <th className="text-right p-2 hidden sm:table-cell">
                {t("wasted_votes_title")}
              </th>
              <th className="text-right p-2 hidden sm:table-cell">
                {t("valid_votes")}
              </th>
              <th className="text-right p-2 whitespace-nowrap">%</th>
            </tr>
          </thead>
          <tbody>
            {regions
              ?.filter((r) => r.key !== "32")
              .map((r) => (
                <tr key={r.key} className="border-t hover:bg-muted/30">
                  <td className="p-2">
                    <Link
                      to={`/municipality/${r.key}`}
                      className="hover:underline"
                    >
                      {regionLabel(r.key, isBg)}
                    </Link>
                  </td>
                  <td className="p-2 text-right tabular-nums hidden sm:table-cell">
                    {formatThousands(r.wastedVotes)}
                  </td>
                  <td className="p-2 text-right tabular-nums hidden sm:table-cell">
                    {formatThousands(r.validVotes)}
                  </td>
                  <td className="p-2 text-right tabular-nums font-mono whitespace-nowrap">
                    {formatPct(r.share, 2)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
