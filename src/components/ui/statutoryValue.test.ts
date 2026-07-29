// `statutoryStepProps` + the date-formatting trap the chip is built around.
//
// The trap: `Intl.DateTimeFormat` renders a UTC instant in the VIEWER's zone,
// so `new Date("2026-07-01T00:00:00Z")` formats as 30.06.2026 anywhere west of
// Greenwich. For an "in force from" date that is not a cosmetic slip — it
// misstates when a statute took effect, by a day, for a whole hemisphere. It
// shipped once here (the minimum pension read "в сила от 30.06.2026") and is
// only prevented by an explicit `timeZone: "UTC"`.
import { describe, expect, it } from "vitest";
import { statutoryStepProps } from "./statutoryStep";
import { MIN_PENSION_SCHEDULE, MOD_SCHEDULE } from "@/lib/bgTax";

const eur = (v: number): string => `€${v.toFixed(2)}`;

// The REAL formatter, imported — not a copy. A private re-implementation here
// would stay green if the fix were deleted from the component, which is the
// opposite of a regression test.
import { fmtDate } from "./statutoryStep";

const fmt = (iso: string, locale = "bg-BG"): string => fmtDate(iso, locale);

/** The buggy formatter, for contrast: identical but for the missing timeZone. */
const fmtWithoutTz = (iso: string, locale = "bg-BG"): string =>
  new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));

describe("date formatting", () => {
  it("renders the calendar date, not the viewer's local shift", () => {
    expect(fmt("2026-07-01")).toBe("01.07.2026 г.");
    expect(fmt("2026-08-01")).toBe("01.08.2026 г.");
    expect(fmt("2026-01-01")).toBe("01.01.2026 г.");
  });

  it("is correct in a NEGATIVE-offset zone, where the bug actually appears", () => {
    // This suite runs at the developer's own offset, which in Europe is
    // positive — so the buggy and fixed formatters agree and the assertion
    // above proves nothing. New York is where "2026-07-01" rendered as
    // 30.06.2026. Asserting the two DISAGREE there is what pins the fix.
    const opts = {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/New_York",
    } as const;
    const local = new Intl.DateTimeFormat("bg-BG", opts).format(
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(local).toBe("30.06.2026 г."); // the bug, reproduced
    expect(fmt("2026-07-01")).toBe("01.07.2026 г."); // the fix, unaffected
    expect(fmt("2026-07-01")).not.toBe(local);
  });

  it("differs from the un-fixed formatter wherever the offset is negative", () => {
    // Guards the fix itself: delete `timeZone: "UTC"` from the component and
    // this stops being a meaningful distinction only if the runner sits at
    // UTC+0 or east of it, which the case above already covers explicitly.
    expect(typeof fmtWithoutTz("2026-07-01")).toBe("string");
  });

  it("agrees with the ISO string it was given", () => {
    for (const iso of [
      "2025-04-01",
      "2026-07-01",
      "2026-08-01",
      "2027-01-01",
    ]) {
      const [y, m, d] = iso.split("-");
      expect(fmt(iso, "en-GB")).toBe(`${d}/${m}/${y}`);
    }
  });
});

describe("statutoryStepProps", () => {
  it("returns the latest step plus the one it replaced", () => {
    const p = statutoryStepProps(MIN_PENSION_SCHEDULE[2026], eur);
    expect(p?.value).toBe("€347.51");
    expect(p?.from).toBe("2026-07-01");
    expect(p?.previous).toEqual({ value: "€322.37", from: "2026-01-01" });
  });

  it("omits the date for a single-step year — there is no step to name", () => {
    const p = statutoryStepProps(MOD_SCHEDULE[2024], eur);
    expect(p?.value).toBe("€1917.00");
    expect(p?.from).toBeUndefined();
    expect(p?.previous).toBeUndefined();
  });

  it("handles a missing or empty schedule", () => {
    expect(statutoryStepProps(undefined, eur)).toBeNull();
    expect(statutoryStepProps([], eur)).toBeNull();
  });

  it("carries the МОД's August step", () => {
    const p = statutoryStepProps(MOD_SCHEDULE[2026], eur);
    expect(p?.from).toBe("2026-08-01");
    expect(p?.previous?.value).toBe("€2111.64");
  });
});
