// The ИСУН procedures under one programme — the tile on /funds/programme/{code}.
//
// Deliberately NOT the corpus-wide catalogue: that payload is 333 KB, and
// fetching it on every programme page to render one tile is 333 KB spent to
// show at most 25 rows. The per-programme shard is a few KB.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";

export interface FundsProcedureIndexEntry {
  procedureCode: string;
  // Null when the procedure's contracts do not share one title, which is the
  // common case — ИСУН publishes no procedure name and only 22 of the 985
  // indexable procedures have contracts uniform enough to derive one.
  procedureName: string | null;
  programCode: string;
  programName: string;
  contractCount: number;
  beneficiaryCount: number;
  totalEur: number;
  paidEur: number;
}

export interface FundsProgramProceduresFile {
  programCode: string;
  // Indexable procedures under this programme — can exceed `procedures.length`,
  // which is capped at 25 so the tile stays a tile.
  procedureCount: number;
  procedures: FundsProcedureIndexEntry[];
}

export const useFundsProgramProcedures = (programCode: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "procedure-by-program", programCode ?? ""],
    queryFn: () =>
      fetchFundPayload<FundsProgramProceduresFile>(
        "procedure-by-program",
        programCode!,
      ),
    enabled: !!programCode,
    staleTime: Infinity,
  });
