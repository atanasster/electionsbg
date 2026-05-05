import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionsStats } from "@/data/parliament/useConnectionsStats";
import { useConnectionsPartyMatrix } from "@/data/parliament/useConnectionsPartyMatrix";
import { cn } from "@/lib/utils";

type Props = {
  /** Selected NS folder, or `null` for "All parliaments". */
  ns: string | null;
  /** Optional click handler to filter the Strongest Ties tab when a heatmap
   * cell is clicked. Receives the cell's two parties; the parent decides
   * what filter to apply. */
  onCellClick?: (partyA: string, partyB: string) => void;
};

/** Hero block above the tabs: a one-sentence stat + a clickable party × party
 * heatmap. Both data sources are precomputed at build time so this renders
 * without loading the global graph. */
export const ConnectionsHero: FC<Props> = ({ ns, onCellClick }) => {
  const { t } = useTranslation();
  const { stats } = useConnectionsStats();
  const { matrix } = useConnectionsPartyMatrix();

  const scope = useMemo(() => {
    if (!stats) return null;
    return ns ? (stats.byNs[ns] ?? null) : stats.all;
  }, [stats, ns]);

  const matrixScope = useMemo(() => {
    if (!matrix) return null;
    return ns ? (matrix.byNs[ns] ?? null) : matrix.all;
  }, [matrix, ns]);

  if (!scope || scope.mpsConnected === 0) {
    // Don't render an empty hero — the page still has tabs below for the
    // user to explore. Showing "0 MPs connected" would be confusing on
    // parliaments without coverage.
    return null;
  }

  return (
    <div className="my-4 rounded-lg border border-border/60 bg-muted/20 p-4">
      <p className="text-sm md:text-base">
        <strong className="text-foreground tabular-nums">
          {scope.mpsConnected}
        </strong>{" "}
        {ns
          ? t("connections_hero_mps_in_ns", {
              count: scope.mpsConnected,
              nsLabel: ns,
            }) || `MPs in parliament ${ns}`
          : t("connections_hero_mps_lifetime", { count: scope.mpsConnected }) ||
            "MPs across all parliaments"}{" "}
        {scope.otherMpsReached > 0 && (
          <>
            {t("connections_hero_have_ties_to") || "have ties to"}{" "}
            <strong className="text-foreground tabular-nums">
              {scope.otherMpsReached}
            </strong>{" "}
            {t("connections_hero_others") || "others"}{" "}
          </>
        )}
        {t("connections_hero_through") || "through"}{" "}
        <strong className="text-foreground tabular-nums">
          {scope.sharedCompanies}
        </strong>{" "}
        {t("connections_hero_companies") || "shared companies"}.
      </p>

      {matrixScope && matrixScope.parties.length >= 2 && (
        <div className="mt-3">
          <PartyHeatmap scope={matrixScope} onCellClick={onCellClick} />
        </div>
      )}
    </div>
  );
};

const cellKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const PartyHeatmap: FC<{
  scope: { parties: string[]; cells: Record<string, { tieCount: number }> };
  onCellClick?: (a: string, b: string) => void;
}> = ({ scope, onCellClick }) => {
  const { t } = useTranslation();

  const maxTie = useMemo(() => {
    let m = 0;
    for (const c of Object.values(scope.cells)) {
      if (c.tieCount > m) m = c.tieCount;
    }
    return m;
  }, [scope]);

  if (maxTie === 0) return null;

  // Log-scale brightness — without this, one mega-cell drowns out everything
  // else. We add 1 inside the log to keep the lowest cell visible.
  const intensity = (n: number) =>
    n === 0 ? 0 : Math.log(n + 1) / Math.log(maxTie + 1);

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1.5">
        {t("connections_hero_matrix_caption") ||
          "Party × party MP↔MP ties — click a cell to drill in."}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="w-32" />
              {scope.parties.map((p) => (
                <th
                  key={`col-${p}`}
                  className="text-[10px] font-normal text-muted-foreground px-1 py-0.5 align-bottom whitespace-nowrap"
                  style={{
                    transform: "rotate(-45deg)",
                    transformOrigin: "left top",
                    height: 60,
                  }}
                >
                  <span className="block max-w-[100px] truncate">{p}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scope.parties.map((rowParty) => (
              <tr key={`row-${rowParty}`}>
                <td className="text-[10px] text-muted-foreground pr-2 whitespace-nowrap">
                  {rowParty}
                </td>
                {scope.parties.map((colParty) => {
                  const k = cellKey(rowParty, colParty);
                  const cell = scope.cells[k];
                  const count = cell?.tieCount ?? 0;
                  const t01 = intensity(count);
                  return (
                    <td
                      key={k + "-" + colParty}
                      className="p-0 border border-border/40"
                    >
                      <button
                        type="button"
                        disabled={count === 0}
                        onClick={() => {
                          if (count > 0 && onCellClick)
                            onCellClick(rowParty, colParty);
                        }}
                        className={cn(
                          "block w-7 h-7 text-[10px] tabular-nums",
                          count === 0
                            ? "cursor-default"
                            : "cursor-pointer hover:ring-1 hover:ring-primary",
                        )}
                        style={
                          count === 0
                            ? undefined
                            : {
                                backgroundColor: `rgba(37, 99, 235, ${0.1 + t01 * 0.7})`,
                                color: t01 > 0.5 ? "white" : undefined,
                              }
                        }
                        aria-label={`${rowParty} × ${colParty}: ${count}`}
                      >
                        {count > 0 ? count : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
