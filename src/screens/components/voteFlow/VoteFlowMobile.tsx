import { useState } from "react";
import { useTranslation } from "react-i18next";
import { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";
import { formatThousands } from "@/data/utils";
import { cn } from "@/lib/utils";

// Sankey is unreadable below ~600px. On phones we render two stacked party
// lists ("from" then "to"), and tapping a party expands a flow drawer of
// "where its voters went" or "where its voters came from".
export const VoteFlowMobile = ({ matrix }: { matrix: VoteFlowMatrix }) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const [openId, setOpenId] = useState<string | null>(null);
  const [side, setSide] = useState<"from" | "to">("from");

  const labelOf = (n: { label: string; labelEn: string }) =>
    isEn ? n.labelEn : n.label;

  const nodes = side === "from" ? matrix.fromNodes : matrix.toNodes;
  const total = nodes.reduce((s, n) => s + n.votes, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex items-center self-start gap-1 rounded-lg bg-muted p-1">
        <button
          className={cn(
            "px-3 py-1 text-xs rounded",
            side === "from" ? "bg-background shadow" : "text-muted-foreground",
          )}
          onClick={() => setSide("from")}
        >
          {t("vote_flow_mobile_side_from")}
        </button>
        <button
          className={cn(
            "px-3 py-1 text-xs rounded",
            side === "to" ? "bg-background shadow" : "text-muted-foreground",
          )}
          onClick={() => setSide("to")}
        >
          {t("vote_flow_mobile_side_to")}
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {nodes
          .slice()
          .sort((a, b) => b.votes - a.votes)
          .map((n) => {
            const isOpen = openId === n.id;
            const pct = total > 0 ? (n.votes / total) * 100 : 0;
            const matchKey = side === "from" ? "from" : "to";
            const otherKey = side === "from" ? "to" : "from";
            const otherNodes =
              side === "from" ? matrix.toNodes : matrix.fromNodes;
            const flows = matrix.flows
              .filter((f) => f[matchKey] === n.id)
              .sort((a, b) => b.votes - a.votes)
              .slice(0, 8);
            return (
              <li
                key={n.id}
                className="rounded border border-border bg-card overflow-hidden"
              >
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
                  onClick={() => setOpenId(isOpen ? null : n.id)}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: n.color }}
                  />
                  <span className="flex-1 truncate text-sm">{labelOf(n)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {pct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-foreground tabular-nums">
                    {formatThousands(n.votes)}
                  </span>
                </button>
                {isOpen && (
                  <ul className="border-t border-border bg-muted/30 px-3 py-2 flex flex-col gap-1 text-xs">
                    {flows.map((f) => {
                      const otherId = f[otherKey];
                      const other = otherNodes.find((x) => x.id === otherId);
                      if (!other) return null;
                      const subPct =
                        n.votes > 0 ? (f.votes / n.votes) * 100 : 0;
                      return (
                        <li
                          key={`${n.id}->${otherId}`}
                          className="flex items-center gap-2"
                        >
                          <span
                            className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: other.color }}
                          />
                          <span className="flex-1 truncate">
                            {labelOf(other)}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {subPct.toFixed(1)}%
                          </span>
                          <span className="text-foreground tabular-nums">
                            {formatThousands(f.votes)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
};
