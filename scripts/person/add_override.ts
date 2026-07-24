// Operator writer for person_link_override — the audited, data-not-code way to fix an
// identity mis-merge in the person resolver (scripts/person/resolve_persons.ts + overrides.ts,
// plan §3 tier 4). The row is applied on the NEXT `npm run db:resolve:persons`.
//
// Three operations (see overrides.ts for the semantics):
//
//   # isolate one wrongly-merged candidacy (ref-level split — vetoes even a gold union):
//   npm run person:override -- split --ref 2024_06_09:c-26-monika-georgieva-vasileva \
//     --note "different Monika than mp-XXXX" --by atanasster
//
//   # union one person the resolver scattered across two blocks (marriage rename):
//   npm run person:override -- merge --name-a "Галя Стоянова Желязкова" \
//     --name-b "Галя Стоянова Василева" --note "same person, renamed" --by atanasster
//
//   # forbid two different folds from auto-merging (fold-level split):
//   npm run person:override -- split --name-a "Иван Петров Иванов" --name-b "..." --by ...
//
// Names are folded to the ONE normalizer (translit_bg_latin) before insert, so the operator
// passes the human-readable Cyrillic name and never the fold. `--fold-a`/`--fold-b` bypass the
// folding when the operator already has a fold in hand. After inserting, RE-RUN the resolver:
//   npm run db:resolve:persons && npm run db:load:person-elections:pg
// (person_election_stats keys on the integer person_id the resolve regenerates.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, exec, end } from "../db/lib/pg";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/schema/pg",
);

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const usage = (): void => {
  console.error(
    `usage:
  npm run person:override -- split --ref <election:slug | mp:id> [--ref-b <ref>] [--note ..] [--by ..]
  npm run person:override -- merge --name-a "<Cyrillic name>" --name-b "<Cyrillic name>" [--note ..] [--by ..]
  npm run person:override -- split --name-a "<name>" --name-b "<name>" [--note ..] [--by ..]
  (--fold-a/--fold-b substitute a pre-folded value for --name-a/--name-b)`,
  );
};

const fold = async (name: string): Promise<string> => {
  const [r] = await allRows<{ f: string }>(
    `SELECT translit_bg_latin($1) AS f`,
    [name],
  );
  return r.f;
};

async function main(): Promise<void> {
  const kind = process.argv[2];
  if (kind !== "merge" && kind !== "split") {
    usage();
    process.exit(1);
  }

  // Self-heal the schema (idempotent) so the ref columns exist even on a DB that predates them.
  await exec(
    fs.readFileSync(path.join(SCHEMA_DIR, "081_person_identity.sql"), "utf8"),
  );

  const ref = arg("--ref");
  const note = arg("--note") ?? null;
  const by = arg("--by") ?? "operator";

  let fold_a: string | null = null;
  let fold_b: string | null = null;
  let ref_a: string | null = null;
  let ref_b: string | null = null;

  if (kind === "split" && ref) {
    ref_a = ref;
    ref_b = arg("--ref-b") ?? null;
  } else {
    const nameA = arg("--name-a");
    const nameB = arg("--name-b");
    fold_a = arg("--fold-a") ?? (nameA ? await fold(nameA) : null);
    fold_b = arg("--fold-b") ?? (nameB ? await fold(nameB) : null);
    if (!fold_a || !fold_b) {
      console.error(
        kind === "merge"
          ? "merge needs --name-a and --name-b (or --fold-a/--fold-b)."
          : "a fold-level split needs --name-a and --name-b, or a ref-level split needs --ref.",
      );
      usage();
      await end();
      process.exit(1);
    }
  }

  const [row] = await allRows<{ override_id: string }>(
    `INSERT INTO person_link_override (kind, fold_a, fold_b, ref_a, ref_b, note, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING override_id`,
    [kind, fold_a, fold_b, ref_a, ref_b, note, by],
  );

  const target = ref_a
    ? `ref-split ${ref_a}${ref_b ? ` + ${ref_b}` : ""}`
    : `${kind} ${fold_a} <-> ${fold_b}`;
  console.log(`inserted override #${row.override_id}: ${target} (by ${by})`);
  console.log(
    "Re-run `npm run db:resolve:persons && npm run db:load:person-elections:pg` to apply.",
  );
  await end();
}

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
