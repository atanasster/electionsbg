import React, { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  prompts,
  Language,
  selectableParties,
  translations,
} from "@/ai/constants";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  sendUserMessage: (message: string) => void;
  language: Language;
}

const Sidebar: React.FC<SidebarProps> = ({ sendUserMessage, language }) => {
  const [selectedStrategyParty, setSelectedStrategyParty] = useState(
    selectableParties[0].id,
  );

  const handlePartyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedStrategyParty(event.target.value);
  };

  const partyDisplayName =
    selectableParties.find((p) => p.id === selectedStrategyParty)?.name[
      language
    ] || selectedStrategyParty;
  const currentTranslations = translations[language];

  return (
    <Accordion type="multiple" className="w-full">
      {Object.keys(prompts).map((key) => {
        const category = prompts[key as keyof typeof prompts];
        return (
          <AccordionItem value={key} key={key}>
            <AccordionTrigger className="text-sm py-2">
              {category.topic[language]}
            </AccordionTrigger>
            <AccordionContent className="[&>div]:!pb-2">
              {key === "strategy" && (
                <div className="mb-2 px-1">
                  <label
                    htmlFor="party-selector"
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    {currentTranslations.sidebarPartySelectorLabel}
                  </label>
                  <select
                    id="party-selector"
                    value={selectedStrategyParty}
                    onChange={handlePartyChange}
                    className="w-full py-1.5 px-2 rounded-md border bg-background text-foreground text-sm focus:ring-ring focus:ring-1 focus:outline-none appearance-none bg-no-repeat bg-right pr-8"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: "right 0.5rem center",
                      backgroundSize: "1.5em 1.5em",
                    }}
                  >
                    {selectableParties.map((party) => (
                      <option key={party.id} value={party.id}>
                        {party.name[language]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                {category.questions.map((q, qIndex) => {
                  let questionText = q[language];
                  if (key === "strategy") {
                    questionText = questionText.replace(
                      /{partyName}/g,
                      `"${partyDisplayName}"`,
                    );
                  }
                  return (
                    <Button
                      key={qIndex}
                      variant="ghost"
                      className="w-full text-left justify-start h-auto py-1.5 whitespace-normal text-muted-foreground hover:text-foreground text-xs"
                      onClick={() => sendUserMessage(questionText)}
                    >
                      {questionText}
                    </Button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
};

export default Sidebar;
