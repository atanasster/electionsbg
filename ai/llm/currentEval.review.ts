import type { EvalCase } from "./currentEval";
// v2 review based on the actual tool contracts. Never mutate prior run artifacts.
const wording: Record<string, [string, string]> = {
  "nationalResults:2": [
    "Show the national vote totals and percentages for every party in the latest parliamentary election.",
    "Покажи националните гласове и проценти за всяка партия на последните парламентарни избори.",
  ],
  "budgetFunction:2": [
    "What is the defence budget function's share of total spending and its trend?",
    "Какъв е делът на бюджетна функция отбрана в общите разходи и тенденцията му?",
  ],
  "judiciaryWorkload:2": [
    "Compare judicial workload by court tier, per post and per person-month worked.",
    "Сравни съдийската натовареност по съдебен ред, по щат и по отработени човекомесеци.",
  ],
  "transportSpending:2": [
    "Break down public procurement by transport mode for BDZ, NKZI, ports and aviation.",
    "Разпредели обществените поръчки по вид транспорт за БДЖ, НКЖИ, пристанища и авиация.",
  ],
  "municipalTransfers:1": [
    "Break down state transfers to municipalities by type: delegated activities, equalisation and capital subsidies.",
    "Разпредели държавните трансфери към общините по вид: делегирани дейности, изравнителна и капиталова субсидия.",
  ],
  "census:1": [
    "What was Vidin municipality's population in Census 2021?",
    "Колко е населението на община Видин според Преброяване 2021?",
  ],
};
const missingEntity = new Set([
  "personProfile:2",
  "personProfile:3",
  "personProfile:4",
  "personProfile:7",
  "personConnections:2",
  "personConnections:3",
  "personConnections:4",
  "personWealth:2",
  "personWealth:3",
  "personWealth:4",
  "companyConnections:2",
]);
export function reviewCase(c: EvalCase): EvalCase {
  if (missingEntity.has(c.id))
    return {
      ...c,
      tool: null,
      review: "No named entity or previous turn: clarification required.",
    };
  const text = wording[c.id];
  return text
    ? {
        ...c,
        en: text[0],
        bg: text[1],
        review:
          "Question narrowed to the documented tool capability; original wording retained in v1 artifacts.",
      }
    : c;
}
