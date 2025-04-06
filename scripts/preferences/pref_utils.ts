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

export const assignPrevYearPreferences = ({
  tyCandidates,
  tyPreferences,
  lyCandidates,
  lyPreferences,
}: {
  tyPreferences: PreferencesInfo[];
  tyCandidates: CandidatesInfo[];
  lyPreferences?: PreferencesInfo[];
  lyCandidates?: CandidatesInfo[];
}) => {
  if (lyCandidates) {
    lyPreferences?.forEach((lyPref) => {
      const lyCandidate = lyCandidates.find(
        (c) =>
          c.pref === lyPref.pref &&
          c.partyNum === lyPref.partyNum &&
          c.oblast === lyPref.oblast,
      );
      if (lyCandidate) {
        const candidate = tyCandidates.find(
          (c) => c.name === lyCandidate.name && c.oblast === lyCandidate.oblast,
        );
        if (candidate) {
          const pref = tyPreferences.find(
            (c) =>
              c.pref === candidate.pref &&
              c.partyNum === candidate.partyNum &&
              c.oblast === candidate.oblast,
          );
          if (pref) {
            pref.lyTotalVotes = lyPref.totalVotes;
            if (lyPref.paperVotes) {
              pref.lyPaperVotes = lyPref.paperVotes;
            }
            if (lyPref.machineVotes) {
              pref.lyMachineVotes = lyPref.machineVotes;
            }
          }
        }
      }
    });
  }
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
    ly.forEach((lyPref) => {
      const lyCandidate = lyCandidates.find(
        (c) =>
          c.pref === lyPref.pref &&
          c.partyNum === lyPref.partyNum &&
          c.oblast === section.oblast,
      );
      if (lyCandidate) {
        const candidate = tyCandidates.find(
          (c) => c.name === lyCandidate.name && c.oblast === section.oblast,
        );
        if (candidate) {
          let pref = tyPreferences.find(
            (c) =>
              c.pref === candidate.pref && c.partyNum === candidate.partyNum,
          );
          if (!pref) {
            pref = {
              partyNum: candidate.partyNum,
              totalVotes: 0,
              pref: candidate.pref,
            };
            assignSectionPreference({
              section,
              preference: pref,
              allVotes,
            });
            tyPreferences.push(pref);
          }
          pref.lyTotalVotes = lyPref.totalVotes;
          if (lyPref.paperVotes) {
            pref.lyPaperVotes = lyPref.paperVotes;
          }
          if (lyPref.machineVotes) {
            pref.lyMachineVotes = lyPref.machineVotes;
          }
        }
      }
    });
  }
};

export const addPreferences = (
  acc: PreferencesInfo[],
  preferences: PreferencesInfo[],
  defaults: Partial<PreferencesInfo>,
) => {
  preferences.forEach((p) => {
    const a = acc.find(
      (a) =>
        a.partyNum === p.partyNum &&
        a.pref === p.pref &&
        a.oblast === defaults.oblast,
    );
    if (a) {
      a.totalVotes = a.totalVotes + p.totalVotes;
      if (p.machineVotes) {
        a.machineVotes = (a.machineVotes || 0) + p.machineVotes;
      }
      if (p.paperVotes) {
        a.paperVotes = (a.paperVotes || 0) + p.paperVotes;
      }
      if (p.partyVotes) {
        a.partyVotes = (a.partyVotes || 0) + p.partyVotes;
      }
      if (p.allVotes) {
        a.allVotes = (a.allVotes || 0) + p.allVotes;
      }
    } else {
      const n: PreferencesInfo = {
        partyNum: p.partyNum,
        totalVotes: p.totalVotes,
        allVotes: p.allVotes,
        partyVotes: p.partyVotes,
        pref: p.pref,
      };
      if (defaults.oblast) {
        n.oblast = defaults.oblast;
      }
      if (defaults.ekatte) {
        n.ekatte = defaults.ekatte;
      }
      if (defaults.obshtina) {
        n.obshtina = defaults.obshtina;
      }
      if (p.machineVotes) {
        n.machineVotes = p.machineVotes;
      }
      if (p.paperVotes) {
        n.paperVotes = p.paperVotes;
      }
      acc.push(n);
    }
  });
};
