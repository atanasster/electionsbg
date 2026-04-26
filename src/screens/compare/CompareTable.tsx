import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { NationalSummary } from "@/data/dashboard/dashboardTypes";
import { formatPct, localDate } from "@/data/utils";
import { Link } from "@/ux/Link";

type Props = {
  left: NationalSummary;
  right: NationalSummary;
};

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

// utils.formatThousands returns "" for 0; we want "0".
const fmtThousands = (n: number) => n.toLocaleString("en-US");

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

export const CompareTable: FC<Props> = ({ left, right }) => {
  const { t } = useTranslation();

  // Union of parties across both elections, keyed by nickName.
  const partyRows = useMemo(() => {
    const map = new Map<
      string,
      {
        nickName: string;
        color?: string;
        leftPct?: number;
        leftVotes?: number;
        leftSeats?: number;
        rightPct?: number;
        rightVotes?: number;
        rightSeats?: number;
      }
    >();
    left.parties.forEach((p) => {
      map.set(p.nickName, {
        nickName: p.nickName,
        color: p.color,
        leftPct: p.pct,
        leftVotes: p.totalVotes,
        leftSeats: p.seats,
      });
    });
    right.parties.forEach((p) => {
      const existing = map.get(p.nickName);
      if (existing) {
        existing.rightPct = p.pct;
        existing.rightVotes = p.totalVotes;
        existing.rightSeats = p.seats;
        if (!existing.color) existing.color = p.color;
      } else {
        map.set(p.nickName, {
          nickName: p.nickName,
          color: p.color,
          rightPct: p.pct,
          rightVotes: p.totalVotes,
          rightSeats: p.seats,
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
  const totalLeftVotes = left.parties.reduce((s, p) => s + p.totalVotes, 0);
  const totalRightVotes = right.parties.reduce((s, p) => s + p.totalVotes, 0);

  const HeaderRow: FC<{ a: string; b: string }> = ({ a, b }) => (
    <tr className="border-b text-xs uppercase text-muted-foreground">
      <th className="text-left py-2 px-2 w-1/3">{t("compare_metric")}</th>
      <th className="text-right py-2 px-2">{a}</th>
      <th className="text-right py-2 px-2 w-24">Δ</th>
      <th className="text-right py-2 px-2">{b}</th>
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <HeaderRow
            a={localDate(left.election)}
            b={localDate(right.election)}
          />
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
              <NumCell value={totalLeftVotes} />
            </td>
            <td className="text-right py-2 px-2">
              <Delta value={totalLeftVotes - totalRightVotes} digits={0} />
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={totalRightVotes} />
            </td>
          </tr>
          <tr className="border-b">
            <td className="py-2 px-2 text-muted-foreground">
              {t("dashboard_anomalies")}
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={left.anomalies.total} />
            </td>
            <td className="text-right py-2 px-2">
              <Delta
                value={left.anomalies.total - right.anomalies.total}
                digits={0}
              />
            </td>
            <td className="text-right py-2 px-2">
              <NumCell value={right.anomalies.total} />
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
                  {r.leftSeats !== undefined && r.leftSeats > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({r.leftSeats})
                    </span>
                  )}
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
                  {r.rightSeats !== undefined && r.rightSeats > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({r.rightSeats})
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
