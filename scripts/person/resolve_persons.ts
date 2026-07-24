// The person resolver (plan §3) — reads the PG-resident office-holder sources, parses
// + blocks + clusters them (nameParts.ts + cluster.ts), and rebuilds the person /
// person_role / person_alias tables. Idempotent: a full TRUNCATE+rebuild with
// DETERMINISTIC slugs, so re-running yields the same person_ids (like
// rebuild_ngo_board_links). Nothing consumes person_id yet, so a rebuild is safe;
// slug persistence (never renumber an active person) is a follow-up once it's served.
//
// Scope so far: magistrate + officials (executive + municipal) + MPs + candidates (CIK,
// per-election by-slug shards) + donors (ЕРИК campaign finance) + local mayors/councillors
// (mi/chmi elected office holders) + sanctions (OFAC/EU, curated)
// + regulators (curated rosters of independent bodies). The mp id is the
// cross-source GOLD KEY — Tier 0 — carried by MPs and by any candidacy resolved to a seat
// (mpId), and is unioned across blocks so a name variant can't scatter one MP. Cross-source
// merges are the safe ones: same mp id (Tier 0), a name-independent corroborant (Tier 1:
// shared company / birth date / party+place, VETOED by a conflicting patronymic), or a
// globally-unique full name (Tier 2). Donors are 2-part and never auto-merge (privacy:
// public_default=false → internal-only). TR officers are BRIDGED two ways, never materialized
// on their own: Bridge A (shared company) attaches a person's TR footprint on a company they
// already declare/link to (magistrate_company + company_politicians) via the strong shared-uic
// corroborant; Bridge B (unique full name) discovers the footprint of a globally-unique-named
// public person on the one company their exact name appears on (Tier-2, double-gated). Review
// candidates (§3 tier 3) persist to person_review_candidate.
//
//   npx tsx scripts/person/resolve_persons.ts
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/person/resolve_persons.ts
//
// A successful run stamps state/ingest/update-persons.json and appends a
// data-changes row. `--no-stamp` suppresses both — the cloud publish passes it,
// and a scratch run should too. Via npm it needs the `--` separator:
//
//   npx tsx scripts/person/resolve_persons.ts --no-stamp
//   npm run db:resolve:persons -- --no-stamp

import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, withTx, end, exec } from "../db/lib/pg";
import {
  isOfficialSource,
  personSourceForOfficial,
} from "../../src/lib/officialSources";
import { copyRows } from "../db/lib/copy";
import { parseName } from "./nameParts";
import { writeIngestState } from "../lib/ingest-state";
import { appendDataChange } from "../lib/data-changes";
import { clusterBlock, type Mention } from "./cluster";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type Raw = {
  id: string;
  source: string;
  ref: string;
  role: string;
  hardId: string | null; // cross-source gold key (parliament MP id) — Tier 0
  // The Сметна палата register's OWN per-person id (`cacbg:<GUID>`), recovered from the
  // declaration source_url. A second, independent gold key — see `registerIdByRef`.
  regId: string | null;
  display: string;
  given: string;
  patr: string | null;
  family: string;
  nameParts: 2 | 3;
  ambiguous: boolean;
  place: string | null; // for person_role display
  // Matching corroborants (kept SEPARATE from `place` display — a magistrate's court
  // is a display place but not a reliable cross-person corroborant).
  cParty: string | null;
  cPlace: string | null;
  cBirth: string | null;
  // `cParty` comes from a NATIONAL PARTY OFFICE (chair / deputy / statutory
  // representative), which qualifies it as strong-against-an-identical-full-name — see
  // samePartyOffice in cluster.ts.
  cPartyOffice: boolean;
  uics: string[]; // declared/linked company EIKs — the strong shared-company corroborant
  sourceRow: unknown | null; // provenance jsonb for the role (e.g. a sanctions designation)
};

// djb2 → 6 base36 chars. Deterministic disambiguator for magistrate-only slugs.
const hash6 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6).padStart(6, "0");
};
const kebab = (s: string): string =>
  s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// A TR role that is board membership of a ЮЛНЦ (association / foundation / читалище) is
// the `ngo` facet, not a company (`tr`) officership — the two carry different meaning on a
// profile (civic board seat vs business interest). These role codes only ever occur on
// NGO entity classes (verified), so the role name is a clean, entity-independent classifier.
const NGO_ROLES = new Set(["ngo_board", "ngo_representative"]);
const trOrNgo = (role: string): "tr" | "ngo" =>
  NGO_ROLES.has(role) ? "ngo" : "tr";

// (election, partyNum) -> canonicalId — a party corroborant that is STABLE across
// elections (partyNum is re-assigned every cycle). Lets a person's candidacies for the
// same party in the same oblast merge across elections (weak-both corroboration, §3
// Tier 1). Degrades to no-party when data/canonical_parties.json is absent.
function buildPartyMap(): Map<string, string> {
  const m = new Map<string, string>();
  const p = path.join(REPO_ROOT, "data/canonical_parties.json");
  if (!fs.existsSync(p)) return m;
  const cp = JSON.parse(fs.readFileSync(p, "utf8")) as {
    parties: {
      id: string;
      history: { election: string; partyNum: number }[];
    }[];
  };
  for (const party of cp.parties)
    for (const h of party.history)
      m.set(`${h.election}#${h.partyNum}`, party.id);
  return m;
}

// Fold a party NAME to a comparison key: uppercase, drop punctuation and quoting (the
// register writes `ПП„Продължаваме промяната"` where the ballot writes `ПП ПРОДЪЛЖАВАМЕ
// ПРОМЯНАТА`), then drop one leading legal-form token so `ПП "X"`, `Политическа партия
// "X"` and a bare `X` all land on `X`.
const partyKey = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^А-ЯЁA-Z0-9]+/g, " ")
    .trim()
    .replace(
      /^(ПОЛИТИЧЕСКА ПАРТИЯ|ПОЛИТИЧЕСКО ДВИЖЕНИЕ|ПОЛИТИЧЕСКА КОАЛИЦИЯ|КОАЛИЦИЯ|ПАРТИЯ|ПП|ПК|ПД) /,
      "",
    )
    .trim();

// Party NAME -> canonicalId, so the institution a party officer files under
// (`ПП "ИМА ТАКЪВ НАРОД"`) lands in the SAME namespace as a candidacy's party
// corroborant (`p_0`) — otherwise the two could never be compared. Built from every name
// the canonical file carries: the display name, and each cycle's ballot name + nickname.
// First key wins, so a name shared by two canonical parties resolves to one of them
// rather than flapping; a party the file does not know simply gets no key, and the
// officer mention then carries no party corroborant at all.
function buildPartyNameMap(): Map<string, string> {
  const m = new Map<string, string>();
  const p = path.join(REPO_ROOT, "data/canonical_parties.json");
  if (!fs.existsSync(p)) return m;
  const cp = JSON.parse(fs.readFileSync(p, "utf8")) as {
    parties: {
      id: string;
      displayName: string | null;
      history: { name: string | null; nickName: string | null }[];
    }[];
  };
  for (const party of cp.parties)
    for (const raw of [
      party.displayName,
      ...party.history.flatMap((h) => [h.name, h.nickName]),
    ]) {
      const k = raw ? partyKey(raw) : "";
      if (k && !m.has(k)) m.set(k, party.id);
    }
  return m;
}

// Build the parse-derived + defaulted fields shared by every source, so each source
// only spells out what differs (id/source/ref/role + any hardId/corroborants).
const fields = (
  p: NonNullable<ReturnType<typeof parseName>>,
  over: Partial<Raw>,
): Omit<Raw, "id" | "source" | "ref" | "role"> => ({
  hardId: null,
  regId: null,
  display: p.displayName,
  given: p.given,
  patr: p.patronymic,
  family: p.family,
  nameParts: p.nameParts,
  ambiguous: p.ambiguous,
  place: null,
  cParty: null,
  cPlace: null,
  cBirth: null,
  cPartyOffice: false,
  uics: [],
  sourceRow: null,
  ...over,
});

// The Сметна палата register (register.cacbg.bg) stamps every declaration filename with
// its OWN per-person GUID — `<GUID><per-filing sequence>.xml` — so every filing by one
// declarant, across years AND across tiers (exec / muni / mp), carries the same GUID. That
// makes it a second gold key alongside the parliament MP id, and a strictly better one than
// the name: the officials slug is `hash(rawName|institution)` (scripts/officials/shared.ts),
// so the register merely re-casing a name between harvests ("Станислав Тодоров Трифонов" →
// "СТАНИСЛАВ ТОДОРОВ ТРИФОНОВ") mints a SECOND slug for the same person and scatters their
// declarations across two identities. The GUID is immune to that, and to marriage renames
// that change the fold itself (MP 3861 "Галя Стоянова Желязкова" and MP 5334 "Галя Стоянова
// Василева" are one person — different blocks, so no name-based tier could ever see them).
//
// Keyed on declaration.subject_ref, which IS person_role.ref (the officials slug / the MP
// id) — the same join load_declarations_pg's phase 2 uses. A ref carrying MORE than one
// GUID is two register persons collapsed onto one slug (the case
// scripts/officials/_slug_collisions.json exists to split); it is SKIPPED rather than
// guessed at, so an unlisted collision can never union two people through this key.
async function registerIdByRef(): Promise<Map<string, string>> {
  const present = await allRows<{ reg: string | null }>(
    `SELECT to_regclass('public.declaration')::text AS reg`,
  );
  if (!present[0]?.reg) return new Map(); // cold bootstrap — declarations not loaded yet
  const rows = await allRows<{ subject_ref: string; guid: string }>(
    `SELECT subject_ref, min(guid) AS guid
       FROM (SELECT subject_ref,
                    upper(substring(source_url from
                      '([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})')) AS guid
               FROM declaration) d
      WHERE guid IS NOT NULL
      GROUP BY subject_ref
     HAVING count(DISTINCT guid) = 1`,
  );
  return new Map(rows.map((r) => [r.subject_ref, `cacbg:${r.guid}`]));
}

// subject_ref -> the canonical party this official is a NATIONAL OFFICER of, for the
// `party_leader` category only (chair / deputy chair / statutory representative — the
// register bundles the three). The institution on such a filing IS a party, so it maps
// into the canonical party namespace and becomes the party-office corroborant
// (samePartyOffice in cluster.ts). Officers of a party the canonical file does not carry,
// and officers whose filings name two different canonical parties (they moved), are left
// without one rather than guessed at.
async function partyOfficeByRef(
  byName: Map<string, string>,
): Promise<Map<string, string>> {
  const present = await allRows<{ reg: string | null }>(
    `SELECT to_regclass('public.declaration')::text AS reg`,
  );
  if (!present[0]?.reg) return new Map();
  const rows = await allRows<{ subject_ref: string; institution: string }>(
    `SELECT DISTINCT subject_ref, institution FROM declaration
      WHERE category = 'party_leader' AND institution IS NOT NULL`,
  );
  const seen = new Map<string, Set<string>>();
  let unmatched = 0;
  for (const r of rows) {
    const id = byName.get(partyKey(r.institution));
    if (!id) {
      unmatched++;
      continue;
    }
    const s =
      seen.get(r.subject_ref) ??
      seen.set(r.subject_ref, new Set()).get(r.subject_ref)!;
    s.add(id);
  }
  const out = new Map<string, string>();
  for (const [ref, ids] of seen) if (ids.size === 1) out.set(ref, [...ids][0]);
  if (unmatched)
    console.log(
      `  ${unmatched} party-officer filing(s) name a party absent from canonical_parties.json — no party corroborant`,
    );
  return out;
}

async function collect(): Promise<Raw[]> {
  const out: Raw[] = [];
  let skipped = 0;
  const regId = await registerIdByRef();
  const partyOffice = await partyOfficeByRef(buildPartyNameMap());
  const add = (
    name: string,
    r: Omit<Raw, keyof ReturnType<typeof fields>>,
    over: Partial<Raw> = {},
  ) => {
    const p = parseName(name);
    if (!p) {
      skipped++;
      return;
    }
    out.push({ ...r, ...fields(p, over) });
  };

  // Person → linked-company (EIK) maps, for the TR-officer bridge (Bridge A). These are
  // the authoritative person↔company links already in PG: magistrate holdings
  // (ИВСС чл.175а) + the curated company_politicians (MP/official). A TR officer on one
  // of these EIKs whose name matches the linked person is that person's own TR footprint,
  // bridged via the STRONG shared-uic corroborant. eikExpected caps the bridge to the
  // linked person's (given, family) so co-owners of the same company are NOT swept in.
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  };
  const magEik = new Map<string, string[]>(); // magistrate name -> eik[]
  const refEik = new Map<string, string[]>(); // 'mp:{id}' | 'off:{slug}' -> eik[]
  const eikExpected = new Map<string, Set<string>>(); // eik -> {givenLc\tfamilyLc}
  const expect = (eik: string, name: string): void => {
    const p = parseName(name);
    if (!p) return;
    const k = `${p.given.toLowerCase()}\t${p.family.toLowerCase()}`;
    (eikExpected.get(eik) ?? eikExpected.set(eik, new Set()).get(eik)!).add(k);
  };
  for (const r of await allRows<{ magistrate_name: string; eik: string }>(
    `SELECT magistrate_name, eik FROM magistrate_company
      WHERE eik IS NOT NULL AND NOT eik_ambiguous`,
  )) {
    push(magEik, r.magistrate_name, r.eik);
    expect(r.eik, r.magistrate_name);
  }
  for (const r of await allRows<{
    eik: string;
    politician: string;
    ref: string;
  }>(`SELECT eik, politician, ref FROM company_politicians`)) {
    const mp = /\/candidate\/mp-(\d+)/.exec(r.ref);
    const off = /\/officials\/(.+)$/.exec(r.ref);
    if (mp) push(refEik, `mp:${mp[1]}`, r.eik);
    else if (off) push(refEik, `off:${off[1]}`, r.eik);
    else continue;
    expect(r.eik, r.politician);
  }

  const mags = await allRows<{ name: string; court: string | null }>(
    `SELECT name, court FROM magistrate`,
  );
  for (const m of mags)
    add(
      m.name,
      {
        id: `magistrate:${m.name}`,
        source: "magistrate",
        ref: m.name,
        role: "magistrate",
      },
      { place: m.court, uics: magEik.get(m.name) ?? [] },
    );

  const offs = await allRows<{
    name: string;
    slug: string;
    role: string | null;
    tier: string | null;
  }>(`SELECT name, slug, role, tier FROM official_roster`);
  // A few executive categories have their own person_source — see
  // src/lib/officialSources.ts for which, and for why the others deliberately
  // stay on the generic one.
  for (const o of offs)
    add(
      o.name,
      {
        id: `official:${o.slug}`,
        source: personSourceForOfficial(o.tier, o.role),
        ref: o.slug,
        role: o.role ?? "official",
      },
      {
        uics: refEik.get(`off:${o.slug}`) ?? [],
        regId: regId.get(o.slug) ?? null,
        cParty: partyOffice.get(o.slug) ?? null,
        cPartyOffice: partyOffice.has(o.slug),
      },
    );

  // MPs (data/parliament/index.json) — the mp id is the cross-source GOLD KEY (Tier 0),
  // and birthDate is a strong name-independent corroborant. Degrades gracefully if the
  // file is absent (fresh clone without the parliament data).
  const mpPath = path.join(REPO_ROOT, "data/parliament/index.json");
  if (fs.existsSync(mpPath)) {
    const idx = JSON.parse(fs.readFileSync(mpPath, "utf8")) as {
      mps: {
        id: number;
        name: string;
        // currentRegion is a bare region NAME on most rows but a {code,name} object on
        // some — normalize to the name string so it never renders as raw JSON.
        currentRegion: string | { code?: string; name?: string } | null;
        currentPartyGroupShort: string | null;
        birthDate: string | null;
      }[];
    };
    for (const mp of idx.mps) {
      const region =
        typeof mp.currentRegion === "object" && mp.currentRegion !== null
          ? (mp.currentRegion.name ?? null)
          : (mp.currentRegion ?? null);
      add(
        mp.name,
        { id: `mp:${mp.id}`, source: "mp", ref: String(mp.id), role: "mp" },
        {
          hardId: `mp:${mp.id}`,
          regId: regId.get(String(mp.id)) ?? null,
          place: region,
          cParty: mp.currentPartyGroupShort,
          cPlace: region,
          cBirth: mp.birthDate,
          uics: refEik.get(`mp:${mp.id}`) ?? [],
        },
      );
    }
  }

  // Sanctions (data/person/sanctions.json) — OFFICIAL OFAC/EU designations of Bulgarian
  // individuals (public record, §5 T1 `sanctions` facet). To never implicate the WRONG
  // same-named person, an entry attaches ONLY via a stable disambiguator (mpId → Tier-0
  // gold key); a name-ambiguous designee (`resolved:false`, no mpId) is documented in the
  // file but NOT emitted, so no ambiguous public accusation is minted.
  const sanctionsPath = path.join(REPO_ROOT, "data/person/sanctions.json");
  if (fs.existsSync(sanctionsPath)) {
    const sx = JSON.parse(fs.readFileSync(sanctionsPath, "utf8")) as {
      designees: {
        name: string;
        mpId?: number;
        resolved?: boolean;
        program: string;
        authority: string;
        date: string;
        url: string;
      }[];
    };
    let heldSanctions = 0;
    for (const d of sx.designees) {
      // Strictest gate on the most defamation-sensitive source: attach ONLY via the mpId
      // gold key, and never if the entry is explicitly held (resolved:false).
      if (d.mpId == null || d.resolved === false) {
        heldSanctions++;
        continue;
      }
      add(
        d.name,
        {
          id: `sanctions:mp:${d.mpId}`,
          source: "sanctions",
          ref: `mp:${d.mpId}`,
          role: "sanctioned",
        },
        {
          hardId: `mp:${d.mpId}`,
          place: d.program,
          sourceRow: {
            program: d.program,
            authority: d.authority,
            date: d.date,
            url: d.url,
          },
        },
      );
    }
    if (heldSanctions)
      console.log(
        `  held ${heldSanctions} name-ambiguous sanction(s) for manual disambiguation`,
      );
  }

  // ДС / COMDOS (data/person/ds.json) — OFFICIAL findings of the Комисия по досиетата
  // (comdos.bg) naming public-office holders established affiliated to State Security /
  // БНА intelligence (public record, §5 T1 `ds` facet). These are government verdicts,
  // not our claim. SAME defamation posture as sanctions: comdos.bg has no bulk feed, so
  // the register is HAND-CURATED from the published решения, and an entry attaches ONLY
  // via the parliament MP id (Tier-0 gold key) AND with an exact birth-date match against
  // the решение — a name-ambiguous namesake (`resolved:false`, no mpId; e.g. a решение-14
  // person whose birth date differs from the current same-named MP) is documented in the
  // file but NOT emitted, so no ambiguous public accusation is minted.
  const dsPath = path.join(REPO_ROOT, "data/person/ds.json");
  if (fs.existsSync(dsPath)) {
    const dx = JSON.parse(fs.readFileSync(dsPath, "utf8")) as {
      affiliations: {
        name: string;
        mpId?: number;
        resolved?: boolean;
        decisionNo: string;
        decisionDate: string;
        category?: string;
        pseudonyms?: string[];
        bodyContext: string;
        url: string;
      }[];
    };
    let heldDs = 0;
    for (const d of dx.affiliations) {
      // Strictest gate: attach a State-Security finding ONLY via the mpId gold key, and
      // never if the entry is explicitly held (resolved:false).
      if (d.mpId == null || d.resolved === false) {
        heldDs++;
        continue;
      }
      add(
        d.name,
        {
          id: `ds:mp:${d.mpId}`,
          source: "ds",
          ref: `mp:${d.mpId}`,
          role: "ds_affiliation",
        },
        {
          hardId: `mp:${d.mpId}`,
          place: d.bodyContext,
          sourceRow: {
            decisionNo: d.decisionNo,
            decisionDate: d.decisionDate,
            bodyContext: d.bodyContext,
            category: d.category ?? null,
            pseudonyms: d.pseudonyms ?? [],
            url: d.url,
          },
        },
      );
    }
    if (heldDs)
      console.log(
        `  held ${heldDs} name-ambiguous ДС affiliation(s) for manual disambiguation`,
      );
  }

  // Regulators (data/person/regulators.json) — curated ROSTERS of the independent /
  // regulatory bodies (Конституционен съд, Сметна палата, КФН, БНБ УС, СЕМ, КЗК,
  // Омбудсман…), the §5 T1 `regulator` "кой решава" facet. Same accuracy discipline as
  // sanctions: an entry attaches ONLY via a stable disambiguator — a parliament `mpId`
  // (Tier-0 gold merge) OR a name the register author has confirmed globally-unique — so
  // a seat is never pinned to the WRONG same-named person. An entry with `resolved:false`
  // (name-ambiguous, no mpId) is documented in the file but NOT emitted. The seat name is
  // the `role`, the body the display `place`, and {body, seat, termStart, url} the
  // provenance jsonb. Most regulators are NOT MPs, so most attach by unique name (the
  // resolver's Tier-2, namesake-gated) or mint their own regulator-only person — either
  // way clustering (cluster.ts) can never false-merge them onto a common namesake.
  const regulatorsPath = path.join(REPO_ROOT, "data/person/regulators.json");
  if (fs.existsSync(regulatorsPath)) {
    const rg = JSON.parse(fs.readFileSync(regulatorsPath, "utf8")) as {
      members: {
        name: string;
        mpId?: number;
        body: string;
        seat: string;
        termStart?: string;
        url: string;
        resolved?: boolean;
      }[];
    };
    let heldReg = 0;
    for (const m of rg.members) {
      // Emit only stable-disambiguator entries: an mpId (gold key) OR resolved:true (a
      // name the author verified unique). Everything else is held for review.
      if (m.mpId == null && m.resolved !== true) {
        heldReg++;
        continue;
      }
      add(
        m.name,
        {
          id:
            m.mpId != null
              ? `regulator:mp:${m.mpId}:${m.seat}`
              : `regulator:${m.seat}:${m.name}`,
          source: "regulator",
          ref:
            m.mpId != null ? `mp:${m.mpId}:${m.seat}` : `${m.seat}:${m.name}`,
          role: m.seat,
        },
        {
          hardId: m.mpId != null ? `mp:${m.mpId}` : null,
          place: m.body,
          sourceRow: {
            body: m.body,
            seat: m.seat,
            termStart: m.termStart ?? null,
            url: m.url,
          },
        },
      );
    }
    if (heldReg)
      console.log(
        `  held ${heldReg} name-ambiguous regulator seat(s) for manual disambiguation`,
      );
  }

  const partyMap = buildPartyMap();

  // Candidates (data/{election}/candidates/by-slug/*.json). Each file is one candidacy in
  // one election, already resolved to an MP id when the candidate was seated (`mpId`) —
  // the Tier-0 GOLD link into the MP person. Non-MP candidacies (c-*) carry party+oblast,
  // the cross-election corroborant. ~67k files across ~10 elections; skipped on a fresh
  // clone without the candidate shards.
  for (const dir of globSync(
    path.join(REPO_ROOT, "data/2*/candidates/by-slug"),
  )) {
    const election = path.basename(path.dirname(path.dirname(dir)));
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const c = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        slug: string;
        name: string;
        partyNum: number | null;
        oblasts: string[];
        mpId: number | null;
      };
      const canon =
        c.partyNum != null
          ? (partyMap.get(`${election}#${c.partyNum}`) ?? null)
          : null;
      const oblast = c.oblasts[0] ?? null;
      add(
        c.name,
        {
          id: `candidate:${election}:${c.slug}`,
          source: "candidate",
          ref: `${election}:${c.slug}`,
          role: "candidate",
        },
        {
          hardId: c.mpId != null ? `mp:${c.mpId}` : null,
          place: oblast,
          cParty: canon,
          cPlace: oblast,
        },
      );
    }
  }

  // Donors (data/{election}/parties/financing/{partyNum}/filing.json → data.fromDonors[]).
  // ЕРИК campaign-finance donors are 2-part names (§2a) with no place, so they never
  // auto-merge (Tier-2 needs a 3-part name; weak-both needs a place) — same-name donors
  // surface only as review candidates, exactly as the plan expects. public_default=false
  // (person_source), so a donor-only person is NOT public. One role per (donor, party,
  // election): a donor giving multiple times folds to one row.
  for (const fin of globSync(
    path.join(REPO_ROOT, "data/2*/parties/financing"),
  )) {
    const election = path.basename(path.dirname(path.dirname(fin)));
    for (const partyNum of fs.readdirSync(fin)) {
      const filing = path.join(fin, partyNum, "filing.json");
      if (!fs.existsSync(filing)) continue;
      const f = JSON.parse(fs.readFileSync(filing, "utf8")) as {
        data?: { fromDonors?: { name: string }[] };
      };
      const canon = partyMap.get(`${election}#${partyNum}`) ?? null;
      const seenDonor = new Set<string>();
      for (const d of f.data?.fromDonors ?? []) {
        const p = parseName(d.name);
        if (!p) {
          skipped++;
          continue;
        }
        if (seenDonor.has(p.displayName)) continue; // one role per distinct donor
        seenDonor.add(p.displayName);
        out.push({
          id: `donor:${election}:${partyNum}:${p.displayName}`,
          source: "donor",
          ref: `${election}:${partyNum}:${p.displayName}`,
          role: "donor",
          ...fields(p, { cParty: canon }),
        });
      }
    }
  }

  // Local mayors & councillors (data/<cycle>/municipalities/<code>.json → the ELECTED
  // office holders: `mayor.elected` + each council party's `candidates[isElected]`). The
  // canonical party (`primaryCanonicalId`) + obshtina are corroborants — so a councillor
  // re-elected across cycles merges, and a councillor who later became an MP links by name.
  // Regular (mi) and partial (chmi) cycles share this structure.
  for (const file of globSync(
    path.join(REPO_ROOT, "data/*mi*/municipalities/*.json"),
  )) {
    const d = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cycle: string;
      obshtinaCode: string;
      obshtinaName: string | null;
      mayor?: {
        elected?: {
          candidateName?: string;
          primaryCanonicalId?: string | null;
        };
      };
      council?: {
        localPartyNum: number;
        primaryCanonicalId: string | null;
        candidates?: { listPos: number; name: string; isElected?: boolean }[];
      }[];
    };
    const place = d.obshtinaName ?? d.obshtinaCode;
    const mayor = d.mayor?.elected;
    if (mayor?.candidateName)
      add(
        mayor.candidateName,
        {
          id: `local:${d.cycle}:${d.obshtinaCode}:mayor`,
          source: "local",
          ref: `${d.cycle}:${d.obshtinaCode}:mayor`,
          role: "mayor",
        },
        { place, cParty: mayor.primaryCanonicalId ?? null, cPlace: place },
      );
    for (const party of Array.isArray(d.council) ? d.council : [])
      for (const c of party.candidates ?? [])
        if (c.isElected && c.name)
          add(
            c.name,
            {
              id: `local:${d.cycle}:${d.obshtinaCode}:${party.localPartyNum}:${c.listPos}`,
              source: "local",
              ref: `${d.cycle}:${d.obshtinaCode}:${party.localPartyNum}:${c.listPos}`,
              role: "councillor",
            },
            {
              place,
              cParty: party.primaryCanonicalId ?? null,
              cPlace: place,
            },
          );
  }

  // TR-officer BRIDGE (Bridge A, plan §3 "share a company"). For every EIK a person is
  // linked to, pull the TR officer/owner rows on that company and keep only those whose
  // name matches the linked person's (given, family) — that is the person's own
  // authoritative TR footprint. These mentions carry the EIK as a strong `uics`
  // corroborant, so they merge into the linked person (Tier 1 strong), patronymic-guarded.
  // We do NOT materialize a person per TR officer: a TR mention that fails to bridge
  // (patronymic conflict, or an unrelated same-EIK co-owner) forms a tr-only group that is
  // dropped in main(). ~1.5k rows on ~360 linked EIKs — bounded, not the 748k-officer set.
  const linkedEiks = [...eikExpected.keys()];
  if (linkedEiks.length) {
    const trRows = await allRows<{ uic: string; name: string; role: string }>(
      `SELECT uic, name, role FROM tr_person_roles WHERE uic = ANY($1::text[])`,
      [linkedEiks],
    );
    const seenTr = new Set<string>();
    for (const t of trRows) {
      const p = parseName(t.name);
      if (!p) continue;
      const key = `${p.given.toLowerCase()}\t${p.family.toLowerCase()}`;
      if (!eikExpected.get(t.uic)?.has(key)) continue; // only the linked person's name
      const dedup = `${t.uic}\t${key}\t${t.role}`;
      if (seenTr.has(dedup)) continue;
      seenTr.add(dedup);
      const src = trOrNgo(t.role); // NGO board seat → `ngo` facet, else company `tr`
      out.push({
        id: `${src}:${t.uic}:${p.displayName}:${t.role}`,
        source: src,
        ref: t.uic, // the company / ЮЛНЦ EIK
        role: t.role,
        ...fields(p, { uics: [t.uic] }),
      });
    }
  }

  if (skipped) console.log(`  skipped ${skipped} un-parseable name(s)`);
  return out;
}

// Fold the raw name parts and full names with the ONE normalizer (SQL), and look up
// the namesake company-count — one round trip each, keyed by the distinct strings.
async function foldAndScore(
  raw: Raw[],
): Promise<{ fold: Map<string, string>; namesake: Map<string, number> }> {
  const strs = new Set<string>();
  for (const r of raw) {
    strs.add(r.given);
    strs.add(r.family);
    strs.add(r.display);
    if (r.patr) strs.add(r.patr);
  }
  const foldRows = await allRows<{ s: string; f: string }>(
    `SELECT s, translit_bg_latin(s) AS f FROM unnest($1::text[]) AS s`,
    [[...strs]],
  );
  const fold = new Map(foldRows.map((r) => [r.s, r.f]));

  const fullFolds = [...new Set(raw.map((r) => fold.get(r.display)!))];
  const ncRows = await allRows<{ name_fold: string; company_count: string }>(
    `SELECT name_fold, company_count FROM officer_name_counts WHERE name_fold = ANY($1::text[])`,
    [fullFolds],
  );
  const namesake = new Map(
    ncRows.map((r) => [r.name_fold, Number(r.company_count)]),
  );
  return { fold, namesake };
}

type M = Mention & { raw: Raw };

// The person-layer schema files, applied (idempotent CREATE … IF NOT EXISTS) before every
// resolve so `db:refresh` / a fresh clone can rebuild from an empty DB — nothing else wires
// these in. Order matters: core tables → election tables → serving fns → review queue.
// 085 (candidate_person / person_election_stats) MUST precede 082, because 082's person_search
// reads person_election_stats in a LATERAL and a LANGUAGE-sql body is validated at CREATE time
// — so on a fresh DB (a new clone or the first Cloud SQL deploy) applying 082 before the 085
// table exists fails with `relation "person_election_stats" does not exist`. The
// db:load:person-elections:pg loader re-applies 085 (idempotently) and fills the rows.
const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/schema/pg",
);
const SCHEMA_FILES = [
  "081_person_identity.sql",
  "085_person_elections.sql",
  "082_person_api.sql",
  "083_person_review.sql",
  "084_person_connections.sql",
];

// The skill /process-watch-report queues for the person layer. The marker file
// MUST be named for it — the orchestrator looks up state/ingest/<skill>.json,
// so a marker filed under any other name is a marker it never finds.
const INGEST_SKILL = "update-persons";

// Skip the marker and the changelog row. `db:resolve:persons:cloud` passes it:
// that run re-derives the layer on Cloud SQL, and the marker answers "when was
// the LOCAL layer last rebuilt" — letting a cloud-only publish advance it would
// make the orchestrator consider a stale local layer current. Also the escape
// hatch for a scratch run.
const skipStamp = process.argv.includes("--no-stamp");

async function main(): Promise<void> {
  console.log(
    "resolving persons (magistrate + officials + MPs + candidates + donors + local + tr-bridge)…",
  );
  for (const f of SCHEMA_FILES)
    await exec(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));
  const raw = await collect();
  const { fold, namesake } = await foldAndScore(raw);

  // §6 privacy gate: a person is public only if some source they hold defaults public
  // (person_source.public_default). All current sources are public, but tr/donor/ngo
  // (public_default=false) must NOT mint a public page for a private individual.
  const publicDefault = new Map(
    (
      await allRows<{ key: string; public_default: boolean }>(
        `SELECT key, public_default FROM person_source`,
      )
    ).map((r) => [r.key, r.public_default]),
  );

  // GOLD-KEY ALIASING. A mention can carry TWO independent gold keys — the parliament MP
  // id and the Сметна палата register person id — and when both sit on the SAME mention
  // they name one identity by construction (that MP filed that declaration). Fold the two
  // key spaces into one canonical key here, so the rest of the resolver keeps its simple
  // single-hardId model: clusterBlock's Tier 0 and main()'s cross-block union then stitch
  // an MP to their declarations, and a register person to every slug the officials ingest
  // minted for them, without either tier learning about the second key space.
  const kp = new Map<string, string>();
  const kfind = (x: string): string => {
    const p = kp.get(x);
    if (p === undefined || p === x) return x;
    const r = kfind(p);
    kp.set(x, r);
    return r;
  };
  const kunion = (a: string, b: string): void => {
    const [ra, rb] = [kfind(a), kfind(b)];
    // Smallest key wins, so the canonical representative is deterministic across runs.
    if (ra !== rb) kp.set(ra > rb ? ra : rb, ra > rb ? rb : ra);
  };
  for (const r of raw) if (r.hardId && r.regId) kunion(r.hardId, r.regId);
  const regKeyed = raw.filter((r) => r.regId).length;
  const aliased = new Set(
    raw.flatMap((r) => (r.hardId && r.regId ? [kfind(r.hardId)] : [])),
  ).size;

  const mentions: M[] = raw.map((r) => ({
    id: r.id,
    source: r.source,
    hardId: ((k) => (k == null ? null : kfind(k)))(r.hardId ?? r.regId),
    givenFold: fold.get(r.given)!,
    familyFold: fold.get(r.family)!,
    patronymicFold: r.patr ? fold.get(r.patr)! : null,
    nameParts: r.nameParts,
    ambiguous: r.ambiguous,
    namesakeRisk: namesake.get(fold.get(r.display)!) ?? 0,
    corroborants: {
      party: r.cParty,
      place: r.cPlace,
      birthDate: r.cBirth,
      uics: r.uics,
      partyOffice: r.cPartyOffice,
    },
    raw: r,
  }));

  // Block on (given_fold, family_fold); cluster each block.
  const blocks = new Map<string, M[]>();
  for (const m of mentions) {
    const k = `${m.givenFold}\t${m.familyFold}`;
    const arr = blocks.get(k) ?? blocks.set(k, []).get(k)!;
    arr.push(m);
  }

  type Group = { ids: string[]; confidence: "exact_id" | "high" };
  const groups: Group[] = [];
  type Review = {
    blockKey: string;
    memberIds: string[];
    reason: "twopart_block" | "identical_fullname";
  };
  const reviews: Review[] = [];
  for (const [blockKey, block] of blocks) {
    const res = clusterBlock(block);
    const merged = new Set<string>();
    for (const mg of res.merges) {
      groups.push({ ids: mg.memberIds, confidence: mg.confidence });
      mg.memberIds.forEach((id) => merged.add(id));
    }
    for (const m of block)
      if (!merged.has(m.id)) groups.push({ ids: [m.id], confidence: "high" });
    for (const rc of res.reviewCandidates)
      reviews.push({ blockKey, memberIds: rc.memberIds, reason: rc.reason });
  }

  const byId = new Map(mentions.map((m) => [m.id, m]));

  // Global GOLD-KEY union (Tier 0, cross-block). A parliament MP id is the same person
  // under ANY name spelling, but blocking is on (given_fold, family_fold) — so a name
  // variant (marriage, transliteration) can scatter one MP's candidacies across blocks.
  // Merge any groups that share a hardId, regardless of block; a shared gold key ⇒
  // exact_id. (Within-block same-hardId mentions already merged in clusterBlock; this
  // only stitches the cross-block remainder.)
  const gp = groups.map((_, i) => i);
  const gfind = (x: number): number =>
    gp[x] === x ? x : (gp[x] = gfind(gp[x]));
  const firstByHard = new Map<string, number>();
  groups.forEach((g, i) => {
    const hard = new Set<string>();
    for (const id of g.ids) {
      const h = byId.get(id)!.hardId;
      if (h) hard.add(h);
    }
    for (const h of hard) {
      const seen = firstByHard.get(h);
      if (seen === undefined) firstByHard.set(h, i);
      else {
        const a = gfind(seen);
        const b = gfind(i);
        if (a !== b) gp[a] = b;
      }
    }
  });
  const unionComps = new Map<number, string[]>();
  groups.forEach((g, i) => {
    const r = gfind(i);
    (unionComps.get(r) ?? unionComps.set(r, []).get(r)!).push(...g.ids);
  });
  const mergedGroups: Group[] = [...unionComps.values()].map((ids) => {
    // exact_id iff a gold key is shared by >=2 members of the final group.
    const hs = ids
      .map((id) => byId.get(id)!.hardId)
      .filter((h): h is string => h != null);
    return {
      ids,
      confidence: new Set(hs).size < hs.length ? "exact_id" : "high",
    };
  });

  // Build person rows with deterministic slugs, then sort by slug and assign ids so a
  // rebuild is stable.
  type Built = {
    slug: string;
    display: string;
    given: string;
    patr: string | null;
    family: string;
    nameParts: number;
    namesake: number;
    confidence: "exact_id" | "high";
    isPublic: boolean;
    members: M[];
  };
  const built: Built[] = mergedGroups
    // Drop bridge-only groups: a TR/NGO officer that failed to bridge to a real person (a
    // same-EIK co-owner, or a patronymic conflict) is NOT materialized (plan §3 bounded
    // universe). Both `tr` and `ngo` are bridge sources — never a standalone person.
    .filter((g) =>
      g.ids.some((id) => {
        const s = byId.get(id)!.source;
        return s !== "tr" && s !== "ngo";
      }),
    )
    .map((g) => {
      const members = g.ids.map((id) => byId.get(id)!);
      // Slug priority: the mp id gold key (stable, /candidate/mp-{id} lineage) > an
      // official's existing slug > a derived name+hash. Deterministic across runs.
      const mpMember = members
        .filter((m) => m.source === "mp")
        .sort((a, b) => Number(a.raw.ref) - Number(b.raw.ref))[0];
      const officialMember = members
        .filter((m) => isOfficialSource(m.source))
        .sort((a, b) => a.raw.ref.localeCompare(b.raw.ref))[0];
      const key = members[0];
      const best = members
        .map((m) => m.raw)
        .sort(
          (a, b) =>
            b.nameParts - a.nameParts || b.display.length - a.display.length,
        )[0];
      const slug = mpMember
        ? `mp-${mpMember.raw.ref}`
        : officialMember
          ? officialMember.raw.ref
          : `${kebab(`${key.givenFold}-${key.familyFold}`)}-${hash6(
              g.ids.slice().sort().join("|"),
            )}`;
      return {
        slug,
        display: best.display,
        given: key.givenFold,
        patr: members.find((m) => m.patronymicFold)?.patronymicFold ?? null,
        family: key.familyFold,
        nameParts: members.some((m) => m.nameParts === 3) ? 3 : 2,
        namesake: Math.max(...members.map((m) => m.namesakeRisk)),
        confidence: g.confidence,
        isPublic: members.some((m) => publicDefault.get(m.source) ?? false),
        members,
      };
    });

  // Guarantee slug uniqueness (belt-and-suspenders — a magistrate slug could in theory
  // collide with an official slug).
  const seen = new Set<string>();
  for (const b of built) {
    let s = b.slug;
    let i = 2;
    while (seen.has(s)) s = `${b.slug}-${i++}`;
    b.slug = s;
    seen.add(s);
  }
  built.sort((a, b) => a.slug.localeCompare(b.slug));

  const personRows: unknown[][] = [];
  const roleRows: unknown[][] = [];
  const aliasRows: unknown[][] = [];
  const aliasSeen = new Set<string>();
  const mentionToPid = new Map<string, number>(); // mention id -> its person's pid
  built.forEach((b, idx) => {
    const pid = idx + 1;
    for (const m of b.members) mentionToPid.set(m.id, pid);
    personRows.push([
      pid,
      b.display,
      b.given,
      b.patr,
      b.family,
      b.nameParts,
      b.slug,
      b.isPublic, // §6 privacy gate — derived from person_source.public_default
      b.namesake,
      "active",
    ]);
    for (const m of b.members) {
      roleRows.push([
        pid,
        m.source,
        m.raw.ref,
        m.raw.role,
        // The CANONICAL party id behind this role, when the source speaks that namespace
        // (candidacies, local mandates, donations, and a party officer's institution all
        // resolve through canonical_parties.json). `mp` is excluded: its party corroborant
        // is a parliamentary-GROUP short name, not a party id, and mixing the two in one
        // column would make them look comparable. Persisting it is what lets the
        // person_resolve gate re-check the party-office merge licence against the data
        // rather than take the resolver's word for it.
        m.source === "mp" ? null : m.raw.cParty,
        m.raw.place,
        null, // start_date
        null, // end_date
        b.confidence,
        m.raw.sourceRow == null ? null : JSON.stringify(m.raw.sourceRow),
      ]);
      const ak = `${pid}\t${m.raw.display}\t${m.source}`;
      if (!aliasSeen.has(ak)) {
        aliasSeen.add(ak);
        aliasRows.push([pid, m.raw.display, m.source]);
      }
    }
  });

  // Persist the review queue (plan §3 tier 3, aggressive-merge holding area). Map each
  // ambiguous group's mentions to the persons they landed in; a group is real only if it
  // spans >=2 DISTINCT persons (mentions that actually merged, or dropped tr mentions,
  // aren't ambiguous). group_key is a deterministic hash of the sorted member slugs, so a
  // re-run addresses the same group. NOTHING is merged here — each person stays active.
  const reviewRows: unknown[][] = [];
  const reviewSeen = new Set<string>();
  const reviewGroups = new Set<string>();
  for (const rc of reviews) {
    const pids = [
      ...new Set(
        rc.memberIds
          .map((id) => mentionToPid.get(id))
          .filter((p): p is number => p !== undefined),
      ),
    ];
    if (pids.length < 2) continue;
    const slugs = pids.map((p) => built[p - 1].slug).sort();
    const groupKey = `${kebab(rc.blockKey.replace("\t", "-"))}-${hash6(slugs.join("|"))}`;
    const namesake = Math.max(...pids.map((p) => built[p - 1].namesake));
    reviewGroups.add(groupKey);
    for (const p of pids) {
      const rk = `${groupKey}\t${p}`;
      if (reviewSeen.has(rk)) continue;
      reviewSeen.add(rk);
      reviewRows.push([groupKey, p, rc.blockKey, namesake, rc.reason]);
    }
  }

  let bridgeBRoles = 0;
  let aliasesInserted = 0;
  await withTx(async (c) => {
    // Rebuild only the derived tables. DELETE, not TRUNCATE … CASCADE: five tables carry
    // an FK to person and they do NOT want the same treatment. person_role / person_alias
    // / person_review_candidate / person_link_evidence are ON DELETE CASCADE — derived,
    // rebuilt below. But `declaration` is ON DELETE SET NULL on purpose: the filings are
    // an INGESTED corpus that outlives any one resolve, and phase 2 of
    // load_declarations_pg re-attaches person_id afterwards. TRUNCATE ignores per-FK
    // delete actions and truncates every referencing table outright, so it wiped the whole
    // declaration tree (declaration + its four ON DELETE CASCADE children) on every run —
    // silently, because phase 2 then reports "filled 0; 0/0 still NULL" and the wealth
    // matview refreshes to 0 rows, both of which read like success. DELETE honours SET
    // NULL. person_link_override is human-authored (fold-keyed, no FK) and survives either
    // way. The person_id sequence is re-set by the setval at the end of this tx.
    await c.query(`DELETE FROM person`);
    await copyRows(
      c,
      "person",
      [
        "person_id",
        "display_name",
        "given_fold",
        "patronymic_fold",
        "family_fold",
        "name_parts",
        "slug",
        "is_public_figure",
        "namesake_risk",
        "status",
      ],
      personRows,
    );
    await copyRows(
      c,
      "person_role",
      [
        "person_id",
        "source",
        "ref",
        "role",
        "party",
        "place",
        "start_date",
        "end_date",
        "confidence",
        "source_row",
      ],
      roleRows,
    );
    // person_alias is keyed on (person_id, alias_fold, source) where alias_fold
    // is GENERATED from translit_bg_latin(alias_raw). One person can hold
    // several officials slugs — slugify() folds in the institution, so a
    // minister who moves ministries gets one slug per posting — and the
    // ten-year officials backfill made that ordinary rather than rare. Those
    // rows carry the same name for the same person and source, so they collide
    // on the fold. Dedupe through a staging table using the same PG function
    // rather than approximating the transliteration in JS.
    await c.query(
      `CREATE TEMP TABLE tmp_person_alias (
         person_id bigint NOT NULL,
         alias_raw text   NOT NULL,
         source    text   NOT NULL
       ) ON COMMIT DROP`,
    );
    await copyRows(
      c,
      "tmp_person_alias",
      ["person_id", "alias_raw", "source"],
      aliasRows,
    );
    const aliasIns = await c.query(
      `INSERT INTO person_alias (person_id, alias_raw, source)
       SELECT DISTINCT ON (person_id, translit_bg_latin(alias_raw), source)
              person_id, alias_raw, source
         FROM tmp_person_alias
        ORDER BY person_id, translit_bg_latin(alias_raw), source, alias_raw`,
    );
    aliasesInserted = aliasIns.rowCount ?? 0;
    await copyRows(
      c,
      "person_review_candidate",
      ["group_key", "person_id", "block_key", "namesake_risk", "reason"],
      reviewRows,
    );

    // Bridge B (name-based TR discovery). A public person with a globally-unique 3-part
    // name whose full-name fold matches a TR officer/owner appearing on exactly ONE
    // company is unambiguously that person on that company — Tier-2 (unique fold),
    // name-independent of any block co-collision. Discovers the TR footprint BEYOND
    // Bridge A's curated links. DOUBLE-gated: unique in tr_officers (namesake_risk<=1)
    // AND unique in tr_person_roles (cc=1). Only touches namesake<=1 persons, so it can
    // never form a common-name collapse. Runs in SQL (the folds live in PG); the ON
    // CONFLICT dedups against Bridge-A rows on the same (person, company, role).
    const bridgeB = await c.query(
      `INSERT INTO person_role (person_id, source, ref, role, confidence)
       SELECT DISTINCT p.person_id,
              CASE WHEN t.role IN ('ngo_board','ngo_representative') THEN 'ngo' ELSE 'tr' END,
              t.uic, t.role, 'high'
         FROM person p
         JOIN (
           SELECT name_fold, count(DISTINCT uic) cc FROM tr_person_roles
            WHERE name_fold IN (
                    SELECT name_fold FROM person
                     WHERE name_parts = 3 AND namesake_risk <= 1 AND is_public_figure)
            GROUP BY name_fold HAVING count(DISTINCT uic) = 1
         ) u ON u.name_fold = p.name_fold
         JOIN tr_person_roles t ON t.name_fold = p.name_fold
        WHERE p.name_parts = 3 AND p.namesake_risk <= 1 AND p.is_public_figure
       ON CONFLICT (person_id, source, ref, role) DO NOTHING`,
    );
    bridgeBRoles = bridgeB.rowCount ?? 0;

    await c.query(
      `SELECT setval(pg_get_serial_sequence('person','person_id'), (SELECT COALESCE(max(person_id),1) FROM person))`,
    );
  });

  const summary =
    `${personRows.length} persons, ${roleRows.length} roles (+${bridgeBRoles} tr bridge-B), ` +
    `${regKeyed} mention(s) keyed by the register person id (${aliased} aliased to an MP id); ` +
    `${aliasesInserted} aliases (${aliasRows.length - aliasesInserted} dup folds collapsed); ` +
    `${reviewGroups.size} review group(s) over ${reviewRows.length} person(s)`;
  console.log(`  ${summary}`);

  // Stamp the marker /process-watch-report compares against, from the run
  // itself rather than from a step an operator has to remember. The person
  // layer is a pure re-derivation downstream of every people source, so
  // whenever one of those changes the orchestrator queues `update-persons` —
  // and with no marker under that name it queued it forever, on every run.
  //
  // Guarded on a non-empty result: the rebuild TRUNCATEs first, so a run
  // against upstreams that were never loaded (fresh clone, wrong DATABASE_URL)
  // resolves zero rows. Stamping that would tell the orchestrator the layer is
  // current and make it skip the layer SILENTLY — the mirror of the bug this
  // marker exists to fix, and the harder one to notice.
  //
  // The marker records THIS re-derivation. The skill also runs
  // `db:load:person-elections:pg` afterwards; that loader is a separate step
  // and the summary says so rather than implying it ran.
  if (skipStamp) {
    // nothing to record — cloud publish or scratch run
  } else if (personRows.length === 0) {
    console.warn(
      "  0 persons resolved — marker NOT stamped; the upstream tables look empty",
    );
  } else {
    writeIngestState(INGEST_SKILL, {
      summary: `db:resolve:persons: ${summary}. person-elections load runs separately.`,
    });
    // The person_* tables are Postgres-only and write nothing under data/, so
    // the orchestrator's `git diff --stat data/` gate never sees this layer.
    // Self-report, the way every other PG-migrated dataset does.
    appendDataChange({
      skill: INGEST_SKILL,
      summary: `Профилите на публичните лица преизчислени — ${personRows.length.toLocaleString("bg-BG")} лица, ${roleRows.length.toLocaleString("bg-BG")} длъжности`,
      source: "Регистър на лицата (обединена самоличност)",
      dedupeSameDay: true,
    });
  }
  await end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
