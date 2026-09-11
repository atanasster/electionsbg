// Presidential tickets → `/person/<slug>`, resolved once and committed.
//
//   npx tsx scripts/parsers_presidential/build_ticket_persons.ts          # report only
//   npx tsx scripts/parsers_presidential/build_ticket_persons.ts --write  # rewrite the map
//
// ⚠⚠ A NAME IS NOT AN IDENTITY, AND THIS FILE'S JOB IS MOSTLY REFUSING. Linking „Румен
// Георгиев Радев" on a result page to a `/person` profile is a claim about a named individual;
// getting it wrong attributes an election, and everything else on that profile — declared
// wealth, company roles, sanctions facets — to somebody who merely shares a name. So a fold
// that matches more than one public figure is REFUSED rather than scored, the way
// `aop_expert_person_links()` refuses and `resolve_persons`' bridges refuse. There is no
// „best match" here and there must never be one.
//
// ⚠ THE FOLD IS POSTGRES'S OWN. `person.name_fold` is `translit_bg_latin(display_name)`, a
// GENERATED column — so the query folds the ticket name with the SAME function rather than
// reimplementing it in TypeScript, where the two could drift. That is the whole reason this is
// a database read and not a string comparison over a committed dump.
//
// ⚠ COMMITTED, BECAUSE THE PRESIDENTIAL FAMILY HAS NO DATABASE. Every other consumer of the
// person layer queries `/api/db`; this tree is JSON, so the link has to be resolved at build
// time and shipped. That makes it a snapshot: a person re-slugged after this ran keeps the old
// target until it is re-run, which is what `person_slug_retired`'s 301s exist for — the link
// degrades to a redirect rather than a 404. Re-run it after `db:resolve:persons`.
//
// ⚠ IT SHIPS IN THE BUNDLE, NOT THE BUCKET. `src/data/presidential/ticketPersons.ts` IMPORTS
// it, so it reaches a reader through `npm run deploy` and NOT through `bucket:sync` — unlike
// every other file under `data/`. A re-run therefore needs a build and a hosting deploy to be
// visible; syncing the bucket does nothing for it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../db/lib/pg";
import { PRESIDENTIAL_FOLDER_RE } from "../lib/electionFolders";
import { parseName } from "../person/nameParts";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");
const OUT_FILE = path.join(DATA_ROOT, "presidential", "ticket_persons.json");

type Ticket = { number: number; president: string; vicePresident: string };

/** One resolved name. ⚠ `slug` IS ABSENT WHEN THE NAME WAS REFUSED — and `reason` says which
 *  refusal, because „nobody by that name is a public figure" and „more than one is" are
 *  different facts and only the second is about ambiguity. */
export type TicketPersonLink = {
  name: string;
  slug?: string;
  reason?: "not_found" | "ambiguous";
  /** How many PUBLIC FIGURES share the fold — the number the link rule is decided on. */
  candidates: number;
  /**
   * How many person rows share it AT ALL, public or not.
   *
   * ⚠⚠ THE LINK RULE AND THE WARNING ARE DIFFERENT QUESTIONS, and `candidates` answers only
   * the first. A fold with one public figure and three private rows is a legitimate link and
   * a name three other people carry — so a surface that warned on `candidates > 1` alone
   * would tell the reader nothing about it. Measured: 5 of 78 linked names have 2–3 registry
   * people on their fold.
   */
  people: number;
  /**
   * The Commerce Registry's own count of distinct PEOPLE under this fold.
   *
   * ⚠ `null` MEANS UNMEASURED, NEVER 1 — `081_person_identity.sql` says so about
   * `fold_people_n` in as many words, and 40 of the 78 links carry a NULL. Rendering it as 1
   * would publish „this name is unique" about a fold nobody has counted.
   */
  foldPeople: number | null;
  /**
   * Which key matched.
   *
   * ⚠ `block` IS THE WEAKER ONE and it is named so the artifact shows it. The ballot prints
   * some names with two parts where `person` holds three, so the full fold can never match —
   * 14 of 140 names, including 2006's WINNING PRESIDENT on the cycle he won. The fallback
   * compares (given, family), the blocking key 081 already indexes, under exactly the same
   * refuse-if-not-one rule: it recovers 4 of the 14 and still refuses „Георги Първанов",
   * where three public figures share the pair and the alphabetically first is a different man.
   */
  basis?: "fold" | "block";
};

export type TicketPersonMap = {
  builtFrom: string;
  /** Keyed by the ticket's Bulgarian name exactly as `tickets.json` prints it. */
  links: Record<string, TicketPersonLink>;
};

export const presidentialCycles = (root = DATA_ROOT): string[] =>
  fs.existsSync(root)
    ? fs
        .readdirSync(root)
        .filter((d) => PRESIDENTIAL_FOLDER_RE.test(d))
        .filter((d) => fs.existsSync(path.join(root, d, "tickets.json")))
        .sort()
    : [];

/** Every distinct person named on a presidential ballot — presidents AND vice-presidents. */
export const ticketNames = (root = DATA_ROOT): string[] => {
  const names = new Set<string>();
  for (const cycle of presidentialCycles(root)) {
    const file = path.join(root, cycle, "tickets.json");
    if (!fs.existsSync(file)) continue;
    try {
      const { tickets } = JSON.parse(fs.readFileSync(file, "utf8")) as {
        tickets: Ticket[];
      };
      for (const t of tickets ?? []) {
        // ⚠ BOTH HALVES OF THE PAIR. A vice-president is a named office-holder with a profile
        // of their own — Йотова has served two terms — and linking only the president would
        // publish half the ballot as unlinkable.
        if (t.president?.trim()) names.add(t.president.trim());
        if (t.vicePresident?.trim()) names.add(t.vicePresident.trim());
      }
    } catch (e) {
      // ⚠ THROW, DO NOT SKIP. An unparseable `tickets.json` silently shrinks the name list,
      // and every floor below it is a `>` against a total — so a cycle vanishing entirely
      // leaves the gates green and its whole ballot unlinked with nothing saying why.
      throw new Error(
        `[ticket-persons] ${cycle}/tickets.json is unreadable: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return [...names].sort();
};

/**
 * Resolve each name against the person layer.
 *
 * ⚠ `is_public_figure` AND `active` — and the reason is DISCLOSURE, not servability. Every
 * `person` row is servable by slug; what the flag decides is whether that person is someone
 * this project publishes about at all. Linking a presidential candidate to a private
 * individual's row would name them on an election page, which is the thing the flag exists to
 * prevent — so this is a narrowing that must never be widened „because the page 404s", which
 * it does not.
 */
type Counted = {
  name: string;
  slug: string | null;
  n_public: string;
  n_person: string;
  fold_people: string | null;
};

/** ⚠ THE FILTER MOVED INSIDE THE AGGREGATE, so one pass answers both questions: which people
 *  share the fold at all, and which of them are servable public figures. Narrowing the JOIN
 *  instead — which the first cut did — makes the private rows invisible, and with them the
 *  only evidence that a linked name is shared. */
const COUNT_SQL = (key: string) => `
  SELECT t.name,
         min(p.slug) FILTER (WHERE p.is_public_figure AND p.status = 'active') AS slug,
         count(*) FILTER (WHERE p.is_public_figure AND p.status = 'active')::text AS n_public,
         count(*)::text AS n_person,
         max(p.fold_people_n)::text AS fold_people
    FROM unnest($1::text[]) AS t(name)
    JOIN person p ON ${key}
   GROUP BY t.name`;

const linkFrom = (
  name: string,
  hit: Counted | undefined,
  basis: "fold" | "block",
): TicketPersonLink => {
  const nPublic = hit ? Number(hit.n_public) : 0;
  const people = hit ? Number(hit.n_person) : 0;
  const foldPeople = hit?.fold_people == null ? null : Number(hit.fold_people);
  if (nPublic === 1 && hit?.slug)
    return {
      name,
      slug: hit.slug,
      candidates: 1,
      people,
      foldPeople,
      basis,
    };
  return {
    name,
    // ⚠ `min(slug)` IS NOT A TIEBREAK. It exists so the single-match arm has a value to read;
    // where the count is not 1 it is discarded, because picking one of several people
    // alphabetically is exactly the wrong answer — measured, on „Георги Първанов" it picks a
    // different man from the president.
    reason: nPublic === 0 ? "not_found" : "ambiguous",
    candidates: nPublic,
    people,
    foldPeople,
    // ⚠ CARRIED ON A REFUSAL TOO, so „which key decided this" is answerable for every entry.
    // A gate re-running the query to prove the refusal still bites has to know which one to
    // run: the two-part names are refused on the BLOCK key and match nothing on the fold.
    ...(nPublic > 1 ? { basis } : {}),
  };
};

export const resolveTicketPersons = async (
  names: string[],
): Promise<Record<string, TicketPersonLink>> => {
  const out: Record<string, TicketPersonLink> = {};
  if (!names.length) return out;
  const byFold = new Map(
    (
      await allRows<Counted>(
        COUNT_SQL("p.name_fold = translit_bg_latin(t.name)"),
        [names],
      )
    ).map((r) => [r.name, r]),
  );
  for (const name of names)
    out[name] = linkFrom(name, byFold.get(name), "fold");

  // ⚠ THE FALLBACK IS FOR TWO-PART BALLOT SPELLINGS ONLY, and it is not a loosening: it uses
  // the SAME refuse-if-not-exactly-one rule on the blocking key `person` already indexes.
  // The ballot prints „Георги Първанов" where the person layer holds „Георги Седефчов
  // Първанов", so the full fold cannot match — 14 of 140 names, one of them 2006's winning
  // president on the page for the cycle he won. Three-part names are NOT retried: there the
  // full fold is the stronger key and already had its chance.
  const twoPart = names.filter((n) => {
    if (out[n].slug) return false;
    const parts = parseName(n);
    return parts?.nameParts === 2;
  });
  if (twoPart.length) {
    const blockRows = await allRows<Counted>(
      COUNT_SQL(
        `p.given_fold = translit_bg_latin(split_part(t.name, ' ', 1))
         AND p.family_fold = translit_bg_latin(
               split_part(t.name, ' ', array_length(string_to_array(t.name, ' '), 1)))`,
      ),
      [twoPart],
    );
    const byBlock = new Map(blockRows.map((r) => [r.name, r]));
    for (const name of twoPart) {
      const link = linkFrom(name, byBlock.get(name), "block");
      // ⚠ IT REPLACES A LINK **AND** A REASON. A fallback that only upgraded on a link left
      // „Георги Първанов" reading `not_found` with `candidates: 0` — „nobody by that name" —
      // when the truth is that THREE public figures share his two-part key and we refuse to
      // guess which. „We do not know him" and „we know several of him" are different
      // statements about a named individual, and the second is the one the reader needs.
      if (link.slug || link.candidates > out[name].candidates) out[name] = link;
    }
  }
  return out;
};

const main = async (): Promise<void> => {
  const names = ticketNames();
  if (!names.length) {
    console.log("[ticket-persons] no tickets.json found — nothing to resolve");
    return;
  }
  // ⚠⚠ THE LOCAL DOCKER POSTGRES, OR NOTHING. This map is COMMITTED, and `person.slug` is not
  // portable between databases: `person_slug_lock` accumulates per database, so two databases
  // that have resolved a different number of times hand the same human different slugs —
  // measured elsewhere in this repo at 3,115 of 143,521 locked keys disagreeing. Minting from
  // the cloud would commit slugs the local tree cannot reproduce, and minting from a stale
  // local one commits slugs prod cannot serve. `emit_prerender_slugs.ts` refuses the mirror
  // image of this for the same reason.
  const url = process.env.DATABASE_URL ?? "";
  if (url && !/127\.0\.0\.1:5433|localhost:5433/.test(url)) {
    console.error(
      `[ticket-persons] DATABASE_URL points at ${url} — refusing to mint the committed map ` +
        "from anything but the local docker Postgres (person slugs are per-database)",
    );
    process.exitCode = 1;
    return;
  }
  if (!(await dbReachable())) {
    // ⚠ SKIP, NEVER WRITE. The map is COMMITTED, so a run without Postgres that wrote an
    // empty file would silently un-link every ticket on every presidential page — the
    // „publish the worse artifact" failure `buildFull.ts` and `hub_stats` both refuse.
    console.error(
      "[ticket-persons] Postgres unreachable — refusing to rewrite the committed map",
    );
    process.exitCode = 1;
    return;
  }
  const links = await resolveTicketPersons(names);
  await end();
  const linked = Object.values(links).filter((l) => l.slug);
  const ambiguous = Object.values(links).filter(
    (l) => l.reason === "ambiguous",
  );
  const missing = Object.values(links).filter((l) => l.reason === "not_found");
  console.log(
    `[ticket-persons] ${names.length} names · ${linked.length} linked · ` +
      `${ambiguous.length} refused as ambiguous · ${missing.length} not in the person layer`,
  );
  for (const l of ambiguous)
    console.log(
      `  ambiguous: ${l.name} — ${l.candidates} public figures share the fold`,
    );

  const map: TicketPersonMap = {
    builtFrom:
      "Resolved by scripts/parsers_presidential/build_ticket_persons.ts against the person " +
      "layer in Postgres. A name matching more than one public figure is REFUSED, never " +
      "scored — see the file header. Re-run after db:resolve:persons. Do not hand-edit.",
    links: Object.fromEntries(
      [...Object.keys(links)].sort().map((k) => [k, links[k]]),
    ),
  };
  const json = `${JSON.stringify(map, null, 2)}\n`;
  const before = fs.existsSync(OUT_FILE)
    ? fs.readFileSync(OUT_FILE, "utf8")
    : null;
  if (before === json) {
    console.log("[ticket-persons] committed map is up to date");
    return;
  }
  if (!process.argv.includes("--write")) {
    console.log(
      before === null
        ? "[ticket-persons] no file on disk — pass --write to create it"
        : "[ticket-persons] DIFFERS from the committed file — pass --write to rewrite it",
    );
    // ⚠ NON-ZERO, so the report mode can be a gate. Exiting 0 on drift makes „nothing to do"
    // and „the committed map is stale" indistinguishable to anything that runs this.
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, json);
  console.log(
    `[ticket-persons] wrote ${path.relative(PROJECT_ROOT, OUT_FILE)}`,
  );
};

// ⚠ RESOLVED PATHS, NOT A BASENAME SUFFIX. `endsWith(basename)` is true for any file with the
// same name anywhere in the tree, so a sibling script could run this one's writer by accident —
// on a file that is committed.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
