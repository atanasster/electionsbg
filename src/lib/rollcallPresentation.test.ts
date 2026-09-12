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
