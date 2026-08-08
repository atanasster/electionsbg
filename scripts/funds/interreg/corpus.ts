// Read the committed Interreg corpus — `data/funds/interreg/`.
//
// ONE READER, and it lives HERE rather than in the loader. `scripts/funds/interreg/`
// owns this corpus — the types, the parse and the ingest that writes it are all
// in this directory — so the loader is its consumer, not its owner.
//
// The placement matters beyond tidiness. `measure.ts` is documented as safe to
// point at PRODUCTION through the Cloud SQL proxy, and when this function lived
// in `load_interreg_pg.ts` that promise was carried by a single line: the
// loader's `isMain` guard. Importing the reader pulled the whole write path —
// stage `CREATE TABLE`s, an unscoped anti-join DELETE, COPY, `recordIngestBatch`
// — into the harness's process, dormant only because that guard evaluated false.
// A later refactor of the loader to top-level-await its own main would have
// turned a read-only measurement into a stage merge against whatever
// `DATABASE_URL` named, with nothing in the harness changing. Now the harness
// imports a file that cannot write.

import path from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import type {
  InterregIndex,
  InterregOperation,
  InterregPartner,
} from "./types";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const CORPUS_DIR = path.join(ROOT, "data/funds/interreg");

const FILES = ["index.json", "operations.json", "partners.json"] as const;

export interface InterregCorpusFiles {
  index: InterregIndex;
  operations: InterregOperation[];
  partners: InterregPartner[];
}

/** The committed corpus, or a throw naming the command that produces it.
 *
 *  Throws rather than returning empty: every caller (the loader, the harness)
 *  would otherwise report a real zero for a missing file, and "0 Interreg
 *  operations" is a plausible-looking answer that happens to be about the
 *  checkout rather than about Interreg. */
export const readCorpus = (): InterregCorpusFiles => {
  for (const f of FILES)
    if (!existsSync(path.join(CORPUS_DIR, f)))
      throw new Error(
        `interreg: ${path.relative(ROOT, path.join(CORPUS_DIR, f))} is missing. ` +
          `Run \`npm run funds:ingest-interreg\` first.`,
      );
  return {
    index: JSON.parse(
      readFileSync(path.join(CORPUS_DIR, "index.json"), "utf8"),
    ),
    operations: JSON.parse(
      readFileSync(path.join(CORPUS_DIR, "operations.json"), "utf8"),
    ),
    partners: JSON.parse(
      readFileSync(path.join(CORPUS_DIR, "partners.json"), "utf8"),
    ),
  };
};
