// Catalogue of per-município naredba parsers. Add a new município by:
//   1. Writing scripts/local_taxes/parsers/<obshtina>.ts that exports a
//      `NaredbaParser` (see sof.ts as the template).
//   2. Importing it and pushing it onto NAREDBA_PARSERS here.
//   3. The watch source picks it up automatically.

import type { NaredbaParser } from "../types";
import { sofParser } from "./sof";
import { varParser } from "./var";
import { bgsParser } from "./bgs";
import { pdvParser } from "./pdv";

export const NAREDBA_PARSERS: NaredbaParser[] = [
  sofParser,
  varParser,
  bgsParser,
  pdvParser,
];

export const parsersByObshtina = (): Map<string, NaredbaParser> => {
  const map = new Map<string, NaredbaParser>();
  for (const p of NAREDBA_PARSERS) {
    if (map.has(p.obshtina)) {
      throw new Error(`duplicate parser for ${p.obshtina}`);
    }
    map.set(p.obshtina, p);
  }
  return map;
};
