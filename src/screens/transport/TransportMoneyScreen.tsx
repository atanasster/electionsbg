// /sector/transport/money — the money OUTSIDE public procurement: the ministry
// budget, the annual rail subsidy, the EU funds on the grant basis, the EU peer
// comparison and road safety. Plan: docs/plans/transport-hub-v1.md §3.
//
// „БЕЗ ПЕРИОД" — no ScopeControl (O9): budget law, Eurostat and ИСУН lifetime
// figures carry their own years and are not filtered by parliament. But the page
// DOES resolve an inbound `pscope=y:YYYY` — the /subsidies hub forwards its scope
// onto its rail tile, and that tile states the year it reads — so #subsidy
// anchors on that year when the rail files cover it, and on the newest year
// otherwise. railSubsidyAnchor() is the one rule both pages read.
//
// Fragment ids: #budget #subsidy #funds #peers #road-safety, and only those.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";
import { scopeYear, useScope } from "@/data/scope/useScope";
import { useRailSubsidy } from "@/data/procurement/useRailSubsidy";
import { useTransportFunds } from "@/data/transport/useTransportSector";
import { TRANSPORT_SECTOR_EIKS } from "@/lib/transportReferenceData";
import { TransportPageFrame } from "./TransportPageFrame";
import { TransportBudgetTile } from "./TransportBudgetTile";
import { TransportSubsidyTile } from "./TransportSubsidyTile";
import { TransportEuFundsTile } from "./TransportEuFundsTile";
import { TransportEuPeerTile } from "./TransportEuPeerTile";
import { TransportRoadSafetyTile } from "./TransportRoadSafetyTile";

export const TransportMoneyScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  // Resolved, not raw: an unparseable value falls back to the newest year.
  const { scope } = useScope();
  const year = scopeYear(scope);
  // The year the subsidy tile actually lands on — the scope year only when the
  // rail files cover it (railSubsidyAnchor), so the label cannot name a year the
  // tile does not show. Same query as the tile's, so no second fetch.
  const { latest } = useRailSubsidy(year);
  const railYear = year != null ? (latest?.year ?? null) : null;
  const { funds, grantBasis, isLoading, isError } = useTransportFunds(
    TRANSPORT_SECTOR_EIKS,
  );
  const sectorWide = bg
    ? "Данните тук са за целия сектор и не се разделят по вид транспорт."
    : "The figures here are for the whole sector and are not split by mode.";
  return (
    <TransportPageFrame
      title={{
        bg: "Парите извън поръчките",
        en: "The money outside procurement",
      }}
      description={{
        bg: "Бюджетът на министерството, годишната субсидия за железниците и на пътник, европейските средства на структурите, разходът за транспорт спрямо ЕС и пътната безопасност — всяко на своя база, не се събират с поръчките.",
        en: "The ministry budget, the annual rail subsidy and what it is per passenger, the bodies' EU funds, transport spending against the EU and road safety — each on its own basis, never added to procurement.",
      }}
      scoped={false}
      periodNote={
        railYear != null
          ? {
              bg: `Субсидията за железниците е показана за ${railYear} г.`,
              en: `The rail subsidy is shown for ${railYear}.`,
            }
          : null
      }
      ready={[funds, year, latest, isLoading]}
    >
      <p className="text-sm text-muted-foreground">{sectorWide}</p>
      <section id="budget" className="scroll-mt-24">
        <TransportBudgetTile />
      </section>
      <section id="subsidy" className="scroll-mt-24">
        <TransportSubsidyTile year={year} />
      </section>
      <section id="funds" className="scroll-mt-24">
        {isLoading ? null : isError ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {bg
              ? "Европейските средства не можаха да се заредят."
              : "The EU funds could not be loaded."}
          </p>
        ) : !grantBasis ? (
          // A function deployed before ?basis=grant answers on the total-project
          // value basis — showing it under a „безвъзмездна помощ" label would
          // halve the absorption rate (D6), so the block says so instead.
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {bg
              ? "Европейските средства на база безвъзмездна помощ все още не са публикувани."
              : "The EU funds on the grant basis are not published yet."}
          </p>
        ) : (
          <TransportEuFundsTile funds={funds} />
        )}
      </section>
      <section id="peers" className="scroll-mt-24">
        <TransportEuPeerTile />
      </section>
      <section id="road-safety" className="scroll-mt-24">
        <TransportRoadSafetyTile />
      </section>
    </TransportPageFrame>
  );
};
