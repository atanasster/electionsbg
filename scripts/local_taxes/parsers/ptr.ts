// Petrich (Община Петрич) — Blagoevgrad-oblast município, both naredbi
// on obshtini.bg.
//   FEES: petrich.obshtini.bg/doc/4416578
//   TAX:  petrich.obshtini.bg/doc/3103531
//
// Petrich's TAX naredba publishes the property-tax rate as a two-row
// tariff: 2.3‰ for non-residential of enterprises, 3‰ for residential
// of enterprises + all property of citizens. The extractor picks the
// higher (3‰) — the relevant rate for the typical household.

import { createObshtiniBgNaredbaParser } from "../lib/obshtini_bg_naredba";

export const ptrParser = createObshtiniBgNaredbaParser({
  obshtina: "BLG33",
  slug: "petrich",
  feesDocId: 4416578,
  taxDocId: 3103531,
  year: 2025,
  label: "Община Петрич — Наредби за местните данъци и такси",
});
