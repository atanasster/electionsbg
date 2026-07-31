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

import { FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { realSignedDate } from "@/lib/signedDate";
import { GRADE_TONE } from "@/lib/riskGrade";
import {
  RISKIEST_GRADES,
  useRiskiestContracts,
} from "@/data/procurement/useRiskiestContracts";

export const RISKIEST_CONTRACTS_PREVIEW = 8;

export const RiskiestContractsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data } = useRiskiestContracts(RISKIEST_CONTRACTS_PREVIEW);
  // "See all" opens the contracts browser pre-filtered to the SAME set the tile
  // previews: ?grade=D,E,F (server-side, migration 112) on top of the current
  // search string, which carries ?pscope so the destination keeps this window.
  // The browser sorts by amount rather than by fired count — the risk column is
  // sortable there — but the row set is identical.
  const [params] = useSearchParams();
  const seeAllHref = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("grade", RISKIEST_GRADES.join(","));
    return { pathname: "/procurement/contracts", search: `?${p.toString()}` };
  }, [params]);
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-600" />
            {t("risk_board_contracts_title") || "Най-рискови договори"}
          </span>
          <Link
            to={seeAllHref}
            className="shrink-0 text-[10px] font-normal normal-case text-primary hover:underline"
          >
            {t("procurement_tile_see_all") || "Виж всички"} →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((c) => {
          const tone = c.riskGrade ? GRADE_TONE[c.riskGrade] : undefined;
          // THE DATE ON THE ROW IS `date`, THE COLUMN THE SCOPE FILTERS ON —
          // deliberately, even though the contract page headlines the signature.
          // The two differ on 98% of these rows and land in DIFFERENT YEARS on
          // 13% of them (measured over the 3,199 D/E/F contracts), so a signed
          // date here would put "2022-07-25" in a board captioned 2024 — a
          // weaker replay of the very mismatch the scope fix closes. The
          // signature is not lost: it rides the tooltip when it is genuinely
          // distinct (realSignedDate — `date_signed` falls back to `date` at
          // load, see @/lib/signedDate) and the contract page leads with it.
          const signedTip = realSignedDate(c);
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
              {/* NO per-check chips here, deliberately — the plan called this
                  "free" and it is not. RiskBadges wraps every chip in a Tooltip,
                  whose touch branch is a role="button" span that does not
                  preventDefault: inside this row's <a>, tapping a chip would open
                  the popover AND navigate away, and 8 rows x ~6 chips adds ~48
                  focusable triggers to one tile. Every other RiskBadges call site
                  puts it BESIDE a link, never inside one. The row already carries
                  the grade and the denominator, and links to the contract page
                  where the per-check ledger is authoritative. */}
              {/* Subject first, then when/who/whom on the sub-line: a flagged
                  contract is read as "what was bought", and the date says which
                  window it falls in — the tile is scope-bounded, so a row dated
                  outside the selected period would be a contradiction, not a
                  detail. Both lines truncate; the full title is the title attr. */}
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm"
                  title={decodeEntities(c.title ?? "") || undefined}
                >
                  {decodeEntities(c.title || c.contractorName || c.key)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {c.date ? (
                    <span
                      className="tabular-nums"
                      title={
                        signedTip
                          ? `${t("contract_signed") || "Signed"} ${signedTip}`
                          : undefined
                      }
                    >
                      {c.date} ·{" "}
                    </span>
                  ) : null}
                  {decodeEntities(c.awarderName ?? "")}
                  {c.contractorName
                    ? ` → ${decodeEntities(c.contractorName)}`
                    : ""}
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
