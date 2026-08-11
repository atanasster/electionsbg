/**
 * Replay a stream of TR ChangeEvents into a per-company state map. Pure / sync.
 *
 * Events must arrive in chronological order — sort by filingDate before
 * piping in, otherwise a later Erase may not match a not-yet-applied Add.
 *
 * Erase events do NOT delete records; they set `erasedAt` so historical links
 * survive (needed for "all companies where person X *ever* held a role"). Use
 * `currentPersons(c)` to get only currently-active records.
 */

import type { TrChangeEvent, TrCompanyState, TrPersonState } from "./types";

export const normalizePersonName = (s: string): string =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

const personKey = (recordId: string, fieldIdent: string) =>
  `${recordId}|${fieldIdent}`;

const ensureCompany = (
  state: Map<string, TrCompanyState>,
  uic: string,
  filingDate: string,
): TrCompanyState => {
  let c = state.get(uic);
  if (!c) {
    c = {
      uic,
      name: null,
      legalForm: null,
      seat: null,
      funds: null,
      status: "unknown",
      lastUpdated: filingDate,
      objectives: null,
      means: null,
      publicBenefit: null,
      privateBenefit: null,
      persons: new Map(),
    };
    state.set(uic, c);
  } else if (!c.lastUpdated || (filingDate && filingDate > c.lastUpdated)) {
    c.lastUpdated = filingDate;
  }
  return c;
};

export const replayEvents = (
  events: TrChangeEvent[],
  initial?: Map<string, TrCompanyState>,
): Map<string, TrCompanyState> => {
  const state = initial ?? new Map<string, TrCompanyState>();

  for (const ev of events) {
    if (ev.kind === "person_added") {
      const c = ensureCompany(state, ev.uic, ev.filingDate);
      const ps: TrPersonState = {
        role: ev.role,
        name: ev.personName,
        nameNormalized: normalizePersonName(ev.personName),
        positionLabel: ev.positionLabel,
        country: ev.country,
        shareAmount: ev.shareAmount,
        shareCurrency: ev.shareCurrency,
        recordId: ev.recordId,
        groupId: ev.groupId,
        fieldIdent: ev.fieldIdent,
        addedAt: ev.filingDate,
        erasedAt: null,
      };
      c.persons.set(personKey(ev.recordId, ev.fieldIdent), ps);
      // CompanyName updates that come on Deed-level $ aren't change events;
      // they come through company_meta with field "name". But the partner-add
      // on a brand-new deed often arrives before any Company meta event, so
      // record the deed's CompanyName opportunistically when we encounter it.
      if (ev.companyName && !c.name) c.name = ev.companyName;
    } else if (ev.kind === "share_transferred") {
      const c = ensureCompany(state, ev.uic, ev.filingDate);
      const key = personKey(ev.recordId, ev.fieldIdent);

      // If the replay already holds a shareholder record for this person, the transfer is
      // simply their exit — stamp it and add nothing. Minting a second row would
      // double-count them in every "companies where X held a role" lookup.
      //
      // "Already holds" MUST include a record erased in this same filing, not just an
      // active one. A SubDeed lists its sections in fixed order and `Partners`/`Erase`
      // precedes `ShareTransfers`, so on an ООД→ЕООД consolidation the seller is already
      // erased by the time the transfer is replayed. Measured on a contiguous replay of the
      // first 150 days: matching only active records minted 768 duplicates out of 12,220
      // rows (6.3%), and the rate climbs as the window widens.
      const target = normalizePersonName(ev.oldOwnerName);
      // ONE transfer ends ONE holding, so at most one record is stamped. Only a SHAREHOLDER
      // can transfer a share — a manager of the same name is a different record, and erasing
      // them would retire a sitting director on the strength of a share sale.
      //
      // Stamping every matching record instead over-erases: 43,692 (company, person) pairs
      // hold more than one shareholder record, and a partial transfer — TR's ShareTransfer
      // carries a ShareAmount precisely because a stake can move in part — would retire
      // somebody who still holds the rest. Measured on a full rebuild, the stamp-all form
      // erased ~12,000 rows beyond one-per-transfer. Where a person really does transfer two
      // holdings the feed files two ShareTransfer records, so each still gets its own stamp.
      const mine = [...c.persons.values()].filter(
        (p) =>
          p.nameNormalized === target &&
          (p.role === "partner" || p.role === "sole_owner"),
      );
      // Already accounted for if a record was erased earlier in THIS filing: a SubDeed lists
      // Partners/Erase before ShareTransfers, so on an ООД→ЕООД consolidation the seller is
      // erased by the time the transfer replays.
      let stamped = mine.some((p) => p.erasedAt === ev.filingDate);
      if (!stamped) {
        // Oldest still-open holding first — deterministic, and the one a transfer most
        // plausibly ends.
        const open = mine
          .filter((p) => p.erasedAt === null)
          .sort((a, b) => (a.addedAt ?? "").localeCompare(b.addedAt ?? ""));
        if (open.length) {
          open[0].erasedAt = ev.filingDate;
          stamped = true;
        }
      }
      if (!stamped && !c.persons.has(key)) {
        // The recovery case: a shareholder the feed never saw arrive, because their stake
        // predates the 2021-01-01 window. `addedAt` is NULL — the transfer states when they
        // left and nothing about when they arrived, and a null start is what stops a
        // consumer drawing a period out of a single observed instant.
        c.persons.set(key, {
          role: ev.role,
          name: ev.oldOwnerName,
          nameNormalized: target,
          positionLabel: null,
          country: ev.country,
          shareAmount: ev.shareAmount,
          shareCurrency: null,
          recordId: ev.recordId,
          groupId: null,
          fieldIdent: ev.fieldIdent,
          addedAt: null,
          erasedAt: ev.filingDate,
        });
      }
      if (ev.companyName && !c.name) c.name = ev.companyName;
    } else if (ev.kind === "person_section_erased") {
      const c = state.get(ev.uic);
      if (!c) continue;
      // Stamp every currently-active record under this fieldIdent as erased.
      // Records keep their entry in the map so reverse lookups for historical
      // affiliations still find them; SQLite persists `erased_at` so callers
      // can filter "currently active" via `WHERE erased_at IS NULL`.
      for (const p of c.persons.values()) {
        if (p.fieldIdent === ev.fieldIdent && p.erasedAt === null) {
          p.erasedAt = ev.filingDate;
        }
      }
      if (ev.filingDate && (!c.lastUpdated || ev.filingDate > c.lastUpdated)) {
        c.lastUpdated = ev.filingDate;
      }
    } else if (ev.kind === "company_meta") {
      const c = ensureCompany(state, ev.uic, ev.filingDate);
      switch (ev.field) {
        case "name":
          if (ev.value) c.name = ev.value;
          break;
        case "legal_form":
          if (ev.value) c.legalForm = ev.value;
          break;
        case "seat":
          if (ev.value) c.seat = ev.value;
          break;
        case "funds":
          if (ev.value) {
            const m = ev.value.match(/^(-?\d+(?:\.\d+)?)/);
            const amount = m ? m[1] : ev.value;
            c.funds = { amount, currency: "BGN" };
          }
          break;
        case "cessation":
        case "addemption":
          c.status = "ceased";
          break;
        case "objectives":
          if (ev.value) c.objectives = ev.value;
          break;
        case "means":
          if (ev.value) c.means = ev.value;
          break;
        case "public_benefit":
          c.publicBenefit = ev.value === "1";
          break;
        case "private_benefit":
          c.privateBenefit = ev.value === "1";
          break;
        case "bankruptcy_open":
        case "bankruptcy_declared":
          c.status = "bankrupt";
          break;
        case "liquidation":
          c.status = "in_liquidation";
          break;
      }
    } else if (ev.kind === "company_meta_erased") {
      // For a clean implementation we'd re-derive status from remaining records,
      // but for now we just clear back to "active" when a status flag is erased.
      const c = state.get(ev.uic);
      if (!c) continue;
      // Erasing a cessation/bankruptcy/liquidation reverts to active.
      if (
        ev.fieldIdent === "00260" ||
        ev.fieldIdent === "00270" ||
        ev.fieldIdent === "09010" ||
        ev.fieldIdent === "09100" ||
        ev.fieldIdent === "05010"
      ) {
        c.status = "active";
      }
    }
  }

  // Companies that ended up with non-null name and no terminal status — mark active
  for (const c of state.values()) {
    if (c.status === "unknown" && c.name) c.status = "active";
  }

  return state;
};

/** Currently-active person records on a company (i.e. not erased). */
export const currentPersons = (c: TrCompanyState): TrPersonState[] => {
  const out: TrPersonState[] = [];
  for (const p of c.persons.values()) {
    if (p.erasedAt === null) out.push(p);
  }
  return out;
};
