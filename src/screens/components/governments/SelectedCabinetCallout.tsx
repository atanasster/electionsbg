// Prominent cabinet-identity card used as a visual reinforcement on
// /indicators/compare (and anywhere else that needs to make "this is the
// cabinet driving the page" obvious to the reader). The amber inset ring
// on the strip pill plus the URL anchor pill in the header tell the user
// SOMETHING is selected; this card tells them WHICH cabinet + WHAT END
// DATE the panels below are using.
//
// Visual: thin party-coloured ribbon on the left edge + small MP avatar +
// PM name + cabinet type chip + tenure dates + parties + end reason. A
// trailing link drills into /governments/:slug for the full term profile.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useGovernments,
  type Government,
  type GovernmentEndReason,
} from "@/data/governments/useGovernments";
import { cabinetFullLabel } from "@/data/governments/cabinetLabel";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMps } from "@/data/parliament/useMps";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { colorForGovernmentSolid } from "./governmentColors";

const formatDateShort = (iso: string | null, lang: "bg" | "en"): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const SelectedCabinetCallout: FC<{
  government: Government;
  lang: "bg" | "en";
  /** Header label rendered above the card ("Данните по-долу са към края на
   *  мандата на" etc.). Optional — host can override with screen-specific
   *  copy or omit when the surrounding section header already covers it. */
  headerText?: string;
  className?: string;
}> = ({ government: g, lang, headerText, className }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const { findMpByName } = useMps();
  const { data: allGovernments } = useGovernments();
  const ribbon = colorForGovernmentSolid(g, colorFor);
  const mp = findMpByName(g.pmBg);

  // Disambiguated full label: appends " III" / " II" when the same PM has
  // multiple cabinets. Falls back to plain full name while governments is
  // loading.
  const fullName = allGovernments
    ? cabinetFullLabel(g, allGovernments, lang)
    : lang === "bg"
      ? g.pmBg
      : g.pmEn;
  const parties = lang === "bg" ? g.parties : (g.partiesEn ?? g.parties);
  const tenure = `${formatDateShort(g.startDate, lang)} – ${formatDateShort(
    g.endDate,
    lang,
  )}`;
  const endReasonText = lang === "bg" ? g.endReasonBg : g.endReasonEn;
  const caretaker = g.type === "caretaker";
  const partyLabel = caretaker
    ? lang === "bg"
      ? g.pmPartyBg
      : (g.pmPartyEn ?? g.pmPartyBg)
    : parties[0];

  const endReasonMap: Record<GovernmentEndReason, string> = {
    term_end: t("gov_end_term_end"),
    election: t("gov_end_election"),
    snap_election: t("gov_end_snap_election"),
    no_confidence: t("gov_end_no_confidence"),
    resignation: t("gov_end_resignation"),
    rotation_failed: t("gov_end_rotation_failed"),
    incumbent: t("gov_end_incumbent"),
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {headerText ? (
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {headerText}
        </div>
      ) : null}
      <Link
        to={`/governments/${encodeURIComponent(g.id)}`}
        className="group rounded-xl border bg-card shadow-sm overflow-hidden transition-colors hover:border-primary/40"
      >
        <div className="flex items-stretch">
          <div
            className="w-1.5 shrink-0"
            style={{ backgroundColor: ribbon }}
            aria-hidden
          />
          <div className="flex-1 p-3 sm:p-4 flex items-start gap-3">
            <MpAvatar
              name={g.pmBg}
              mpId={mp?.id}
              className="h-12 w-12 sm:h-14 sm:w-14 shrink-0"
              showPartyRing={false}
            />
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-base font-semibold leading-tight">
                  {fullName}
                </span>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                    caretaker
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {caretaker ? t("gov_type_caretaker") : t("gov_type_regular")}
                </span>
                {partyLabel ? (
                  <span className="text-xs text-muted-foreground truncate">
                    {caretaker ? `(${partyLabel})` : partyLabel}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {tenure}
              </div>
              {!caretaker && parties.length > 1 ? (
                <div className="text-xs text-muted-foreground truncate">
                  {parties.join(", ")}
                </div>
              ) : null}
              {endReasonText && g.endReason !== "incumbent" ? (
                <div className="text-[11px] italic text-muted-foreground mt-0.5">
                  {endReasonMap[g.endReason]} — {endReasonText}
                </div>
              ) : g.endReason === "incumbent" ? (
                <div className="text-[11px] italic text-muted-foreground mt-0.5">
                  {endReasonMap[g.endReason]}
                </div>
              ) : null}
            </div>
            <ArrowUpRight
              className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary"
              aria-hidden
            />
          </div>
        </div>
      </Link>
    </div>
  );
};
