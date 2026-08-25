// Component guard for the НЗОК reimbursement tile's PER-STREAM AS-OF.
//
// НЗОК publishes three reports per month on one listing page and a hospital's
// income is their sum, so the payload takes each stream at its OWN latest month —
// deliberately, because pinning them to one date would silently drop a lagging
// stream's money from the total. The cost is that a figure can be older than the
// date beside it, and the tile's headline is the БМП anchor.
//
// Measured before the Tier 1 parser work: devices lagged БМП by five months, so
// every hospital's devices figure was February's presented under a July heading —
// €32,312,935 nationally, 62.9% of that stream, with nothing on the page saying
// so. The payload has carried `periodByStream` on its national twin since
// migration 050, and that field's own type comment claimed "the tile footnotes the
// lag rather than silently dropping the lagging stream's money". No component read
// it. This file is what makes that comment true, so it must not become decorative.
//
// Hermetic: the data hooks are mocked, fetch is never reached (vitest.setup throws
// on an unstubbed one).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NzokHospitalReimbursement } from "@/data/budget/types";

const lang = { current: "bg" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: lang.current },
  }),
}));

const entry: { current: NzokHospitalReimbursement | null } = { current: null };
vi.mock("@/data/budget/useBudget", () => ({
  useNzokHospitalByEik: () => ({ data: entry.current }),
  useNzokHospitalMomentumByEik: () => ({ data: null }),
}));

vi.mock("./NzokPeerGrowthStrip", () => ({
  NzokPeerGrowthStrip: () => null,
}));

const { NzokHospitalReimbursementTile } =
  await import("./NzokHospitalReimbursementTile");

/** A hospital whose devices money is five months older than its БМП money — the
 *  real shape, from `nzok_hospital_reimbursement_by_eik('831605795')`, trimmed in
 *  two fields: live is `ownership: "state"` and `totalMonthEur: 3313374`. The null
 *  ownership suppresses the governance block, which these tests do not exercise. */
const lagging: NzokHospitalReimbursement = {
  asOf: "2026-07-31",
  ownership: null,
  totalCumulativeEur: 26883902,
  totalMonthEur: 1000,
  bmpEur: 23386775,
  drugsEur: 3387461,
  devicesEur: 109666,
  periodByStream: { bmp: "2026-07", drugs: "2026-07", devices: "2026-02" },
  facilities: [
    {
      regNo: "2201211067",
      name: "Тестова болница",
      cumulativeEur: 26883902,
      monthEur: 1000,
      bmpEur: 23386775,
      drugsEur: 3387461,
      devicesEur: 109666,
    },
  ],
};

beforeEach(() => {
  entry.current = null;
  lang.current = "bg";
});

describe("NzokHospitalReimbursementTile — per-stream as-of", () => {
  it("dates a stream that is older than the headline", () => {
    entry.current = lagging;
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    // ⚠️ The €109,666 beside "Медицински изделия" is FEBRUARY's, under a July
    // heading. Without this line a reader comparing two hospitals reads it as a
    // July figure, and comparing this hospital across months sees a flat devices
    // series that is simply the same month repeated.
    expect(screen.getByText(/по-стар отчет/)).toBeInTheDocument();
    expect(screen.getByText(/февруари 2026/)).toBeInTheDocument();
  });

  it("says the total mixes months when any stream lags", () => {
    entry.current = lagging;
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    // The headline number is a SUM across those months, so the caveat belongs
    // beside the total too — the per-stream dates explain which, but a reader who
    // only reads the big number would otherwise never reach them.
    expect(screen.getByText(/различни месеци/)).toBeInTheDocument();
  });

  it("says nothing when every stream is current", () => {
    // ⚠️ The mirror case, and the one that keeps the warning meaningful. A caveat
    // that is always on is furniture: a reader stops seeing it, and it stops
    // distinguishing the months where it matters. Streams in step must be silent.
    entry.current = {
      ...lagging,
      periodByStream: { bmp: "2026-07", drugs: "2026-07", devices: "2026-07" },
    };
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    // Anchor: prove the tile actually rendered, so the absences below mean "no
    // warning" and not "no component" — both assertions pass on a `return null`.
    expect(screen.getByText(/Медицински изделия/)).toBeInTheDocument();
    expect(screen.queryByText(/по-(стар|нов) отчет/)).not.toBeInTheDocument();
    expect(screen.queryByText(/различни месеци/)).not.toBeInTheDocument();
  });

  it("says nothing on a payload that carries no per-stream dates", () => {
    // The field is optional: a database whose 065 predates it returns no
    // `periodByStream`. Absent is NOT "everything is current" — but it is also not
    // something we can date, so the tile must not invent a claim either way. It
    // renders exactly as it did before, which is the honest degrade.
    entry.current = { ...lagging, periodByStream: undefined };
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    expect(screen.queryByText(/по-(стар|нов) отчет/)).not.toBeInTheDocument();
    expect(screen.queryByText(/различни месеци/)).not.toBeInTheDocument();
    // …and the money is still shown. A missing as-of must never hide a figure.
    expect(screen.getByText(/Медицински изделия/)).toBeInTheDocument();
  });

  it("does not warn about a stream absent from the latest month", () => {
    // ⚠️ Absent from `periodByStream` means this company has no rows in that
    // stream's LATEST month — the view pins every stream to its corpus-wide max
    // period, so the company may still have older ones (159 EIKs do). Either way
    // there is no month to name, and dating a figure we cannot date would be a
    // claim about a named hospital that is not true.
    entry.current = {
      ...lagging,
      devicesEur: 0,
      periodByStream: { bmp: "2026-07", drugs: "2026-07" },
    };
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    expect(screen.getByText(/Медицински изделия/)).toBeInTheDocument();
    expect(screen.queryByText(/по-(стар|нов) отчет/)).not.toBeInTheDocument();
  });

  it("dates a stream that is NEWER than the headline, and calls it newer", () => {
    // ⚠️ The mirror of the first test, and the direction an "older than" check
    // misses entirely. The headline is the БМП anchor — max period over LOADED
    // bmp rows — so a REFUSED bmp month leaves drugs/devices ahead of it. Measured
    // on this corpus: five periods carry drugs/devices rows and no bmp row at all
    // (2023-01/02/03, 2025-01, 2026-01), and 2026-01 is in the plan's own
    // rejection table. The total still mixes months, so both caveats must fire —
    // and the label must not call a newer report an older one.
    entry.current = {
      ...lagging,
      asOf: "2025-12-31",
      periodByStream: { bmp: "2025-12", drugs: "2026-01", devices: "2026-01" },
    };
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    expect(screen.getByText(/различни месеци/)).toBeInTheDocument();
    expect(screen.getAllByText(/януари 2026 — по-нов отчет/).length).toBe(2);
    expect(screen.queryByText(/по-стар отчет/)).not.toBeInTheDocument();
  });

  it("renders the caveats in English too", () => {
    // The BG arm is exercised by every test above; without this one the EN copy
    // could be missing, malformed or still say "older" for a newer report and
    // nothing would notice.
    lang.current = "en";
    entry.current = lagging;
    render(<NzokHospitalReimbursementTile eik="831605795" />);
    expect(screen.getByText(/from different months/)).toBeInTheDocument();
    expect(screen.getByText(/older report/)).toBeInTheDocument();
  });
});
