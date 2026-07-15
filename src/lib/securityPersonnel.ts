// Curated МВР personnel reference — the denominator behind the "€ per employee"
// tile. The МВР budget node (update-budget) carries the total ЗДБ expenditure but
// NO headcount and NO §01-заплати economic-type split, so the two figures below are
// curated (like data/defense/programs.json) and clearly labelled as estimates on
// the tile. Everything derived from them (personnel budget, cost per employee) is
// anchored to the LIVE budget total, so only these two inputs are hand-set.
//
// Sources: заети численост ≈ 46,000 — МВР програмен бюджет / публични отчети
// (щатната численост по ЗМВР е по-висока; заетите места са релевантният знаменател
// за разход на служител). Дял заплати ~90% — отчет за изпълнението (2025 салдо
// ≈ 3.82 млрд. лв заплати от ~4.14 млрд. лв разход). Both echo the figures Васил
// Велев (АИКБ) cites publicly; we surface only what our budget data can anchor.

export const MVR_PERSONNEL = {
  /** Approximate filled headcount (заети места), 2024–2025. Estimate. */
  headcount: 46000,
  /** Personnel (заплати + осигуровки) as a share of total МВР expenditure.
   *  Estimate from the execution report — the budget node has no economic-type
   *  split. Shared with the iceberg budget-bridge tile. */
  personnelShareEst: 0.9,
  /** Reference year the two figures above describe. */
  year: 2025,
} as const;
