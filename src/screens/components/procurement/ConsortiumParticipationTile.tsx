// „Участие в обединения" — the ONLY procurement surface a consortium-member-only entity has.
//
// WHY IT EXISTS. Migration 087 moves a joint (обединение / ДЗЗД) award's whole value onto ONE
// carrier row and ZEROES the member rows, so a three-firm consortium is counted once. Every
// serving surface then read „this firm's own money is €0" as „this firm has no procurement":
// `company_procurement`'s NULL guard used the member-excluding `contract_count` as its
// existence test, and the screens gate their whole procurement section on
// `rollup.contractCount > 0`. Measured 2026-09-21: **1,172 companies and 731 person name
// folds** are in that state, party to **€7.48bn** of joint awards across 1,048 consortia, and
// every one of their pages rendered nothing. The worked example is МЛГ ЕООД (113581389), a
// named party to a €69.2m АПИ guardrail framework.
//
// ⚠️⚠️ THE ONE THING THIS TILE MUST NEVER DO IS IMPLY THE FIRM WON THIS MONEY.
// `consortiumEur` is the FULL value of each joint contract, because the per-member share is
// NOT PUBLIC — ЦАИС publishes the award, not the split. So:
//   • the heading is „Участие в обединения", never „Обществени поръчки";
//   • every figure is labelled as the contract's value, not the firm's revenue;
//   • the caveat („дялът на всеки участник не е публичен") is in the tile body, not a
//     tooltip — a reader who never hovers must still get it;
//   • nothing here is ever added to `totalEur`, which stays the firm's SOLO work.
// Folding these euros into a headline would re-create exactly the multiple count 087 exists
// to prevent, and would publish „this firm won €69m" about a firm that was one of three.
//
// ⚠️ IT DELIBERATELY RENDERS NONE OF THE SOLO FIELDS (plan §3, invariant 7). `awarderCount`,
// `byAwarder`, `byYear`, `topContracts`, `totalOther` and the whole `breakdown` filter
// `tag = 'contract'` with NO member exclusion, so for a member-only entity they are computed
// entirely from €0 placeholders: all 1,101 report `awarderCount >= 1` beside
// `contractCount = 0`, and **285 report `breakdown.singleBidN > 0`** — a single-bidder
// competition statistic about a firm that won nothing on its own. The SQL leaves those fields
// alone (narrowing them would move the per-row counts of 2,063 MIXED companies as a side
// effect); not rendering them here is the other half of that decision.
//
// THE ANNEX COUNT IS THE CARRIER'S. `procurement_annexes` resolves against `contracts.key`
// and 087 puts the amendments on the carrier, so a member row carries none. `annexCount` is
// therefore „this joint contract was amended N times", NOT „this firm filed N amendments" —
// two different claims, and the second is what `amendmentCount` means. The link goes to the
// carrier's own contract page, where the trail actually lives.
//
// Shared by CompanyDbScreen and PersonScreen so a reader who arrives at the same joint
// contract by either route is told the same thing.
//
// Plan: docs/plans/consortium-member-visibility-v1.md

import { FC } from "react";
import { Link } from "react-router-dom";
import { Users2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";

/** One joint contract this entity took part in, as `consortiumContracts` carries it. */
export type ConsortiumContract = {
  key: string;
  ocid?: string;
  date?: string;
  /** The FULL contract value — never this entity's share, which is not public. */
  amountEur?: number | null;
  partyEik?: string;
  partyName?: string;
  title?: string;
  /** The consortium entity (a synthetic `obed-` key, or a registered ДЗЗД's own EIK). */
  consortiumEik?: string;
  /** The carrier's `contracts.key` — where the annex trail lives. */
  carrierKey?: string | null;
  consortiumName?: string | null;
  /** Amendments on the CARRIER's contract, not filings by this entity. */
  annexCount?: number;
  /** Rows come from a person's portfolio; absent on the company arm. */
  contractorEik?: string;
  contractorName?: string;
};

/** Rows shown before the list is cut. The payload itself caps at 25 (`conslist`'s LIMIT). */
const SHOWN = 8;

const num = new Intl.NumberFormat("bg-BG");

export const ConsortiumParticipationTile: FC<{
  count: number;
  eur: number;
  annexCount?: number;
  contracts?: ConsortiumContract[];
  /** Person arm: name the member company on each row (a portfolio spans several). */
  showContractor?: boolean;
  lang?: string;
}> = ({
  count,
  eur,
  annexCount = 0,
  contracts = [],
  showContractor = false,
  lang = "bg",
}) => {
  if (count <= 0) return null;
  const rows = contracts.slice(0, SHOWN);
  // ⚠️ AGAINST `count`, NOT `contracts.length`. Both SQL arms cap `consortiumContracts` at
  // `conslist`'s LIMIT 25 while `consortiumCount` is unbounded, so the array is ALREADY
  // truncated before it arrives. Measured on EIK 206331450: count 40, 25 delivered, 8 shown
  // — subtracting the array would disclose „и още 17" and drop 15 joint contracts with
  // nothing saying so, under a heading that says 40.
  const hidden = Math.max(0, count - rows.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users2 className="h-4 w-4" /> Участие в обединения (
          {num.format(count)})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The caveat sits in the BODY, above the number it qualifies — not in a tooltip.
            „€69,2 млн." beside a company name reads as revenue unless something says
            otherwise, and a reader on a phone never hovers. */}
        <p className="text-xs text-muted-foreground">
          Показаната сума е <strong>пълната стойност на договорите</strong>, в
          които{" "}
          {showContractor ? "фирмите на лицето участват" : "фирмата участва"}{" "}
          заедно с други —{" "}
          <strong>дялът на всеки участник не е публичен</strong> и не се вписва
          в регистъра. Затова тази сума <strong>не е приход</strong> и не се
          добавя към спечеленото самостоятелно.
        </p>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span
            className="text-2xl font-bold tabular-nums"
            title={formatEur(eur, lang)}
          >
            {formatEurCompact(eur, lang) || "—"}
          </span>
          <span className="text-sm text-muted-foreground">
            общо по {num.format(count)} {count === 1 ? "договор" : "договора"}
          </span>
          {annexCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              · {num.format(annexCount)} {annexCount === 1 ? "анекс" : "анекса"}{" "}
              по тези договори
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <ul className="space-y-2 border-t border-border pt-3">
            {rows.map((c) => (
              <li key={c.key} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  {/* ⚠️ `/procurement/contract/:id`, NOT `/funds/contract/:number`. Those are
                      different corpora: the funds route is the ИСУН EU-funds page keyed by
                      `fund_projects.contract_number`, while this is a `contracts.key`. The
                      wrong family dead-ends on „contract not found", which would defeat the
                      whole point of carrying `carrierKey` here. `CompanyTopContractsTile`
                      and its siblings use this route; follow them. */}
                  <Link
                    to={`/procurement/contract/${encodeURIComponent(c.carrierKey || c.key)}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {decodeEntities(c.title || "") || c.key}
                  </Link>
                  <span
                    className="shrink-0 tabular-nums text-muted-foreground"
                    title={formatEur(Number(c.amountEur ?? 0), lang)}
                  >
                    {formatEurCompact(Number(c.amountEur ?? 0), lang) || "—"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.partyEik && (
                    <AwarderLink eik={c.partyEik} className="hover:underline">
                      {decodeEntities(c.partyName || "") || undefined}
                    </AwarderLink>
                  )}
                  {c.date ? ` · ${c.date}` : ""}
                  {showContractor && c.contractorEik ? (
                    <>
                      {" · чрез "}
                      <CompanyLink
                        eik={c.contractorEik}
                        className="hover:underline"
                      >
                        {decodeEntities(c.contractorName || "") ||
                          c.contractorEik}
                      </CompanyLink>
                    </>
                  ) : null}
                  {c.consortiumEik ? (
                    <>
                      {" · "}
                      <CompanyLink
                        eik={c.consortiumEik}
                        className="hover:underline"
                        title="Обединението, на което е записана пълната стойност на договора."
                      >
                        {decodeEntities(c.consortiumName || "") ||
                          "обединението"}
                      </CompanyLink>
                    </>
                  ) : null}
                  {/* „договорът е изменян", never „подадени анекси" — the amendments are
                      the carrier's, and this entity filed none of them. */}
                  {c.annexCount ? (
                    <span className="tabular-nums">
                      {" · договорът е изменян "}
                      {num.format(c.annexCount)}{" "}
                      {c.annexCount === 1 ? "път" : "пъти"}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            и още {num.format(hidden)} {hidden === 1 ? "договор" : "договора"}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
