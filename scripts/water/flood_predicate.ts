// The riverbed-works discriminator, ONE definition, shared by the generator
// (write_flood_maintenance.ts) and its gate (water_flood_maintenance.data.test.ts)
// so the two cannot count different corpora. No user input — inline literals.
//
// ⚠️ It selects a TOPIC, not the water sector: any awarder qualifies (municipalities,
// oblast governors, Напоителни системи), so its total is never summed with the
// WATER_SECTOR_EIKS procurement figure (docs/plans/water-hub-v1.md W5).
//
// ⚠️ TIGHTENED 2026-10-13 — the first version over-counted by ~€146M of €428M.
// It took every row under CPV 45247 (dams, canals, IRRIGATION channels) and
// 90721 (environmental-safety services), and the bare word „проводимост". So it
// published as „riverbed cleaning":
//   - Напоителни системи's irrigation-canal reconstruction („…35 хидромелиоративни
//     съоръжения за напояване", 74 contracts / €48.3M);
//   - Danube fairway dredging for navigation (€15.7M);
//   - Sofia's street gullies with snow clearing (€7.9M);
//   - sewer repairs, drinking-water reservoirs, waste transport, and an MRI magnet
//     „с висока проводимост".
// The rule is now three clauses, and every one is needed:
//   ENTRY — CPV 45246 (river regulation and flood control), or a title naming the
//           work (речно корито, корекция на р., почистване на дере, укрепване на
//           бреговете, охранителен канал, дига, вредното въздействие на водите);
//   RIVER — the title must name a river, riverbed, gully, bank, dike or flood:
//           45246 alone also carried a block of flats and a bike-path slope;
//   EXCL  — irrigation, navigation dredging, street gullies, drinking-water
//           reservoirs and landfill-cell dikes are out even when a river word
//           appears beside them. Each pattern is PHRASED, not a bare noun: a bare
//           „депо", „канализац" or „водоем" also dropped genuine river work whose
//           title merely mentions hauling debris to a landfill, a repaired sewer, or
//           a reservoir as a location (~€1.5M, review 2026-10-13).
// Measured on the 2026-10-13 corpus: 1,011 contracts / €313.1M, from 985 / €427.9M.
// The old rule erred BOTH ways: it over-counted irrigation and dredging, and it
// never matched „(почистване на) коритото на р./река" — 49+ genuine clean-ups.
// Known and kept: mixed contracts that bundle a river correction with other works
// (Банско's ПСОВ + ВиК network + river correction, €21.7M) cannot be split by title.
const ENTRY =
  "(\\mречн\\S* корит|корит\\S* на (р\\.|р |река|дере)|корекция на (р|дере)|почистване.*дере|\\mпроводимост|укрепване на бреговете|охранител[а-я]* канал|вредното въздействие на водите|\\mдиг[аи]\\M)";
const RIVER =
  '(\\mречн|корит|дере|\\mрек[аи]\\M|\\mр\\.\\s*[А-ЯA-Z„"]|брегов|наводн|охранител[а-я]* канал|\\mдиг[аи]\\M|вредното въздействие на водите)';
const EXCLUDE =
  "(напояван|хидромелиоратив|дъждоприем|снегопочист|фарватер|корабоплав|драг[иа]|питейн[а-я]* водоем|водоеми за питейн|клетк[аи] №|регионално депо|депо за (отпадъци|ТБО|неопасни))";

export const FLOOD_WHERE = `tag = 'contract'
  AND (cpv LIKE '45246%' OR title ~* '${ENTRY}')
  AND title ~* '${RIVER}'
  AND NOT title ~* '${EXCLUDE}'`;

/** The exclusion pattern, exported so the gate can assert no selected title
 *  matches it (a mutation that drops the NOT clause must fail). */
export const FLOOD_EXCLUDE = EXCLUDE;
