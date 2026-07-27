// React Query hook for the ИВСС magistrate-declaration register index.
//
// This artifact indexes WHAT was filed and WHEN — not the contents of the
// declarations. Each declaration is a 12-page PDF form; parsing 46k of them is a
// separate project (see scripts/judiciary/__write_declarations.ts). Filing gaps
// across years mostly reflect entering or leaving the corps, not misconduct, and
// are deliberately not surfaced as a per-magistrate compliance score.

import { useQuery } from "@tanstack/react-query";

export interface DeclarationYear {
  year: number;
  declarations: number;
  magistrates: number;
  /** The annual declaration, due 15 May. */
  annual: number;
  /** Change declarations (чл. 175в, ал. 5 ЗСВ), filed through the autumn. */
  change: number;
}

export interface FilingCalendar {
  basis: "annual";
  total: number;
  /** "DD.MM" — the statutory deadline for the annual declaration. */
  deadline: string;
  byMonth: { month: number; count: number }[];
  byDayOfMay: { day: number; count: number }[];
}

export interface IntegrityPerson {
  name: string;
  position: string;
  court: string;
  /** ИВСС footnote „(1) - лицето е подало декларация извън срока": the person
   *  DID file, after the deadline. Absent means they never filed at all — a
   *  materially different statement, so the two must never render alike. */
  filedLate: boolean;
  /** The list's fifth column, where it has one (discrepancy: "Вид декларация"). */
  extra?: string;
}

export interface IntegrityList {
  id: "annual_late" | "change_late" | "left_office_late" | "discrepancy";
  bg: string;
  en: string;
  legalRef: string;
  url: string;
  /** Each list carries its own year heading; the ИВСС maintains them separately. */
  year: number | null;
  people: IntegrityPerson[];
  /** Header of the fifth column, when the list has one. */
  extraBg?: string;
  extraEn?: string;
}

export interface DeclarationsFile {
  generatedAt: string;
  source: {
    publisher: string;
    url: string;
    register: string;
    description: string;
  };
  latestYear: number;
  totals: {
    declarations: number;
    magistrates: number;
    firstYear: number;
    lastYear: number;
  };
  years: DeclarationYear[]; // descending
  filingCalendar: FilingCalendar;
  integrity: IntegrityList[];
}

// Served from Postgres (judiciary_payloads, migration 109) via /api/db/judiciary-declarations
// — replaces the static data/judiciary/declarations.json (persons-pg-retirement-v1 T2.6). The
// route returns the register-index blob verbatim; a DB predating migration 109 returns a 200 +
// null body, which becomes undefined here so every consumer's `data?.years` guard shows the
// empty state instead of throwing.
const fetchDeclarations = async (): Promise<DeclarationsFile | undefined> => {
  const res = await fetch("/api/db/judiciary-declarations");
  if (!res.ok)
    throw new Error(`judiciary-declarations: ${res.status} ${res.url}`);
  const body = (await res.json()) as DeclarationsFile | null;
  return body && typeof body === "object" && Array.isArray(body.years)
    ? body
    : undefined;
};

export const useJudiciaryDeclarations = () =>
  useQuery({
    queryKey: ["judiciary", "declarations"] as const,
    queryFn: fetchDeclarations,
    staleTime: Infinity,
  });
