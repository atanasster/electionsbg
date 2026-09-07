// CLI: rebuild „Разлика с флаш паметта" for every presidential round that has flash records.
//
//   npm run presidential:flash                 # every cycle the catalogue declares a tree for
//   npm run presidential:flash -- 2021_11_14_pvr
//
// ⚠ IT IS NOT IN ANY CHAIN, and that is deliberate. The input is `raw_data/**/suemg` — ~24,000
// zip archives across the two 2021 rounds, gitignored, ~60 s to walk — so it is an operator
// action like the other raw-tree passes, not something a data refresh should re-run. Its output
// is committed, so a fresh clone serves the tile without ever opening an archive.

import { PRESIDENTIAL_SOURCES } from "./sources";
import { buildPresidentialFlashDiff } from "./flash_diff";

const stringify = (o: object) => JSON.stringify(o, null, 2);
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const run = async () => {
  const cycles = only.length ? only : Object.keys(PRESIDENTIAL_SOURCES);
  let wrote = 0;
  for (const cycle of cycles) {
    for (const round of [1, 2] as const) {
      const res = await buildPresidentialFlashDiff({
        publicFolder: "data",
        cycle,
        round,
        stringify,
      });
      if (!res) continue;
      wrote += 1;
      const { comparedSections, protocolSections, uncomparedMachineVotes } =
        res.coverage;
      const compared = res.tickets.reduce((a, t) => a + t.machineVotes, 0);
      const total = compared + uncomparedMachineVotes;
      console.log(
        `${cycle} tur${round}: ${comparedSections}/${protocolSections} sections, ` +
          `${compared.toLocaleString("bg-BG")} of ${total.toLocaleString("bg-BG")} machine votes ` +
          `compared (${((100 * compared) / total).toFixed(2)}%)`,
      );
    }
  }
  // ⚠ ZERO IS THE EXPECTED ANSWER FOR FOUR OF THE FIVE CYCLES — only 2021 published records —
  // so it is reported rather than treated as a failure.
  console.log(`wrote ${wrote} flash comparison(s).`);
};

await run();
