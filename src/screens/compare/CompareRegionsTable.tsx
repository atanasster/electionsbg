import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatPct } from "@/data/utils";
import { Link } from "@/ux/Link";
import { RegionSummary } from "./regionSummary";

type Props = {
  left: RegionSummary;
  right: RegionSummary;
};

const fmtThousands = (n: number) => n.toLocaleString("en-US");

const Delta: FC<{ value: number; suffix?: string; digits?: number }> = ({
  value,
  suffix,
  digits = 2,
}) => {
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  const tone =
    value > 0
      ? "text-positive"
      : value < 0
        ? "text-negative"
        : "text-muted-foreground";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const formatted =
    digits === 0
      ? Math.abs(Math.round(value)).toLocaleString("en-US")
      : Math.abs(value).toFixed(digits);
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="tabular-nums whitespace-nowrap">
        {sign}
        {formatted}
        {suffix}
      </span>
    </span>
  );
};

const NumCell: FC<{ value?: number; format?: "thousands" | "pct" }> = ({
  value,
  format = "thousands",
}) => (
  <span className="tabular-nums font-medium">
    {value === undefined
      ? "—"
      : format === "pct"
        ? formatPct(value, 2)
        : fmtThousands(value)}
  </span>
);

export const CompareRegionsTable: FC<Props> = ({ left, right }) => {
  const { t } = useTranslation();

  const partyRows = useMemo(() => {
    const map = new Map<
      string,
      {
        nickName: string;
        color?: string;
        leftPct?: number;
        leftVotes?: number;
        rightPct?: number;
        rightVotes?: number;
      }
    >();
    left.parties.forEach((p) => {
      map.set(p.nickName, {
        nickName: p.nickName,
        color: p.color,
        leftPct: p.pct,
        leftVotes: p.totalVotes,
      });
    });
    right.parties.forEach((p) => {
      const existing = map.get(p.nickName);
      if (existing) {
        existing.rightPct = p.pct;
        existing.rightVotes = p.totalVotes;
        if (!existing.color) existing.color = p.color;
      } else {
        map.set(p.nickName, {
          nickName: p.nickName,
          color: p.color,
          rightPct: p.pct,
          rightVotes: p.totalVotes,
        });
      }
    });
    return Array.from(map.values())
      .filter(
        (r) =>
          (r.leftPct !== undefined && r.leftPct >= 0.5) ||
          (r.rightPct !== undefined && r.rightPct >= 0.5),
      )
      .sort(
        (a, b) =>
          (b.leftPct ?? b.rightPct ?? 0) - (a.leftPct ?? a.rightPct ?? 0),
      );
  }, [left.parties, right.parties]);

  const turnoutDelta = left.turnout.pct - right.turnout.pct;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-muted-foreground">
            <th className="text-left py-2 px-2 w-1/3">{t("compare_metric")}</th>
            <th className="text-right py-2 px-2">{left.regionName}</th>
            <th className="text-right py-2 px-2 w-24">Δ</th>
            <th className="text-right py-2 px-2">{right.regionName}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-2 px-2 text-muted-foreground">
              {t("dashboard_turnout")}
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={left.turnout.pct} format="pct" />
            </td>
            <td className="text-right py-2 px-2">
              <Delta
                value={turnoutDelta}
                suffix={` ${t("dashboard_pct_points")}`}
              />
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={right.turnout.pct} format="pct" />
            </td>
          </tr>
          <tr className="border-b">
            <td className="py-2 px-2 text-muted-foreground">
              {t("compare_total_votes")}
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={left.totalValidVotes} />
            </td>
            <td className="text-right py-2 px-2">
              <Delta
                value={left.totalValidVotes - right.totalValidVotes}
                digits={0}
              />
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={right.totalValidVotes} />
            </td>
          </tr>
          <tr className="border-b">
            <td
              colSpan={4}
              className="py-3 px-2 text-xs uppercase text-muted-foreground"
            >
              {t("compare_parties_section")}
            </td>
          </tr>
          {partyRows.map((r) => {
            const deltaPct =
              r.leftPct !== undefined && r.rightPct !== undefined
                ? r.leftPct - r.rightPct
                : undefined;
            return (
              <tr key={r.nickName} className="border-b">
                <td className="py-2 px-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: r.color || "#888" }}
                    />
                    <Link
                      to={`/party/${r.nickName}`}
                      className="hover:underline truncate"
                      underline={false}
                    >
                      {r.nickName}
                    </Link>
                  </span>
                </td>
                <td className="text-right py-2 px-2">
                  <NumCell value={r.leftPct} format="pct" />
                </td>
                <td className="text-right py-2 px-2">
                  {deltaPct !== undefined ? (
                    <Delta
                      value={deltaPct}
                      suffix={` ${t("dashboard_pct_points")}`}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {r.leftPct === undefined
                        ? t("compare_only_b")
                        : t("compare_only_a")}
                    </span>
                  )}
                </td>
                <td className="text-right py-2 px-2">
                  <NumCell value={r.rightPct} format="pct" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
