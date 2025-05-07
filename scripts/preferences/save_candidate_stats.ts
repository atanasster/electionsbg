import fs from "fs";
import {
  CandidatesInfo,
  CandidateStatsYearly,
  PartyInfo,
  PreferencesInfo,
} from "@/data/dataTypes";

const candidateYearStats = ({
  publicFolder,
  year,
  stats,
}: {
  publicFolder: string;
  year: string;
  stats: { name: string; stats: CandidateStatsYearly[] }[];
}) => {
  const outFolder = `${publicFolder}/${year}`;

  const parties: PartyInfo[] = JSON.parse(
    fs.readFileSync(`${outFolder}/cik_parties.json`, "utf-8"),
  );
  const candidates: CandidatesInfo[] = JSON.parse(
    fs.readFileSync(`${outFolder}/candidates.json`, "utf-8"),
  );
  const preferences: PreferencesInfo[] = JSON.parse(
    fs.readFileSync(`${outFolder}/preferences/country.json`, "utf-8"),
  );
  stats.forEach((stat) => {
    const candidate = candidates.filter((c) => c.name === stat.name);
    if (candidate.length) {
      const party = parties.find((p) => p.number === candidate[0].partyNum);

      const prefs = candidate.map((c) => {
        const pref = preferences.find(
          (p) =>
            p.partyNum === c.partyNum &&
            p.oblast === c.oblast &&
            p.pref === c.pref,
        );
        if (pref) {
          return {
            oblast: pref.oblast as string,
            pref: pref.pref,
            preferences: pref.totalVotes,
          };
        }
        return null;
      });
      stat.stats.push({
        elections_date: year,
        party,
        preferences: prefs.filter((p) => !!p),
      });
    } else {
      stat.stats.push({
        elections_date: year,
        preferences: [],
      });
    }
  });
};

export const saveCandidateStats = ({
  publicFolder,
  year,
  prevYears,
  stringify,
}: {
  publicFolder: string;
  year: string;
  prevYears: string[];
  stringify: (o: object) => string;
}) => {
  const outFolder = `${publicFolder}/${year}`;
  const candidates: CandidatesInfo[] = JSON.parse(
    fs.readFileSync(`${outFolder}/candidates.json`, "utf-8"),
  );
  const stats = candidates.map((c) => ({
    name: c.name,
    stats: [],
  }));
  candidateYearStats({
    publicFolder,
    year,
    stats,
  });
  for (let i = prevYears.length - 1; i >= 0; i--) {
    const prevYear = prevYears[i];
    candidateYearStats({ publicFolder, year: prevYear, stats });
  }
  const candidatesFolder = `${outFolder}/candidates`;
  if (!fs.existsSync(candidatesFolder)) {
    fs.mkdirSync(candidatesFolder);
  }
  stats.forEach((stat) => {
    const name = stat.name;

    const candidateFolder = `${candidatesFolder}/${name}`;
    if (!fs.existsSync(candidateFolder)) {
      fs.mkdirSync(candidateFolder);
    }

    const settlements: PreferencesInfo[] = JSON.parse(
      fs.readFileSync(`${candidateFolder}/settlements.json`, "utf-8"),
    );
    const sections: PreferencesInfo[] = JSON.parse(
      fs.readFileSync(`${candidateFolder}/sections.json`, "utf-8"),
    );
    const candidateStats = {
      stats: stat.stats,
      top_sections: sections
        .sort((a, b) => b.totalVotes - a.totalVotes)
        .slice(0, 10),
      top_settlements: settlements
        .sort((a, b) => b.totalVotes - a.totalVotes)
        .slice(0, 10),
    };
    fs.writeFileSync(
      `${candidateFolder}/preferences_stats.json`,
      stringify(candidateStats),
      "utf8",
    );
  });
};
