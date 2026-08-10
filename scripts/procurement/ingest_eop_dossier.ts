// Tier A of the tender dossier ingest — the JSON crawl.
// docs/plans/tender-dossier-ingest-v1.md §5.
//
// For every ЦАИС-era tender we already hold (`tenders.tender_id`, which is also the
// ocid suffix), fetch the anonymous per-tender surface and store the raw bodies:
//
//   details          the long description, contact, ATTACHMENT MANIFEST, notice HTML
//   announcements    the award-stage trail (протоколи / доклади / решения) — titles+dates
//   announcement_docs per announcement: file names/sizes/md5, so we can LINK to each
//   contract_items   contracts + supplier EIKs + annexes + CurrentContractValue
//   lots / exports   lot shells; the export-pack inventory
//   buyer_profile    per OrganizationId: address / NUTS / EIK
//
// NOTHING IS DOWNLOADED FROM BLOB STORAGE HERE. Tier A is metadata + text fields
// only (~5 GB); the 3.65 TB document tier was dropped (plan §12, §5) in favour of
// linking out to app.eop.bg. Tier B (ingest_eop_spec_text.ts) adds ONE file per
// tender — the техническа спецификация — and discards its bytes after extraction.
//
// Resume is per (kind, subjectId) and consults ANSWERS ONLY, so an interrupted or
// failed fetch is always retried (see eop_dossier_store.ts for why that split is
// structural rather than conventional).
//
//   tsx scripts/procurement/ingest_eop_dossier.ts --probe            # 200 tenders, no write
//   tsx scripts/procurement/ingest_eop_dossier.ts --probe --apply    # 200 tenders, write
//   tsx scripts/procurement/ingest_eop_dossier.ts --apply            # full crawl, resumable
//   tsx scripts/procurement/ingest_eop_dossier.ts --apply --from-year 2024 --limit 5000

import path from "node:path";
import { fileURLToPath } from "node:url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { allRows } from "../db/lib/pg";
import {
  EOP_API_VERSION,
  eopCall,
  IANA_TZ,
  mapPool,
  throttleSummary,
  type EopResult,
} from "./eop_api";
import { EopDossierStore, type DossierKind } from "./eop_dossier_store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_dossier.sqlite",
);

/** Measured safe at concurrency 6 (8.97 req/s, no throttling, latency stable across
 *  a 300-call burst). Do not raise without re-measuring — this is a shared public
 *  register, and the plan's §2.1 figure is the only evidence we have. */
const CONCURRENCY = 6;

/** The five tender-keyed methods, in the order the crawl issues them. */
const TENDER_METHODS: { kind: DossierKind; method: string }[] = [
  { kind: "details", method: "GetPublishedTenderDetails" },
  { kind: "announcements", method: "GetPublicTenderAnnouncementsByTenderId" },
  { kind: "contract_items", method: "GetPublishedContractListItems" },
  { kind: "lots", method: "GetPublishedLots" },
  { kind: "exports", method: "GetPublishedTenderExportsByTenderId" },
];

type Counters = {
  answers: number;
  empty: number;
  failures: number;
  skipped: number;
  denied: number;
};

const newCounters = (): Counters => ({
  answers: 0,
  empty: 0,
  failures: 0,
  skipped: 0,
  denied: 0,
});

/**
 * Store one result under the answers/failures split.
 *
 * `raw` is the exact body text so the store keeps a byte-faithful copy; we re-encode
 * from the parsed value only when the caller had to parse it first.
 */
const record = (
  store: EopDossierStore | null,
  c: Counters,
  kind: DossierKind,
  subjectId: number,
  res: EopResult<unknown>,
  raw: string | null,
): void => {
  if (!res.ok) {
    if (res.reason === "denied") c.denied++;
    c.failures++;
    store?.putFailure(kind, subjectId, res.reason, res.status, res.detail);
    return;
  }
  const body = raw ?? (res.body === null ? "" : JSON.stringify(res.body));
  if (body === "") c.empty++;
  c.answers++;
  store?.putAnswer(kind, subjectId, body, res.status, EOP_API_VERSION);
};

/** eopCall, but also handing back the raw body text for byte-faithful storage. */
const callRaw = async (
  method: string,
  params: Record<string, unknown>,
): Promise<{ res: EopResult<unknown>; raw: string | null }> => {
  const res = await eopCall<unknown>(method, params);
  if (!res.ok) return { res, raw: null };
  return { res, raw: res.body === null ? "" : JSON.stringify(res.body) };
};

const main = async (args: {
  probe: boolean;
  apply: boolean;
  limit?: string;
  fromYear?: string;
  refresh: boolean;
}): Promise<void> => {
  const store = args.apply ? new EopDossierStore(STORE_FILE) : null;
  if (!args.apply)
    console.log("(dry run — nothing is written; pass --apply to store)");

  // Work set: every ЦАИС-era tender we hold. The pre-2020 РОП half has no ЦАИС
  // tenderId and this API does not serve it at all (plan §2).
  const where: string[] = [
    "ocid LIKE 'ocds-e82gsb-%'",
    "tender_id IS NOT NULL",
  ];
  if (args.fromYear) where.push(`publication_date >= '${args.fromYear}-01-01'`);
  // --probe sets a DEFAULT cap of 200; an explicit --limit still wins, so
  // `--probe --limit 40` means 40 rather than silently ignoring the flag.
  const explicit = args.limit ? parseInt(args.limit, 10) : null;
  const limit =
    explicit && Number.isFinite(explicit) ? explicit : args.probe ? 200 : null;
  const rows = await allRows<{ tender_id: number; unp: string }>(
    `SELECT tender_id, unp FROM tenders WHERE ${where.join(" AND ")}
      ORDER BY publication_date DESC, unp
      ${limit ? `LIMIT ${limit}` : ""}`,
  );
  const ids = rows.map((r) => Number(r.tender_id));
  console.log(
    `→ work set: ${ids.length.toLocaleString()} tender(s)` +
      (args.fromYear ? ` from ${args.fromYear}` : "") +
      (limit ? ` (limited)` : ""),
  );

  const c = newCounters();
  const orgIds = new Set<number>();
  const annIds: number[] = [];
  let done = 0;

  await mapPool(ids, CONCURRENCY, async (tenderId) => {
    for (const { kind, method } of TENDER_METHODS) {
      if (!args.refresh && store?.has(kind, tenderId)) {
        c.skipped++;
        // Still need the ids the later passes fan out over, so read them back
        // from the store rather than re-fetching.
        if (kind === "details") {
          const d = store.getJson<{ OrganizationId?: number }>(kind, tenderId);
          if (d?.OrganizationId) orgIds.add(Number(d.OrganizationId));
        } else if (kind === "announcements") {
          const a = store.getJson<{ Id?: number }[]>(kind, tenderId);
          for (const x of a ?? []) if (x?.Id) annIds.push(Number(x.Id));
        }
        continue;
      }
      const { res, raw } = await callRaw(method, {
        tenderId,
        ianaTimeZone: IANA_TZ,
      });
      record(store, c, kind, tenderId, res, raw);
      if (!res.ok) continue;
      if (kind === "details") {
        const d = res.body as { OrganizationId?: number } | null;
        if (d?.OrganizationId) orgIds.add(Number(d.OrganizationId));
      } else if (kind === "announcements") {
        for (const x of (res.body as { Id?: number }[] | null) ?? [])
          if (x?.Id) annIds.push(Number(x.Id));
      }
    }
    done++;
    if (done % 500 === 0)
      console.log(
        `  … ${done.toLocaleString()}/${ids.length.toLocaleString()} tenders ` +
          `(${c.answers.toLocaleString()} answers, ${c.failures} failures, ${c.skipped.toLocaleString()} cached)`,
      );
  });

  // Fan-out 1: one call per announcement for its document manifest. This is where
  // the протокол file names/sizes/md5 come from — we link to them, never fetch them.
  console.log(
    `→ announcement documents: ${annIds.length.toLocaleString()} announcement(s)`,
  );
  await mapPool(annIds, CONCURRENCY, async (annId) => {
    if (!args.refresh && store?.has("announcement_docs", annId)) {
      c.skipped++;
      return;
    }
    const { res, raw } = await callRaw("RetrieveTenderAnnouncementDocuments", {
      tenderAnnouncementId: annId,
    });
    record(store, c, "announcement_docs", annId, res, raw);
  });

  // Fan-out 2: buyer profiles. ~2k distinct organisations across 127k tenders, so
  // this is nearly free — and it carries the address that the flat ЦАИС feed omits,
  // which is why those awarders never resolve to an EKATTE today.
  const orgList = [...orgIds];
  console.log(
    `→ buyer profiles: ${orgList.length.toLocaleString()} organisation(s)`,
  );
  await mapPool(orgList, CONCURRENCY, async (orgId) => {
    if (!args.refresh && store?.has("buyer_profile", orgId)) {
      c.skipped++;
      return;
    }
    const { res, raw } = await callRaw(
      "GetPublicBuyerProfileBasicInformation",
      {
        organizationId: orgId,
      },
    );
    record(store, c, "buyer_profile", orgId, res, raw);
  });

  console.log(
    `\n✓ ${c.answers.toLocaleString()} answer(s) (${c.empty.toLocaleString()} empty), ` +
      `${c.failures.toLocaleString()} failure(s)` +
      (c.denied
        ? ` (${c.denied} DENIED — a method left the anonymous surface!)`
        : "") +
      `, ${c.skipped.toLocaleString()} already cached`,
  );
  const throttled = throttleSummary();
  if (throttled) console.log(throttled);
  if (c.denied)
    console.log(
      "  ⚠ a `denied` result means the register stopped serving a method anonymously.\n" +
        "    Re-probe the surface before trusting the rest of this run (plan §1.1).",
    );
  if (store) {
    const s = store.stats();
    console.log(
      `  store: ${s.answers.toLocaleString()} answers, ${s.failures.toLocaleString()} failures, ` +
        `kinds ${JSON.stringify(s.byKind)}`,
    );
    store.close();
  }
};

const cli = command({
  name: "ingest_eop_dossier",
  args: {
    probe: flag({
      type: optional(boolean),
      long: "probe",
      description:
        "200 most recent tenders only — surface check before a full crawl.",
      defaultValue: () => false,
    }),
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description: "Write to the raw store (omit for a dry run).",
      defaultValue: () => false,
    }),
    refresh: flag({
      type: optional(boolean),
      long: "refresh",
      description: "Re-fetch subjects already answered (default: resume).",
      defaultValue: () => false,
    }),
    limit: option({
      type: optional(string),
      long: "limit",
      description: "Cap the tender work set (most recent first).",
    }),
    fromYear: option({
      type: optional(string),
      long: "from-year",
      description: "Only tenders published in/after this year, e.g. 2024.",
    }),
  },
  handler: (args) =>
    main({
      probe: !!args.probe,
      apply: !!args.apply,
      refresh: !!args.refresh,
      limit: args.limit,
      fromYear: args.fromYear,
    }),
});

run(cli, process.argv.slice(2));
