// "Най-рискови договори" — the contract-grain leaderboard, sibling of
// RiskGradeLeaderboardTile (which ranks buyers). Ranks individual contracts by
// how many of the 12 automated checks fired, off the server-side index
// (contract_risk_cache, 112), so it spans the whole corpus.
//
// ⚠️ FRAMING is load-bearing here in a way it is not on the buyer board: a
// letter next to a NAMED COMPANY's contract is a much stronger public claim
// than an aggregate over a buyer's portfolio. So every row shows the denominator
// ("4 от 10 проверки"), the grade is never rendered without the count beside it,
// each row links to the contract page where the per-check ledger says which
// checks fired AND which were not checkable, and the tile carries the same
// non-verdict footnote as the meters. This is an indicator for review, not a
// finding of wrongdoing.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { GRADE_TONE } from "@/lib/riskGrade";
import { useRiskiestContracts } from "@/data/procurement/useRiskiestContracts";

export const RISKIEST_CONTRACTS_PREVIEW = 8;

export const RiskiestContractsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data } = useRiskiestContracts(RISKIEST_CONTRACTS_PREVIEW);
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          {t("risk_board_contracts_title") || "Най-рискови договори"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((c) => {
          const tone = c.riskGrade ? GRADE_TONE[c.riskGrade] : undefined;
          return (
            <Link
              key={c.key}
              to={`/procurement/contract/${c.key}`}
              className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
            >
              {/* tone.chip carries its own dark: variants, so the badge stays
                  legible in both themes without a second colour source. */}
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold tabular-nums ${tone?.chip ?? ""}`}
              >
                {c.riskGrade}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {decodeEntities(c.contractorName ?? "—")}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {decodeEntities(c.awarderName ?? "")}
                </span>
              </span>
              {/* The denominator travels with the grade — a letter alone would
                  overstate what these checks establish. */}
              <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                {c.riskFired} {t("risk_cri_of") || "от"} {c.riskAvailable}{" "}
                {t("risk_board_checks_abbr") || "проверки"}
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums">
                {c.amountEur != null
                  ? formatEurCompact(c.amountEur, i18n.language)
                  : ""}
              </span>
            </Link>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground">
          {t("risk_board_contracts_note") ||
            "Брой задействани автоматични проверки — индикатор за преглед, не доказателство за нарушение."}
        </p>
      </CardContent>
    </Card>
  );
};
