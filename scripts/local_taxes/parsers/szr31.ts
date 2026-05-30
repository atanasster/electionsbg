// Стара Загора (SZR31) — oblast capital, both naredbi on obshtini.bg.
// Discovered via the slug-variant probe (probe_obshtini_all.ts): the
// subdomain concatenates the two-word name ("starazagora"), which the
// original underscore-only slug guess missed.
//   FEES: starazagora.obshtini.bg/doc/564999
//   TAX:  starazagora.obshtini.bg/doc/338011

import { createObshtiniBgNaredbaParser } from "../lib/obshtini_bg_naredba";

export const szr31Parser = createObshtiniBgNaredbaParser({
  obshtina: "SZR31",
  slug: "starazagora",
  feesDocId: 564999,
  taxDocId: 338011,
  year: 2025,
  label: "Община Стара Загора — Наредби за местните данъци и такси",
});
