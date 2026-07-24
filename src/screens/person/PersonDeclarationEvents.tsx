// Disposals & third-party expenses (audit T3.4) — the four things a declaration RECORDS
// but that are not part of the estate at filing time: property and vehicles transferred in
// the prior year, expenses someone else paid for the declarant, and guarantees given in
// their favour.
//
// These are the most editorially interesting rows in the filing precisely because they are
// not wealth. "Sold the car the year before leaving office" and "someone else paid for this
// trip" are transactions, and the register is the only place they are recorded. The parser
// threw all 9,127 of them away until audit T1.6.
//
// Framing: each row is a verbatim register fact with its own source link, shown against
// the year it was DECLARED. We deliberately do not compute an "event year": the register's
// "transferred during the previous year" wording is relative to the reporting period, and
// the filing year only equals period+1 for ANNUAL filings — on an Entry/Vacate the two are
// the same year, so subtracting one would mislabel the year of a named person's
// transaction. Where the filing states the period it covers, that is shown instead. No
// totals across kinds either — a disposal and a paid-for trip are not commensurable and
// summing them would invent a figure.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { usePersonDeclarationEvents } from "./usePersonDeclarationEvents";

const KIND_KEY: Record<string, string> = {
  disposal_property: "pp_decl_event_disposal_property",
  disposal_vehicle: "pp_decl_event_disposal_vehicle",
  third_party_expense: "pp_decl_event_third_party_expense",
  guarantee: "pp_decl_event_guarantee",
};

export const PersonDeclarationEvents: FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const events = usePersonDeclarationEvents(slug);

  if (!events || events.length === 0) return null;

  return (
    <DashboardSection
      id="person-events"
      title={t("pp_events_title")}
      icon={ArrowLeftRight}
      subtitle={t("pp_events_hint")}
    >
      <Card>
        <CardContent className="pt-6">
          <ul className="divide-y divide-border">
            {events.map((e, i) => (
              <li
                key={`${e.sourceUrl}-${i}`}
                className="flex items-baseline gap-3 py-2 text-sm"
              >
                {/* The period the filing covers when the register states it, else the
                    year it was filed — never a computed event year. */}
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                  {e.fiscalYear ?? e.year}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {t(KIND_KEY[e.kind] ?? e.kind)}
                </span>
                <span className="flex-1 truncate">
                  {[e.description, e.detail, e.location]
                    .filter(Boolean)
                    .join(" · ")}
                  {e.legalBasis && (
                    <span className="ml-1 text-muted-foreground">
                      ({e.legalBasis})
                    </span>
                  )}
                </span>
                {/* 0 means UNPRICED in this corpus, not "transferred for nothing" —
                    printing €0 would assert that a named person gave a property away.
                    Same guard the declarations block applies. */}
                <span className="shrink-0 tabular-nums">
                  {e.valueEur != null && e.valueEur !== 0
                    ? formatEur(e.valueEur, locale)
                    : "—"}
                </span>
                <a
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  aria-label={t("pp_events_source")}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("pp_events_caveat")}
          </p>
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
