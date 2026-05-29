// Razgrad (Община Разград) — oblast capital, both naredbi on obshtini.bg.
//   FEES: razgrad.obshtini.bg/doc/6505930
//   TAX:  razgrad.obshtini.bg/doc/6505934

import { createObshtiniBgNaredbaParser } from "../lib/obshtini_bg_naredba";

export const razParser = createObshtiniBgNaredbaParser({
  obshtina: "RAZ26",
  slug: "razgrad",
  feesDocId: 6505930,
  taxDocId: 6505934,
  year: 2025,
  label: "Община Разград — Наредби за местните данъци и такси",
});
