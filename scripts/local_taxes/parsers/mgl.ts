// Maglizh (Община Мъглиж) — Stara Zagora oblast município, both naredbi
// on obshtini.bg.
//   FEES: maglizh.obshtini.bg/doc/5853991
//   TAX:  maglizh.obshtini.bg/doc/5822281

import { createObshtiniBgNaredbaParser } from "../lib/obshtini_bg_naredba";

export const mglParser = createObshtiniBgNaredbaParser({
  obshtina: "SZR22",
  slug: "maglizh",
  feesDocId: 5853991,
  taxDocId: 5822281,
  year: 2025,
  label: "Община Мъглиж — Наредби за местните данъци и такси",
});
