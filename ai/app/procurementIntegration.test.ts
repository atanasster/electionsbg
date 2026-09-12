import { expect, it } from "vitest";
import {
  PROCUREMENT_QUESTIONS,
  procurementTemplate,
} from "../../src/lib/questions/contracts/procurement";
import { toChatQuestionIntent } from "./questionAdapter";
import { procurementContinuations } from "./procurementContinuations";
import { siteLinks } from "../render/links";
import {
  decodeProcurementQuery,
  validateProcurementQuery,
} from "../../src/lib/procurementQuery";
import { procurementPageCsv } from "../../src/lib/procurementExport";
import type { Envelope } from "../tools/types";
it.each(
  PROCUREMENT_QUESTIONS.filter(
    (q) => q.chat.capabilityId === "procurementQuery",
  ),
)("catalog $id retains identity and editable year", (q) => {
  for (const lang of ["bg", "en"] as const) {
    const intent = toChatQuestionIntent(q.id, lang, { year: 2025 });
    expect(intent.args).toEqual(procurementTemplate(q.id, 2025, lang).query);
    expect(intent.text).toContain("2025");
    expect(intent.text).not.toContain("2026");
    expect(q.sql.status).toBe("unavailable");
  }
});
it("followups and links preserve scope and numerator", () => {
  const parsed = validateProcurementQuery({
    corpus: "contracts",
    operation: "share",
    metric: "oneBid",
    from: "2026-01-01",
    toExclusive: "2027-01-01",
    subjectSectors: ["roads"],
    buyerIds: ["000695089"],
  });
  if (!parsed.ok) throw Error();
  const env: Envelope = {
    tool: "procurementQuery",
    kind: "scalar",
    title: "query",
    facts: {},
    viz: "none",
    provenance: [],
    procurement: {
      query: parsed.query,
      result: { status: "success", revision: { contracts: "7" } },
    },
  };
  for (const follow of procurementContinuations(env).filter(
    (f) => !f.intent?.args.parentQuery,
  ))
    expect(follow.intent?.args).toMatchObject({
      from: "2026-01-01",
      subjectSectors: ["roads"],
      buyerIds: ["000695089"],
      metric: "oneBid",
    });
  const url = new URL(siteLinks(env)[0].href),
    decoded = decodeProcurementQuery(url.searchParams.get("query")!);
  expect(decoded).toEqual({ ok: true, query: parsed.query });
  expect(url.searchParams.get("revision")).toBe('{"contracts":"7"}');
});
it("page export labels cap and prevents formula injection", () => {
  const csv = procurementPageCsv(
    [{ title: "=SUM(A1:A2)", buyer: "+cmd", value: 12 }],
    "scope",
    { contracts: 7 },
  );
  expect(csv).toContain("Current page only");
  expect(csv).toContain("'=SUM");
  expect(csv).toContain("'+cmd");
});
