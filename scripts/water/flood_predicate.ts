// The riverbed-works discriminator: CPV (river regulation / flood-defence works)
// OR title keywords. ONE definition, shared by the generator
// (write_flood_maintenance.ts) and its gate (water_flood_maintenance.data.test.ts)
// so the two cannot count different corpora. No user input — inline literals.
//
// ⚠️ It selects a TOPIC, not the water sector: any awarder qualifies (municipalities,
// oblast governors, Напоителни системи), so its total is never summed with the
// WATER_SECTOR_EIKS procurement figure (docs/plans/water-hub-v1.md W5).
export const FLOOD_WHERE = `tag = 'contract' AND (
  cpv LIKE '45246%' OR cpv LIKE '45247%' OR cpv LIKE '90721%'
  OR title ILIKE '%речно корито%' OR title ILIKE '%речни корита%'
  OR title ILIKE '%проводимост%' OR title ILIKE '%корекция на река%'
  OR title ILIKE '%почистване%дере%'
)`;
