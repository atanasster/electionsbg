// Shared "voting abroad" FAQ — single source of truth consumed by:
//   • the live React diaspora dashboard (/municipality/32),
//   • the prerendered HTML body (scripts/prerender/bodyBuilders.ts), and
//   • the FAQPage JSON-LD (scripts/prerender/jsonLd.ts → buildFaqLd).
// Keeping one copy guarantees the visible text, the crawlable HTML, and the
// structured data never drift apart. Answers are evergreen — no election-specific
// dates that would go stale; procedural specifics defer to "the deadlines
// announced by the CEC before each vote". Sources: cik.bg, mfa.bg.
//
// Targets the verified-demand head term "секции за гласуване в чужбина" and the
// "избирателни секции в <country>" cluster (GSC: ~18 queries / ~878 impressions
// served today only by scattered /sections/<country> pages).

// МИР 32 — the abroad ("Извън страната") electoral district. Lives here (a
// non-component module) so component files can import it without tripping the
// react-refresh "only export components" lint rule.
export const DIASPORA_REGION = "32";

export const isDiasporaRegion = (code?: string | null): boolean =>
  code === DIASPORA_REGION;

export type FaqItem = { q: string; a: string };

export const DIASPORA_FAQ: Record<"bg" | "en", FaqItem[]> = {
  bg: [
    {
      q: "Кой може да гласува в чужбина?",
      a: "Всеки български гражданин, навършил 18 години най-късно в изборния ден, може да гласува в избирателна секция в чужбина — независимо от постоянния си адрес в България. Не е необходимо да сте се отписали от адресната си регистрация.",
    },
    {
      q: "Какви документи са необходими?",
      a: "Валиден български документ за самоличност — лична карта или паспорт. Дипломатическият, служебният и моряшкият паспорт също се приемат. Документ с изтекъл срок не дава право на глас.",
    },
    {
      q: "Трябва ли предварителна регистрация?",
      a: "Не е задължителна — в изборния ден може да гласувате без предварителна заявка във всяка вече разкрита секция в чужбина. Подаването на заявление преди вота обаче помага на ЦИК да прецени къде да открие секции. Заявления се подават онлайн през сайта на ЦИК в обявените срокове.",
    },
    {
      q: "Кога работят секциите?",
      a: "Обикновено от 07:00 до 20:00 ч. местно време. Ако в 20:00 ч. пред секцията все още чакат избиратели, гласуването продължава, докато гласуват всички, но не по-късно от 21:00 ч.",
    },
    {
      q: "Как да намеря своята секция?",
      a: "Изберете държава от списъка по-горе, за да видите всички секции и адресите им по държава и град. Секциите в чужбина се откриват най-често в дипломатическите и консулските представителства и в наети помещения в по-големите градове.",
    },
    {
      q: "Как се открива нова секция?",
      a: "Български граждани подават заявления за гласуване в определено населено място през сайта на ЦИК в сроковете преди всеки вот. В държави извън ЕС секция се открива при достатъчен брой подадени заявления, а извън дипломатическите мисии броят на секциите може да е ограничен със закон.",
    },
  ],
  en: [
    {
      q: "Who can vote abroad?",
      a: "Any Bulgarian citizen who turns 18 no later than election day may vote at a polling section abroad — regardless of their permanent address in Bulgaria. You do not need to have deregistered your Bulgarian address.",
    },
    {
      q: "What documents do I need?",
      a: "A valid Bulgarian identity document — an ID card or a passport. Diplomatic, official and seaman's passports are also accepted. An expired document does not entitle you to vote.",
    },
    {
      q: "Do I need to register in advance?",
      a: "It is not mandatory — on election day you can vote without a prior application at any section already opened abroad. Filing an application before the vote does, however, help the CEC decide where to open sections. Applications are submitted online via the CEC website within the announced deadlines.",
    },
    {
      q: "What are the voting hours?",
      a: "Usually 07:00 to 20:00 local time. If voters are still waiting outside the section at 20:00, voting continues until they have all voted, but no later than 21:00.",
    },
    {
      q: "How do I find my polling section?",
      a: "Pick a country from the list above to see all of its sections and their addresses by country and city. Sections abroad are most often opened at diplomatic and consular missions and in rented venues in larger cities.",
    },
    {
      q: "How is a new section opened?",
      a: "Bulgarian citizens submit applications to vote in a given location via the CEC website within the deadlines before each vote. In countries outside the EU a section opens once enough applications are filed, and outside diplomatic missions the number of sections may be capped by law.",
    },
  ],
};
