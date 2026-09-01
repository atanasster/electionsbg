// Phase 7's second question: can a home-feed event be attributed to a WATCHABLE SUBJECT?
//
//   npx tsx scripts/db/gen_home/subjects.ts
//
// §7.4 names six subject kinds — place, company, institution, product, programme, sector — and
// defers the cursor schema until „the home feed event IDs survive a 30-day stability test". This
// module answers the other half: given the events we actually publish, how many can be attached
// to a subject at all, and how many distinct subjects would ever receive one.
//
// ⚠️ ATTRIBUTION IS DERIVED FROM WHAT THE EVENT ALREADY DECLARES — `scope`, `route`, `factArgs`
// — and NEVER from parsing its prose. A subject guessed out of a title is a subscription that
// fires on a coincidence of words, and the reader cannot tell which of the two it was.
//
// It is a MEASUREMENT, not a feature: nothing imports it, and the cursor schema stays unbuilt
// until the evidence says otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HomeEventV1, HomeFeedV1 } from "../../../src/data/home/homeTypes";
import { obshtinaForCouncilKey } from "../../../src/data/council/councilObshtinaMap";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** §7.4's `WatchSubject`, restated here so this measurement does not require the schema. */
export type SubjectKind =
  | "place"
  | "company"
  | "institution"
  | "product"
  | "programme"
  | "sector";

export interface Subject {
  kind: SubjectKind;
  id: string;
}

/**
 * The kinds `subjectsOf` can actually produce.
 *
 * ⚠️ A KIND ABSENT FROM HERE HAS NO RULE, and its count of zero is NOT a measurement. `sector`
 * is the live case: nothing an event declares names one, so „sector 0" would read as „no sector
 * events exist" when it means „nobody wrote the rule" — a distinction that matters precisely
 * when Precondition 2 is re-checked.
 */
export const EXTRACTED: ReadonlySet<SubjectKind> = new Set<SubjectKind>([
  "place",
  "product",
  "company",
  "institution",
  "programme",
]);

/**
 * Every subject an event can be attached to, from its DECLARED fields only.
 *
 * ⚠️ A NATIONAL EVENT HAS NO SUBJECT, and that is a finding rather than a gap to paper over. „A
 * parliamentary sitting happened" is not about a place, a company or a programme — attaching it
 * to one so that every watchlist has something to show would make the subscription meaningless.
 */
export const subjectsOf = (e: HomeEventV1): Subject[] => {
  const out: Subject[] = [];
  // ⚠️ A MUNICIPALITY-SCOPED ROW CARRIES THE COUNCIL PIPELINE'S SHARD KEY, NOT A MUNICIPALITY
  // CODE — and eight of the sixteen keys are not frontend codes, three of them being OTHER
  // municipalities': `PDV01` is Асеновград, `BGS01` is Айтос, `VAR01` is Аврен, `SOF` names
  // nothing at all. Lifted straight into a subject it does not fail to resolve, it names the
  // WRONG PLACE plausibly — and 11 of the 12 place attributions in the first measured window
  // were `PDV01`, i.e. Plovdiv's decisions delivered to Asenovgrad. Refuse rather than mis-key:
  // an unresolvable subject is a finding, and `run()` counts them.
  if (e.scope.level === "municipality" && e.scope.id) {
    const code = obshtinaForCouncilKey(e.scope.id);
    if (code) out.push({ kind: "place", id: `obshtina:${code}` });
  }
  // ⚠️ NAMESPACED, because an oblast code and an obshtina code are different identifier spaces
  // and a bare id would let one subscription silently match the other.
  if (e.scope.level === "oblast" && e.scope.id)
    out.push({ kind: "place", id: `oblast:${e.scope.id}` });
  // The route is the canonical identity for the two families that have one.
  // Decoded: a route segment is percent-encoded, and two spellings of one id would otherwise be
  // two subscriptions.
  const seg = (re: RegExp): string | null => {
    const m = re.exec(e.route);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  };
  const product = seg(/^\/product\/([^/?#]+)/);
  if (product) out.push({ kind: "product", id: product });
  const company = seg(/^\/company\/([^/?#]+)/);
  if (company) out.push({ kind: "company", id: company });
  const awarder = seg(/^\/awarder\/([^/?#]+)/);
  if (awarder) out.push({ kind: "institution", id: awarder });
  // ⚠️ The PROGRAMME NAME, not a slug — the open-calls corpus has no programme id, so a
  // subscription would have to key on a free-text name the register can re-spell at any time.
  // Reported so the cost is visible rather than discovered later.
  const programme = e.factArgs.programme;
  if (typeof programme === "string" && programme.trim())
    out.push({ kind: "programme", id: programme.trim() });
  return out;
};

const run = (): void => {
  const feed = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/home/feed.json"), "utf8"),
  ) as HomeFeedV1;

  const byKind = new Map<SubjectKind, Map<string, number>>();
  let attached = 0;
  let refusedPlace = 0;
  const unattachedByCategory = new Map<string, number>();

  for (const e of feed.events) {
    // ⚠️ COUNTED SEPARATELY FROM „no subject". „We could not resolve this council key" and
    // „this event is national" are different answers, and only the first is a gap in the
    // bridge — reported so it can never render as „this place has nothing".
    if (
      e.scope.level === "municipality" &&
      e.scope.id &&
      !obshtinaForCouncilKey(e.scope.id)
    )
      refusedPlace++;
    const subs = subjectsOf(e);
    if (subs.length === 0) {
      unattachedByCategory.set(
        e.category,
        (unattachedByCategory.get(e.category) ?? 0) + 1,
      );
      continue;
    }
    attached++;
    for (const s of subs) {
      const m = byKind.get(s.kind) ?? new Map<string, number>();
      m.set(s.id, (m.get(s.id) ?? 0) + 1);
      byKind.set(s.kind, m);
    }
  }

  console.log(
    `subject attribution · ${feed.events.length} events in the ${feed.windowDays}-day window ` +
      `to ${feed.computedAt.slice(0, 10)}`,
  );
  console.log(
    `  attached to ≥1 subject: ${attached}/${feed.events.length} ` +
      `(${Math.round((100 * attached) / Math.max(feed.events.length, 1))}%)`,
  );
  if (refusedPlace > 0)
    console.log(
      `  ⚠ ${refusedPlace} municipality-scoped event(s) refused: the council key does not ` +
        `resolve to a frontend obshtina code`,
    );
  const KINDS: SubjectKind[] = [
    "place",
    "company",
    "institution",
    "product",
    "programme",
    "sector",
  ];
  for (const kind of KINDS) {
    const m = byKind.get(kind);
    if (!m || m.size === 0) {
      // ⚠️ „NO RULE" AND „NO SUPPLY" ARE DIFFERENT ZEROS, and only the second is evidence.
      // `sector` has no extraction rule at all — nothing in an event declares one — so
      // reporting it as „0 events" would read as a measured absence and would misfire exactly
      // when Precondition 2 is re-checked against a corpus that has since grown one.
      console.log(
        `  ${kind.padEnd(12)} ${
          EXTRACTED.has(kind)
            ? "— no event in this corpus carries one"
            : "— NOT MEASURED: no extraction rule exists for this kind"
        }`,
      );
      continue;
    }
    const counts = [...m.values()].sort((a, b) => b - a);
    console.log(
      `  ${kind.padEnd(12)} ${m.size} distinct · ${counts.reduce((a, b) => a + b, 0)} events · ` +
        `busiest ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}`,
    );
  }
  console.log("  unattached, by category:");
  for (const [c, n] of [...unattachedByCategory].sort((a, b) => b[1] - a[1]))
    console.log(`    ${c.padEnd(22)} ${n}`);
};

if (process.argv[1] && process.argv[1].includes("gen_home/subjects")) {
  try {
    run();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

export { run };
