// Balchik (Община Балчик) — Dobrich-oblast município, both naredbi on
// obshtini.bg.
//   FEES: balchik.obshtini.bg/doc/6563059
//   TAX:  balchik.obshtini.bg/doc/6563060

import { createObshtiniBgNaredbaParser } from "../lib/obshtini_bg_naredba";

export const blcParser = createObshtiniBgNaredbaParser({
  obshtina: "DOB03",
  slug: "balchik",
  feesDocId: 6563059,
  taxDocId: 6563060,
  year: 2025,
  label: "Община Балчик — Наредби за местните данъци и такси",
});
