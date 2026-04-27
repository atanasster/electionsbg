import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { PartyFinancing } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = {
  financing?: PartyFinancing | null;
  partyNickName?: string;
};

export const PartyDonorsCountCard: FC<Props> = ({
  financing,
  partyNickName,
}) => {
  const { t } = useTranslation();
  const { donorCount, donorsTotal, candidatesCount, candidatesTotal } =
    useMemo(() => {
      const donors = financing?.data.fromDonors ?? [];
      const cands = financing?.data.fromCandidates ?? [];
      return {
        donorCount: donors.length,
        donorsTotal: donors.reduce(
          (s, d) => s + (d.monetary || 0) + (d.nonMonetary || 0),
          0,
        ),
        candidatesCount: cands.length,
        candidatesTotal: cands.reduce(
          (s, d) => s + (d.monetary || 0) + (d.nonMonetary || 0),
          0,
        ),
      };
    }, [financing]);

  return (
    <StatCard label={t("donors")} hint={t("dashboard_party_donors_count_hint")}>
      <div className="flex items-baseline gap-2">
        <Users className="h-5 w-5 text-muted-foreground shrink-0" />
        {partyNickName && donorCount > 0 ? (
          <Link
            to={`/party/${partyNickName}/donors`}
            className="text-2xl font-bold tabular-nums hover:underline"
            underline={false}
          >
            {formatThousands(donorCount)}
          </Link>
        ) : (
          <span className="text-2xl font-bold tabular-nums">
            {donorCount > 0 ? formatThousands(donorCount) : "0"}
          </span>
        )}
      </div>
      {donorsTotal > 0 && (
        <div className="text-sm font-medium tabular-nums">
          {formatThousands(donorsTotal)} {t("lv")}
        </div>
      )}
      {candidatesCount > 0 && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {t("candidates")}: {formatThousands(candidatesCount)} ·{" "}
          {formatThousands(candidatesTotal)} {t("lv")}
        </div>
      )}
      {partyNickName && donorCount > 0 && (
        <Link
          to={`/party/${partyNickName}/donors`}
          className="text-[10px] text-primary hover:underline mt-1"
          underline={false}
        >
          {t("dashboard_see_details")} →
        </Link>
      )}
    </StatCard>
  );
};
