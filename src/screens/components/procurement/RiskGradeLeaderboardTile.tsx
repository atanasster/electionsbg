// "Riskiest institutions" leaderboard — top buyers by the multi-component A–F
// procurement risk grade (awarder_risk_grade_scoped, schema 041). Scoped to the
// live ?pscope window (like the rest of the module); each row links to the
// buyer's /awarder page where the full grade breakdown lives. Grade is
// share-of-value-weighted EXPOSURE, footnoted as such.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useAwarderRiskTop } from "@/data/procurement/useAwarderRiskTop";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { GRADE_TONE } from "@/lib/riskGrade";

// Exported so the parent screen can query the same data (React Query dedupes by
// key) to decide whether to render the tile's grid column at all.
export const RISK_GRADE_BOARD_PREVIEW = 8;
export const RISK_GRADE_BOARD_MIN_SCORE = 55; // E floor (per risk_grade_letter)

export const RiskGradeLeaderboardTile: FC = () => {
  // Carry the active scope (pscope/elections) onto the awarder page — a bare
  // pathname resets it to the default window (see SectorAwardersTile).
  const scopedHref = useScopedHref();
  const { t, i18n } = useTranslation();
  // E and worse — the leaderboard is about the elevated tail.
  const { data } = useAwarderRiskTop(
    RISK_GRADE_BOARD_PREVIEW,
    RISK_GRADE_BOARD_MIN_SCORE,
  );
  if (!data || data.rows.length === 0) return null;
  // The DB fell back to the corpus when the selected scope had no precomputed
  // rows — badge it so these all-years leaders aren't read as the selected period.
  const fellBack = data.scope !== data.requested && data.scope === "all";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          {t("risk_grade_board_title") || "Riskiest buyers (grade)"}
          {fellBack ? (
            <span className="text-[11px] font-normal text-muted-foreground">
              {t("risk_grade_board_allyears") || "all years"}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <ul className="flex flex-col">
          {data.rows.map((e) => (
            <li
              key={e.eik}
              className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold ${
                  (GRADE_TONE[e.grade] ?? GRADE_TONE.C).chip
                }`}
              >
                {e.grade}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <Link
                  to={scopedHref(`/awarder/${e.eik}`)}
                  className="hover:underline"
                >
                  {decodeEntities(e.name) || e.eik}
                </Link>
              </span>
              <span className="tabular-nums text-xs text-muted-foreground shrink-0">
                {formatEurCompact(e.totalEur, i18n.language)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {t("risk_grade_board_hint") ||
            "Share-of-value-weighted exposure (single-bid, direct award, supplier concentration, political links) — a pattern signal, not proof."}
        </p>
      </CardContent>
    </Card>
  );
};
