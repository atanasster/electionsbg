// Lightweight, dependency-free chart tiles for the generic sector dashboard —
// spend-by-year bars and a top-contractors leaderboard, both built from the
// AwarderModel the dashboard already fetches. Pure CSS/flex (no chart lib) so
// they render instantly for the OG screenshot and stay cheap on the page.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { AwarderModel } from "@/lib/awarderModel";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { isConsortiumSupplier } from "@/lib/companyKey";

export const SectorSpendByYearTile: FC<{ model: AwarderModel<"all"> }> = ({
  model,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const years = model.years.filter((y) => y.totalEur > 0);
  if (years.length < 2) return null;
  const max = Math.max(...years.map((y) => y.totalEur));

  return (
    // min-w-0 so this card can shrink below its bar-row's min-content width when
    // it's a grid/flex child (grid items default to min-width:auto) — otherwise
    // the track grows to the full bar row and the CardContent scroller never
    // engages on a narrow screen.
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Възложени по година" : "Awarded by year"}
        </CardTitle>
      </CardHeader>
      {/* overflow-x-auto so a long year run (e.g. 2017–2026) scrolls on a narrow
          screen instead of clipping the most recent, tallest bars (house rule:
          wide content scrolls in its own container). On desktop it fits and the
          bars flex to fill, so nothing changes there. */}
      <CardContent className="overflow-x-auto p-3 md:p-4">
        <div className="flex h-[220px] items-end gap-2">
          {years.map((y) => (
            <div
              key={y.year}
              className="flex min-w-[40px] flex-1 flex-col items-center justify-end gap-1"
            >
              <div className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {formatEurCompact(y.totalEur, locale)}
              </div>
              <div
                className="w-full rounded-t bg-primary/80"
                style={{
                  height: `${Math.max(2, (y.totalEur / max) * 170)}px`,
                }}
                title={`${y.year}: ${formatEurCompact(y.totalEur, locale)}`}
              />
              <div className="text-[10px] tabular-nums text-muted-foreground">
                {y.year}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export const SectorTopContractorsTile: FC<{
  model: AwarderModel<"all">;
  /** Optional "see all →" link in the header (opt-in; omit to hide). */
  seeAllTo?: string;
  /** The sector's own member EIKs. A contractor that is ALSO a member is an
   *  in-group transfer, not a supplier the sector bought from on the market, and
   *  the row says so — see the note under the list. Omit to disable the check. */
  memberEiks?: readonly string[];
  /** Contractors that are PUBLIC BODIES but NOT members of this sector — a state
   *  or municipal company, an agency, a fund manager. Same treatment as
   *  `memberEiks` and for the same reason: the money is an intra-government
   *  transfer rather than a market award, and unlabelled the row reads as a
   *  private vendor topping the sector. Still counted; never filtered out.
   *
   *  ⚠ MUST BE A CURATED LIST, never "is this EIK an awarder somewhere". ЗОП's
   *  utilities regime makes private regulated companies contracting authorities
   *  too, so that probe returns ЕВН, Овергаз, Софийска вода and the privately
   *  held Топлофикации alongside the genuinely public ones — measured on water,
   *  44% of its answer was private. Omit to disable the check. */
  stateBodyEiks?: readonly string[];
}> = ({ model, seeAllTo, memberEiks, stateBodyEiks }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const rows = model.suppliers.slice(0, 8);
  const members = new Set(memberEiks ?? []);
  // A member is already labelled „в групата", which is the more specific
  // statement — so the two sets never both fire on one row.
  const stateBodies = new Set(
    (stateBodyEiks ?? []).filter((e) => !members.has(e)),
  );
  // Both gated on the VISIBLE rows rather than on the prop: a listed EIK that
  // falls outside the top-8 must not produce a footnote explaining a chip the
  // reader cannot see. `stateBodyEiks.length > 0` would pass every test here
  // and be wrong on exactly that case.
  const hasInGroup = rows.some((s) => members.has(s.eik));
  const hasStateBody = rows.some((s) => stateBodies.has(s.eik));
  // Same visible-rows gate, and needed for the same reason — but note this one
  // takes NO prop. A consortium is recognisable from the row itself, so there is
  // nothing for a caller to curate and nothing to keep in step; every sector gets
  // the note the moment a consortium reaches its top-8.
  const hasConsortium = rows.some(isConsortiumSupplier);
  if (rows.length < 2) return null;
  const max = rows[0].totalEur || 1;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          {bg ? "Топ изпълнители" : "Top contractors"}
        </CardTitle>
        {seeAllTo && (
          <Link
            to={seeAllTo}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {bg ? "виж всички →" : "see all →"}
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5 p-3 md:p-4">
        {rows.map((s) => {
          const inGroup = members.has(s.eik);
          const isStateBody = stateBodies.has(s.eik);
          const isConsortium = isConsortiumSupplier(s);
          return (
            <div key={s.eik} className="flex items-center gap-2 text-sm">
              <CompanyLink
                eik={s.eik}
                className="min-w-0 max-w-[42%] shrink truncate text-primary hover:underline"
                title={s.name}
              >
                {s.name}
              </CompanyLink>
              {inGroup && (
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  aria-describedby="sector-topcontractors-ingroup-note"
                  title={
                    bg
                      ? "Изпълнителят е от същата група — парите остават в сектора"
                      : "The contractor belongs to the same group — the money stays inside the sector"
                  }
                >
                  {bg ? "в групата" : "in-group"}
                </span>
              )}
              {isConsortium && (
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  aria-describedby="sector-topcontractors-consortium-note"
                  title={
                    bg
                      ? "Няколко фирми, спечелили заедно. Сумата е на целия договор и се брои веднъж."
                      : "Several firms that won together. The figure is the whole contract and is counted once."
                  }
                >
                  {bg ? "консорциум" : "consortium"}
                </span>
              )}
              {isStateBody && (
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  aria-describedby="sector-topcontractors-statebody-note"
                  title={
                    bg
                      ? "Изпълнителят е държавна или общинска структура — трансфер вътре в държавата, не спечелен на пазара договор"
                      : "The contractor is a state or municipal body — a transfer inside government, not a contract won on a market"
                  }
                >
                  {bg ? "държавно" : "state body"}
                </span>
              )}
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${
                    inGroup || isStateBody ? "bg-primary/30" : "bg-primary/70"
                  }`}
                  style={{ width: `${Math.max(3, (s.totalEur / max) * 100)}%` }}
                />
              </div>
              <div className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatEurCompact(s.totalEur, locale)}
              </div>
            </div>
          );
        })}
        {hasInGroup && (
          <p
            id="sector-topcontractors-ingroup-note"
            className="pt-1.5 text-xs text-muted-foreground"
          >
            {bg
              ? "„В групата“ = изпълнителят е една от организациите в сектора. Тези пари не са отишли на външен пазар — държавата плаща на собственото си дружество."
              : "“In-group” = the contractor is one of the sector's own organisations. That money did not go to an external market — the state is paying its own company."}
          </p>
        )}
        {hasStateBody && (
          <p
            id="sector-topcontractors-statebody-note"
            className="pt-1.5 text-xs text-muted-foreground"
          >
            {bg
              ? "„Държавно“ = изпълнителят е държавна или общинска структура извън сектора. Договорът е реална обществена поръчка и се брои тук, но парите остават вътре в държавата, а не отиват на външен пазар."
              : "“State body” = the contractor is a state or municipal organisation outside this sector. The contract is a real public procurement and is counted here, but the money stays inside government rather than reaching an external market."}
          </p>
        )}
        {/* The note no longer names „Обединение", and that is deliberate: since
            `consortiumEur` landed it also covers REGISTERED ДЗЗД, whose rows
            carry an ordinary company name with no such token in it. Quoting a
            label that only half the marked rows show would be worse than
            quoting none. */}
        {hasConsortium && (
          <p
            id="sector-topcontractors-consortium-note"
            className="pt-1.5 text-xs text-muted-foreground"
          >
            {bg
              ? "Отбелязаните редове са консорциуми — няколко фирми, спечелили заедно. Сумата е на целия договор и се брои веднъж, но участник в консорциум може да има и собствен ред тук, така че класирането подценява фирмите, които печелят предимно в консорциум."
              : "The marked rows are consortia — several firms that won together. The figure is the whole contract and is counted once, but a member firm may also hold its own row here, so the ranking understates firms that win mainly through consortia."}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
