import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatPct, localDate } from "@/data/utils";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { Link } from "@/ux/Link";
import { candidateUrlFor } from "@/data/candidates/candidateSlug";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateSummary } from "./candidateSummary";

type Props = {
  left: CandidateSummary;
  right: CandidateSummary;
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

const CandidateHeader: FC<{ c: CandidateSummary }> = ({ c }) => {
  const { displayNameFor } = useCanonicalParties();
  const { nameForBg } = useCandidateName();
  const display = nameForBg(c.name, c.name_en ?? null);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Link
        to={candidateUrlFor({
          partyNum: c.party?.number ?? null,
          name: c.name,
        })}
        className="hover:underline"
        underline={false}
      >
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: c.party?.color || "#888" }}
          />
          <span className="font-medium normal-case">{display}</span>
        </span>
      </Link>
      <span className="text-xs text-muted-foreground normal-case">
        {c.party?.nickName
          ? (displayNameFor(c.party.nickName) ?? c.party.nickName)
          : "—"}
        {c.oblastNames.length > 0 && <> · {c.oblastNames.join(", ")}</>}
        {c.prefs.length > 0 && (
          <>
            {" · "}#{c.prefs.join(", #")}
          </>
        )}
      </span>
    </div>
  );
};

export const CompareCandidatesTable: FC<Props> = ({ left, right }) => {
  const { t } = useTranslation();
  const pp = ` ${t("dashboard_pct_points")}`;

  const hasPaper =
    left.paperVotes !== undefined || right.paperVotes !== undefined;
  const hasMachine =
    left.machineVotes !== undefined || right.machineVotes !== undefined;
  const hasPaperShare =
    left.paperPct !== undefined || right.paperPct !== undefined;
  const hasShareParty =
    left.sharePartyPrefs !== undefined ||
    right.sharePartyPrefs !== undefined ||
    left.sharePartyVotes !== undefined ||
    right.sharePartyVotes !== undefined;
  const hasHistory =
    left.timesContested > 0 ||
    right.timesContested > 0 ||
    !!left.pastBest ||
    !!right.pastBest;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-muted-foreground">
            <th className="text-left py-2 px-2 w-1/4">{t("compare_metric")}</th>
            <th className="text-right py-2 px-2 align-bottom">
              <CandidateHeader c={left} />
            </th>
            <th className="text-right py-2 px-2 w-24">Δ</th>
            <th className="text-right py-2 px-2 align-bottom">
              <CandidateHeader c={right} />
            </th>
          </tr>
        </thead>
        <tbody>
          <SectionRow label={t("compare_section_result")} />
          <Row
            label={t("compare_candidate_total")}
            leftContent={<NumCell value={left.totalVotes} />}
            rightContent={<NumCell value={right.totalVotes} />}
            delta={
              <Delta value={left.totalVotes - right.totalVotes} digits={0} />
            }
          />
          {hasPaper && (
            <Row
              label={t("compare_candidate_paper")}
              leftContent={<NumCell value={left.paperVotes} />}
              rightContent={<NumCell value={right.paperVotes} />}
              delta={
                left.paperVotes !== undefined &&
                right.paperVotes !== undefined ? (
                  <Delta
                    value={left.paperVotes - right.paperVotes}
                    digits={0}
                  />
                ) : undefined
              }
            />
          )}
          {hasMachine && (
            <Row
              label={t("compare_candidate_machine")}
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
          )}
          {hasPaperShare && (
            <Row
              label={t("compare_candidate_paper_share")}
              leftContent={
                <NumCell value={left.paperPct} format="pct" digits={1} />
              }
              rightContent={
                <NumCell value={right.paperPct} format="pct" digits={1} />
              }
              delta={
                left.paperPct !== undefined && right.paperPct !== undefined ? (
                  <Delta
                    value={left.paperPct - right.paperPct}
                    suffix={pp}
                    digits={1}
                  />
                ) : undefined
              }
            />
          )}

          {hasShareParty && (
            <>
              <SectionRow label={t("compare_section_party_context")} />
              <Row
                label={t("compare_share_party_prefs")}
                leftContent={
                  <NumCell
                    value={left.sharePartyPrefs}
                    format="pct"
                    digits={1}
                  />
                }
                rightContent={
                  <NumCell
                    value={right.sharePartyPrefs}
                    format="pct"
                    digits={1}
                  />
                }
                delta={
                  left.sharePartyPrefs !== undefined &&
                  right.sharePartyPrefs !== undefined ? (
                    <Delta
                      value={left.sharePartyPrefs - right.sharePartyPrefs}
                      suffix={pp}
                      digits={1}
                    />
                  ) : undefined
                }
              />
              <Row
                label={t("compare_share_party_votes")}
                leftContent={
                  <NumCell
                    value={left.sharePartyVotes}
                    format="pct"
                    digits={2}
                  />
                }
                rightContent={
                  <NumCell
                    value={right.sharePartyVotes}
                    format="pct"
                    digits={2}
                  />
                }
                delta={
                  left.sharePartyVotes !== undefined &&
                  right.sharePartyVotes !== undefined ? (
                    <Delta
                      value={left.sharePartyVotes - right.sharePartyVotes}
                      suffix={pp}
                      digits={2}
                    />
                  ) : undefined
                }
              />
            </>
          )}

          <SectionRow label={t("compare_section_strongholds")} />
          <Row
            label={t("compare_top_region")}
            leftContent={
              left.topRegion ? (
                <span className="tabular-nums">
                  <span className="font-medium">{left.topRegion.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({fmtThousands(left.topRegion.votes)})
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
                    ({fmtThousands(right.topRegion.votes)})
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
                    ({fmtThousands(left.topSettlement.votes)})
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
                    ({fmtThousands(right.topSettlement.votes)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
          />
          <Row
            label={t("compare_top_section")}
            leftContent={
              left.topSection ? (
                <span className="tabular-nums">
                  <Link
                    to={`/section/${left.topSection.section}`}
                    underline={false}
                    className="font-medium hover:underline"
                  >
                    {left.topSection.section}
                  </Link>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({fmtThousands(left.topSection.votes)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
            rightContent={
              right.topSection ? (
                <span className="tabular-nums">
                  <Link
                    to={`/section/${right.topSection.section}`}
                    underline={false}
                    className="font-medium hover:underline"
                  >
                    {right.topSection.section}
                  </Link>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({fmtThousands(right.topSection.votes)})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
          />

          {hasHistory && (
            <>
              <SectionRow label={t("compare_section_history")} />
              <Row
                label={t("compare_times_contested")}
                leftContent={<NumCell value={left.timesContested} />}
                rightContent={<NumCell value={right.timesContested} />}
                delta={
                  <Delta
                    value={left.timesContested - right.timesContested}
                    digits={0}
                  />
                }
              />
              <Row
                label={t("compare_past_best")}
                leftContent={
                  left.pastBest ? (
                    <span className="tabular-nums">
                      <span className="font-medium">
                        {fmtThousands(left.pastBest.votes)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        ({localDate(left.pastBest.date)})
                      </span>
                    </span>
                  ) : (
                    "—"
                  )
                }
                rightContent={
                  right.pastBest ? (
                    <span className="tabular-nums">
                      <span className="font-medium">
                        {fmtThousands(right.pastBest.votes)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        ({localDate(right.pastBest.date)})
                      </span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};
