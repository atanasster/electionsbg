// Samokov (Община Самоков) — Sofia-oblast município, both naredbi on
// obshtini.bg. Same município that has the capital programme tile.
//   FEES: samokov.obshtini.bg/doc/5993006
//   TAX:  samokov.obshtini.bg/doc/5992724
//
// propertyTaxIndividualsRate is overridden because Samokov's Чл. 3
// reads "Размерът на данъка върху недвижимите имоти се определя на
// 2,5 на хиляда." — no "върху данъчната оценка" tail anchor, so the
// auto-extractor's strict gating rejects it.

import { createObshtiniBgNaredbaParser } from "../lib/obshtini_bg_naredba";

export const sfoParser = createObshtiniBgNaredbaParser({
  obshtina: "SFO39",
  slug: "samokov",
  feesDocId: 5993006,
  taxDocId: 5992724,
  year: 2025,
  label: "Община Самоков — Наредби за местните данъци и такси",
  propertyTaxIndividualsRate: 2.5,
});
