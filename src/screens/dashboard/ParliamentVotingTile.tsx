import { FC, Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { usePartyCorrelation } from "@/data/parliament/votes/usePartyCorrelation";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";

const MAX_PARTIES = 8;

// Linear gradient from red (anti-correlated) through neutral grey to green
// (highly correlated). Diagonal cells (self-similarity = 1) render as the
// strongest green.
const cellColor = (score: number): string => {
  const v = Math.max(-1, Math.min(1, score));
  if (v >= 0) {
    const alpha = v;
    return `rgba(16, 185, 129, ${alpha})`;
  }
  const alpha = -v;
  return `rgba(239, 68, 68, ${alpha})`;
};

// Compact label for axis cells — group short name, truncated when long. The
// full name is in the cell title attribute / tooltip.
const compact = (s: string): string => (s.length > 8 ? `${s.slice(0, 7)}…` : s);

export const ParliamentVotingTile: FC = () => {
  const { t } = useTranslation();
  const { file, isLoading } = usePartyCorrelation();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();

  const view = useMemo(() => {
    if (!file) return null;
    const parties = file.parties.slice(0, MAX_PARTIES);
    const matrix = parties.map((_, i) =>
      parties.map((__, j) => file.matrix[i]?.[j] ?? 0),
    );
    return { parties, matrix };
  }, [file]);

  if (isLoading) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (!view || view.parties.length < 2) return null;

  const labelOf = (short: string) => labelForPartyShort(short) || short;
  const colorOf = (short: string) => colorForPartyShort(short) ?? "#94a3b8";

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Vote className="h-4 w-4" />
          {t("dashboard_parliament_voting_title") || "Parliament voting"}
          <Link
            to="/parliament"
            underline={false}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <p className="text-sm text-muted-foreground mb-4">
          {t("dashboard_parliament_voting_desc") ||
            "How parliamentary groups vote in relation to one another. Cells show cosine similarity of each pair's majority-vote vectors — greener cells mean the two groups vote alike, redder cells mean they vote against each other."}
        </p>

        <div
          className="flex-1 grid gap-[2px] text-[10px]"
          style={{
            gridTemplateColumns: `auto repeat(${view.parties.length}, minmax(0, 1fr))`,
            gridTemplateRows: `auto repeat(${view.parties.length}, minmax(0, 1fr))`,
          }}
        >
          {/* top-left blank corner */}
          <div />
          {/* column headers */}
          {view.parties.map((p) => (
            <div
              key={`col-${p}`}
              title={labelOf(p)}
              className="flex items-end justify-center px-1"
            >
              <div
                className="font-medium whitespace-nowrap"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  color: colorOf(p),
                  maxHeight: 80,
                }}
              >
                {compact(labelOf(p))}
              </div>
            </div>
          ))}
          {/* rows: label + cells */}
          {view.parties.map((rowParty, i) => (
            <Fragment key={`row-${rowParty}`}>
              <div
                title={labelOf(rowParty)}
                className="flex items-center justify-end pr-2 font-medium whitespace-nowrap"
                style={{ color: colorOf(rowParty), maxWidth: 110 }}
              >
                <span className="truncate inline-block max-w-[110px]">
                  {compact(labelOf(rowParty))}
                </span>
              </div>
              {view.parties.map((colParty, j) => {
                const score = view.matrix[i][j];
                const cell = (
                  <div
                    className="flex items-center justify-center tabular-nums rounded h-full w-full"
                    style={{
                      backgroundColor: cellColor(score),
                      color:
                        Math.abs(score) > 0.55
                          ? "rgba(255,255,255,0.95)"
                          : "var(--foreground)",
                    }}
                  >
                    {i === j ? "" : score === 0 ? "–" : Math.round(score * 100)}
                  </div>
                );
                if (i === j) {
                  return (
                    <div key={`${rowParty}-${colParty}`} className="contents">
                      {cell}
                    </div>
                  );
                }
                const verdict =
                  score >= 0.55
                    ? t("dashboard_parliament_legend_together")
                    : score <= -0.2
                      ? t("dashboard_parliament_legend_against")
                      : t("dashboard_parliament_legend_neutral");
                return (
                  <Tooltip
                    key={`${rowParty}-${colParty}`}
                    className="max-w-64 p-2.5"
                    content={
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className="font-semibold truncate"
                            style={{ color: colorOf(rowParty) }}
                          >
                            {labelOf(rowParty)}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            ↔
                          </span>
                          <span
                            className="font-semibold truncate text-right"
                            style={{ color: colorOf(colParty) }}
                          >
                            {labelOf(colParty)}
                          </span>
                        </div>
                        <div className="border-t border-border pt-2 flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">
                            {t("similarity_score") || "similarity"}
                          </span>
                          <span className="font-semibold tabular-nums text-sm">
                            {(score * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          {verdict}
                        </div>
                      </div>
                    }
                  >
                    {cell}
                  </Tooltip>
                );
              })}
            </Fragment>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground mt-3 text-right">
          {t("dashboard_parliament_legend_note") ||
            "Values are % cosine over per-item majority vectors."}
        </p>
      </CardContent>
    </Card>
  );
};
