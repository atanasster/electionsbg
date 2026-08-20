// A6 — project the tier-A/B capture into Postgres (schema: 146_tender_dossier.sql).
// docs/plans/tender-dossier-ingest-v1.md §5.
//
// INPUT is the gitignored SQLite capture written by ingest_eop_dossier.ts and
// ingest_eop_spec_text.ts. This fetches NOTHING: it is the offline projection half,
// so it can be re-run freely after a parser change without touching the register.
//
// STAGE-MERGED, not TRUNCATE+rebuild. Every one of these tables is on a serving path
// (`/tenders/:unp`, the document redirect, the B3 search index), and a TRUNCATE holds
// an AccessExclusiveLock for the whole load — which is what 500s the tender routes at
// the pool's lock_timeout. See scripts/db/lib/stage_merge.ts.
//
// ⚠️ THE STORE IS A PARTIAL CAPTURE UNTIL THE FULL CRAWL RUNS, and this loader must
// never mistake that for "these procedures have no dossier". `mergeFromStage` deletes
// every key the build did not produce, so pointing it at a 200-tender store would
// evict the other 131,516. It therefore merges ONLY the УНП set the store actually
// covers (see `scopedMerge`), leaving everything else untouched.
//
//   npm run db:load:tender-dossier:pg
//   npm run db:load:tender-dossier:pg:cloud

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { command, run, optional, flag, boolean } from "cmd-ts";
import { exec, getPool, withTx } from "./lib/pg";
import { copyRows, pgTextArray } from "./lib/copy";
import { EopDossierStore } from "../procurement/eop_dossier_store";
import {
  parseNoticePairs,
  noticeFields,
  noticeText,
} from "../procurement/eop_notice_parse";
import { classifyDocName } from "../procurement/eop_doc_kind";
import { wcfDate } from "../procurement/eop_api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_dossier.sqlite",
);
const SCHEMA_FILE = path.resolve(__dirname, "schema/pg/146_tender_dossier.sql");
// 147 also carries the app_readonly GRANTs for 146's tables, which shipped without
// any. Applied here so a cloud load repairs an already-deployed 146 (see 147's head).
const SEARCH_SCHEMA_FILE = path.resolve(
  __dirname,
  "schema/pg/147_tender_search_text.sql",
);

// ---- shapes of the captured bodies (loose: we read a subset) ----------------

interface DocEntry {
  Id?: number;
  Name?: string;
  Extension?: string | null;
  MimeType?: string | null;
  Size?: number;
  MD5Hash?: string | null;
  Container?: string | null;
  DocumentCloudName?: string | null;
  IsPreviousVersion?: boolean;
  PreviousVersionId?: number | null;
  CreatedDate?: string | null;
}

interface Details {
  SpecialNumber?: string | null;
  OrganizationId?: number;
  TenderDescription?: string | null;
  ContactPersonDisplayName?: string | null;
  ContactPersonEmail?: string | null;
  ContactPersonPhone?: string | null;
  OfferPhaseStartDate?: string | null;
  OfferPhaseEndDate?: string | null;
  OpeningOfOffersDate?: string | null;
  TenderGuid?: string | null;
  TenderDescriptionDocuments?: DocEntry[];
  TenderPublicationDetails?: {
    TenderPublicationId?: number;
    DocumentId?: number;
    PublicationFormType?: unknown;
    BulgarianNumber?: string | null;
    HtmlPreview?: string;
  }[];
}

/** Visible text out of the register's HTML description field. */
const plain = (html: string | null | undefined): string | null => {
  if (!html) return null;
  const t = noticeText(html);
  return t || null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * A criteria array for COPY, or NULL when the notice exposed none.
 *
 * ⚠️ EMPTY MUST BE NULL, NOT `{}`. 146's header and `isPriceOnly`'s tri-state both
 * rest on "not exposed" being distinguishable from "none published" — and the whole
 * 2020–2023 legacy tier is the first case. Writing `{}` collapses them and silently
 * asserts that three years of procedures published no award criteria.
 *
 * The literal encoding itself is `pgTextArray` from lib/copy, which is round-trip
 * tested there; a second copy here was one escaping bug away from divergence.
 */
const criteria = (xs: readonly string[]): string | null =>
  xs.length ? pgTextArray(xs) : null;

// ---- the projection (STREAMING) --------------------------------------------
//
// ⚠️ NOTHING IS MATERIALISED. An earlier revision built seven arrays in memory and
// measured 884 MB RSS on 1,095 dossiers — 0.83% of the 131,716-tender work set, so
// the full corpus would have died. `store.iterate()` is keyset-paged for exactly
// this reason, and `copyRows` takes a lazy Iterable, so each table streams from
// SQLite straight into COPY and only one page is ever resident.
//
// The cost is re-reading `details` once per derived table. That is cheap (local
// SQLite, no network) and is the right trade against holding the corpus twice.

/** УНП per tenderId, plus the УНП set that scopes the merge. Small by construction —
 *  131k short strings, not 131k × 400 KB bodies. */
interface Scope {
  unpByTender: Map<number, string>;
  unps: string[];
}

const readScope = (store: EopDossierStore): Scope => {
  const unpByTender = new Map<number, string>();
  for (const { subjectId, body } of store.iterate<Details>("details")) {
    const unp = body.SpecialNumber?.trim();
    // A body with no УНП is a lot stub, not a procedure (eop_tender_class.ts).
    if (unp) unpByTender.set(subjectId, unp);
  }
  return { unpByTender, unps: [...new Set(unpByTender.values())] };
};

const docRow = (
  d: DocEntry,
  unp: string,
  tenderId: number,
  source: "attachment" | "announcement",
): unknown[] => [
  d.Id,
  unp,
  tenderId,
  source,
  d.Name ?? "",
  (d.Extension ?? "").toLowerCase() || null,
  d.MimeType ?? null,
  num(d.Size),
  (d.MD5Hash ?? "").toLowerCase() || null,
  d.Container ?? null,
  d.DocumentCloudName ?? null,
  d.Name ? classifyDocName(d.Name) : null,
  d.IsPreviousVersion ?? null,
  num(d.PreviousVersionId),
  wcfDate(d.CreatedDate),
];

function* genDossier(store: EopDossierStore): Generator<unknown[]> {
  const now = new Date().toISOString();
  for (const { subjectId: tenderId, body } of store.iterate<Details>(
    "details",
  )) {
    const unp = body.SpecialNumber?.trim();
    if (!unp) continue;
    yield [
      unp,
      tenderId,
      num(body.OrganizationId),
      plain(body.TenderDescription),
      body.ContactPersonDisplayName?.trim() || null,
      body.ContactPersonEmail?.trim() || null,
      body.ContactPersonPhone?.trim() || null,
      wcfDate(body.OfferPhaseStartDate),
      wcfDate(body.OfferPhaseEndDate),
      wcfDate(body.OpeningOfOffersDate),
      body.TenderGuid ?? null,
      now,
      `https://app.eop.bg/today/${tenderId}`,
    ];
  }
}

/** Attachments AND announcement documents, deduped on documentId — the same file is
 *  republished under one id per surface, and the table is keyed on that id. */
function* genDocuments(
  store: EopDossierStore,
  sc: Scope,
): Generator<unknown[]> {
  const seen = new Set<number>();
  for (const { subjectId: tenderId, body } of store.iterate<Details>(
    "details",
  )) {
    const unp = body.SpecialNumber?.trim();
    if (!unp) continue;
    for (const d of body.TenderDescriptionDocuments ?? []) {
      if (!d?.Id || seen.has(d.Id)) continue;
      seen.add(d.Id);
      yield docRow(d, unp, tenderId, "attachment");
    }
  }
  for (const { subjectId: tenderId, body } of store.iterate<{ Id?: number }[]>(
    "announcements",
  )) {
    const unp = sc.unpByTender.get(tenderId);
    if (!unp) continue;
    for (const a of body ?? []) {
      if (!a?.Id) continue;
      for (const d of store.getJson<DocEntry[]>("announcement_docs", a.Id) ??
        []) {
        if (!d?.Id || seen.has(d.Id)) continue;
        seen.add(d.Id);
        yield docRow(d, unp, tenderId, "announcement");
      }
    }
  }
}

function* genNotices(store: EopDossierStore): Generator<unknown[]> {
  for (const { subjectId: tenderId, body } of store.iterate<Details>(
    "details",
  )) {
    const unp = body.SpecialNumber?.trim();
    if (!unp) continue;
    for (const p of body.TenderPublicationDetails ?? []) {
      if (!p?.TenderPublicationId) continue;
      const pairs = parseNoticePairs(p.HtmlPreview ?? "");
      const f = noticeFields(pairs);
      yield [
        p.TenderPublicationId,
        unp,
        tenderId,
        typeof p.PublicationFormType === "string"
          ? p.PublicationFormType
          : null,
        p.BulgarianNumber ?? null,
        f.isEforms,
        f.btCount,
        f.buyerLegalCategory,
        f.buyerActivity,
        criteria(f.awardCriteriaTypes),
        criteria(f.selectionCriteria),
        f.durationValue,
        f.offerDeadlineDate,
        f.offerDeadlineTime,
        noticeText(p.HtmlPreview ?? "") || null,
        JSON.stringify(pairs),
      ];
    }
  }
}

function* genAnnouncements(
  store: EopDossierStore,
  sc: Scope,
): Generator<unknown[]> {
  for (const { subjectId: tenderId, body } of store.iterate<
    { Id?: number; Title?: string; Text?: string; CreatedDate?: string }[]
  >("announcements")) {
    const unp = sc.unpByTender.get(tenderId);
    if (!unp) continue;
    for (const a of body ?? []) {
      if (!a?.Id) continue;
      yield [
        a.Id,
        unp,
        tenderId,
        a.Title ?? null,
        plain(a.Text),
        wcfDate(a.CreatedDate),
      ];
    }
  }
}

function* genContractItems(
  store: EopDossierStore,
  sc: Scope,
): Generator<unknown[]> {
  for (const { subjectId: tenderId, body } of store.iterate<{
    ContractListItems?: {
      Id?: number;
      Subject?: string;
      Value?: number;
      CurrentContractValue?: number;
      Currency?: number;
      StartDate?: string;
      EndDate?: string;
      CurrentStartDate?: string;
      CurrentEndDate?: string;
      ContractSuppliers?: {
        OrganizationName?: string;
        RegistryNumber?: string;
      }[];
      Annexes?: unknown[];
    }[];
  }>("contract_items")) {
    const unp = sc.unpByTender.get(tenderId);
    if (!unp) continue;
    for (const ci of body.ContractListItems ?? []) {
      if (!ci?.Id) continue;
      yield [
        ci.Id,
        unp,
        tenderId,
        ci.Subject ?? null,
        num(ci.Value),
        num(ci.CurrentContractValue),
        num(ci.Currency),
        wcfDate(ci.StartDate),
        wcfDate(ci.EndDate),
        wcfDate(ci.CurrentStartDate),
        wcfDate(ci.CurrentEndDate),
        JSON.stringify(
          (ci.ContractSuppliers ?? []).map((x) => ({
            name: x.OrganizationName ?? null,
            eik: x.RegistryNumber ?? null,
          })),
        ),
        JSON.stringify(ci.Annexes ?? []),
      ];
    }
  }
}

function* genBuyerProfiles(store: EopDossierStore): Generator<unknown[]> {
  for (const { subjectId: orgId, body } of store.iterate<{
    RegistryNumber?: string;
    OrganizationName?: string;
    BatchNumber?: number | string;
    TotalPublishedTendersCount?: number;
    Address?: { City?: string; Postcode?: string; StreetAddress?: string };
    NutsCode?: { Id?: number };
    OrganizationStructure?: { RelatedOrganizations?: unknown[] };
  }>("buyer_profile")) {
    yield [
      orgId,
      body.RegistryNumber ?? null,
      body.OrganizationName ?? null,
      body.Address?.City ?? null,
      body.Address?.Postcode ?? null,
      body.Address?.StreetAddress ?? null,
      num(body.NutsCode?.Id),
      body.BatchNumber != null ? String(body.BatchNumber) : null,
      num(body.TotalPublishedTendersCount),
      JSON.stringify(body.OrganizationStructure?.RelatedOrganizations ?? []),
    ];
  }
}

/** Tier-B text, paged rather than `.all()` — the same fix the store's own iterate()
 *  needed, and reintroducing it here would OOM on the same corpus. */
function* genDocText(store: EopDossierStore): Generator<unknown[]> {
  for (const r of store.iterateDocText()) {
    yield [
      r.md5,
      r.documentId,
      r.name,
      r.ext,
      r.sizeBytes,
      r.chars,
      r.pages,
      r.extractor,
      r.extractorVersion,
      r.text,
    ];
  }
}

// ---- merge ------------------------------------------------------------------

const COLS: Record<string, string[]> = {
  tender_dossier: [
    "unp",
    "tender_id",
    "organization_id",
    "description_text",
    "contact_name",
    "contact_email",
    "contact_phone",
    "offer_phase_start",
    "offer_phase_end",
    "opening_of_offers",
    "tender_guid",
    "fetched_at",
    "source_url",
  ],
  tender_document: [
    "document_id",
    "unp",
    "tender_id",
    "source",
    "name",
    "ext",
    "mime",
    "size_bytes",
    "md5",
    "container",
    "cloud_name",
    "kind",
    "is_previous_version",
    "previous_version_id",
    "created_at",
  ],
  tender_notice: [
    "publication_id",
    "unp",
    "tender_id",
    "form_type",
    "notice_no",
    "is_eforms",
    "bt_count",
    "buyer_legal_category",
    "buyer_activity",
    "award_criteria",
    "selection_criteria",
    "duration_value",
    "offer_deadline_date",
    "offer_deadline_time",
    "text",
    "pairs",
  ],
  tender_announcement: [
    "announcement_id",
    "unp",
    "tender_id",
    "title",
    "body_text",
    "created_at",
  ],
  tender_contract_item: [
    "contract_id",
    "unp",
    "tender_id",
    "subject",
    "value_native",
    "current_value_native",
    "currency_code",
    "start_date",
    "end_date",
    "current_start_date",
    "current_end_date",
    "suppliers",
    "annexes",
  ],
  tender_buyer_profile: [
    "organization_id",
    "eik",
    "name",
    "city",
    "postcode",
    "street",
    "nuts_id",
    "batch_number",
    "total_published_tenders",
    "related_orgs",
  ],
  tender_document_text: [
    "md5",
    "document_id",
    "name",
    "ext",
    "size_bytes",
    "chars",
    "pages",
    "extractor",
    "extractor_version",
    "text",
  ],
};

/**
 * Merge one table, scoped to the УНП the capture covers.
 *
 * ⚠️ NOT `mergeFromStage`. That deletes every key absent from the stage, which is
 * right for a whole-corpus rebuild and catastrophic here: the store is a partial
 * capture until the ~26 h crawl finishes, so an unscoped merge would evict every
 * procedure the current run happens not to cover. Deletes are therefore restricted
 * to rows whose УНП IS in this build — a re-projection still removes documents the
 * register has withdrawn, without touching procedures we simply have not crawled.
 */
const scopedMerge = async (
  c: Parameters<Parameters<typeof withTx>[0]>[0],
  table: string,
  rows: Iterable<unknown[]>,
  scopeCol: string | null,
  unps: string[],
): Promise<void> => {
  const cols = COLS[table];
  const stage = `${table}_stage`;
  const key = cols[0];
  const nonKey = cols.slice(1);
  // Run metadata, not data: updated on every write but never a REASON to write.
  const VOLATILE = new Set(["fetched_at"]);
  const compare = nonKey.filter((n) => !VOLATILE.has(n));
  await c.query(`DROP TABLE IF EXISTS ${stage}`);
  await c.query(
    `CREATE UNLOGGED TABLE ${stage} (LIKE ${table} INCLUDING DEFAULTS)`,
  );
  // `rows` is a lazy generator — copyRows streams it, so the projection never
  // materialises. See the header: an array-building revision measured 884 MB on
  // 0.83% of the corpus.
  await copyRows(c, stage, cols, rows);
  // A duplicate key here means the projection emitted one subject twice; fail with
  // that rather than letting ON CONFLICT quietly pick a winner.
  await c.query(`ALTER TABLE ${stage} ADD PRIMARY KEY (${key})`);
  await c.query(`ANALYZE ${stage}`);
  await c.query(
    `INSERT INTO ${table} (${cols.join(",")})
       SELECT ${cols.join(",")} FROM ${stage}
     ON CONFLICT (${key}) DO UPDATE SET
       ${nonKey.map((n) => `${n} = EXCLUDED.${n}`).join(", ")}
     -- Touch only genuinely-changed rows. This is the most re-run-prone loader in
     -- the family (every parser change re-projects), and without this each run
     -- rewrites every row and bloats the table for nothing.
     --
     -- ⚠️ COMPARED ON PAYLOAD ONLY. fetched_at is stamped per run, so
     -- including it makes every row differ from itself and the guard a no-op —
     -- measured: a re-run that changed nothing still issued 1,312 updates.
     WHERE (${compare.map((n) => `${table}.${n}`).join(", ")})
        IS DISTINCT FROM (${compare.map((n) => `EXCLUDED.${n}`).join(", ")})`,
  );
  if (scopeCol)
    await c.query(
      `DELETE FROM ${table} t
        WHERE t.${scopeCol} = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM ${stage} s WHERE s.${key} = t.${key})`,
      [unps],
    );
  await c.query(`DROP TABLE IF EXISTS ${stage}`);
};

// B3 — the searchable body (147_tender_search_text.sql).
//
// Built in SQL FROM THE TABLES THIS RUN JUST WROTE, not from the store, for one
// reason: the body must be exactly what the dossier route serves. Re-deriving it
// from the capture would let the two drift on any projection change — a document
// the parser started rejecting would vanish from the page and stay findable, which
// is the worse half of a search bug, since the hit leads to a page that does not
// contain the word.
//
// ⚠️ SCOPED TO THE CAPTURED УНП, like every merge above. An unscoped rebuild would
// see the 99.2% of the corpus this run did not capture as rows to delete.
/** ⚠️ BATCHED, and the batch size is a Cloud SQL constraint rather than a
 *  performance tweak. Managed Postgres sets `temp_file_limit` (2,569,247 kB on
 *  the serving instance); local sets `-1`, so the unbatched form CANNOT FAIL in
 *  development and fails every time in production. Measured 2026-08-19 on the
 *  first full-capture publish: the whole 50,283-УНП scope aborted the entire
 *  transaction with „temporary file size exceeds temp_file_limit" inside this
 *  function, after the seven table merges had already streamed ~929k rows over
 *  the proxy — all of it rolled back.
 *
 *  The sort feeding the document aggregate carries extracted PDF text, so its
 *  temp footprint scales with the scope. Temp files are released when a
 *  STATEMENT ends, so running the same scoped query over slices keeps the peak
 *  bounded while leaving the merge semantics identical — every slice is still
 *  inside the caller's single transaction. */
const SEARCH_TEXT_BATCH = 2_000;

const rebuildSearchText = async (
  c: Parameters<Parameters<typeof withTx>[0]>[0],
  unps: string[],
): Promise<void> => {
  for (let i = 0; i < unps.length; i += SEARCH_TEXT_BATCH) {
    await rebuildSearchTextBatch(c, unps.slice(i, i + SEARCH_TEXT_BATCH));
  }
};

const rebuildSearchTextBatch = async (
  c: Parameters<Parameters<typeof withTx>[0]>[0],
  unps: string[],
): Promise<void> => {
  await c.query(
    // ⚠️ THE SCOPE IS REPEATED INSIDE BOTH SUBQUERIES, not only on the driving table.
    // Postgres cannot push the outer qual through a GROUP BY, so without it both
    // aggregate the WHOLE corpus and discard 99%+ of the result. Measured with a
    // 5-УНП scope: 25.3 ms / 1,205 buffers / Seq Scans, against 5.2 ms / 268 buffers
    // / index scans when scoped. The sort feeding the document aggregate carries
    // extracted PDF text, so at full capture the unscoped form is an external sort of
    // the entire document corpus on every re-projection — which would make this
    // loader's cost a function of TOTAL corpus size rather than of capture size, and
    // re-projecting freely after a parser change is the property it exists to have.
    //
    // string_agg is ORDERed for the same reason the merge compares payloads: without
    // it the concatenation order is plan-dependent, so an unchanged capture can
    // produce a different string and defeat the change-detection guard below.
    `INSERT INTO tender_search_text (t_unp, fold)
     SELECT d.unp,
            -- concat_ws SKIPS nulls rather than propagating them, so a procedure
            -- with no notice text still contributes its description. A plain ‖
            -- would null the whole row out.
            translit_bg_latin(concat_ws(' ', d.description_text, n.txt, x.txt))
       FROM tender_dossier d
       LEFT JOIN (
         SELECT unp, string_agg(text, ' ' ORDER BY publication_id) txt
           FROM tender_notice
          WHERE unp = ANY($1::text[]) AND coalesce(text, '') <> '' GROUP BY unp
       ) n ON n.unp = d.unp
       LEFT JOIN (
         SELECT doc.unp, string_agg(t.text, ' ' ORDER BY doc.document_id) txt
           FROM tender_document doc
           JOIN tender_document_text t ON t.md5 = doc.md5
          WHERE doc.unp = ANY($1::text[]) AND coalesce(t.text, '') <> ''
          GROUP BY doc.unp
       ) x ON x.unp = d.unp
      WHERE d.unp = ANY($1::text[])
        -- A procedure whose three sources are all empty gets NO ROW rather than an
        -- empty one: an empty row would still count toward tender_search_coverage(),
        -- inflating the figure a UI uses to say how much of the corpus it searched.
        AND coalesce(concat_ws(' ', d.description_text, n.txt, x.txt), '') <> ''
     ON CONFLICT (t_unp) DO UPDATE SET fold = EXCLUDED.fold
      WHERE tender_search_text.fold IS DISTINCT FROM EXCLUDED.fold`,
    [unps],
  );
  // The capture can REMOVE text (a document withdrawn, a parse that now rejects),
  // so a procedure in scope that no longer projects a body must lose its row —
  // otherwise it stays findable by a word the register no longer publishes.
  await c.query(
    `DELETE FROM tender_search_text s
      WHERE s.t_unp = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM tender_dossier d
           WHERE d.unp = s.t_unp
             AND coalesce(d.description_text, '') <> ''
        )
        AND NOT EXISTS (
          SELECT 1 FROM tender_notice n
           WHERE n.unp = s.t_unp AND coalesce(n.text, '') <> ''
        )
        AND NOT EXISTS (
          SELECT 1 FROM tender_document doc
            JOIN tender_document_text t ON t.md5 = doc.md5
           WHERE doc.unp = s.t_unp AND coalesce(t.text, '') <> ''
        )`,
    [unps],
  );
};

const main = async (args: { apply: boolean }): Promise<void> => {
  // ⚠️ DDL FIRST, BEFORE THE CAPTURE GUARD. The schema needs no capture, and 147 is
  // what repairs 146's missing app_readonly GRANTs on an already-deployed database —
  // precisely the case where the gitignored ~26 h capture is absent. With the guard
  // first, `db:load:tender-dossier:pg:cloud` on such a machine printed "Nothing to
  // load", applied no DDL and exited 0: a deploy that looks successful and creates
  // nothing, leaving every tenders search reading a table that does not exist.
  await exec(fs.readFileSync(SCHEMA_FILE, "utf8"));
  await exec(fs.readFileSync(SEARCH_SCHEMA_FILE, "utf8"));

  if (!fs.existsSync(STORE_FILE)) {
    console.log(
      `→ schema applied; no capture at ${STORE_FILE} — run ingest_eop_dossier.ts first.`,
    );
    await getPool().end();
    return;
  }

  const store = new EopDossierStore(STORE_FILE);
  const sc = readScope(store);
  console.log(
    `→ capture covers ${sc.unps.length.toLocaleString()} procedure(s) ` +
      `(${sc.unpByTender.size.toLocaleString()} tenderId(s))`,
  );

  if (!args.apply) {
    // Count without holding: the generators are lazy, so this walks and discards.
    const count = (g: Iterable<unknown[]>): number => {
      let n = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const _row of g) n++;
      return n;
    };
    console.log(
      `  dossiers=${count(genDossier(store)).toLocaleString()} ` +
        `documents=${count(genDocuments(store, sc)).toLocaleString()} ` +
        `notices=${count(genNotices(store)).toLocaleString()} ` +
        `announcements=${count(genAnnouncements(store, sc)).toLocaleString()} ` +
        `contractItems=${count(genContractItems(store, sc)).toLocaleString()} ` +
        `buyerProfiles=${count(genBuyerProfiles(store)).toLocaleString()} ` +
        `docText=${count(genDocText(store)).toLocaleString()}`,
    );
    console.log("✓ dry run (omit --dry-run to write)");
    store.close();
    await getPool().end();
    return;
  }

  await withTx(async (c) => {
    await scopedMerge(c, "tender_dossier", genDossier(store), "unp", sc.unps);
    await scopedMerge(
      c,
      "tender_document",
      genDocuments(store, sc),
      "unp",
      sc.unps,
    );
    await scopedMerge(c, "tender_notice", genNotices(store), "unp", sc.unps);
    await scopedMerge(
      c,
      "tender_announcement",
      genAnnouncements(store, sc),
      "unp",
      sc.unps,
    );
    await scopedMerge(
      c,
      "tender_contract_item",
      genContractItems(store, sc),
      "unp",
      sc.unps,
    );
    // Keyed on their own identity, not on a УНП, so a partial capture has no scope
    // to delete within — upsert only.
    await scopedMerge(
      c,
      "tender_buyer_profile",
      genBuyerProfiles(store),
      null,
      [],
    );
    await scopedMerge(c, "tender_document_text", genDocText(store), null, []);
    await rebuildSearchText(c, sc.unps);
  });
  store.close();

  const { rows } = await getPool().query<{ t: string; n: string }>(
    `SELECT 'tender_dossier' t, count(*)::text n FROM tender_dossier
     UNION ALL SELECT 'tender_document', count(*)::text FROM tender_document
     UNION ALL SELECT 'tender_notice', count(*)::text FROM tender_notice
     UNION ALL SELECT 'tender_announcement', count(*)::text FROM tender_announcement
     UNION ALL SELECT 'tender_contract_item', count(*)::text FROM tender_contract_item
     UNION ALL SELECT 'tender_buyer_profile', count(*)::text FROM tender_buyer_profile
     UNION ALL SELECT 'tender_document_text', count(*)::text FROM tender_document_text
     UNION ALL SELECT 'tender_search_text', count(*)::text FROM tender_search_text`,
  );
  console.log(
    `✓ loaded → ${rows.map((r) => `${r.t}=${Number(r.n).toLocaleString()}`).join(", ")}`,
  );
  await getPool().end();
};

run(
  command({
    name: "load_tender_dossier_pg",
    args: {
      // ⚠️ WRITES BY DEFAULT, like every other db:load:* in the family. An
      // --apply gate here made `db:load:tender-dossier:pg:cloud` print "✓ dry run"
      // and exit 0 having published nothing — a deploy that looks successful and
      // moves no data.
      dryRun: flag({
        type: optional(boolean),
        long: "dry-run",
        description: "Report the projection without writing.",
        defaultValue: () => false,
      }),
    },
    handler: (a) => main({ apply: !a.dryRun }),
  }),
  process.argv.slice(2),
);
