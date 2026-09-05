import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseElections } from "./parse_elections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Never written to: every case below is refused before any file is opened.
const publicFolder = path.resolve(__dirname, "../../data");
const stringify = (o: object) => JSON.stringify(o);

// `--date` is the operator's one lever here, and `raw_data/` now holds four kinds of
// election tree. Handing a `_pvr` or `_mi` folder to the parliamentary parser used to
// get as far as `parseParties`, whose `createReadStream` on the missing
// `cik_parties.txt` rejects unhandled — an ENOENT stack rather than an explanation.
describe("parseElections refuses a wrong-kind --date", () => {
  it.each([
    ["2021_11_14_pvr", /presidential cycle/],
    ["2023_10_29_mi", /local cycle/],
    ["2026_02_22_chmi", /chmi cycle/],
    ["agri", /not an election folder/],
  ])("%s", async (date, message) => {
    await expect(
      parseElections({ date, publicFolder, stringify }),
    ).rejects.toThrow(message);
  });

  // The refusal must not swallow the ordinary typo case: a name of the RIGHT kind
  // that simply is not there still reports as missing, not as wrong-kind.
  it("still reports a missing parliamentary folder as missing", async () => {
    await expect(
      parseElections({ date: "2099_01_01", publicFolder, stringify }),
    ).rejects.toThrow(/Can not find specified folder/);
  });

  // Neither flag set is the documented no-op; it must stay one rather than falling
  // through to "parse the latest".
  it("does nothing when neither date nor all is given", async () => {
    await expect(
      parseElections({ publicFolder, stringify }),
    ).resolves.toBeUndefined();
  });
});
