import { it, expect } from "vitest";
import {
  rollcallDisplayRow,
  rollcallDateLabel,
  rollcallStatus,
} from "./rollcallPresentation";
import { procurementPageCsv } from "./procurementExport";
it("year-only evidence stays year-only in public rows and export", () => {
  const r = rollcallDisplayRow(
    {
      key: "opaque-2022-01-01",
      session_key: "HKV34:2022-01-01",
      date: "2022-01-01",
      year_only: true,
      title: "=SUM(A1)",
    },
    "en",
  );
  expect(r.date).toBe("2022");
  expect(rollcallDateLabel("2022-01-01", 1)).toBe("2022");
  const csv = procurementPageCsv(
    [{ Date: r.date, Title: r.title }],
    "2022",
    "r",
  );
  expect(csv).not.toContain("2022-01-01");
  expect(csv).toContain("'=SUM(A1)");
  expect(csv).toContain("Current page only");
  expect(csv).toContain("Revision");
});
it("source absence and comparison status use human labels", () => {
  expect(
    rollcallDisplayRow({ choice: "recordedAbsent", title: null }, "bg"),
  ).toMatchObject({
    choice: "Записано отсъствие",
    title: "Без заглавие в източника",
  });
  expect(rollcallStatus("partial", "bg")).toBe("Непълно покритие");
});
it("drill-down scope exposes its inherited body, dates and choice", async () => {
  const { rollcallDisplayScope } = await import("./rollcallPresentation");
  const { validateRollcallQuery, encodeRollcallQuery } =
    await import("./rollcallQuery");
  const parent = validateRollcallQuery({
    corpus: "councilResolutions",
    councilIds: ["RSE01"],
    from: "2025-01-01",
    toExclusive: "2026-01-01",
  });
  if (!parent.ok) throw Error();
  const child = validateRollcallQuery({
    corpus: "councilCasts",
    choice: "against",
    parentQuery: encodeRollcallQuery(parent.query),
    relationship: "voteCasts",
  });
  if (!child.ok) throw Error();
  const scope = rollcallDisplayScope(child.query, "en", [
    { body: "RSE01", body_name: "Община Русе" },
  ]);
  expect(scope).toContain("Община Русе");
  expect(scope).toContain("2025-01-01");
  expect(scope).toContain("Against");
  expect(scope).not.toContain("All indexed dates");
});
it("a child roll labels parent person constraints only with matching identity evidence", async () => {
  const { rollcallDisplayScope } = await import("./rollcallPresentation");
  const { validateRollcallQuery, encodeRollcallQuery } =
    await import("./rollcallQuery");
  const parent = validateRollcallQuery({
    corpus: "parliamentVotes",
    seatIds: ["52:7"],
  });
  if (!parent.ok) throw Error();
  const child = validateRollcallQuery({
    corpus: "parliamentCasts",
    parentQuery: encodeRollcallQuery(parent.query),
    relationship: "voteCasts",
  });
  if (!child.ok) throw Error();
  const rows = [
    { person_key: "52:7", name: "Person A" },
    { person_key: "52:8", name: "Person B" },
  ];
  const scope = rollcallDisplayScope(child.query, "en", rows);
  expect(scope).toContain("Person A");
  expect(scope).not.toContain("Person B");
  expect(rollcallDisplayScope(parent.query, "en", [rows[1]])).toContain("52:7");
});
