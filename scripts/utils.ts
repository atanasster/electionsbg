export const isMachineOnlyVote = (year: string) => {
  return ["2021_07_11", "2021_11_14", "2022_10_02"].includes(year);
};
