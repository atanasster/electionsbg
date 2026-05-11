import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sigma } from "lucide-react";
import { useBenford, type BenfordPartyEntry } from "@/data/benford/useBenford";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const partyLabel = (
  p: Pick<BenfordPartyEntry, "nickName" | "name" | "name_en">,
  isBg: boolean,
) =>
  isBg ? p.nickName || p.name || "?" : p.nickName || p.name_en || p.name || "?";

type Bucket = "close" | "moderate" | "strong";
const madBucket = (mad: number): Bucket =>
  mad < 0.04 ? "close" : mad < 0.08 ? "moderate" : "strong";

const bucketColor = (b: Bucket): string =>
  b === "close"
    ? "bg-emerald-500"
    : b === "moderate"
      ? "bg-amber-500"
      : "bg-orange-600";

// Home-page tile — compact summary of the Benford second-digit (Mebane)
// signal. Counts parties that exceed the moderate / strong MAD thresholds
// and surfaces the three biggest deviations. Falls back to first-digit
// only for elections too small for 2BL.
export const BenfordTile: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useBenford();

  const { top, moderate, strong } = useMemo(() => {
    if (!data?.parties.length) return { top: [], moderate: 0, strong: 0 };
    const rows = data.parties
      .map((p) => ({ p, test: p.secondDigit ?? p.firstDigit }))
      .filter(
        (
          x,
        ): x is {
          p: BenfordPartyEntry;
          test: NonNullable<BenfordPartyEntry["secondDigit"]>;
        } => !!x.test,
      );
    let mod = 0;
    let str = 0;
    for (const r of rows) {
      if (r.test.mad >= 0.04) mod++;
      if (r.test.mad >= 0.08) str++;
    }
    const sorted = rows
      .filter((r) => r.test.mad >= 0.04)
      .sort((a, b) => b.test.mad - a.test.mad)
      .slice(0, 3);
    return { top: sorted, moderate: mod, strong: str };
  }, [data]);

  if (!data) return null;
  if (moderate === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_benford_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Sigma className="h-4 w-4" />
              <span>{t("dashboard_benford")}</span>
            </div>
          </Hint>
          <Link
            to="/benford"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-2xl font-semibold tabular-nums">
          {formatThousands(strong)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("dashboard_benford_strong_suffix")} · {formatThousands(moderate)}{" "}
          {t("dashboard_benford_moderate_suffix")}
        </span>
      </div>
      {top.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm mt-1">
          {top.map(({ p, test }) => {
            const b = madBucket(test.mad);
            return (
              <li key={p.partyNum} className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color || "#888" }}
                />
                <Link
                  to={`/benford/${p.partyNum}`}
                  className="truncate font-medium"
                  underline={false}
                >
                  {partyLabel(p, isBg)}
                </Link>
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${bucketColor(b)}`}
                />
                <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                  MAD {test.mad.toFixed(3)}
                </span>
                <span className="tabular-nums text-[10px] text-muted-foreground shrink-0">
                  n={formatThousands(test.n)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </StatCard>
  );
};
