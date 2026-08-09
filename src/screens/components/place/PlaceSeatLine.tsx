// A compact, localizable "seat" line — settlement · obshtina · oblast — for a page about an
// ENTITY that HAS a place (an awarder / company / farm), as opposed to a page that IS a place
// (which uses the PlaceHeaderView hero). Resolved from place_dim (117) via awarder_seat_place,
// so it carries EN names + the codes each segment links on: the settlement → its procurement
// page, the obshtina/oblast → their governance dashboards. A segment with no code (a
// name-parsed seat with no EKATTE) renders as plain text rather than a dead link.
//
// Replaces the free-text tr_companies.seat one-liner on the awarder page; that raw registered
// office can still ride along as a secondary detail line (it is often a full street address).

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Link } from "@/ux/Link";
import { placeViewUrl } from "@/data/local/placeViews";
import { shortOblastName } from "@/lib/oblastName";
import { SettlementProcurementLink } from "@/screens/components/procurement/SettlementProcurementLink";

export type SeatPlace = {
  ekatte: string | null;
  settlement: string | null;
  settlementEn: string | null;
  settlementType: string | null;
  obshtinaCode: string | null;
  obshtina: string | null;
  obshtinaEn: string | null;
  oblastCode: string | null;
  oblast: string | null;
  oblastEn: string | null;
};

export const PlaceSeatLine: FC<{ place: SeatPlace; className?: string }> = ({
  place,
  className,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const settlement =
    (lang === "bg"
      ? place.settlement
      : place.settlementEn || place.settlement) ?? null;
  const obshtina =
    (lang === "bg" ? place.obshtina : place.obshtinaEn || place.obshtina) ??
    null;
  const oblastRaw =
    (lang === "bg" ? place.oblast : place.oblastEn || place.oblast) ?? null;
  // A standalone segment in the place path, so the tier word is implied by
  // position — "…· общ. Карлово · Пловдив". `shortOblastName` drops it from
  // either end, which also covers PDV's "обл." PREFIX that the local strip this
  // replaced could not see.
  const oblast = oblastRaw ? shortOblastName(oblastRaw) : null;

  const settlementLabel =
    lang === "bg" && place.settlementType && settlement
      ? `${place.settlementType} ${settlement}`
      : settlement;

  const obshtinaHref = place.obshtinaCode
    ? placeViewUrl("governance", {
        level: "municipality",
        obshtina: place.obshtinaCode,
        oblast: place.oblastCode ?? undefined,
      })
    : null;
  const oblastHref = place.oblastCode
    ? placeViewUrl("governance", {
        level: "region",
        oblast: place.oblastCode,
      })
    : null;

  const segments: ReactNode[] = [];
  if (settlementLabel) {
    segments.push(
      place.ekatte ? (
        <SettlementProcurementLink
          ekatte={place.ekatte}
          className="link text-foreground hover:underline hover:cursor-pointer"
        >
          {settlementLabel}
        </SettlementProcurementLink>
      ) : (
        settlementLabel
      ),
    );
  }
  if (obshtina) {
    segments.push(
      obshtinaHref ? (
        <Link to={obshtinaHref} underline>
          {obshtina}
        </Link>
      ) : (
        obshtina
      ),
    );
  }
  if (oblast) {
    segments.push(
      oblastHref ? (
        <Link to={oblastHref} underline>
          {oblast}
        </Link>
      ) : (
        oblast
      ),
    );
  }

  if (segments.length === 0) return null;

  return (
    <div
      className={`mt-1 flex items-center gap-1.5 text-sm text-muted-foreground ${className ?? ""}`}
    >
      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {segments.map((seg, i) => (
          <span key={i}>
            {i > 0 ? " · " : ""}
            {seg}
          </span>
        ))}
      </span>
    </div>
  );
};
