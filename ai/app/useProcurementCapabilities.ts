import { useEffect, useState } from "react";
import { fetchDb } from "../tools/dataClient";
import { PROCUREMENT_QUERY_VERSION } from "../../src/lib/procurementQuery";
import { PROCUREMENT_TEMPLATES } from "../../src/lib/questions/contracts/procurement";
import type { QuestionCatalog } from "../../src/lib/questions/types";
type Capabilities = {
  version: string;
  corpora: Record<string, { ready: boolean; risks: string[] }>;
};
export function useProcurementCapabilities(
  catalog: QuestionCatalog,
): QuestionCatalog {
  const [cap, setCap] = useState<Capabilities | null>(null);
  useEffect(() => {
    let active = true;
    void fetchDb<Capabilities>("procurement-capabilities")
      .then((c) => {
        if (active) setCap(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return {
    ...catalog,
    questions: catalog.questions.filter((q) => {
      if (!q.id.startsWith("procurement-query-")) return true;
      const t = PROCUREMENT_TEMPLATES.find(
          (t) => "procurement-query-" + t.id === q.id,
        ),
        c = t && cap?.corpora[String(t.query.corpus)];
      return (
        cap?.version === PROCUREMENT_QUERY_VERSION &&
        c?.ready &&
        (!(t?.query.numeratorPredicates as string[] | undefined)?.length ||
          (t!.query.numeratorPredicates as string[]).every((p) =>
            c.risks.includes(p.replace("risk:", "")),
          ))
      );
    }),
  };
}
