// The eight key budget documents (OGP / IBP Open Budget Survey).
//
// Plan: docs/plans/budget-hub-v1.md §7.4. `/budget/law` scores the frame from
// this list, so a wrong entry becomes a published claim about what Bulgaria
// makes available.
//
// ⚠️ THE SLOT IDS MUST MATCH `OBS_CATEGORY` IN `scripts/db/load_budget_pg.ts`,
// which is what writes `budget_document.obs_category`. They are two halves of
// one mapping living on opposite sides of the database, so
// `obsBudgetDocs.test.ts` reads the loader's table and fails if it ever emits a
// category that is not a slot here. Without that gate a renamed slot silently
// scores itself absent — and „Bulgaria does not publish X" is the single most
// consequential sentence this page can produce.
//
// The ORDER is the survey's own budget-cycle order (formulation → approval →
// execution → oversight), not alphabetical: a reader scanning the column should
// see where in the year each document belongs.

export interface ObsBudgetDoc {
  /** Matches `budget_document.obs_category`, or is absent from it by design. */
  id: string;
  labelBg: string;
  labelEn: string;
  /** What the document is, for a reader who has not met the OBS frame. */
  descBg: string;
  descEn: string;
}

export const OBS_BUDGET_DOCS: readonly ObsBudgetDoc[] = [
  {
    id: "pre-budget-statement",
    labelBg: "Предварителни бюджетни насоки",
    labelEn: "Pre-budget statement",
    descBg:
      "Рамката и приоритетите, публикувани преди правителството да внесе проекта — така че дебатът да започне преди числата да са фиксирани.",
    descEn:
      "The fiscal framework and priorities published before the government tables its proposal, so debate can begin before the figures are fixed.",
  },
  {
    id: "executive-budget-proposal",
    labelBg: "Проект на бюджета",
    labelEn: "Executive's budget proposal",
    descBg:
      "Това, което Министерският съвет внася в Народното събрание — преди депутатите да са го променили.",
    descEn:
      "What the Council of Ministers tables in parliament, before MPs amend it.",
  },
  {
    id: "enacted-budget",
    labelBg: "Приет бюджет",
    labelEn: "Enacted budget",
    descBg: "Законът за държавния бюджет, както е гласуван и обнародван.",
    descEn: "The budget act as voted and promulgated.",
  },
  {
    id: "citizens-budget",
    labelBg: "Граждански бюджет",
    labelEn: "Citizens budget",
    descBg:
      "Бюджетът, обяснен на разбираем език — не съкратен, а преведен, за да е четим без счетоводна подготовка.",
    descEn:
      "The budget in plain language — not an abridgement but a translation, readable without an accounting background.",
  },
  {
    id: "in-year-report",
    labelBg: "Текущи отчети през годината",
    labelEn: "In-year reports",
    descBg:
      "Как върви изпълнението, докато годината още тече — месечните и тримесечните отчети по КФП.",
    descEn:
      "How execution is going while the year is still running — the monthly and quarterly КФП reports.",
  },
  {
    id: "mid-year-review",
    labelBg: "Средногодишен преглед",
    labelEn: "Mid-year review",
    descBg:
      "Преоценка към средата на годината: как върви изпълнението и как се променят прогнозите за приходи, разходи и дълг до края на годината. Това, че прогнозите се преразглеждат, го отличава от поредния текущ отчет.",
    descEn:
      "A mid-year reassessment: how execution is going and how the forecasts for revenue, expenditure and debt change for the rest of the year. The revised forecasts are what distinguish it from another in-year report.",
  },
  {
    id: "year-end-report",
    labelBg: "Годишен отчет",
    labelEn: "Year-end report",
    descBg: "Какво в действителност е похарчено, след като годината приключи.",
    descEn: "What was actually spent, once the year has closed.",
  },
  {
    id: "audit-report",
    labelBg: "Одитен доклад",
    labelEn: "Audit report",
    descBg:
      "Независимата проверка на отчета — от Сметната палата, а не от изпълнителната власт.",
    descEn:
      "The independent check on the outturn — by the National Audit Office, not the executive.",
  },
] as const;

export const OBS_DOC_COUNT = OBS_BUDGET_DOCS.length;
