import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatPct } from "@/data/utils";
import { Link } from "@/ux/Link";
import { PartySummary } from "./partySummary";

type Props = {
  left: PartySummary;
  right: PartySummary;
};

const fmtThousands = (n: number) => n.toLocaleString("en-US");

const Delta: FC<{
  value: number;
  suffix?: string;
  digits?: number;
  invert?: boolean;
}> = ({ value, suffix, digits = 2, invert = false }) => {
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  const positive = invert ? value < 0 : value > 0;
  const negative = invert ? value > 0 : value < 0;
  const tone = positive
    ? "text-positive"
    : negative
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

const NumCell: FC<{
  value?: number;
  format?: "thousands" | "pct";
  digits?: number;
}> = ({ value, format = "thousands", digits = 2 }) => (
  <span className="tabular-nums font-medium">
    {value === undefined
      ? "—"
      : format === "pct"
        ? formatPct(value, digits)
        : fmtThousands(value)}
  </span>
);

const Cell: FC<{ children: ReactNode }> = ({ children }) => (
  <td className="text-right py-2 px-2">{children}</td>
);

const Row: FC<{
  label: string;
  leftContent: ReactNode;
  rightContent: ReactNode;
  delta?: ReactNode;
}> = ({ label, leftContent, rightContent, delta }) => (
  <tr className="border-b">
    <td className="py-2 px-2 text-muted-foreground">{label}</td>
    <Cell>{leftContent}</Cell>
    <Cell>
      {delta ?? <span className="text-xs text-muted-foreground">—</span>}
    </Cell>
    <Cell>{rightContent}</Cell>
  </tr>
);

const SectionRow: FC<{ label: string }> = ({ label }) => (
  <tr className="border-b">
    <td
      colSpan={4}
      className="py-3 px-2 text-xs uppercase text-muted-foreground"
    >
      {label}
    </td>
  </tr>
);

const PartyHeader: FC<{ p: PartySummary }> = ({ p }) => (
  <Link
    to={`/party/${p.nickName}`}
    className="hover:underline"
    underline={false}
  >
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block w-3 h-3 rounded-sm shrink-0"
        style={{ backgroundColor: p.color || "#888" }}
      />
      {p.nickName}
    </span>
  </Link>
);

export const ComparePartiesTable: FC<Props> = ({ left, right }) => {
  const { t } = useTranslation();
  const pp = ` ${t("dashboard_pct_points")}`;

  const hasMachine =
    left.machineVotes !== undefined || right.machineVotes !== undefined;
  const hasFlash =
    left.flashDiff !== undefined || right.flashDiff !== undefined;
  const hasPreferences =
    left.preferencesTotal !== undefined || right.preferencesTotal !== undefined;
  const hasRisk =
    left.riskSectionsVotes !== undefined ||
    right.riskSectionsVotes !== undefined;
  const hasRecount =
    left.recountAdded !== undefined || right.recountAdded !== undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-muted-foreground">
            <th className="text-left py-2 px-2 w-1/3">{t("compare_metric")}</th>
            <th className="text-right py-2 px-2">
              <PartyHeader p={left} />
            </th>
            <th className="text-right py-2 px-2 w-24">Δ</th>
            <th className="text-right py-2 px-2">
              <PartyHeader p={right} />
            </th>
          </tr>
        </thead>
        <tbody>
          <SectionRow label={t("compare_section_result")} />
          <Row
            label={t("compare_party_pct")}
            leftContent={<NumCell value={left.pct} format="pct" />}
            rightContent={<NumCell value={right.pct} format="pct" />}
            delta={<Delta value={left.pct - right.pct} suffix={pp} />}
          />
          <Row
            label={t("compare_party_votes")}
            leftContent={<NumCell value={left.totalVotes} />}
            rightContent={<NumCell value={right.totalVotes} />}
            delta={
              <Delta value={left.totalVotes - right.totalVotes} digits={0} />
            }
          />
          <Row
            label={t("compare_party_seats")}
            leftContent={<NumCell value={left.seats} />}
            rightContent={<NumCell value={right.seats} />}
            delta={<Delta value={left.seats - right.seats} digits={0} />}
          />
          <Row
            label={t("compare_party_position")}
            leftContent={
              <span className="tabular-nums font-medium">
                {left.position || "—"}
              </span>
            }
            rightContent={
              <span className="tabular-nums font-medium">
                {right.position || "—"}
              </span>
            }
            // Lower position is better → invert delta colors.
            delta={
              left.position && right.position ? (
                <Delta
                  value={left.position - right.position}
                  digits={0}
                  invert
                />
              ) : undefined
            }
          />
          <Row
            label={t("compare_party_threshold")}
            leftContent={
              <span
                className={
                  left.passedThreshold
                    ? "text-positive"
                    : "text-muted-foreground"
                }
              >
                {left.passedThreshold ? "✓" : "—"}
              </span>
            }
            rightContent={
              <span
                className={
                  right.passedThreshold
                    ? "text-positive"
                    : "text-muted-foreground"
                }
              >
                {right.passedThreshold ? "✓" : "—"}
              </span>
            }
          />

          <SectionRow label={t("compare_section_strongholds")} />
          <Row
            label={t("compare_top_region")}
            leftContent={
              left.topRegion ? (
                <span className="tabular-nums">
                  <span className="font-medium">{left.topRegion.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({formatPct(left.topRegion.pct, 1)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
            rightContent={
              right.topRegion ? (
                <span className="tabular-nums">
                  <span className="font-medium">{right.topRegion.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({formatPct(right.topRegion.pct, 1)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
          />
          <Row
            label={t("compare_top_settlement")}
            leftContent={
              left.topSettlement ? (
                <span className="tabular-nums">
                  <span className="font-medium">{left.topSettlement.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({formatPct(left.topSettlement.pct, 1)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
            rightContent={
              right.topSettlement ? (
                <span className="tabular-nums">
                  <span className="font-medium">
                    {right.topSettlement.name}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({formatPct(right.topSettlement.pct, 1)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
          />

          {hasMachine && (
            <>
              <SectionRow label={t("compare_section_modality")} />
              <Row
                label={t("compare_paper_pct")}
                leftContent={
                  <NumCell value={left.paperPct} format="pct" digits={1} />
                }
                rightContent={
                  <NumCell value={right.paperPct} format="pct" digits={1} />
                }
                delta={
                  left.paperPct !== undefined &&
                  right.paperPct !== undefined ? (
                    <Delta
                      value={left.paperPct - right.paperPct}
                      suffix={pp}
                      digits={1}
                    />
                  ) : undefined
                }
              />
              <Row
                label={t("compare_machine_votes")}
                leftContent={<NumCell value={left.machineVotes} />}
                rightContent={<NumCell value={right.machineVotes} />}
                delta={
                  left.machineVotes !== undefined &&
                  right.machineVotes !== undefined ? (
                    <Delta
                      value={left.machineVotes - right.machineVotes}
                      digits={0}
                    />
                  ) : undefined
                }
              />
              {hasFlash && (
                <Row
                  label={t("compare_flash_diff")}
                  leftContent={<NumCell value={left.flashDiff} />}
                  rightContent={<NumCell value={right.flashDiff} />}
                  delta={
                    left.flashDiff !== undefined &&
                    right.flashDiff !== undefined ? (
                      <Delta
                        value={left.flashDiff - right.flashDiff}
                        digits={0}
                      />
                    ) : undefined
                  }
                />
              )}
            </>
          )}

          {hasPreferences && (
            <>
              <SectionRow label={t("compare_section_preferences")} />
              <Row
                label={t("compare_preferences_total")}
                leftContent={<NumCell value={left.preferencesTotal} />}
                rightContent={<NumCell value={right.preferencesTotal} />}
                delta={
                  left.preferencesTotal !== undefined &&
                  right.preferencesTotal !== undefined ? (
                    <Delta
                      value={left.preferencesTotal - right.preferencesTotal}
                      digits={0}
                    />
                  ) : undefined
                }
              />
              <Row
                label={t("compare_preferences_share")}
                leftContent={
                  <NumCell
                    value={left.preferencesPct}
                    format="pct"
                    digits={1}
                  />
                }
                rightContent={
                  <NumCell
                    value={right.preferencesPct}
                    format="pct"
                    digits={1}
                  />
                }
                delta={
                  left.preferencesPct !== undefined &&
                  right.preferencesPct !== undefined ? (
                    <Delta
                      value={left.preferencesPct - right.preferencesPct}
                      suffix={pp}
                      digits={1}
                    />
                  ) : undefined
                }
              />
              <Row
                label={t("compare_top_candidate")}
                leftContent={
                  left.topCandidate ? (
                    <span>
                      <span className="font-medium">
                        {left.topCandidate.name}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1 tabular-nums">
                        ({fmtThousands(left.topCandidate.votes)})
                      </span>
                    </span>
                  ) : (
                    "—"
                  )
                }
                rightContent={
                  right.topCandidate ? (
                    <span>
                      <span className="font-medium">
                        {right.topCandidate.name}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1 tabular-nums">
                        ({fmtThousands(right.topCandidate.votes)})
                      </span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            </>
          )}

          {(hasRisk || hasRecount) && (
            <SectionRow label={t("compare_section_anomalies")} />
          )}
          {hasRisk && (
            <>
              <Row
                label={t("compare_risk_votes")}
                leftContent={<NumCell value={left.riskSectionsVotes} />}
                rightContent={<NumCell value={right.riskSectionsVotes} />}
                delta={
                  left.riskSectionsVotes !== undefined &&
                  right.riskSectionsVotes !== undefined ? (
                    <Delta
                      value={left.riskSectionsVotes - right.riskSectionsVotes}
                      digits={0}
                    />
                  ) : undefined
                }
              />
              <Row
                label={t("compare_risk_share")}
                leftContent={
                  <NumCell
                    value={left.riskSectionsPct}
                    format="pct"
                    digits={2}
                  />
                }
                rightContent={
                  <NumCell
                    value={right.riskSectionsPct}
                    format="pct"
                    digits={2}
                  />
                }
                delta={
                  left.riskSectionsPct !== undefined &&
                  right.riskSectionsPct !== undefined ? (
                    <Delta
                      value={left.riskSectionsPct - right.riskSectionsPct}
                      suffix={pp}
                      digits={2}
                    />
                  ) : undefined
                }
              />
            </>
          )}
          {hasRecount && (
            <>
              <Row
                label={t("compare_recount_added")}
                leftContent={<NumCell value={left.recountAdded} />}
                rightContent={<NumCell value={right.recountAdded} />}
                delta={
                  left.recountAdded !== undefined &&
                  right.recountAdded !== undefined ? (
                    <Delta
                      value={left.recountAdded - right.recountAdded}
                      digits={0}
                    />
                  ) : undefined
                }
              />
              <Row
                label={t("compare_recount_removed")}
                leftContent={<NumCell value={left.recountRemoved} />}
                rightContent={<NumCell value={right.recountRemoved} />}
                delta={
                  left.recountRemoved !== undefined &&
                  right.recountRemoved !== undefined ? (
                    <Delta
                      value={left.recountRemoved - right.recountRemoved}
                      digits={0}
                    />
                  ) : undefined
                }
              />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};
