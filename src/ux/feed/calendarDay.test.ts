// A repo-wide lint for one defect that has now shipped four times.
//
// THE SHAPE. A plain calendar day ("2026-07-31") is parsed as UTC midnight and then handed
// to an Intl.DateTimeFormat with no `timeZone`, so it is rendered in the VIEWER's zone.
// West of UTC that is 17:00 the previous day, and the label comes out one day early. The
// numbers are all correct; the date is simply wrong, which is why it survives review — and
// on /votes/<date> it produced a page whose URL said 31 July and whose heading said 30 July.
//
// Found in six files at once by a sweep, after being fixed individually in the session strip,
// the news rail and the contested-votes tile. A grep is a blunt instrument, but the
// alternative is remembering, and remembering has a measured 0% success rate here.
//
// The right fix in a COMPONENT is useDayLabel(); this gate only insists the timezone is
// pinned somehow, because several of these are module-level helpers where a hook cannot go.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });

describe("calendar days are formatted in UTC", () => {
  test("no file parses a UTC-midnight day and formats it without timeZone", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const src = readFileSync(file, "utf8");
      // Only files that BUILD a calendar-day Date are in scope: an Intl formatter over a real
      // instant (a timestamp, Date.now()) is correctly rendered in the viewer's zone.
      if (!src.includes("T00:00:00Z")) continue;
      // Each formatter's options object, checked on its own — a file can hold one correct
      // formatter and one broken one, which MyAreaAlertsTile did.
      for (const m of src.matchAll(
        /new Intl\.DateTimeFormat\(([\s\S]*?)\n\s*\}\)/g,
      )) {
        // COMMENTS STRIPPED FIRST, and that is not a nicety. The fix these files carry is a
        // `timeZone: "UTC"` option under a comment explaining why — and the comment contains
        // the words `timeZone: "UTC"`. Without this line the gate matched the PROSE, so
        // deleting the actual option left it green. Verified by doing exactly that.
        const opts = m[1].replace(/\/\/.*$/gm, "");
        // A formatter with no options object at all takes the locale default and formats no
        // explicit day, so it cannot show the wrong one.
        if (!/(year|month|day|weekday)\s*:/.test(opts)) continue;
        if (!opts.includes("timeZone")) {
          offenders.push(path.relative(".", file));
        }
      }
    }
    assert.deepEqual(
      [...new Set(offenders)],
      [],
      "these format a calendar day in the viewer's timezone, so it renders a day early " +
        'west of UTC — pass timeZone: "UTC", or use useDayLabel() in a component:\n' +
        [...new Set(offenders)].join("\n"),
    );
  });

  test("the sweep still finds the files it is meant to police", () => {
    // Without this the gate above passes vacuously the day the regex stops matching, or the
    // day someone renames the T00:00:00Z idiom.
    const scanned = walk("src").filter((f) =>
      readFileSync(f, "utf8").includes("T00:00:00Z"),
    );
    assert.ok(
      scanned.length >= 8,
      `only ${scanned.length} files build a UTC-midnight day; the sweep found 12+ when written`,
    );
  });
});
