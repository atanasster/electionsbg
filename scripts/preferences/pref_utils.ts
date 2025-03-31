import { CandidatesInfo, PreferencesInfo, SectionInfo } from "@/data/dataTypes";
import { totalAllVotes } from "@/data/utils";

const assignSectionPreference = ({
  preference,
  section,
  allVotes,
}: {
  preference: PreferencesInfo;
  section: SectionInfo;
  allVotes?: number;
}) => {
  preference.oblast = section.oblast;
  preference.obshtina = section.obshtina;
  preference.ekatte = section.ekatte;
  preference.partyVotes = section.results.votes.find(
    (v) => v.partyNum === preference.partyNum,
  )?.totalVotes;
  preference.allVotes = allVotes;
};
export const assignPrevYearPreference = ({
  section,
  tyPreferences,
  tyCandidates,
  lyCandidates,
  lyPreferences,
}: {
  section: SectionInfo;
  tyPreferences: PreferencesInfo[];
  tyCandidates: CandidatesInfo[];
  lyPreferences?: PreferencesInfo[];
  lyCandidates?: CandidatesInfo[];
}) => {
  const allVotes = totalAllVotes(section.results.votes);
  tyPreferences.forEach((p) => {
    assignSectionPreference({ section, preference: p, allVotes });
  });
  if (lyPreferences && lyCandidates) {
    const ly = lyPreferences.filter((l) => l.section === section.section);
    ly.forEach((preference) => {
      const lyCandidate = lyCandidates.find(
        (c) =>
          c.pref === preference.pref &&
          c.partyNum === preference.partyNum &&
          c.oblast === section.oblast,
      );
      if (lyCandidate) {
        const candidate = tyCandidates.find(
          (c) => c.name === lyCandidate.name && c.oblast === section.oblast,
        );
        if (candidate) {
          const pref = tyPreferences.find(
            (c) =>
              c.pref === candidate.pref && c.partyNum === candidate.partyNum,
          );
          if (pref) {
            pref.lyTotalVotes = preference.totalVotes;
          } else {
            const p: PreferencesInfo = {
              partyNum: candidate.partyNum,
              totalVotes: 0,
              pref: candidate.pref,
              lyTotalVotes: preference.totalVotes,
            };
            assignSectionPreference({
              section,
              preference: p,
              allVotes,
            });
            tyPreferences.push(p);
          }
        }
      }
    });
  }
};
