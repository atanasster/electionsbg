import fs from "fs";
import { parse } from "csv-parse";
import {
  AgenciesSummary,
  FinancingAgency,
  PartyFinancing,
  PartyInfo,
  SharedVendor,
} from "@/data/dataTypes";

export type ParsedAgency = FinancingAgency & { cik_party_name: string };

// Precompute the agencies summary the common dashboard needs (counts + the
// vendors hired by more than one party), so it loads a small file instead of
// the full ~200 KB per-party agency list. Mirrors the grouping the dashboard
// used to do client-side.
export const buildAgenciesSummary = (
  partiesFinancing: PartyFinancing[],
): AgenciesSummary => {
  const byEik = new Map<
    string,
    { name: string; type?: string; parties: Set<number> }
  >();
  const byType = new Map<string, number>();
  let total = 0;
  for (const p of partiesFinancing) {
    for (const a of p.data.agencies) {
      total += 1;
      byType.set(a.type ?? "", (byType.get(a.type ?? "") ?? 0) + 1);
      const key = a.eik || a.name;
      const e =
        byEik.get(key) ??
        ({ name: a.name, type: a.type, parties: new Set<number>() } as {
          name: string;
          type?: string;
          parties: Set<number>;
        });
      e.parties.add(p.party);
      if (!e.type && a.type) e.type = a.type;
      byEik.set(key, e);
    }
  }
  const sharedVendors: SharedVendor[] = [...byEik.entries()]
    .map(([key, v]) => ({
      eik: /^\d+$/.test(key) ? key : undefined,
      name: v.name,
      type: v.type,
      parties: [...v.parties].sort((a, b) => a - b),
    }))
    .filter((v) => v.parties.length > 1)
    .sort(
      (a, b) =>
        b.parties.length - a.parties.length || a.name.localeCompare(b.name),
    );
  return {
    total,
    distinctCompanies: byEik.size,
    byType: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    sharedVendors,
  };
};

// Resolve the ЕРИК "Към участник" field ("КП ГЕРБ-СДС - Коалиция",
// "Тодор Тодоров Батков - Инициативен комитет") to a CIK party name. Same
// contract as parse_candidate_donations: strip the trailing " - <type>"
// segment, then apply the sp_parties.json override, else the fuzzy prefix
// rules. Unlike the candidate parser we also resolve Инициативен комитет rows
// (they map through sp_parties.json too), so no agency is dropped.
const resolveParty = (
  participantField: string,
  lookup: Record<string, string>,
  cik: PartyInfo[],
): string | null => {
  const parts = participantField.split(" - ");
  const spName =
    parts.length > 1 ? parts.slice(0, -1).join(" - ") : participantField;
  const mapped = lookup[spName];
  const party = mapped
    ? cik.find((p) => p.name === mapped)
    : cik.find(
        (p) =>
          p.name === spName ||
          p.name === `КОАЛИЦИЯ ${spName}` ||
          p.name === `ПП ${spName}` ||
          `КП ${p.name}` === spName ||
          p.name === `ПОЛИТИЧЕСКА ПАРТИЯ ${spName}`,
      );
  return party?.name ?? null;
};

// Parse the election-wide agencies.csv into CIK-party-resolved rows. Unmatched
// participants are warned + skipped (agencies is a secondary dataset — a stray
// row must not fail the whole financing parse).
export const parseAgencies = async ({
  dataFolder,
  cik_parties,
}: {
  dataFolder: string;
  cik_parties: PartyInfo[];
}): Promise<ParsedAgency[]> => {
  const file = `${dataFolder}/agencies.csv`;
  if (!fs.existsSync(file)) return [];
  const lookupFile = `${dataFolder}/sp_parties.json`;
  const lookup: Record<string, string> = fs.existsSync(lookupFile)
    ? JSON.parse(fs.readFileSync(lookupFile, "utf-8"))
    : {};

  const rows: string[][] = [];
  await new Promise<void>((resolve) =>
    fs
      .createReadStream(file)
      .pipe(
        parse({ delimiter: ",", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (r: string[]) => rows.push(r))
      .on("end", () => resolve()),
  );

  const out: ParsedAgency[] = [];
  const unmatched = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const [name, eik, type, participant, descr] = rows[i];
    // Skip the header row and blanks.
    if (!name || name === "Наименование" || !participant) continue;
    const cik_party_name = resolveParty(participant, lookup, cik_parties);
    if (!cik_party_name) {
      unmatched.add(participant);
      continue;
    }
    out.push({
      cik_party_name,
      name,
      eik: eik || undefined,
      type: type || undefined,
      descr: descr || undefined,
    });
  }
  if (unmatched.size) {
    console.warn(
      `  parse_agencies: ${unmatched.size} unmatched participant(s), agencies skipped: ${[...unmatched].join("; ")}`,
    );
  }
  return out;
};
