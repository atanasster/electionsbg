import fs from "fs";
import { parse } from "csv-parse";
import { CandidatesInfo, PartyInfo } from "@/data/dataTypes";

export type CandidateDonations = {
  candidate_name: string;
  cik_party_name: string;
  date: string;
  kind: string;
  monetary: number;
  nonMonetary: number;
};
export const parseCandidateDonations = async ({
  dataFolder,
  candidates,
  cik_parties,
}: {
  dataFolder: string;
  candidates: CandidatesInfo[];
  cik_parties: PartyInfo[];
}): Promise<CandidateDonations[]> => {
  const result: string[][] = [];
  const fromFileName = `${dataFolder}/candidates_donations.csv`;
  if (!fs.existsSync(fromFileName)) {
    return [];
  }
  const partiesLookup: Record<string, string> = JSON.parse(
    fs.readFileSync(`${dataFolder}/sp_parties.json`, "utf-8"),
  );

  return new Promise((resolve) =>
    fs
      .createReadStream(fromFileName)
      .pipe(
        parse({ delimiter: ",", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        const allCandidates: CandidateDonations[] = [];
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          let candidate_name = row[0];

          const monetary = parseFloat(row[4]);
          const nonMonetary = parseFloat(row[5]);
          if (
            candidate_name &&
            candidate_name !== "Сума:" &&
            (!isNaN(monetary) || !isNaN(nonMonetary))
          ) {
            const nameParts = candidate_name
              .toLowerCase()
              .split(" ")
              .filter((s) => s !== "");
            const nameMatches = candidates.find((candidate) => {
              const candidateParts = candidate.name
                .toLowerCase()
                .split(" ")
                .filter((s) => s !== "");
              if (
                nameParts.length === candidateParts.length &&
                nameParts.join(" ") === candidateParts.join(" ")
              ) {
                return true;
              }
              if (
                nameParts.length === 2 &&
                candidateParts.length === 3 &&
                nameParts[0] === candidateParts[0] &&
                nameParts[1] === candidateParts[2]
              ) {
                return true;
              }
              return false;
            });
            if (nameMatches) {
              candidate_name = nameMatches.name;
            } else {
              candidate_name = nameParts
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");
            }

            const sp_PartyFull = row[1];
            const sp_PartyNameParts = sp_PartyFull.split(" - ");
            if (
              sp_PartyNameParts[sp_PartyNameParts.length - 1] !==
              "Инициативен комитет"
            ) {
              const sp_PartyName = sp_PartyNameParts.slice(0, -1).join(" - ");

              const party = partiesLookup[sp_PartyName]
                ? cik_parties.find((p) => p.name == partiesLookup[sp_PartyName])
                : cik_parties.find(
                    (p) =>
                      p.name === sp_PartyName ||
                      p.name === `КОАЛИЦИЯ ${sp_PartyName}` ||
                      p.name === `ПП ${sp_PartyName}` ||
                      `КП ${p.name}` === sp_PartyName ||
                      p.name === `ПОЛИТИЧЕСКА ПАРТИЯ ${sp_PartyName}`,
                  );
              if (!party) {
                throw new Error("Could not find party name: " + sp_PartyName);
              }
              const date = row[2];
              const kind = row[4];
              allCandidates.push({
                candidate_name,
                cik_party_name: party.name,
                date,
                monetary,
                nonMonetary,
                kind,
              });
            }
          }
        }
        resolve(allCandidates);
      }),
  );
};
