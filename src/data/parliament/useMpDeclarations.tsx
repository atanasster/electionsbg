import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";
import type {
  MpAsset,
  MpDeclaration,
  MpDeclarationEvent,
  MpIncomeRecord,
  MpOwnershipStake,
} from "@/data/dataTypes";

// Served from Postgres (mp_declarations(), migration 105) via /api/db/mp-declarations —
// replaces the parliament/declarations/{id}.json shard (persons-pg-retirement-v1 T2.1b). The
// route is slug-keyed; the ?id= path resolves the person from the mp id (candidate screens have
// no slug). The SQL fn's JSON vocabulary differs from the MpDeclaration type at a few keys, so
// the filing is reshaped here rather than changing every consumer:
//   year→declarationYear, type→declarationType, stakes→ownershipStakes (tableNum→table),
//   income eurDeclarant→amountEurDeclarant / eurSpouse→amountEurSpouse.
// `itemType` on a stake has no PG column (declaration_stake carries none) — it renders only as
// an optional subtitle segment, so it maps to null. `assets` keys match MpAsset verbatim.

/** The mp_declarations() per-filing JSON, before the vocabulary reshape below. */
interface RawStake {
  tableNum: string;
  companyName: string | null;
  holderName: string | null;
  transfereeName: string | null;
  shareSize: string | null;
  valueEur: number | null;
  registeredOffice: string | null;
}
interface RawIncome {
  parent: string | null;
  category: string | null;
  eurDeclarant: number | null;
  eurSpouse: number | null;
}
interface RawEvent {
  kind: MpDeclarationEvent["kind"];
  description: string | null;
  detail: string | null;
  location: string | null;
  municipality: string | null;
  valueEur: number | null;
  legalBasis: string | null;
}
export interface RawFiling {
  declarantName: string;
  institution: string;
  year: number;
  fiscalYear: number | null;
  type: string;
  filedAt: string | null;
  entryNumber: string | null;
  controlHash: string | null;
  sourceUrl: string;
  stakes?: RawStake[];
  income?: RawIncome[];
  assets?: MpAsset[];
  events?: RawEvent[];
}

const reshapeStake = (st: RawStake): MpOwnershipStake => ({
  table: st.tableNum as "10" | "11",
  itemType: null,
  shareSize: st.shareSize,
  companyName: st.companyName,
  registeredOffice: st.registeredOffice,
  valueEur: st.valueEur,
  holderName: st.holderName,
  legalBasis: null,
  fundsOrigin: null,
  transfereeName: st.transfereeName,
});

const reshapeIncome = (r: RawIncome): MpIncomeRecord => ({
  parent: r.parent,
  category: r.category,
  amountEurDeclarant: r.eurDeclarant,
  amountEurSpouse: r.eurSpouse,
});

// mp_declarations omits areaSqm/builtAreaSqm/currency on events; no consumer reads .events, so
// they are null-filled to satisfy the type rather than dropped.
const reshapeEvent = (e: RawEvent): MpDeclarationEvent => ({
  kind: e.kind,
  description: e.description,
  detail: e.detail,
  location: e.location,
  municipality: e.municipality,
  areaSqm: null,
  builtAreaSqm: null,
  currency: null,
  valueEur: e.valueEur,
  legalBasis: e.legalBasis,
});

export const reshapeFiling = (f: RawFiling, mpId: number): MpDeclaration => ({
  mpId,
  declarantName: f.declarantName,
  institution: f.institution,
  declarationYear: f.year,
  fiscalYear: f.fiscalYear,
  declarationType: f.type,
  filedAt: f.filedAt,
  entryNumber: f.entryNumber,
  controlHash: f.controlHash,
  sourceUrl: f.sourceUrl,
  ownershipStakes: (f.stakes ?? []).map(reshapeStake),
  income: (f.income ?? []).map(reshapeIncome),
  assets: f.assets ?? [],
  events: (f.events ?? []).map(reshapeEvent),
});

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  MpDeclaration[]
> => {
  const id = queryKey[1];
  if (!id) return [];
  const response = await fetch(`/api/db/mp-declarations?id=${id}`);
  if (!response.ok) {
    throw new Error(`mp-declarations: ${response.status} ${response.url}`);
  }
  const body = (await response.json()) as RawFiling[] | null;
  return Array.isArray(body) ? body.map((f) => reshapeFiling(f, id)) : [];
};

export const useMpDeclarations = (name?: string | null) => {
  const id = useMpIdForName(name) ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["mp_declarations", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  return { declarations: data ?? [], isLoading };
};
