// One-off: reconcile `person_slug_lock` with a local-elections RE-PARSE that changes who won
// a seat, before `db:resolve:persons` runs against the new bundles.
//
// WHY THIS EXISTS. `person_slug_lock` maps a MENTION id (`local:<cycle>:<obshtina>:<kind>:<key>`)
// to the slug the person holding that mention last had, and `chooseStableSlug` reuses the slug of
// a person's OLDEST locked member mention — ties broken alphabetically. A mention id names a SEAT,
// not a person, which is fine as long as a seat never changes hands. Two things in
// docs/plans/village-mayor-attribution-v1.md do exactly that:
//
//   §T1  ingesting the кметство runoff replaces the round-1 vote leader with the actual winner
//        on 267 measured seats (2023: 137, 2019: 130);
//   §T0  splitting общ. Бяла (обл. Русе) out of VAR05 renumbers that município's kmetstvo
//        indices, so a surviving seat can arrive under a different ref.
//
// Left alone, the first case hands the NEW winner the LOSER's /person URL. Measured on the seat
// that started this work: both Безмер locks share one `first_seen`, so the tie breaks
// alphabetically and `ivan-stoyanov-1xhzvh` < `rosen-rusev-a0a8lm` — Русев would have been served
// at the man he beat's URL, with his own slug retired and 301'd into it. Every one of the 267
// flips has that shape.
//
// TWO OUTCOMES, and the difference matters:
//
//   FLIP  same ref, different winner  → DELETE the lock. The new winner then takes their own
//         derived slug, and the loser's slug orphans into the existing retirement machinery.
//   MOVE  same winner, different ref  → REKEY the lock onto the new mention id. This is the §T0
//         re-split: the person did not change, only the seat's address did, so deleting would
//         mint them a new URL and 404 the old one for no reason.
//
// Run AFTER the re-parse and BEFORE `db:resolve:persons` — it compares the FRESH bundles on disk
// against the STILL-OLD person_role rows, which is the only window where both states exist.
//
//   npx tsx scripts/person/kmetstvo_flips.ts --emit                 # write the audit file
//   npx tsx scripts/person/kmetstvo_flips.ts --apply                # rekey + purge the locks
//   DATABASE_URL=… npx tsx scripts/person/kmetstvo_flips.ts --apply # …on Cloud SQL
//
// `--emit` is read-only. `--apply` re-derives the same diff and refuses to run if it disagrees
// with the committed file, so the thing reviewed is the thing applied.

import fs, { globSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { command, run, flag, boolean, option, string } from "cmd-ts";
import { allRows, withTx, end } from "../db/lib/pg";
import {
  type LocalMayorMention,
  pickLocalWinner,
  mayorRef,
  councillorRef,
  kmetstvoRef,
  districtRef,
  districtsAreShardedElsewhere,
  councilShardReplicatesSofia,
} from "../parsers_local/localPersonRefs";
import type { LocalMunicipalityBundle } from "../parsers_local/types";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "../..");
const DEFAULT_OUT = path.join(
  REPO_ROOT,
  "raw_data/person/kmetstvo_flips_2026_08.json",
);

type Seat = {
  ref: string;
  cycle: string;
  obshtinaCode: string;
  role: "mayor" | "councillor" | "village_mayor" | "rayon_mayor";
  /** Free-text label for the audit file — the кметство/район name where there is one. */
  place: string | null;
  winner: string;
};

type Flip = Seat & { fromSlug: string; fromName: string };
type Move = { fromRef: string; toRef: string; slug: string; winner: string };
/** A ref that vanished whose holder turns up nowhere else — no lock action is possible, and
 *  none is wanted. Reported so the resolver's "dead slug with no redirect" warning has a
 *  written cause. */
type Orphan = { ref: string; slug: string; name: string };

/** The person currently holding a ref, with every spelling they are known by. */
export type Held = {
  slug: string;
  name: string;
  /** translit_bg_latin(display_name) — the cluster's canonical spelling. */
  fold: string;
  /** translit_bg_latin() of every person_alias row: the raw spelling of each merged mention. */
  aliasFolds: ReadonlySet<string>;
  role: Seat["role"];
};

export type FlipFile = {
  generatedAt: string;
  /** Seat changed hands: the lock must be DELETED or the new winner inherits the loser's URL. */
  flips: Flip[];
  /** Seat kept its holder but changed address: the lock is REKEYED so the URL survives. */
  moves: Move[];
  /** Seat vanished AND changed hands, so it is neither: no surviving ref to purge, and no
   *  destination to rekey to. Recorded, not acted on. */
  orphans: Orphan[];
};

/**
 * Every elected local seat in the CURRENT bundles on disk, keyed by the same refs
 * `resolve_persons` mints. Mirrors that walk exactly — same helpers, same order, same guards —
 * because a ref computed differently here would purge a lock that is not the one at risk.
 */
export const seatsFromBundles = (root = REPO_ROOT): Seat[] => {
  const seats: Seat[] = [];
  for (const file of globSync(
    path.join(root, "data/*mi*/municipalities/*.json"),
  )) {
    // The bundle shape is `LocalMunicipalityBundle` (parsers_local/types.ts), read through a
    // narrowed view: every field this walk touches is optional here because the resolver
    // reads these same files defensively — a chmi partial legitimately has no council, and a
    // legacy bundle can predate a field. Narrowing rather than re-declaring keeps the two
    // walks reading one shape.
    const d = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<
      Omit<LocalMunicipalityBundle, "council" | "kmetstva" | "districts">
    > & {
      cycle: string;
      obshtinaCode: string;
      council?: {
        localPartyNum: number;
        candidates?: { listPos: number; name: string; isElected?: boolean }[];
      }[];
      kmetstva?: {
        kmetstvoName?: string;
        ekatte?: string;
        candidates?: LocalMayorMention[];
        round2?: LocalMayorMention[];
      }[];
      districts?: {
        districtName?: string;
        districtCode?: string;
        candidates?: LocalMayorMention[];
        round2?: LocalMayorMention[];
      }[];
    };
    const base = { cycle: d.cycle, obshtinaCode: d.obshtinaCode };
    const mayor = d.mayor?.elected;
    if (mayor?.candidateName)
      seats.push({
        ...base,
        ref: mayorRef(d.cycle, d.obshtinaCode),
        role: "mayor",
        place: null,
        winner: mayor.candidateName,
      });
    // `!Array.isArray` mirrors the resolver's own guard verbatim. No bundle needs it today,
    // but a walk that diverges here purges a lock the resolver never touches.
    if (
      !councilShardReplicatesSofia(d.obshtinaCode) &&
      Array.isArray(d.council)
    )
      for (const party of d.council)
        for (const c of party.candidates ?? [])
          if (c.isElected && c.name)
            seats.push({
              ...base,
              ref: councillorRef(
                d.cycle,
                d.obshtinaCode,
                party.localPartyNum,
                c.listPos,
              ),
              role: "councillor",
              place: null,
              winner: c.name,
            });
    (d.kmetstva ?? []).forEach((k, i) => {
      const el = pickLocalWinner(k.candidates, k.round2);
      if (!el?.candidateName) return;
      seats.push({
        ...base,
        ref: kmetstvoRef(d.cycle, d.obshtinaCode, k.ekatte, i),
        role: "village_mayor",
        place: k.kmetstvoName ?? null,
        winner: el.candidateName,
      });
    });
    if (!districtsAreShardedElsewhere(d.obshtinaCode))
      (d.districts ?? []).forEach((dist, i) => {
        const el = pickLocalWinner(dist.candidates, dist.round2);
        if (!el?.candidateName) return;
        seats.push({
          ...base,
          ref: districtRef(d.cycle, d.obshtinaCode, dist.districtCode, i),
          role: "rayon_mayor",
          place: dist.districtName ?? null,
          winner: el.candidateName,
        });
      });
  }
  return seats;
};

/**
 * Compare fresh seats against the pre-re-parse person_role rows. Pure, so it is unit-testable
 * without a database.
 *
 * `fold` MUST be `translit_bg_latin()` — the one normaliser, which lives in SQL
 * (000_search_fns.sql) precisely so nobody reimplements it (scripts/person/nameParts.ts says
 * so). Comparing RAW strings here produced 33 false flips on the first live run: the bundles
 * carry the CIK spelling while `person.display_name` carries the resolver's canonical form, so
 * "ЙОНКО ЙОРДАНОВ ГЕРГОВ" vs "Йонко Йорданов Гергов" and "Парашкевова - Узунова" vs
 * "Парашкевова-Узунова" both read as a change of officeholder. Purging those locks would have
 * re-slugged 33 people — including two sitting MPs — for a difference in capitalisation.
 */
export const diffSeats = (
  seats: readonly Seat[],
  held: ReadonlyMap<string, Held>,
  lockedRefs: ReadonlySet<string>,
  fold: (name: string) => string,
): { flips: Flip[]; moves: Move[]; orphans: Orphan[] } => {
  // Is the bundle's winner the SAME HUMAN as the person currently holding the ref?
  //
  // Not `display_name` equality. A cluster's display name is the resolver's pick across every
  // source that merged into it, so it routinely differs from the CIK spelling on this
  // particular seat — the first live run produced 33 such "flips": capitalisation
  // ("ЙОНКО ЙОРДАНОВ ГЕРГОВ"), hyphen spacing ("Парашкевова - Узунова"), and two MPs filed
  // under a married surname where the local mention has the maiden one (Петкова/Минева,
  // Желязкова/Василева). Every one is the same woman or man.
  //
  // `person_alias` holds the raw spelling of every mention that merged into the cluster, so
  // an alias hit answers the question the display name only approximates.
  const sameHuman = (prev: Held, winner: string): boolean => {
    const f = fold(winner);
    return prev.fold === f || prev.aliasFolds.has(f);
  };

  const flips: Flip[] = [];
  const seatByRef = new Map(seats.map((s) => [s.ref, s]));
  for (const s of seats) {
    const prev = held.get(s.ref);
    // No previous holder → a brand-new ref (§T0's RSE04 seats). Nothing is locked to it, so
    // there is nothing to purge; the resolver will mint a fresh slug.
    if (!prev || sameHuman(prev, s.winner)) continue;
    if (!lockedRefs.has(s.ref)) continue; // no lock to inherit — nothing at risk
    flips.push({ ...s, fromSlug: prev.slug, fromName: prev.name });
  }
  // MOVES: a ref that disappeared whose holder reappears, same cycle + same office + same
  // person, under a ref no previous holder had. That is a município re-split, not a change of
  // office.
  const moves: Move[] = [];
  const orphans: Orphan[] = [];
  const byKey = new Map<string, Seat[]>();
  for (const s of seats) {
    // A destination is any seat NOT already held by a DIFFERENT person — not merely one on a
    // brand-new ref. A T0-style renumber can shift a person onto a ref somebody else used to
    // hold, and indexing only new refs would find no destination and label them an ORPHAN:
    // "no longer holds any seat", about a person who plainly does. That survived the 2026-08
    // run only because VAR05's three surviving villages kept indices 0–2.
    //
    // A ref that is currently someone ELSE's is still indexed: "this person now sits there"
    // is the true statement, and the apply step declines to clobber an occupied mention (the
    // ON CONFLICT guard, which logs a skip). Reporting a move that is then skipped is more
    // accurate than reporting an orphan who is not one.
    //
    // Keyed on ROLE too: a man who was a councillor and is now his village's mayor is not
    // one seat that moved, and rekeying across office kinds would silently re-address the
    // wrong lock.
    const k = `${s.cycle}\t${s.role}\t${fold(s.winner)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  for (const [ref, prev] of held) {
    if (seatByRef.has(ref)) continue; // the ref survived — not a move
    if (!lockedRefs.has(ref)) continue;
    const cycle = ref.split(":")[0];
    // Every spelling this person is known by, so a move is found on the same evidence a flip
    // is dismissed on.
    const candidates = [prev.fold, ...prev.aliasFolds].flatMap(
      (f) => byKey.get(`${cycle}\t${prev.role}\t${f}`) ?? [],
    );
    const unique = [...new Set(candidates.map((c) => c.ref))];
    // NO destination: this seat both moved AND changed hands, so its old holder turns up
    // nowhere in the new bundles. Nothing to purge (the ref is gone) and nothing to rekey
    // (there is no successor seat that is theirs) — but if that person held no other role
    // they vanish, and `resolve_persons` then warns about a dead slug with no redirect.
    //
    // 404 is the right answer and a redirect would be a lie: we published them as кмет on
    // the strength of a round-1 lead they lost. Both real cases in the 2026-08 run are that
    // — Мариян Георгиев lost Босилковци 164–167 and Емил Георгиев lost Копривец 242–251,
    // and their VAR05 refs also moved to RSE04 in the same pass.
    //
    // Recorded so that warning has a written cause: its own text suggests an officials
    // re-slug map, which would be the wrong remedy here.
    if (unique.length === 0) {
      orphans.push({ ref, slug: prev.slug, name: prev.name });
      continue;
    }
    // More than one destination and we cannot say which seat this person's URL belongs to.
    if (unique.length !== 1) continue;
    moves.push({
      fromRef: ref,
      toRef: unique[0],
      slug: prev.slug,
      winner: prev.name,
    });
  }
  // Deterministic order: the audit file is committed and diffed, and `--apply` compares
  // against it, so an unstable order would produce spurious mismatches.
  flips.sort((a, b) => a.ref.localeCompare(b.ref));
  moves.sort((a, b) => a.fromRef.localeCompare(b.fromRef));
  orphans.sort((a, b) => a.ref.localeCompare(b.ref));
  return { flips, moves, orphans };
};

const loadState = async (
  winnerNames: readonly string[],
): Promise<{
  held: Map<string, Held>;
  lockedRefs: Set<string>;
  fold: (name: string) => string;
}> => {
  const held = new Map<string, Held>();
  // `person.name_fold` is a GENERATED column over translit_bg_latin(display_name), and
  // `person_alias.alias_fold` is the same function over each merged mention's raw spelling —
  // so the held side costs nothing to fold. Aliases are aggregated in the same pass rather
  // than a second query, because a ref with no alias row must still yield an empty set, not
  // a missing key.
  for (const r of await allRows<{
    ref: string;
    role: string;
    slug: string;
    name: string;
    fold: string;
    alias_folds: string[] | null;
  }>(
    `SELECT r.ref, r.role, p.slug, p.display_name AS name, p.name_fold AS fold,
            ARRAY(
              SELECT DISTINCT a.alias_fold FROM person_alias a
               WHERE a.person_id = p.person_id AND a.alias_fold IS NOT NULL
            ) AS alias_folds
       FROM person_role r JOIN person p USING (person_id)
      WHERE r.source = 'local'`,
  )) {
    // A ref is (person_id, source, ref, role) in person_role, so one ref CAN legitimately
    // carry two roles — but never two people, which `local_person_roles.data.test.ts`
    // asserts. Silently keeping the last row read would make the diff depend on row order.
    const prior = held.get(r.ref);
    if (prior && prior.slug !== r.slug)
      throw new Error(
        `[flips] ref ${r.ref} is held by two people (${prior.slug}, ${r.slug}) — ` +
          `the mention key is not unique, so no lock decision here is safe.`,
      );
    if (prior) continue;
    held.set(r.ref, {
      slug: r.slug,
      name: r.name,
      fold: r.fold,
      aliasFolds: new Set(r.alias_folds ?? []),
      role: r.role as Seat["role"],
    });
  }
  const lockedRefs = new Set<string>();
  for (const r of await allRows<{ mention_id: string }>(
    `SELECT mention_id FROM person_slug_lock WHERE mention_id LIKE 'local:%'`,
  ))
    lockedRefs.add(r.mention_id.slice("local:".length));
  // Fold the bundle side through the SAME SQL function, in one round trip over the distinct
  // names. Reimplementing translit_bg_latin in TS is exactly what nameParts.ts forbids.
  const distinct = [...new Set(winnerNames)];
  const folded = new Map<string, string>();
  for (const r of await allRows<{ raw: string; fold: string }>(
    `SELECT raw, translit_bg_latin(raw) AS fold FROM unnest($1::text[]) AS raw`,
    [distinct],
  ))
    folded.set(r.raw, r.fold);
  const fold = (name: string): string => {
    const hit = folded.get(name);
    if (hit === undefined)
      throw new Error(`[flips] unfolded name "${name}" — prefetch missed it`);
    return hit;
  };
  return { held, lockedRefs, fold };
};

const summarise = (f: FlipFile): string =>
  `${f.flips.length} flip(s), ${f.moves.length} move(s), ${f.orphans?.length ?? 0} orphan(s)`;

const app = command({
  name: "kmetstvo-flips",
  args: {
    emit: flag({
      type: boolean,
      long: "emit",
      description: "write the audit file (read-only)",
    }),
    apply: flag({
      type: boolean,
      long: "apply",
      description: "rekey moved locks + delete flipped ones",
    }),
    pruneDead: flag({
      type: boolean,
      long: "prune-dead",
      description:
        "delete local locks whose mention is gone AND whose slug is dead (run after the resolve)",
    }),
    file: option({
      type: string,
      long: "file",
      defaultValue: () => DEFAULT_OUT,
      description: "audit file path",
    }),
  },
  handler: async ({ emit, apply, pruneDead, file }) => {
    // A separate, later step: it reads the state the RESOLVE leaves behind, so it cannot be
    // folded into --apply (which runs before it).
    //
    // A re-ingest that removes seats removes people — the 2007 de-duplication dropped 2,420
    // phantom кметство entries, and 147 of their holders had no other mention, so they cease
    // to exist. Their slug is correctly dead: there is no successor to redirect to, and
    // `person_slug_retired.target_slug` is NOT NULL so a redirect cannot even be written. But
    // the LOCK row survives, pointing at a slug that is neither live nor retired — which
    // `person_slug_retired.data.test.ts` fails on, and which would hand that dead slug to
    // whoever a future re-parse puts on that mention id.
    //
    // Scoped to `local:` mentions that no longer exist AND whose slug is dead, so it can
    // never touch a lock that is doing its job.
    if (pruneDead) {
      const dead = await allRows<{ mention_id: string; slug: string }>(
        `SELECT l.mention_id, l.slug
           FROM person_slug_lock l
          WHERE l.mention_id LIKE 'local:%'
            AND NOT EXISTS (
              SELECT 1 FROM person_role r
               WHERE r.source = 'local' AND 'local:' || r.ref = l.mention_id
            )
            AND NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = l.slug)
            AND NOT EXISTS (
              SELECT 1 FROM person_slug_retired s WHERE s.slug = l.slug
            )`,
      );
      console.log(
        `[flips] ${dead.length} dead lock(s) — mention gone and slug neither live nor retired`,
      );
      for (const d of dead.slice(0, 10))
        console.log(`   ${d.mention_id} → ${d.slug}`);
      if (dead.length > 10) console.log(`   … and ${dead.length - 10} more`);
      if (dead.length)
        await withTx(async (c) => {
          const r = await c.query(
            `DELETE FROM person_slug_lock WHERE mention_id = ANY($1::text[])`,
            [dead.map((d) => d.mention_id)],
          );
          console.log(`[flips] pruned ${r.rowCount} dead lock(s)`);
        });
      return;
    }
    if (!emit && !apply) {
      console.error(
        "[flips] nothing to do — pass --emit (read-only) or --apply. See the header.",
      );
      process.exitCode = 1;
      return;
    }
    // `--emit --apply` in one process would write the audit file and then check the run
    // against the file it just wrote — a review gate that reviews itself. Two invocations,
    // with a human between them.
    if (emit && apply) {
      console.error(
        "[flips] --emit and --apply are separate steps: emit, READ the file, then apply.",
      );
      process.exitCode = 1;
      return;
    }
    const seats = seatsFromBundles();
    const { held, lockedRefs, fold } = await loadState(
      seats.map((s) => s.winner),
    );
    const { flips, moves, orphans } = diffSeats(seats, held, lockedRefs, fold);
    const current: FlipFile = {
      generatedAt: new Date().toISOString(),
      flips,
      moves,
      orphans,
    };
    console.log(
      `[flips] ${seats.length} elected seat(s) on disk, ${held.size} in person_role, ${lockedRefs.size} locked → ${summarise(current)}`,
    );
    // A brand-new ref that ALREADY carries a lock. `person_slug_lock` is never truncated, so
    // a ref reused after an earlier shape change would hand its new holder a stranger's slug
    // — the same hazard as a flip, arriving from the opposite direction. Assumed impossible
    // when this was written; checked, because "assumed" is how the original defect shipped.
    const staleOnNew = seats.filter(
      (s) => !held.has(s.ref) && lockedRefs.has(s.ref),
    );
    if (staleOnNew.length)
      console.warn(
        `[flips] ${staleOnNew.length} NEW ref(s) already carry a lock from an earlier vintage — ` +
          `their winner would inherit it. Inspect before applying:\n  ` +
          staleOnNew
            .slice(0, 5)
            .map((s) => `${s.ref} → ${s.winner}`)
            .join("\n  "),
      );
    // This tool cannot tell "the re-parse has not run" from "the resolver already ran": both
    // leave the bundles and person_role agreeing. Say so rather than let a clean line read as
    // an all-clear.
    if (!flips.length && !moves.length)
      console.log(
        `[flips] no changes — either the re-parse has not run yet, or db:resolve:persons has ` +
          `already consumed it. This tool cannot distinguish the two; check which before moving on.`,
      );
    for (const f of flips.slice(0, 10))
      console.log(
        `  FLIP ${f.ref} ${f.place ? `(${f.place}) ` : ""}${f.fromName} → ${f.winner}  [lock ${f.fromSlug}]`,
      );
    if (flips.length > 10) console.log(`  … and ${flips.length - 10} more`);
    for (const m of moves.slice(0, 10))
      console.log(`  MOVE ${m.fromRef} → ${m.toRef}  ${m.winner} [${m.slug}]`);
    if (moves.length > 10) console.log(`  … and ${moves.length - 10} more`);
    for (const o of orphans)
      console.log(
        `  ORPHAN ${o.ref} ${o.name} [${o.slug}] — seat moved AND changed hands; no lock action, /person 404s`,
      );

    if (emit) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n", "utf8");
      console.log(`[flips] wrote ${file}`);
    }

    if (apply) {
      if (!fs.existsSync(file))
        throw new Error(
          `[flips] ${file} not found — run --emit first and review it before applying.`,
        );
      const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as FlipFile;
      // The reviewed artifact must be the applied one — but "equal" is the wrong test,
      // because applying REMOVES entries from the next run's diff (a purged lock is no
      // longer `locked`, a rekeyed one no longer sits on the old ref). So the rule is
      // CONTAINMENT: everything still actionable must have been in the reviewed file.
      // A re-run is then a clean no-op instead of an error, and an entry the file has never
      // seen still stops the run.
      const flipKey = (x: Flip) => `${x.ref}\t${x.fromSlug}\t${x.winner}`;
      const moveKey = (x: Move) => `${x.fromRef}\t${x.toRef}\t${x.slug}`;
      const reviewed = new Set([
        ...onDisk.flips.map(flipKey),
        ...onDisk.moves.map(moveKey),
      ]);
      const unreviewed = [...flips.map(flipKey), ...moves.map(moveKey)].filter(
        (k) => !reviewed.has(k),
      );
      if (unreviewed.length)
        throw new Error(
          `[flips] ${unreviewed.length} change(s) are not in ${file} — the data moved since it was written. ` +
            `Write a NEW file (--emit --file <new path>), review it, then apply that one. Do not overwrite the reviewed artifact:\n  ` +
            unreviewed.slice(0, 5).join("\n  "),
        );
      if (!flips.length && !moves.length) {
        console.log(
          `[flips] nothing left to apply — already applied, or the re-parse has not run yet.`,
        );
        return;
      }
      await withTx(async (c) => {
        // PURGE FIRST, then rekey. A flip's ref keeps existing — it just changes hands — so
        // its stale lock occupies a mention id that a MOVE may need as its destination. On a
        // wholesale renumber (2007: 5,367 entries folding to 2,947) every destination is
        // occupied by the previous holder of that index, so rekeying first skipped all 2,367
        // moves and left every one of those people to inherit a stranger's slug. Purging
        // first frees exactly the ids the moves are entitled to.
        const purged = await c.query(
          `DELETE FROM person_slug_lock WHERE mention_id = ANY($1::text[])`,
          [
            [
              ...flips.map((f) => `local:${f.ref}`),
              ...orphans.map((o) => `local:${o.ref}`),
            ],
          ],
        );
        let rekeyed = 0;
        // `first_seen` IS COPIED, and that is the whole point of a move. It is
        // `chooseStableSlug`'s primary sort key (oldest member mention wins the anchor), and
        // 99% of this table shares one seeding timestamp — so a row re-stamped with now()
        // would sort strictly last and could never win the anchor again, silently defeating
        // the URL preservation the move exists to perform.
        for (const m of moves) {
          const ins = await c.query(
            `INSERT INTO person_slug_lock (mention_id, slug, first_seen)
               SELECT $1, slug, first_seen FROM person_slug_lock WHERE mention_id = $2
             ON CONFLICT (mention_id) DO NOTHING`,
            [`local:${m.toRef}`, `local:${m.fromRef}`],
          );
          if (ins.rowCount) {
            rekeyed++;
            // Deleted ONLY on a successful insert. A destination still locked after the purge
            // belongs to somebody the diff did not touch; dropping the source anyway would
            // destroy a lock and mint this person a new URL for nothing.
            await c.query(
              `DELETE FROM person_slug_lock WHERE mention_id = $1`,
              [`local:${m.fromRef}`],
            );
          } else {
            console.warn(
              `[flips] MOVE skipped — ${m.toRef} is already locked; ${m.fromRef} left in place (${m.slug})`,
            );
          }
        }
        console.log(
          `[flips] purged ${purged.rowCount} lock(s) (${flips.length} flip + ${orphans.length} orphan), rekeyed ${rekeyed}/${moves.length}`,
        );
      });
      console.log(
        `[flips] done — now run db:resolve:persons, then data:local-person-refresh.`,
      );
    }
  },
});

// Guarded so the pure helpers can be imported by the unit test without opening a pool.
if (process.argv[1] === __filename)
  run(app, process.argv.slice(2)).finally(() => end());
