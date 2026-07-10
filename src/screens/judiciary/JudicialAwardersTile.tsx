// Съдебната власт като възложител — the bridge from the caseload half of the
// story to the money half.
//
// Each central judicial body procures in its own name and has a generic awarder
// dashboard at /awarder/<eik>; only the ВСС carries a domain sector pack (budget
// by spending body, self-financing, procurement lens), because it is the buyer
// that procures courthouses and the e-justice systems for the whole system.
//
// The 50 individual courts also procure, but most have only 1-3 contracts ever,
// so they are counted rather than listed — a link per empty page would be noise.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { JUDICIAL_BODIES, COURT_COUNT } from "@/lib/vssReferenceData";
import { Link } from "react-router-dom";

export const JudicialAwardersTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Съдебната власт като възложител"
            : "The judiciary as a public buyer"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Всеки орган на съдебната власт възлага обществени поръчки от свое име. Отвори страницата му, за да видиш договорите, изпълнителите и рисковите сигнали."
            : "Each judicial body awards public procurement in its own name. Open its page to see the contracts, contractors and risk signals."}
        </p>

        <ul className="divide-y divide-border/60">
          {JUDICIAL_BODIES.map((b) => {
            const note = bg ? b.noteBg : b.noteEn;
            return (
              <li key={b.eik}>
                <Link
                  to={`/awarder/${b.eik}`}
                  className="group flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium group-hover:text-primary">
                      {bg ? b.bg : b.en}
                      {b.hasPack && (
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {bg ? "с бюджетен разрез" : "with budget breakdown"}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {bg ? "ЕИК " : "EIK "}
                      {b.eik}
                      {note ? ` · ${note}` : ""}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? `Отделно ${COURT_COUNT} съдилища възлагат поръчки самостоятелно, но рядко — повечето имат само по няколко договора, защото съдебната власт купува централизирано през ВСС.`
            : `A further ${COURT_COUNT} individual courts award procurement themselves, but rarely — most have only a handful of contracts, because the judiciary buys centrally through the ВСС.`}
        </p>
      </CardContent>
    </Card>
  );
};
