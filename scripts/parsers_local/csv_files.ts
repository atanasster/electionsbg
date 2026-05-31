// Resolve a race-folder TXT file by base name, tolerating the dated suffix
// CIK ships in the real bundles.
//
// The csv.zip race folders (ОС/КО/КК/КР) contain files named either bare
// (`votes.txt` — the README's idealised layout) or, in every actual bundle
// we've seen, dated (`votes_25.10.2015.txt`, `sections_29.10.2023.txt`). The
// original parsers only looked for the bare form, which is why CSV-mode never
// actually matched a file. Resolve `<base>.txt` first, then `<base>_*.txt`.

import fs from "fs";
import path from "path";

export const resolveRaceFile = (
  inFolder: string,
  base: string,
): string | null => {
  if (!fs.existsSync(inFolder)) return null;
  const exact = path.join(inFolder, `${base}.txt`);
  if (fs.existsSync(exact)) return exact;
  const re = new RegExp(`^${base}(_.*)?\\.txt$`, "i");
  const match = fs.readdirSync(inFolder).find((f) => re.test(f));
  return match ? path.join(inFolder, match) : null;
};
