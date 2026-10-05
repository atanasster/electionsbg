// The „voting abroad" FAQ section — one component for every abroad page (the parliamentary
// МИР 32 dashboard and the presidential abroad page), so the visible answers stay the one copy
// `DIASPORA_FAQ` exists to be (the prerender and the FAQPage JSON-LD read the same data).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DIASPORA_FAQ } from "@/data/diaspora/diasporaFaq";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const DiasporaFaqSection: FC<{ headingLevel?: 2 | 3 }> = ({
  headingLevel,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "bg";
  return (
    <DashboardSection
      id="diaspora_faq"
      title={
        lang === "en" ? "Voting abroad — FAQ" : "Гласуване в чужбина — въпроси"
      }
      icon={HelpCircle}
      headingLevel={headingLevel}
    >
      <Accordion type="single" collapsible className="w-full">
        {DIASPORA_FAQ[lang].map((item, i) => (
          <AccordionItem key={item.q} value={`faq-${i}`}>
            <AccordionTrigger className="text-left text-base font-medium">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </DashboardSection>
  );
};
