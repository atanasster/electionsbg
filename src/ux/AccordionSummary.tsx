import { FC, PropsWithChildren } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { useTranslation } from "react-i18next";

export const AccordionSummary: FC<PropsWithChildren> = ({ children }) => {
  const [summaryOpen, setSummaryOpen] = useSearchParam("summary", {
    replace: true,
  });
  const { t } = useTranslation();
  return (
    <Accordion
      type="single"
      value={summaryOpen === "closed" ? "none" : "cards"}
      collapsible
      className="w-full"
      onValueChange={(value) => {
        if (value !== "cards") {
          setSummaryOpen("closed");
        } else {
          setSummaryOpen(undefined);
        }
      }}
    >
      <AccordionItem value="cards">
        <AccordionTrigger className="font-extrabold text-2xl text-muted-foreground justify-center gap-2">
          {t("summary")}
        </AccordionTrigger>
        <AccordionContent>{!summaryOpen && children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
