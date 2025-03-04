export const backupFileName = (fName: string) => {
  const parts = fName.split(".");
  return `${parts[0]}_original.${parts[1]}`;
};
