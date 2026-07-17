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
import { JUDICIAL_BODIES, COURT_COUNT } from "@/lib/vssReferenceData";
import { AwarderListSection } from "@/screens/components/procurement/AwarderListSection";

export const JudicialAwardersTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  return (
    <AwarderListSection
      variant="roster"
      showEik
      title={
        bg
          ? "Съдебната власт като възложител"
          : "The judiciary as a public buyer"
      }
      intro={
        bg
          ? "Всеки орган на съдебната власт възлага обществени поръчки от свое име. Отвори страницата му, за да видиш договорите, изпълнителите и рисковите сигнали."
          : "Each judicial body awards public procurement in its own name. Open its page to see the contracts, contractors and risk signals."
      }
      rows={JUDICIAL_BODIES.map((b) => ({
        eik: b.eik,
        name: bg ? b.bg : b.en,
        badge: b.hasPack
          ? bg
            ? "с бюджетен разрез"
            : "with budget breakdown"
          : undefined,
        note: bg ? b.noteBg : b.noteEn,
      }))}
      footnote={
        bg
          ? `Отделно ${COURT_COUNT} съдилища възлагат поръчки самостоятелно, но рядко — повечето имат само по няколко договора, защото съдебната власт купува централизирано през ВСС.`
          : `A further ${COURT_COUNT} individual courts award procurement themselves, but rarely — most have only a handful of contracts, because the judiciary buys centrally through the ВСС.`
      }
    />
  );
};
