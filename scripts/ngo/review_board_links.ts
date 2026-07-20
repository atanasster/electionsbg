// Review helper for the medium-confidence ngo_board_links (migration 080).
//
// Medium links (namesake company_count 2–3) are WITHHELD from the public NGO /
// company page — a name coincidence could implicate the wrong person. This
// offline report ranks the withheld candidates by the public money the NGO
// touches (highest-stakes first) so an editor can verify the person against the
// NGO's actual board and, if confirmed, paste the (eik, ref) into
// data/ngo/board_link_overrides.json → `promote`. The loader then bumps it to
// 'high' on the next rebuild and it renders publicly.
//
// Read-only. No writes. Never surfaces medium rows on a routable page (that would
// defeat the defamation guard); the review stays a build-time / editor step.
//
//   npm run ngo:review-board-links            # top 40 by public money
//   npm run ngo:review-board-links -- --limit 100 --kind mp

import { allRows, end } from "../db/lib/pg";

type Row = {
  eik: string;
  ngo: string;
  person: string;
  ref: string;
  kind: string;
  role: string | null;
  namesake_count: number;
  money_eur: number;
};

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const main = async (): Promise<void> => {
  const limit = Math.max(1, Math.min(500, Number(arg("limit", "40")) || 40));
  const kind = arg("kind", ""); // '', 'mp', 'official', 'magistrate'

  const rows = await allRows<Row>(
    `SELECT l.eik, c.name AS ngo, l.person, l.ref, l.kind, l.role, l.namesake_count,
            ROUND(
              COALESCE((SELECT sum(total_eur) FROM fund_projects WHERE beneficiary_eik = l.eik), 0)
              + COALESCE((SELECT sum(amount_eur) FROM ngo_funding WHERE eik = l.eik), 0)
              + COALESCE((SELECT sum(amount_eur) FROM contracts WHERE contractor_eik = l.eik), 0)
            )::bigint AS money_eur
     FROM ngo_board_links l
     JOIN tr_companies c ON c.uic = l.eik
     WHERE l.confidence = 'medium'
       AND ($1 = '' OR l.kind = $1)
     ORDER BY money_eur DESC, l.eik, l.ref
     LIMIT $2`,
    [kind, limit],
  );

  if (rows.length === 0) {
    console.log("No medium-confidence board links to review.");
    return;
  }

  const eur = (n: number): string =>
    n >= 1_000_000
      ? `€${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `€${Math.round(n / 1_000)}k`
        : `€${n}`;

  console.log(
    `Top ${rows.length} withheld (medium) board links by NGO public money${kind ? ` · kind=${kind}` : ""}:\n`,
  );
  for (const r of rows) {
    const ngo = r.ngo.replace(/&quot;/g, '"');
    console.log(
      `${eur(r.money_eur).padStart(7)}  ${r.kind.padEnd(10)} cc=${r.namesake_count}  ${r.person}`,
    );
    console.log(`         ${ngo}`);
    console.log(`         promote: { "eik": "${r.eik}", "ref": "${r.ref}" }\n`);
  }
  console.log(
    "Verify each against the NGO's actual board before promoting. Paste confirmed\n" +
      'entries into data/ngo/board_link_overrides.json → "promote", then re-run\n' +
      "npm run db:load:ngo-board-links.",
  );
};

main()
  .then(() => end())
  .catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
