// A4 — walk the ЦАИС ЕОП tenderId space.
// docs/plans/tender-dossier-ingest-v1.md §5 (A4), §9.3.
//
// WHY A WALK AND NOT A SEARCH. The register exposes five anonymous search methods,
// but their request shape resisted reverse-engineering (three guesses → ErrorCode 4;
// the WCF proxy binds XMLHttpRequest before page scripts can hook it). The ids turn
// out to be DENSE in a known range, so walking them is simpler, needs no pagination,
// and is the authoritative answer to "is our corpus complete?" — which is the
// question that found the 69-day hole in the first place (§11).
//
// Each id classifies cleanly from one GetPublishedTenderDetails call (400-id probe,
// plan §9.3):
//
//   empty body          24%   unpublished / draft — the register has nothing to say
//   lot stub            53%   SpecialNumber null AND no publications: a LOT, whose
//                             dossier lives on its parent procedure, not here
//   published procedure 22%   SpecialNumber set + >=1 publication
//
// ⚠️ THE LOT STUB IS THE TRAP. A lot answers 200 with a real body — name, status —
// so "did I get a 200?" is not a completeness test. Only the (SpecialNumber,
// publications) pair separates a procedure from a lot, and counting lots as
// procedures would inflate the corpus by ~2.4x.
//
// Read-only by default: it reports what is missing and writes nothing. The point is
// to MEASURE completeness; filling the gap is ingest_tenders' job, and this prints
// the command.
//
//   tsx scripts/procurement/enumerate_eop_ids.ts --probe            # 400 sampled ids
//   tsx scripts/procurement/enumerate_eop_ids.ts --from 560000 --to 600641
//   tsx scripts/procurement/enumerate_eop_ids.ts --full             # the whole range

import path from "node:path";
import { fileURLToPath } from "node:url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { allRows } from "../db/lib/pg";
import { eopCall, mapPool, throttleSummary, wcfDate, IANA_TZ } from "./eop_api";
import { EopDossierStore } from "./eop_dossier_store";
import {
  classifyDetails,
  selectIds,
  ID_FLOOR,
  type TenderIdClass,
} from "./eop_tender_class";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_dossier.sqlite",
);

const CONCURRENCY = 6;

type Details = {
  SpecialNumber?: string | null;
  TenderName?: string | null;
  OrganizationName?: string | null;
  PublicationDate?: string | null;
  TenderPublicationDetails?: unknown[];
};

/** `error` is deliberately NOT one of TenderIdClass: a call that failed tells us
 *  nothing about what the id is, and must never be counted as an answer. */
type Klass = TenderIdClass | "error";

interface Row {
  tenderId: number;
  klass: Klass;
  unp?: string;
  publicationDate?: string | null;
  buyer?: string;
}

const main = async (args: {
  probe: boolean;
  full: boolean;
  from?: string;
  to?: string;
  sample?: string;
  store: boolean;
}): Promise<void> => {
  // Our side of the comparison: every ЦАИС tenderId the corpus holds.
  const have = new Set(
    (
      await allRows<{ tender_id: number }>(
        `SELECT tender_id FROM tenders
          WHERE ocid LIKE 'ocds-e82gsb-%' AND tender_id IS NOT NULL`,
      )
    ).map((r) => Number(r.tender_id)),
  );
  // Fold, don't spread: `Math.max(...have)` pushes 131,716 arguments onto the stack
  // and throws RangeError. The set only grows, so a spread here is a latent crash.
  let maxHave = 0;
  for (const id of have) if (id > maxHave) maxHave = id;

  // Range + sampling are validated in selectIds, which throws rather than quietly
  // walking a short (or empty) list — see its header.
  const ids = selectIds({
    maxHave,
    from: args.from,
    to: args.to,
    sample: args.sample,
    full: args.full,
    probe: args.probe,
  });
  const from = ids[0];
  const to = ids[ids.length - 1];
  const span = to - from + 1;

  console.log(
    `→ corpus holds ${have.size.toLocaleString()} ЦАИС tenderId(s); ` +
      `walking ${ids.length.toLocaleString()} id(s) in [${from}, ${to}]` +
      (args.full ? " (FULL)" : ` (sampled from ${span.toLocaleString()})`),
  );

  const store = args.store ? new EopDossierStore(STORE_FILE) : null;
  const counts: Record<Klass, number> = {
    empty: 0,
    lot: 0,
    procedure: 0,
    error: 0,
  };
  const missing: Row[] = [];
  let done = 0;

  await mapPool(ids, CONCURRENCY, async (tenderId) => {
    const res = await eopCall<Details>("GetPublishedTenderDetails", {
      tenderId,
      ianaTimeZone: IANA_TZ,
    });
    if (!res.ok) {
      counts.error++;
      // A store write must never abort the walk: a concurrent tier-A crawl holds
      // the SQLite write lock and throws ERR_SQLITE_ERROR immediately, which would
      // discard up to 17 hours of audit for a side effect the audit does not need.
      try {
        store?.putFailure(
          "details",
          tenderId,
          res.reason,
          res.status,
          res.detail,
        );
      } catch {
        /* the report is the deliverable; the cached body is a bonus */
      }
    } else {
      const klass = classifyDetails(res.body);
      counts[klass]++;
      if (klass === "procedure" && !have.has(tenderId)) {
        const b = res.body as Details;
        missing.push({
          tenderId,
          klass,
          unp: b.SpecialNumber ?? undefined,
          publicationDate: wcfDate(b.PublicationDate)?.slice(0, 10) ?? null,
          buyer: (b.OrganizationName ?? "").slice(0, 40),
        });
      }
      // Opportunistic: a walk already paid for the call, so keep the body rather
      // than making the tier-A crawl re-fetch it.
      if (store && klass === "procedure")
        try {
          store.putAnswer(
            "details",
            tenderId,
            JSON.stringify(res.body),
            res.status,
            "service.eop.bg/NX1Service.svc/v1",
          );
        } catch {
          /* same: a locked store must not cost us the walk */
        }
    }
    if (++done % 500 === 0)
      console.log(
        `  … ${done.toLocaleString()}/${ids.length.toLocaleString()} ` +
          `(${counts.procedure.toLocaleString()} procedures, ${missing.length} missing)`,
      );
  });

  const probed = counts.empty + counts.lot + counts.procedure;
  const pct = (n: number) => ((100 * n) / (probed || 1)).toFixed(1) + "%";
  console.log(
    `\n  unpublished/draft ${counts.empty.toLocaleString()} (${pct(counts.empty)})` +
      ` · lot stubs ${counts.lot.toLocaleString()} (${pct(counts.lot)})` +
      ` · published procedures ${counts.procedure.toLocaleString()} (${pct(counts.procedure)})` +
      ` · errors ${counts.error}`,
  );

  if (counts.procedure === 0) {
    console.log("  (no procedures in this sample — nothing to compare)");
  } else {
    // An errored id is not evidence of presence OR absence, so a clean "✓" while
    // calls failed would overstate the result. Qualify rather than silently drop.
    if (counts.error)
      console.log(
        `  ⚠ ${counts.error} id(s) could not be classified — the figure below is a ` +
          `LOWER bound on what is missing.`,
      );
    const rate = (100 * missing.length) / counts.procedure;
    console.log(
      `\n${missing.length ? "⚠" : "✓"} ${missing.length.toLocaleString()} of ` +
        `${counts.procedure.toLocaleString()} published procedures are ABSENT from the corpus ` +
        `(${rate.toFixed(1)}%)`,
    );
    for (const m of missing.slice(0, 25))
      console.log(
        `    ${m.tenderId}  ${m.publicationDate ?? "?"}  ${m.unp ?? "(no УНП)"}  ${m.buyer ?? ""}`,
      );
    if (missing.length > 25)
      console.log(`    … and ${missing.length - 25} more`);
    if (missing.length) {
      const days = [
        ...new Set(missing.map((m) => m.publicationDate).filter(Boolean)),
      ].sort() as string[];
      // Only print a command we can actually fill in. Without dates the register
      // told us nothing to key a backfill on, and `--from undefined` is worse than
      // no suggestion at all.
      if (days.length)
        console.log(
          `\n  Missing procedures span ${days.length} publication day(s): ${days[0]} … ${days[days.length - 1]}\n` +
            `  Fix:  npx tsx scripts/procurement/ingest_tenders.ts --backfill ` +
            `--from ${days[0]} --to ${days[days.length - 1]} --apply\n` +
            `  (the day-coverage guard will refuse the rebuild if the cache is still holed)`,
        );
      else
        console.log(
          `\n  None of the missing procedures carried a publication date, so no ` +
            `backfill window can be derived — re-probe the ids listed above.`,
        );
    }
  }
  if (!args.full)
    console.log(
      `\n  NOTE: sampled walk — the rate above is an estimate over ${ids.length.toLocaleString()} of ` +
        `${span.toLocaleString()} ids. Use --full for the authoritative answer (~17 h).`,
    );
  const throttled = throttleSummary();
  if (throttled) console.log(throttled);
  store?.close();
  // Exit non-zero when the audit actually found something, so this can gate a
  // pipeline rather than only inform a human reading stdout.
  if (missing.length) process.exitCode = 1;
};

const cli = command({
  name: "enumerate_eop_ids",
  args: {
    probe: flag({
      type: optional(boolean),
      long: "probe",
      description: "400 sampled ids — a quick completeness estimate.",
      defaultValue: () => false,
    }),
    full: flag({
      type: optional(boolean),
      long: "full",
      description: "Walk EVERY id in the range (~544k calls, ~17 h).",
      defaultValue: () => false,
    }),
    sample: option({
      type: optional(string),
      long: "sample",
      description:
        "How many ids to sample (default 2000; ignored with --full).",
    }),
    from: option({
      type: optional(string),
      long: "from",
      description: `First tenderId (default ${ID_FLOOR}).`,
    }),
    to: option({
      type: optional(string),
      long: "to",
      description: "Last tenderId (default: the highest the corpus holds).",
    }),
    store: flag({
      type: optional(boolean),
      long: "store",
      description: "Keep the fetched procedure bodies in the tier-A store.",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      probe: !!args.probe,
      full: !!args.full,
      sample: args.sample,
      from: args.from,
      to: args.to,
      store: !!args.store,
    }),
});

run(cli, process.argv.slice(2));
