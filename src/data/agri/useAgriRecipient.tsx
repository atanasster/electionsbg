// Per-legal-entity subsidy rollup for one EIK (/farm/:eik + the /company/:eik
// tile). null when the EIK received no subsidies.

import { useQuery } from "@tanstack/react-query";
import { fetchAgriPayload } from "./fetchAgriPayload";
import type { AgriRecipientFile } from "./types";

export const useAgriRecipient = (eik: string | null | undefined) =>
  useQuery({
    queryKey: ["agri", "recipient", eik] as const,
    queryFn: () =>
      eik ? fetchAgriPayload<AgriRecipientFile>("recipient", eik) : null,
    enabled: !!eik,
    staleTime: Infinity,
  });
